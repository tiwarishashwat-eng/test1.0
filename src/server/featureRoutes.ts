/**
 * API routes for profiles, emergencies, responders, ticket operations (priority,
 * proof of fix, blockers, ETA), incidents, insights, Campus Pulse, and admin config.
 * Every route enforces authentication, role, and ownership on the server.
 */
import fs from 'fs';
import type { Express, NextFunction, Request, Response, RequestHandler } from 'express';
import {
  CONFIG_SECTIONS,
  ConfigSection,
  EmergencyType,
  PRIORITY_LEVELS,
  PriorityLevel,
  ProfileResponse,
  Ticket,
  User
} from '../shared/types.js';
import { missingProfileFields } from '../shared/validation.js';
import { auditStore } from './auditStore.js';
import { configStore } from './configStore.js';
import { emergencyStore, deriveAlertState, parseEmergencyLocation, toStudentView as emergencyStudentView } from './emergencyService.js';
import { decodeImage, evidenceFilePath, saveEvidenceFile } from './evidenceStore.js';
import { incidentStore } from './incidentService.js';
import {
  campusHotspots,
  detectWaste,
  ETA_MIN_SAMPLES,
  findRepeatOffenders,
  historicalResolution,
  roomCheckStore,
  roomReadiness,
  workaroundsFor
} from './insightsService.js';
import { getNotificationProviderStatus, notificationStore, verifyReceiptSignature } from './notificationService.js';
import { parseImpactInputs } from './priorityEngine.js';
import { pulseStore } from './pulseService.js';
import { ticketRepository, toStudentView } from './ticketStore.js';
import { userStore } from './userStore.js';

export interface Guards {
  requireAuth: RequestHandler;
  requireStaff: RequestHandler;
  requireAdmin: RequestHandler;
}

const requireRole =
  (...roles: User['role'][]) =>
  (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, error: 'You do not have permission for this action.' });
    next();
  };

function text(value: unknown, field: string, { min = 1, max = 1000 } = {}): string | { error: string } {
  if (typeof value !== 'string' || value.trim().length < min) return { error: `${field} is required${min > 1 ? ` (at least ${min} characters)` : ''}` };
  if (value.length > max) return { error: `${field} must be at most ${max} characters` };
  return value.trim();
}

const isErr = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null && 'error' in v;

/** Staff in the responsible department, or an admin, may act on a ticket's resolution. */
function canResolve(user: User, ticket: Ticket): boolean {
  if (user.role === 'admin') return true;
  if (user.role !== 'staff') return false;
  const department = ticket.assignment?.department ?? configStore.routeFor(ticket.category);
  return user.department === department;
}

/** Owning student, staff, or admin may read a ticket's public details. */
function canReadTicket(user: User, ticket: Ticket): boolean {
  return user.role === 'staff' || user.role === 'admin' || (user.role === 'student' && ticket.studentId === user.id);
}

function viewFor(user: User, ticket: Ticket) {
  return user.role === 'student' ? toStudentView(ticket) : ticket;
}

function notFound(res: Response, what = 'Ticket') {
  return res.status(404).json({ success: false, error: `${what} not found` });
}

function responderIncidentView(incident: ReturnType<typeof emergencyStore.get>) {
  if (!incident) return null;
  const { state, detail } = deriveAlertState(incident);
  return { ...incident, alertState: state, alertDetail: detail, notifications: notificationStore.listFor(incident.id) };
}

export function registerFeatureRoutes(app: Express, { requireAuth, requireStaff, requireAdmin }: Guards) {
  const requireStudent = requireRole('student');
  const requireResponder = requireRole('responder', 'admin');

  // ==========================================================================
  // Student profile
  // ==========================================================================

  app.get('/api/profile', requireStudent, (req: Request, res: Response) => {
    const profile = userStore.getProfile(req.user!.id);
    const missing = missingProfileFields(profile);
    const body: ProfileResponse = { success: true, profile, missingFields: missing, isComplete: missing.length === 0 };
    return res.json(body);
  });

  app.put('/api/profile', requireStudent, (req: Request, res: Response) => {
    if (!req.body || typeof req.body !== 'object') return res.status(400).json({ success: false, error: 'Profile data is required' });
    // Identity comes from the session; any client-supplied id is ignored
    const result = userStore.saveProfile(req.user!.id, req.body);
    if (result.status !== 200) {
      return res.status(result.status).json({ success: false, error: 'Please correct the highlighted fields.', fieldErrors: result.errors });
    }
    auditStore.record(req.user!, 'profile.updated', 'user', req.user!.id);
    const missing = missingProfileFields(result.profile);
    return res.json({ success: true, profile: result.profile, missingFields: missing, isComplete: missing.length === 0 });
  });

  // ==========================================================================
  // Emergencies (student side)
  // ==========================================================================

  app.post('/api/emergencies', requireStudent, (req: Request, res: Response) => {
    const { clientRequestId, type, location, confirmNew } = req.body ?? {};
    if (typeof clientRequestId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(clientRequestId)) {
      return res.status(400).json({ success: false, error: 'A request id is required' });
    }
    const emergencyType: EmergencyType = type === 'medical' || type === 'security' ? type : 'unspecified';
    let parsedLocation;
    try {
      parsedLocation = parseEmergencyLocation(location);
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
    const result = emergencyStore.create(req.user!, {
      clientRequestId,
      type: emergencyType,
      location: parsedLocation,
      confirmNew: confirmNew === true
    });
    if (result.created) auditStore.record(req.user!, 'emergency.created', 'emergency', result.incident.id);
    return res.status(result.created ? 201 : 200).json({
      success: true,
      created: result.created,
      possibleDuplicate: result.possibleDuplicate,
      incident: emergencyStudentView(result.incident)
    });
  });

  app.get('/api/emergencies/mine', requireStudent, (req: Request, res: Response) => {
    return res.json({ success: true, incidents: emergencyStore.listForStudent(req.user!.id) });
  });

  // ==========================================================================
  // Responder interface
  // ==========================================================================

  app.get('/api/responder/emergencies', requireResponder, (req: Request, res: Response) => {
    const incidents = emergencyStore.all().filter((i) => emergencyStore.canView(i, req.user!)).map(responderIncidentView);
    return res.json({ success: true, incidents });
  });

  app.get('/api/responder/emergencies/:id', requireResponder, (req: Request, res: Response) => {
    const incident = emergencyStore.get(req.params.id);
    if (!incident || !emergencyStore.canView(incident, req.user!)) return notFound(res, 'Incident');
    return res.json({ success: true, incident: responderIncidentView(incident) });
  });

  const responderAction =
    (action: 'acknowledge' | 'responding' | 'update' | 'close' | 'escalate') => (req: Request, res: Response) => {
      const incident = emergencyStore.get(req.params.id);
      if (!incident || !emergencyStore.canView(incident, req.user!)) return notFound(res, 'Incident');
      let updated;
      if (action === 'acknowledge') updated = emergencyStore.acknowledge(incident.id, req.user!);
      else if (action === 'responding') updated = emergencyStore.markResponding(incident.id, req.user!);
      else {
        const field = action === 'close' ? 'outcome' : action === 'escalate' ? 'reason' : 'note';
        const value = text(req.body?.[field], field[0].toUpperCase() + field.slice(1), { max: 1000 });
        if (isErr(value)) return res.status(400).json({ success: false, error: value.error });
        if (action === 'update') updated = emergencyStore.addUpdate(incident.id, req.user!, value);
        else if (action === 'close') updated = emergencyStore.close(incident.id, req.user!, value);
        else {
          updated = emergencyStore.escalate(incident.id, req.user!, value);
          if (!updated) return res.status(409).json({ success: false, error: 'This incident is closed or already at the highest escalation level.' });
        }
      }
      if (!updated) return res.status(409).json({ success: false, error: 'This incident is closed.' });
      return res.json({ success: true, incident: responderIncidentView(updated) });
    };

  app.post('/api/responder/emergencies/:id/acknowledge', requireResponder, responderAction('acknowledge'));
  app.post('/api/responder/emergencies/:id/responding', requireResponder, responderAction('responding'));
  app.post('/api/responder/emergencies/:id/updates', requireResponder, responderAction('update'));
  app.post('/api/responder/emergencies/:id/close', requireResponder, responderAction('close'));
  app.post('/api/responder/emergencies/:id/escalate', requireResponder, responderAction('escalate'));

  // Provider delivery receipts (HMAC-signed with NOTIFY_RECEIPT_SECRET; no user session)
  app.post('/api/notifications/receipt', (req: Request, res: Response) => {
    const raw = (req as any).rawBody as string | undefined;
    if (!raw || !verifyReceiptSignature(raw, req.header('X-CampusConnect-Signature') ?? undefined)) {
      return res.status(401).json({ success: false, error: 'Invalid signature' });
    }
    const { notificationId, idempotencyKey, status, error } = req.body ?? {};
    if (status !== 'delivered' && status !== 'failed') return res.status(400).json({ success: false, error: 'Status must be delivered or failed' });
    const attempt = notificationStore.applyReceipt(
      { notificationId: typeof notificationId === 'string' ? notificationId : undefined, idempotencyKey: typeof idempotencyKey === 'string' ? idempotencyKey : undefined },
      status,
      typeof error === 'string' ? error.slice(0, 300) : undefined
    );
    if (!attempt) return notFound(res, 'Notification');
    return res.json({ success: true });
  });

  // ==========================================================================
  // Ticket operations
  // ==========================================================================

  const loadTicket = (req: Request, res: Response): Ticket | null => {
    const id = String(req.params.id).trim().toUpperCase();
    const ticket = ticketRepository.getRawById(/^\d+$/.test(id) ? `CC-${id}` : id);
    if (!ticket || !canReadTicket(req.user!, ticket)) {
      // Same response for "missing" and "not yours"
      res.status(404).json({ success: false, error: 'No ticket with that ID was found in your complaints.' });
      return null;
    }
    return ticket;
  };

  app.post('/api/tickets/:id/impact', requireStaff, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const impact = parseImpactInputs(req.body?.impact, 'staff', req.user!.name);
    if (typeof impact === 'string') return res.status(400).json({ success: false, error: impact });
    const updated = ticketRepository.setImpact(ticket.id, impact, req.user!)!;
    auditStore.record(req.user!, 'ticket.impact_updated', 'ticket', ticket.id);
    return res.json({ success: true, ticket: updated });
  });

  app.post('/api/tickets/:id/priority-override', requireStaff, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const { level } = req.body ?? {};
    if (level !== null && !PRIORITY_LEVELS.includes(level as PriorityLevel)) {
      return res.status(400).json({ success: false, error: `Level must be one of ${PRIORITY_LEVELS.join(', ')} (or null to remove the override)` });
    }
    const reason = text(req.body?.reason, 'Reason', { min: 5, max: 500 });
    if (isErr(reason)) return res.status(400).json({ success: false, error: reason.error });
    const updated = ticketRepository.overridePriority(ticket.id, level, reason, req.user!)!;
    auditStore.record(req.user!, 'ticket.priority_override', 'ticket', ticket.id, `${level ?? 'removed'}: ${reason}`);
    return res.json({ success: true, ticket: updated });
  });

  app.post('/api/tickets/:id/resolution-proof', requireStaff, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    if (!canResolve(req.user!, ticket)) {
      return res.status(403).json({ success: false, error: 'Only staff in the responsible department (or an administrator) can upload proof of fix.' });
    }
    if (ticket.status === 'Resolved') return res.status(409).json({ success: false, error: 'This ticket is already resolved.' });
    const summary = text(req.body?.summary, 'Resolution summary', { min: 10, max: 1000 });
    if (isErr(summary)) return res.status(400).json({ success: false, error: summary.error });
    const image = decodeImage(req.body?.imageBase64, req.body?.mimeType);
    if (typeof image === 'string') return res.status(400).json({ success: false, error: image });
    let stored;
    try {
      stored = saveEvidenceFile(image);
    } catch (err) {
      console.error('[Evidence] Save failed', err);
      return res.status(500).json({ success: false, error: 'The photo could not be saved. Proof of fix was not recorded.' });
    }
    const updated = ticketRepository.addResolutionProof(
      ticket.id,
      { id: stored.id, summary, uploadedBy: req.user!.name, uploadedById: req.user!.id, uploadedAt: new Date().toISOString(), mimeType: stored.mimeType, sizeBytes: stored.sizeBytes, sha256: stored.sha256 },
      req.user!
    )!;
    auditStore.record(req.user!, 'ticket.proof_uploaded', 'ticket', ticket.id, stored.id);
    return res.status(201).json({ success: true, ticket: updated });
  });

  app.get('/api/tickets/:id/evidence/:proofId', requireAuth, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const proof = ticket.resolutionProofs?.find((p) => p.id === req.params.proofId);
    const file = proof ? evidenceFilePath(proof.id, proof.mimeType) : null;
    if (!proof || !file) return notFound(res, 'Evidence');
    res.setHeader('Content-Type', proof.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    return fs.createReadStream(file).pipe(res);
  });

  app.post('/api/tickets/:id/reopen-request', requireStudent, (req: Request, res: Response) => {
    const reason = text(req.body?.reason, 'Reason', { min: 5, max: 1000 });
    if (isErr(reason)) return res.status(400).json({ success: false, error: reason.error });
    const result = ticketRepository.requestReopen(String(req.params.id).toUpperCase(), req.user!, reason);
    if (!result.ticket) return res.status(result.status).json({ success: false, error: result.error });
    auditStore.record(req.user!, 'ticket.reopen_requested', 'ticket', result.ticket.id);
    return res.json({ success: true, ticket: toStudentView(result.ticket) });
  });

  app.post('/api/tickets/:id/blockers', requireStaff, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const description = text(req.body?.description, 'Blocker description', { min: 3, max: 300 });
    if (isErr(description)) return res.status(400).json({ success: false, error: description.error });
    return res.status(201).json({ success: true, ticket: ticketRepository.addBlocker(ticket.id, description, req.user!) });
  });

  app.post('/api/tickets/:id/blockers/:blockerId/resolve', requireStaff, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const updated = ticketRepository.resolveBlocker(ticket.id, req.params.blockerId, req.user!);
    if (!updated) return notFound(res, 'Open blocker');
    return res.json({ success: true, ticket: updated });
  });

  app.post('/api/tickets/:id/eta', requireStaff, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const { earliest, latest, note, changeReason } = req.body ?? {};
    const e = Date.parse(earliest);
    const l = Date.parse(latest);
    if (Number.isNaN(e) || Number.isNaN(l)) return res.status(400).json({ success: false, error: 'Earliest and latest must be valid dates' });
    if (l < e) return res.status(400).json({ success: false, error: 'Latest must be after earliest' });
    if (l < Date.now() - 60000) return res.status(400).json({ success: false, error: 'The estimate window must not be entirely in the past' });
    if (ticket.etaEstimate && (typeof changeReason !== 'string' || changeReason.trim().length < 5)) {
      return res.status(400).json({ success: false, error: 'Explain why the estimate changed (at least 5 characters)' });
    }
    for (const [v, label] of [[note, 'Note'], [changeReason, 'Reason']] as const) {
      if (v !== undefined && (typeof v !== 'string' || v.length > 500)) return res.status(400).json({ success: false, error: `${label} must be at most 500 characters` });
    }
    const updated = ticketRepository.setEta(
      ticket.id,
      { earliest: new Date(e).toISOString(), latest: new Date(l).toISOString(), note: note?.trim() || undefined, changeReason: changeReason?.trim() || undefined },
      req.user!
    );
    return res.json({ success: true, ticket: updated });
  });

  /** Everything known about timing, with the method behind each number. */
  app.get('/api/tickets/:id/timing', requireAuth, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const history = historicalResolution(ticket.category);
    return res.json({
      success: true,
      slaDeadline: ticket.slaDeadline,
      slaNote: 'Target set by the campus service-level rules for this category and priority. It is a target, not a guarantee.',
      staffEstimate: ticket.etaEstimate ?? null,
      historical: history
        ? { ...history, note: `Typical range from ${history.samples} resolved ${ticket.category} tickets (25th-75th percentile). Not a guarantee.` }
        : { note: `Not enough history: fewer than ${ETA_MIN_SAMPLES} resolved ${ticket.category} tickets.` },
      openBlockers: (ticket.blockers ?? []).filter((b) => !b.resolvedAt)
    });
  });

  app.post('/api/tickets/:id/asset', requireStaff, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const { assetId } = req.body ?? {};
    if (assetId !== null && (typeof assetId !== 'string' || !configStore.get().assets.some((a) => a.id === assetId))) {
      return res.status(400).json({ success: false, error: 'Unknown asset (configure assets in the Admin Console first)' });
    }
    return res.json({ success: true, ticket: ticketRepository.setAsset(ticket.id, assetId ?? undefined, req.user!) });
  });

  app.post('/api/tickets/:id/waste-review', requireStaff, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    const { status, note } = req.body ?? {};
    if (status !== 'confirmed' && status !== 'rejected') return res.status(400).json({ success: false, error: 'Status must be confirmed or rejected' });
    if (note !== undefined && (typeof note !== 'string' || note.length > 500)) return res.status(400).json({ success: false, error: 'Note must be at most 500 characters' });
    const updated = ticketRepository.setWasteReview(ticket.id, { status, note: note?.trim() || undefined, by: req.user!.name, at: new Date().toISOString() }, req.user!);
    return res.json({ success: true, ticket: updated });
  });

  app.get('/api/tickets/:id/workarounds', requireAuth, (req: Request, res: Response) => {
    const ticket = loadTicket(req, res);
    if (!ticket) return;
    return res.json({ success: true, ...workaroundsFor(ticket) });
  });

  // ==========================================================================
  // Shared incidents (staff)
  // ==========================================================================

  app.get('/api/incidents', requireStaff, (_req: Request, res: Response) => {
    return res.json({ success: true, incidents: incidentStore.list() });
  });

  app.post('/api/incidents', requireStaff, (req: Request, res: Response) => {
    const title = text(req.body?.title, 'Title', { min: 3, max: 120 });
    if (isErr(title)) return res.status(400).json({ success: false, error: title.error });
    if (!Array.isArray(req.body?.ticketIds) || req.body.ticketIds.some((t: unknown) => typeof t !== 'string')) {
      return res.status(400).json({ success: false, error: 'ticketIds must be a list of ticket IDs' });
    }
    const result = incidentStore.createManual(req.user!, title, req.body.ticketIds.map((t: string) => t.toUpperCase()));
    if (!result.incident) return res.status(400).json({ success: false, error: result.error });
    return res.status(201).json({ success: true, incident: result.incident });
  });

  app.post('/api/incidents/:id/link', requireStaff, (req: Request, res: Response) => {
    if (typeof req.body?.ticketId !== 'string') return res.status(400).json({ success: false, error: 'ticketId is required' });
    const result = incidentStore.link(req.params.id, req.body.ticketId.toUpperCase(), req.user!);
    if (!result.incident) return res.status(400).json({ success: false, error: result.error });
    return res.json({ success: true, incident: result.incident });
  });

  app.post('/api/incidents/:id/unlink', requireStaff, (req: Request, res: Response) => {
    if (typeof req.body?.ticketId !== 'string') return res.status(400).json({ success: false, error: 'ticketId is required' });
    const note = text(req.body?.note, 'Reason', { min: 3, max: 500 });
    if (isErr(note)) return res.status(400).json({ success: false, error: note.error });
    const result = incidentStore.unlink(req.params.id, req.body.ticketId.toUpperCase(), req.user!, note);
    if (!result.incident) return res.status(400).json({ success: false, error: result.error });
    return res.json({ success: true, incident: result.incident });
  });

  app.post('/api/incidents/:id/status', requireStaff, (req: Request, res: Response) => {
    const { status } = req.body ?? {};
    if (!['reviewed', 'dismissed', 'resolved'].includes(status)) return res.status(400).json({ success: false, error: 'Status must be reviewed, dismissed, or resolved' });
    const note = text(req.body?.note, 'Note', { min: 3, max: 500 });
    if (isErr(note)) return res.status(400).json({ success: false, error: note.error });
    const result = incidentStore.setStatus(req.params.id, status, req.user!, note);
    if (!result.incident) return res.status(400).json({ success: false, error: result.error });
    return res.json({ success: true, incident: result.incident });
  });

  // ==========================================================================
  // Insights (staff) and campus data
  // ==========================================================================

  app.get('/api/insights/repeat-offenders', requireStaff, (_req, res) => res.json({ success: true, ...findRepeatOffenders() }));
  app.get('/api/insights/waste', requireStaff, (_req, res) => res.json({ success: true, signals: detectWaste() }));
  app.get('/api/insights/hotspots', requireStaff, (_req, res) => res.json({ success: true, ...campusHotspots() }));
  app.get('/api/insights/pulse-signals', requireStaff, (_req, res) => res.json({ success: true, signals: pulseStore.investigationSuggestions() }));
  app.get('/api/insights/readiness', requireStaff, (_req, res) => {
    const rooms = configStore.get().rooms.map((r) => roomReadiness(r.id)).filter(Boolean);
    return res.json({ success: true, rooms, configured: rooms.length > 0 });
  });

  app.post('/api/rooms/:roomId/checks', requireStaff, (req: Request, res: Response) => {
    const room = configStore.get().rooms.find((r) => r.id === req.params.roomId);
    if (!room) return notFound(res, 'Room');
    const { assetId, result, note } = req.body ?? {};
    if (result !== 'working' && result !== 'issue') return res.status(400).json({ success: false, error: 'Result must be working or issue' });
    if (assetId !== undefined && !room.assetIds.includes(assetId)) return res.status(400).json({ success: false, error: 'Asset is not in this room' });
    if (note !== undefined && (typeof note !== 'string' || note.length > 300)) return res.status(400).json({ success: false, error: 'Note must be at most 300 characters' });
    const check = roomCheckStore.record({ roomId: room.id, assetId, result, note: note?.trim() || undefined }, req.user!);
    return res.status(201).json({ success: true, check, readiness: roomReadiness(room.id) });
  });

  app.post('/api/facilities/:id/verify', requireStaff, (req: Request, res: Response) => {
    const { status } = req.body ?? {};
    if (!['available', 'unavailable', 'unknown'].includes(status)) return res.status(400).json({ success: false, error: 'Status must be available, unavailable, or unknown' });
    const facility = configStore.verifyFacility(req.params.id, status, req.user!);
    if (!facility) return notFound(res, 'Facility');
    auditStore.record(req.user!, 'facility.verified', 'facility', facility.id, status);
    return res.json({ success: true, facility });
  });

  // Campus lists for forms (no personal data)
  app.get('/api/campus', requireAuth, (_req: Request, res: Response) => {
    const c = configStore.get();
    return res.json({
      success: true,
      buildings: c.buildings.map((b) => ({ id: b.id, name: b.name, campus: b.campus })),
      assets: c.assets.map((a) => ({ id: a.id, name: a.name, type: a.type, building: a.building, floor: a.floor })),
      rooms: c.rooms,
      facilities: c.facilities
    });
  });

  // ==========================================================================
  // Campus Pulse (anonymous)
  // ==========================================================================

  // Deliberately ignores the session: submissions are not linked to an account
  app.post('/api/pulse', (req: Request, res: Response) => {
    const result = pulseStore.submit(req.body ?? {}, req.ip ?? '');
    if (!result.ok) return res.status(result.status).json({ success: false, error: result.error });
    return res.status(201).json({ success: true });
  });

  app.get('/api/pulse/buildings', (_req: Request, res: Response) => {
    return res.json({ success: true, buildings: configStore.get().buildings.map((b) => b.name) });
  });

  app.get('/api/pulse/summary', requireAuth, (_req: Request, res: Response) => res.json({ success: true, summary: pulseStore.summary() }));

  app.get('/api/admin/pulse/raw', requireAdmin, (_req: Request, res: Response) => res.json({ success: true, entries: pulseStore.rawEntries() }));

  // ==========================================================================
  // Administration
  // ==========================================================================

  app.get('/api/admin/config', requireAdmin, (_req: Request, res: Response) => {
    return res.json({ success: true, config: configStore.get(), notificationProvider: getNotificationProviderStatus() });
  });

  app.put('/api/admin/config/:section', requireAdmin, (req: Request, res: Response) => {
    const section = req.params.section as ConfigSection;
    if (!CONFIG_SECTIONS.includes(section)) return notFound(res, 'Configuration section');
    const isResponder = (id: string) => userStore.getActiveResponders().some((u) => u.id === id);
    const result = configStore.updateSection(section, req.body?.value, req.user!, isResponder);
    if (!result.ok) return res.status(400).json({ success: false, error: result.error });
    auditStore.record(req.user!, 'config.updated', 'config', section);
    return res.json({ success: true, config: configStore.get() });
  });

  app.get('/api/admin/audit', requireAdmin, (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    return res.json({
      success: true,
      entries: auditStore.list({
        targetType: typeof req.query.targetType === 'string' ? req.query.targetType : undefined,
        targetId: typeof req.query.targetId === 'string' ? req.query.targetId : undefined,
        limit
      })
    });
  });

  app.get('/api/admin/notifications', requireAdmin, (_req: Request, res: Response) => {
    return res.json({ success: true, provider: getNotificationProviderStatus() });
  });
}
