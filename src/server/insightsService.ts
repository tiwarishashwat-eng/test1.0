/**
 * Data-driven insights built only from persisted tickets, configured campus data,
 * and staff-recorded checks. No Gemini; no invented readings, costs, or savings.
 */
import {
  CampusFacility,
  FacilityType,
  RoomCheck,
  Ticket,
  TicketCategory,
  User
} from '../shared/types.js';
import { configStore } from './configStore.js';
import { dataPath, newId, readJsonFile, writeJsonFileAtomic } from './jsonFile.js';
import { sameBuilding } from './textSimilarity.js';
import { ticketRepository } from './ticketStore.js';

const DAY_MS = 24 * 3600 * 1000;

// ----------------------------------------------------------------------------
// Room / equipment checks (recorded by staff)
// ----------------------------------------------------------------------------

export class RoomCheckStore {
  private readonly file = dataPath('room-checks.json');
  private checks: RoomCheck[] = readJsonFile<{ checks: RoomCheck[] }>(this.file)?.checks ?? [];

  record(input: { roomId: string; assetId?: string; result: 'working' | 'issue'; note?: string }, actor: User): RoomCheck {
    const check: RoomCheck = { id: newId('chk'), ...input, checkedBy: actor.name, checkedById: actor.id, checkedAt: new Date().toISOString() };
    this.checks.push(check);
    writeJsonFileAtomic(this.file, { checks: this.checks });
    return check;
  }

  forRoom(roomId: string): RoomCheck[] {
    return this.checks.filter((c) => c.roomId === roomId).sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
  }
}

export const roomCheckStore = new RoomCheckStore();

// ----------------------------------------------------------------------------
// Repeat-offender detector
// ----------------------------------------------------------------------------

export interface RepeatOffender {
  assetId: string;
  assetName: string;
  assetType: string;
  building: string;
  ticketCount: number;
  windowDays: number;
  ticketIds: string[];
  firstReportAt: string;
  latestReportAt: string;
  reopenCount: number;
  hypotheses: string[]; // explicitly unverified
}

export function findRepeatOffenders(now = new Date()): { offenders: RepeatOffender[]; configuredAssets: number; ticketsWithAssets: number } {
  const config = configStore.get();
  const since = now.getTime() - config.repeatOffenderWindowDays * DAY_MS;
  const assets = new Map(config.assets.map((a) => [a.id, a]));
  const byAsset = new Map<string, Ticket[]>();
  let ticketsWithAssets = 0;
  for (const t of ticketRepository.getAllTicketsForSystem()) {
    if (!t.assetId || !assets.has(t.assetId)) continue;
    ticketsWithAssets++;
    if (Date.parse(t.createdAt) < since) continue;
    byAsset.set(t.assetId, [...(byAsset.get(t.assetId) ?? []), t]);
  }

  const offenders: RepeatOffender[] = [];
  for (const [assetId, tickets] of byAsset) {
    if (tickets.length < config.repeatOffenderThreshold) continue;
    const asset = assets.get(assetId)!;
    const sorted = [...tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const reopenCount = tickets.reduce((n, t) => n + (t.reopenRequests?.length ?? 0), 0);
    const hypotheses: string[] = [
      `Unverified: ${tickets.length} reports in ${config.repeatOffenderWindowDays} days suggests the underlying fault may not be addressed by previous repairs. Consider an inspection or a replacement assessment.`
    ];
    if (reopenCount > 0) hypotheses.push(`Unverified: students reported ${reopenCount} repair(s) as unsuccessful, which may indicate fixes are not holding.`);
    const categories = new Set(tickets.map((t) => t.category));
    if (categories.size === 1) hypotheses.push(`Unverified: all reports are ${[...categories][0]} issues, pointing to a single recurring failure mode.`);
    if (sorted.length >= 3) {
      const gaps = sorted.slice(1).map((t, i) => Date.parse(t.createdAt) - Date.parse(sorted[i].createdAt));
      if (gaps[gaps.length - 1] < gaps[0]) hypotheses.push('Unverified: the time between failures is getting shorter.');
    }
    offenders.push({
      assetId,
      assetName: asset.name,
      assetType: asset.type,
      building: asset.building,
      ticketCount: tickets.length,
      windowDays: config.repeatOffenderWindowDays,
      ticketIds: sorted.map((t) => t.id),
      firstReportAt: sorted[0].createdAt,
      latestReportAt: sorted[sorted.length - 1].createdAt,
      reopenCount,
      hypotheses
    });
  }
  return { offenders: offenders.sort((a, b) => b.ticketCount - a.ticketCount), configuredAssets: config.assets.length, ticketsWithAssets };
}

// ----------------------------------------------------------------------------
// Classroom readiness
// ----------------------------------------------------------------------------

export interface ReadinessItem {
  assetId: string;
  assetName: string;
  state: 'verified_working' | 'known_issue' | 'unknown';
  reason: string;
  lastVerifiedAt?: string;
}

export interface RoomReadiness {
  roomId: string;
  roomName: string;
  building: string;
  available: boolean; // false when data is insufficient for a score
  score?: number; // percentage of equipment verified working
  items: ReadinessItem[];
  explanation: string;
}

export function roomReadiness(roomId: string, now = new Date()): RoomReadiness | null {
  const config = configStore.get();
  const room = config.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const freshMs = config.verificationFreshnessHours * 3600 * 1000;
  const checks = roomCheckStore.forRoom(roomId);
  const openTickets = ticketRepository.getAllTicketsForSystem().filter((t) => t.status !== 'Resolved' && t.assetId);

  const items: ReadinessItem[] = room.assetIds.map((assetId) => {
    const asset = config.assets.find((a) => a.id === assetId);
    const name = asset?.name ?? assetId;
    const ticket = openTickets.find((t) => t.assetId === assetId);
    if (ticket) return { assetId, assetName: name, state: 'known_issue', reason: `Open ticket ${ticket.id} (${ticket.status})` };
    const latest = checks.find((c) => c.assetId === assetId) ?? checks.find((c) => !c.assetId);
    if (!latest) return { assetId, assetName: name, state: 'unknown', reason: 'Never checked' };
    const age = now.getTime() - Date.parse(latest.checkedAt);
    if (age > freshMs) return { assetId, assetName: name, state: 'unknown', reason: `Last check is older than ${config.verificationFreshnessHours}h (stale)`, lastVerifiedAt: latest.checkedAt };
    if (latest.result === 'issue') return { assetId, assetName: name, state: 'known_issue', reason: `Check by ${latest.checkedBy} found an issue${latest.note ? `: ${latest.note}` : ''}`, lastVerifiedAt: latest.checkedAt };
    return { assetId, assetName: name, state: 'verified_working', reason: `Verified working by ${latest.checkedBy}`, lastVerifiedAt: latest.checkedAt };
  });

  const unknown = items.filter((i) => i.state === 'unknown').length;
  if (items.length === 0 || unknown * 2 > items.length) {
    return {
      roomId,
      roomName: room.name,
      building: room.building,
      available: false,
      items,
      explanation: items.length === 0
        ? 'No equipment is configured for this room, so readiness cannot be scored.'
        : `Readiness unavailable: ${unknown} of ${items.length} items have no recent verified check.`
    };
  }
  const working = items.filter((i) => i.state === 'verified_working').length;
  return {
    roomId,
    roomName: room.name,
    building: room.building,
    available: true,
    score: Math.round((working / items.length) * 100),
    items,
    explanation: `${working} of ${items.length} items verified working within the last ${config.verificationFreshnessHours}h; ${items.filter((i) => i.state === 'known_issue').length} known issue(s); ${unknown} unknown/stale.`
  };
}

// ----------------------------------------------------------------------------
// Campus waste detector
// ----------------------------------------------------------------------------

const WASTE_RULES: { kind: 'water' | 'energy'; pattern: RegExp; label: string }[] = [
  { kind: 'water', pattern: /\b(leak|leaking|dripping|running tap|tap (is )?(left )?(open|running)|overflow|burst|paani (beh|bah)|nal (khula|band nahi))/i, label: 'Possible water waste (leak or running water)' },
  { kind: 'energy', pattern: /\b(lights?|fans?|ac|air ?con\w*|projector)\b.{0,40}\b(left on|always on|on all (day|night)|never (turned|switched) off|empty (room|class)|band nahi|chalu)/i, label: 'Possible energy waste (equipment left running)' }
];

export interface WasteSignal {
  ticketId: string;
  kind: 'water' | 'energy';
  label: string;
  building: string;
  location: string;
  status: Ticket['status'];
  reportedAt: string;
  verification: 'unverified' | 'confirmed' | 'rejected';
  reviewNote?: string;
}

export function detectWaste(): WasteSignal[] {
  const signals: WasteSignal[] = [];
  for (const t of ticketRepository.getAllTicketsForSystem()) {
    const text = `${t.problemTitle ?? ''} ${t.description}`;
    const rule = WASTE_RULES.find((r) => r.pattern.test(text));
    if (!rule) continue;
    signals.push({
      ticketId: t.id,
      kind: rule.kind,
      label: rule.label,
      building: t.building,
      location: t.location,
      status: t.status,
      reportedAt: t.createdAt,
      verification: t.wasteReview?.status ?? 'unverified',
      reviewNote: t.wasteReview?.note
    });
  }
  return signals.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
}

// ----------------------------------------------------------------------------
// Campus X-Ray (hotspots). Map view needs building coordinates; otherwise a list.
// ----------------------------------------------------------------------------

export interface Hotspot {
  building: string;
  verifiedLocation: boolean;
  latitude?: number;
  longitude?: number;
  openCount: number;
  resolvedCount: number;
  medianResolutionHours?: number;
  byCategory: Partial<Record<TicketCategory, number>>;
}

export function campusHotspots(windowDays = 30, now = new Date()): { hotspots: Hotspot[]; mapAvailable: boolean; windowDays: number } {
  const config = configStore.get();
  const since = now.getTime() - windowDays * DAY_MS;
  const groups = new Map<string, { tickets: Ticket[]; verified: boolean; lat?: number; lng?: number }>();
  for (const t of ticketRepository.getAllTicketsForSystem()) {
    if (Date.parse(t.createdAt) < since) continue;
    const b = config.buildings.find((cb) => sameBuilding(cb.name, t.building));
    const key = b ? b.name : 'Unrecognised location';
    const g = groups.get(key) ?? { tickets: [], verified: Boolean(b), lat: b?.latitude, lng: b?.longitude };
    g.tickets.push(t);
    groups.set(key, g);
  }
  const hotspots: Hotspot[] = [...groups.entries()].map(([building, g]) => {
    const durations = g.tickets
      .filter((t) => t.status === 'Resolved' && t.resolvedAt)
      .map((t) => (Date.parse(t.resolvedAt!) - Date.parse(t.createdAt)) / 3600000)
      .sort((a, b) => a - b);
    const byCategory: Hotspot['byCategory'] = {};
    for (const t of g.tickets) byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
    return {
      building,
      verifiedLocation: g.verified,
      latitude: g.lat,
      longitude: g.lng,
      openCount: g.tickets.filter((t) => t.status !== 'Resolved').length,
      resolvedCount: durations.length,
      medianResolutionHours: durations.length ? Math.round(durations[Math.floor(durations.length / 2)] * 10) / 10 : undefined,
      byCategory
    };
  });
  return {
    hotspots: hotspots.sort((a, b) => b.openCount - a.openCount),
    mapAvailable: config.buildings.some((b) => b.latitude !== undefined && b.longitude !== undefined),
    windowDays
  };
}

// ----------------------------------------------------------------------------
// Instant workaround suggestions
// ----------------------------------------------------------------------------

const WORKAROUND_TYPES: Record<TicketCategory, FacilityType[]> = {
  Plumbing: ['restroom', 'water_station'],
  Electricity: ['classroom', 'study_area'],
  Cleanliness: ['restroom'],
  'Internet Connectivity': ['wifi_zone', 'study_area'],
  Other: []
};

export interface WorkaroundSuggestion {
  facility: CampusFacility;
  availability: 'available' | 'unavailable' | 'unknown';
  reason: string;
}

export function workaroundsFor(ticket: Ticket, now = new Date()): { suggestions: WorkaroundSuggestion[]; message: string } {
  const config = configStore.get();
  const types = WORKAROUND_TYPES[ticket.category];
  const freshMs = config.verificationFreshnessHours * 3600 * 1000;
  const openTickets = ticketRepository.getAllTicketsForSystem().filter((t) => t.status !== 'Resolved' && t.id !== ticket.id);
  const suggestions: WorkaroundSuggestion[] = config.facilities
    .filter((f) => types.includes(f.type) && !(sameBuilding(f.building, ticket.building) && f.floor && f.floor === ticket.floor))
    .map((facility) => {
      const affected = openTickets.find((t) => t.category === ticket.category && sameBuilding(t.building, facility.building) && facility.floor && t.floor === facility.floor);
      if (affected) return { facility, availability: 'unavailable' as const, reason: `Open ${ticket.category} report on the same floor (${affected.id})` };
      if (facility.status !== 'available') return { facility, availability: facility.status, reason: facility.status === 'unavailable' ? 'Marked unavailable by staff' : 'Availability has not been verified' };
      if (!facility.verifiedAt || now.getTime() - Date.parse(facility.verifiedAt) > freshMs) {
        return { facility, availability: 'unknown' as const, reason: `Not verified in the last ${config.verificationFreshnessHours}h` };
      }
      return { facility, availability: 'available' as const, reason: `Verified available by ${facility.verifiedBy} at ${facility.verifiedAt}` };
    })
    .sort((a, b) => ['available', 'unknown', 'unavailable'].indexOf(a.availability) - ['available', 'unknown', 'unavailable'].indexOf(b.availability));
  const available = suggestions.filter((s) => s.availability === 'available');
  return {
    suggestions,
    message: available.length > 0
      ? `${available.length} verified alternative(s) available.`
      : 'No confirmed workaround is available right now.'
  };
}

// ----------------------------------------------------------------------------
// Historical resolution time (documented ETA method)
// ----------------------------------------------------------------------------

export const ETA_MIN_SAMPLES = 5;

/**
 * Typical resolution time for a category: the 25th-75th percentile of hours from
 * submission to resolution across resolved tickets in that category. Returned only
 * when at least ETA_MIN_SAMPLES resolved tickets exist. Not a guarantee.
 */
export function historicalResolution(category: TicketCategory): { samples: number; p25Hours: number; p75Hours: number } | null {
  const hours = ticketRepository
    .getAllTicketsForSystem()
    .filter((t) => t.category === category && t.status === 'Resolved' && t.resolvedAt)
    .map((t) => (Date.parse(t.resolvedAt!) - Date.parse(t.createdAt)) / 3600000)
    .filter((h) => h >= 0)
    .sort((a, b) => a - b);
  if (hours.length < ETA_MIN_SAMPLES) return null;
  const q = (p: number) => hours[Math.min(hours.length - 1, Math.floor(p * (hours.length - 1)))];
  return { samples: hours.length, p25Hours: Math.round(q(0.25) * 10) / 10, p75Hours: Math.round(q(0.75) * 10) / 10 };
}
