/**
 * Emergency incidents. Deliberately independent of Gemini, duplicate detection,
 * maintenance SLAs, and approval workflows: the incident is persisted first, then
 * alerts are queued in the background.
 */
import {
  AppConfig,
  EmergencyAlertState,
  EmergencyEvent,
  EmergencyIncident,
  EmergencyLocation,
  EmergencyType,
  NotificationAttempt,
  ResponderShift,
  StudentEmergencyView,
  User
} from '../shared/types.js';
import { auditStore, SYSTEM_ACTOR } from './auditStore.js';
import { configStore } from './configStore.js';
import { dataPath, newId, readJsonFile, writeJsonFileAtomic } from './jsonFile.js';
import { getNotificationProviderStatus, notificationStore } from './notificationService.js';
import { userStore } from './userStore.js';

const MAX_ESCALATION_LEVEL = 2;
const TEXT_LIMIT = 200;

// ----------------------------------------------------------------------------
// Duty schedules
// ----------------------------------------------------------------------------

function localDayAndMinutes(now: Date, timezone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function isShiftActive(shift: ResponderShift, now: Date, timezone: string): boolean {
  const { day, minutes } = localDayAndMinutes(now, timezone);
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  if (start < end) return shift.days.includes(day) && minutes >= start && minutes < end;
  // Overnight shift: the part after midnight belongs to the previous day's shift
  const previousDay = (day + 6) % 7;
  return (shift.days.includes(day) && minutes >= start) || (shift.days.includes(previousDay) && minutes < end);
}

/** Active responders currently on shift for a zone (empty shift zone list = all zones). */
export function onDutyResponders(config: AppConfig, zoneId: string | undefined, opts: { backup: boolean }, now = new Date()): User[] {
  const responders = new Map(userStore.getActiveResponders().map((u) => [u.id, u]));
  const result = new Map<string, User>();
  for (const shift of config.shifts) {
    if (shift.isBackup !== opts.backup) continue;
    const user = responders.get(shift.userId);
    if (!user || !isShiftActive(shift, now, config.timezone)) continue;
    const coversZone = shift.zoneIds.length === 0 || (zoneId !== undefined && shift.zoneIds.includes(zoneId));
    if (coversZone) result.set(user.id, user);
  }
  return [...result.values()];
}

// ----------------------------------------------------------------------------
// Input validation
// ----------------------------------------------------------------------------

function optText(v: unknown, field: string, max = TEXT_LIMIT): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw new Error(`${field} must be text`);
  const t = v.trim();
  if (t.length > max) throw new Error(`${field} must be at most ${max} characters`);
  return t || undefined;
}

export function parseEmergencyLocation(raw: unknown): EmergencyLocation {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const gpsStatus = ['granted', 'denied', 'unavailable', 'not_requested'].includes(r.gpsStatus) ? r.gpsStatus : 'not_requested';
  let gps: EmergencyLocation['gps'];
  if (gpsStatus === 'granted' && r.gps) {
    const { latitude, longitude, accuracyMeters, capturedAt } = r.gps;
    const valid =
      typeof latitude === 'number' && latitude >= -90 && latitude <= 90 &&
      typeof longitude === 'number' && longitude >= -180 && longitude <= 180 &&
      typeof accuracyMeters === 'number' && accuracyMeters >= 0 && accuracyMeters < 1e6 &&
      typeof capturedAt === 'string' && !Number.isNaN(Date.parse(capturedAt));
    if (!valid) throw new Error('GPS coordinates are not valid');
    gps = { latitude, longitude, accuracyMeters, capturedAt: new Date(capturedAt).toISOString() };
  }
  return {
    campus: optText(r.campus, 'Campus'),
    building: optText(r.building, 'Building'),
    floor: optText(r.floor, 'Floor', 20),
    room: optText(r.room, 'Room', 20),
    details: optText(r.details, 'Location details', 300),
    gps,
    gpsStatus: gps ? 'granted' : gpsStatus === 'granted' ? 'unavailable' : gpsStatus
  };
}

// ----------------------------------------------------------------------------
// Store
// ----------------------------------------------------------------------------

export class EmergencyStore {
  private readonly file = dataPath('emergencies.json');
  private incidents = new Map<string, EmergencyIncident>();
  private counter = 1;

  constructor() {
    const stored = readJsonFile<{ incidents: EmergencyIncident[]; counter: number }>(this.file);
    for (const i of stored?.incidents ?? []) this.incidents.set(i.id, i);
    this.counter = stored?.counter ?? 1;
  }

  private persist() {
    writeJsonFileAtomic(this.file, { counter: this.counter, incidents: [...this.incidents.values()] });
  }

  get(id: string) {
    return this.incidents.get(id);
  }

  all(): EmergencyIncident[] {
    return [...this.incidents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private event(incident: EmergencyIncident, actor: Pick<User, 'id' | 'name'>, type: EmergencyEvent['type'], note?: string) {
    incident.events.push({ id: newId('evt'), at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, type, note });
    incident.updatedAt = new Date().toISOString();
  }

  /**
   * Creates an incident. Returns the existing one for a retried request
   * (same clientRequestId), or flags a possible duplicate when the same student
   * reported an open emergency moments ago and did not confirm it is a new one.
   */
  create(
    reporter: User,
    input: { clientRequestId: string; type: EmergencyType; location: EmergencyLocation; confirmNew: boolean },
    now = new Date()
  ): { incident: EmergencyIncident; created: boolean; possibleDuplicate: boolean } {
    const config = configStore.get();
    for (const i of this.incidents.values()) {
      if (i.reporterId === reporter.id && i.clientRequestId === input.clientRequestId) {
        return { incident: i, created: false, possibleDuplicate: false };
      }
    }
    if (!input.confirmNew) {
      const windowMs = config.emergencyDuplicateWindowSeconds * 1000;
      const recent = [...this.incidents.values()].find(
        (i) => i.reporterId === reporter.id && i.status !== 'closed' && now.getTime() - Date.parse(i.createdAt) < windowMs
      );
      if (recent) return { incident: recent, created: false, possibleDuplicate: true };
    }

    // Reporter details come from the server-side profile, never from the request
    const profile = userStore.getProfile(reporter.id);
    const location: EmergencyLocation = {
      ...input.location,
      campus: input.location.campus ?? profile?.campus,
      building: input.location.building ?? profile?.building,
      floor: input.location.floor ?? profile?.floor,
      room: input.location.room ?? profile?.room
    };
    const building = configStore.findBuilding(location.building);
    const iso = now.toISOString();
    const incident: EmergencyIncident = {
      id: `EM-${String(this.counter++).padStart(5, '0')}`,
      type: input.type,
      status: 'open',
      reporterId: reporter.id,
      reporter: { name: profile?.fullName || reporter.name, studentId: profile?.studentId || undefined, phone: profile?.phone || reporter.phone },
      location,
      zoneId: building?.zoneId,
      createdAt: iso,
      updatedAt: iso,
      clientRequestId: input.clientRequestId,
      notificationIds: [],
      notifiedResponderIds: [],
      respondingIds: [],
      escalationLevel: 0,
      events: []
    };
    this.event(incident, reporter, 'created', `Emergency reported (${input.type})`);
    this.incidents.set(incident.id, incident);
    this.persist(); // persisted before any notification work starts

    const primary = onDutyResponders(config, incident.zoneId, { backup: false }, now);
    this.alert(incident, primary, 'emergency_alert', 0);
    this.persist();
    return { incident, created: true, possibleDuplicate: false };
  }

  private alert(incident: EmergencyIncident, recipients: User[], purpose: NotificationAttempt['purpose'], level: number) {
    const loc = [incident.location.building, incident.location.floor && `floor ${incident.location.floor}`, incident.location.room && `room ${incident.location.room}`]
      .filter(Boolean)
      .join(', ');
    const gps = incident.location.gps ? ` GPS ${incident.location.gps.latitude.toFixed(5)},${incident.location.gps.longitude.toFixed(5)} (±${Math.round(incident.location.gps.accuracyMeters)}m)` : '';
    for (const r of recipients) {
      const attempt = notificationStore.enqueue({
        idempotencyKey: `${purpose}:${incident.id}:${level}:${r.id}`,
        purpose,
        subjectId: incident.id,
        recipient: r,
        subject: `${level > 0 ? `ESCALATION L${level}: ` : ''}Campus emergency ${incident.id} (${incident.type})`,
        body: `${incident.reporter.name}${incident.reporter.phone ? `, ${incident.reporter.phone}` : ''}. Location: ${loc || 'not provided'}${incident.location.details ? ` (${incident.location.details})` : ''}.${gps} Open CampusConnect to acknowledge.`
      });
      if (!incident.notificationIds.includes(attempt.id)) incident.notificationIds.push(attempt.id);
      if (!incident.notifiedResponderIds.includes(r.id)) incident.notifiedResponderIds.push(r.id);
    }
  }

  /** Escalates to the next level: 1 = on-duty backup responders, 2 = all on-duty responders and admins. */
  escalate(id: string, actor: Pick<User, 'id' | 'name'>, reason: string, now = new Date()): EmergencyIncident | null {
    const incident = this.incidents.get(id);
    if (!incident || incident.status === 'closed' || incident.escalationLevel >= MAX_ESCALATION_LEVEL) return null;
    const config = configStore.get();
    const level = incident.escalationLevel + 1;
    const recipients =
      level === 1
        ? onDutyResponders(config, incident.zoneId, { backup: true }, now)
        : [
            ...onDutyResponders(config, undefined, { backup: false }, now),
            ...onDutyResponders(config, undefined, { backup: true }, now),
            ...userStore.getActiveUsersByRole('admin')
          ];
    const unique = [...new Map(recipients.map((r) => [r.id, r])).values()];
    incident.escalationLevel = level;
    incident.lastEscalatedAt = now.toISOString();
    this.alert(incident, unique, 'emergency_escalation', level);
    this.event(
      incident,
      actor,
      'escalated',
      `Escalation level ${level}: ${reason}. ${unique.length === 0 ? 'No escalation recipients are configured or on duty.' : `${unique.length} recipient(s) alerted.`}`
    );
    this.persist();
    auditStore.record(actor, 'emergency.escalated', 'emergency', incident.id, `level ${level}: ${reason}`);
    return incident;
  }

  acknowledge(id: string, responder: User): EmergencyIncident | null {
    const incident = this.incidents.get(id);
    if (!incident || incident.status === 'closed') return null;
    if (!incident.acknowledgedBy) {
      incident.acknowledgedBy = { id: responder.id, name: responder.name, at: new Date().toISOString() };
      if (incident.status === 'open') incident.status = 'acknowledged';
    }
    this.event(incident, responder, 'acknowledged');
    this.persist();
    return incident;
  }

  markResponding(id: string, responder: User): EmergencyIncident | null {
    const incident = this.incidents.get(id);
    if (!incident || incident.status === 'closed') return null;
    if (!incident.acknowledgedBy) incident.acknowledgedBy = { id: responder.id, name: responder.name, at: new Date().toISOString() };
    if (!incident.respondingIds.includes(responder.id)) incident.respondingIds.push(responder.id);
    incident.status = 'responding';
    this.event(incident, responder, 'responding');
    this.persist();
    return incident;
  }

  addUpdate(id: string, actor: User, note: string): EmergencyIncident | null {
    const incident = this.incidents.get(id);
    if (!incident) return null;
    this.event(incident, actor, 'update', note);
    this.persist();
    return incident;
  }

  close(id: string, actor: User, outcome: string): EmergencyIncident | null {
    const incident = this.incidents.get(id);
    if (!incident || incident.status === 'closed') return null;
    incident.status = 'closed';
    incident.closedAt = new Date().toISOString();
    incident.outcome = outcome;
    this.event(incident, actor, 'closed', outcome);
    this.persist();
    auditStore.record(actor, 'emergency.closed', 'emergency', incident.id, outcome);
    return incident;
  }

  /** Scheduler: escalate open incidents nobody acknowledged within the configured timeout. */
  escalateOverdue(now = new Date()): string[] {
    const timeoutMs = configStore.get().emergencyAckTimeoutSeconds * 1000;
    const escalated: string[] = [];
    for (const i of this.incidents.values()) {
      if (i.status !== 'open' || i.escalationLevel >= MAX_ESCALATION_LEVEL) continue;
      const since = Date.parse(i.lastEscalatedAt ?? i.createdAt);
      if (now.getTime() - since >= timeoutMs) {
        if (this.escalate(i.id, SYSTEM_ACTOR, `No acknowledgement within ${Math.round(timeoutMs / 1000)} seconds`, now)) {
          escalated.push(i.id);
        }
      }
    }
    return escalated;
  }

  /** Whether a responder/admin may see this incident. Maintenance staff never can. */
  canView(incident: EmergencyIncident, user: User, now = new Date()): boolean {
    if (user.role === 'admin') return true;
    if (user.role !== 'responder') return false;
    if (incident.notifiedResponderIds.includes(user.id) || incident.respondingIds.includes(user.id) || incident.acknowledgedBy?.id === user.id) {
      return true;
    }
    // Currently on shift for this incident's zone (primary or backup)
    const config = configStore.get();
    return config.shifts.some(
      (s) =>
        s.userId === user.id &&
        isShiftActive(s, now, config.timezone) &&
        (s.zoneIds.length === 0 || (incident.zoneId !== undefined && s.zoneIds.includes(incident.zoneId)))
    );
  }

  listForStudent(studentId: string): StudentEmergencyView[] {
    return this.all().filter((i) => i.reporterId === studentId).map((i) => toStudentView(i));
  }
}

/** Derives a truthful alert state from recorded notification outcomes. */
export function deriveAlertState(incident: EmergencyIncident): { state: EmergencyAlertState; detail: string } {
  if (incident.status === 'closed') return { state: 'Closed', detail: incident.outcome ? 'Closed by a responder.' : 'Closed.' };
  if (incident.status === 'responding') return { state: 'Responder on the way', detail: 'A responder has marked themselves as responding.' };
  if (incident.acknowledgedBy) return { state: 'Acknowledged', detail: 'A responder acknowledged your alert.' };

  const attempts = incident.notificationIds.map((id) => notificationStore.get(id)).filter(Boolean) as NotificationAttempt[];
  const count = (s: NotificationAttempt['status']) => attempts.filter((a) => a.status === s).length;
  const escalatedNote = incident.escalationLevel > 0 ? ` Escalated to level ${incident.escalationLevel}.` : '';

  if (attempts.length === 0) {
    const provider = getNotificationProviderStatus();
    return provider.configured
      ? { state: 'No on-duty responders configured', detail: `No responder is scheduled on duty for this location, so no alert could be sent.${escalatedNote} Contact the campus emergency desk directly.` }
      : { state: 'Alerting not configured', detail: `Automatic alerts are not set up on this server and no responders are scheduled.${escalatedNote} Contact the campus emergency desk directly.` };
  }
  if (count('pending') + count('sending') > 0) return { state: 'Sending', detail: `Sending alerts to ${attempts.length} recipient(s)...` };
  const delivered = count('delivered');
  const accepted = count('accepted');
  if (delivered > 0) {
    return { state: incident.escalationLevel > 0 ? 'Escalated' : 'Alert sent', detail: `Delivery confirmed for ${delivered} of ${attempts.length} recipient(s). Awaiting acknowledgement.${escalatedNote}` };
  }
  if (accepted > 0) {
    return { state: incident.escalationLevel > 0 ? 'Escalated' : 'Awaiting acknowledgement', detail: `The alert provider accepted ${accepted} message(s); delivery is not yet confirmed.${escalatedNote}` };
  }
  if (count('not_configured') === attempts.length) {
    return { state: 'Alerting not configured', detail: `On-duty responders can see this alert in CampusConnect, but no message could be sent because alerting is not configured.${escalatedNote} Contact the campus emergency desk directly.` };
  }
  return { state: 'Delivery failed', detail: `Alerts could not be delivered (${count('failed')} failed, ${count('no_contact')} without contact details).${escalatedNote} Contact the campus emergency desk directly.` };
}

export function toStudentView(incident: EmergencyIncident): StudentEmergencyView {
  const { state, detail } = deriveAlertState(incident);
  return {
    id: incident.id,
    type: incident.type,
    status: incident.status,
    alertState: state,
    alertDetail: detail,
    createdAt: incident.createdAt,
    location: incident.location,
    acknowledgedAt: incident.acknowledgedBy?.at,
    escalationLevel: incident.escalationLevel,
    closedAt: incident.closedAt
  };
}

export const emergencyStore = new EmergencyStore();
