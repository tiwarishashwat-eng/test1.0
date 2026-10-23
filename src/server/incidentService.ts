/**
 * Shared incidents: automatic recurring-issue clusters and staff-linked incidents.
 * Linking never merges, closes, or deletes tickets; each ticket keeps its own ID,
 * owner, status, and history. Deterministic rules only (no Gemini).
 *
 * Cluster rule: tickets are "related" when they share the category, the building,
 * and either a domain concept (e.g. both mention a leak/"paani") or >= 30% word
 * overlap, and were created within 2 hours of each other. When >= 10 DISTINCT
 * students (not tickets, so retries and repeat submissions do not inflate the count)
 * filed related, unresolved tickets in a rolling 2-hour window, a cluster is created
 * (or the matching active cluster updated) and its tickets are raised to High.
 */
import { Incident, IncidentAuditEntry, Ticket, User } from '../shared/types.js';
import { auditStore, SYSTEM_ACTOR } from './auditStore.js';
import { dataPath, readJsonFile, writeJsonFileAtomic } from './jsonFile.js';
import { conceptsOf, extractCanonicalTokens, jaccard, normalizeBuildingName, sameBuilding } from './textSimilarity.js';
import { ticketRepository } from './ticketStore.js';

export const CLUSTER_WINDOW_MS = 2 * 60 * 60 * 1000;
export const CLUSTER_THRESHOLD = 10;
const MIN_TEXT_OVERLAP = 0.3;

function ticketText(t: Ticket) {
  return `${t.problemTitle ?? ''} ${t.description} ${t.location} ${t.roomOrArea ?? ''}`;
}

/** Deterministic relatedness between two maintenance tickets (time not included). */
export function areRelated(a: Ticket, b: Ticket): { related: boolean; sharedConcepts: string[] } {
  if (a.category !== b.category || !sameBuilding(a.building, b.building)) return { related: false, sharedConcepts: [] };
  const ta = extractCanonicalTokens(ticketText(a));
  const tb = extractCanonicalTokens(ticketText(b));
  const ca = conceptsOf(ta);
  const shared = conceptsOf(tb).filter((c) => ca.includes(c));
  return { related: shared.length > 0 || jaccard(ta, tb) >= MIN_TEXT_OVERLAP, sharedConcepts: shared };
}

export class IncidentStore {
  private readonly file = dataPath('incidents.json');
  private incidents = new Map<string, Incident>();
  private counter = 1;

  constructor() {
    const stored = readJsonFile<{ incidents: Incident[]; counter: number }>(this.file);
    for (const i of stored?.incidents ?? []) this.incidents.set(i.id, i);
    this.counter = stored?.counter ?? 1;
  }

  private persist() {
    writeJsonFileAtomic(this.file, { counter: this.counter, incidents: [...this.incidents.values()] });
  }

  get(id: string) {
    return this.incidents.get(id);
  }

  list(filter?: { status?: Incident['status'] }): Incident[] {
    return [...this.incidents.values()]
      .filter((i) => !filter?.status || i.status === filter.status)
      .sort((a, b) => b.latestReportAt.localeCompare(a.latestReportAt));
  }

  private audit(incident: Incident, actor: Pick<User, 'id' | 'name'>, action: IncidentAuditEntry['action'], ticketId?: string, note?: string) {
    incident.audit.push({ at: new Date().toISOString(), actorId: actor.id, actorName: actor.name, action, ticketId, note });
    incident.updatedAt = new Date().toISOString();
    auditStore.record(actor, `incident.${action}`, 'incident', incident.id, [ticketId, note].filter(Boolean).join(': ') || undefined);
  }

  /** Recomputes counts/times and pushes link state onto every affected ticket. */
  private refresh(incident: Incident, affectedTicketIds: string[] = []) {
    const tickets = incident.ticketIds.map((id) => ticketRepository.getRawById(id)).filter(Boolean) as Ticket[];
    incident.distinctReporters = new Set(tickets.map((t) => t.studentId).filter(Boolean)).size;
    const times = tickets.map((t) => t.createdAt).sort();
    if (times.length) {
      incident.firstReportAt = times[0];
      incident.latestReportAt = times[times.length - 1];
    }
    for (const id of new Set([...incident.ticketIds, ...affectedTicketIds])) this.syncTicket(id);
  }

  /** Writes the ticket's incident list and the cluster size used by the priority engine. */
  private syncTicket(ticketId: string) {
    const memberOf = [...this.incidents.values()].filter((i) => i.status !== 'dismissed' && i.ticketIds.includes(ticketId));
    const reporters = memberOf
      .filter((i) => i.source === 'auto_cluster' && (i.status === 'active' || i.status === 'reviewed'))
      .reduce((max, i) => Math.max(max, i.distinctReporters), 0);
    ticketRepository.setIncidentLinks(ticketId, memberOf.map((i) => i.id), reporters > 0 ? reporters : undefined);
  }

  /**
   * Evaluates clustering for a newly created ticket. Idempotent: running it again for
   * the same ticket changes nothing. Returns the cluster the ticket joined, if any.
   */
  evaluateForTicket(ticketId: string): Incident | null {
    const ticket = ticketRepository.getRawById(ticketId);
    if (!ticket || ticket.status === 'Resolved') return null;
    const t0 = Date.parse(ticket.createdAt);

    const related = ticketRepository.getAllTicketsForSystem().filter((other) => {
      if (other.id === ticket.id || other.status === 'Resolved') return false;
      const dt = Math.abs(t0 - Date.parse(other.createdAt));
      return dt <= CLUSTER_WINDOW_MS && areRelated(ticket, other).related;
    });

    // Join an ongoing cluster for the same issue even before a new window fills up
    const concept = this.primaryConcept(ticket, related);
    const key = `${ticket.category}|${normalizeBuildingName(ticket.building)}|${concept}`;
    const existing = [...this.incidents.values()].find(
      (i) =>
        i.source === 'auto_cluster' &&
        (i.status === 'active' || i.status === 'reviewed') &&
        i.clusterKey === key &&
        t0 - Date.parse(i.latestReportAt) <= CLUSTER_WINDOW_MS
    );

    // Tickets staff already judged wrongly grouped for this issue never count again
    const dismissedForKey = new Set(
      [...this.incidents.values()].filter((i) => i.status === 'dismissed' && i.clusterKey === key).flatMap((i) => i.ticketIds)
    );
    // Tickets in the rolling window ending at this ticket, excluding staff-removed ones
    const windowTickets = [ticket, ...related.filter((o) => Date.parse(o.createdAt) <= t0 && t0 - Date.parse(o.createdAt) <= CLUSTER_WINDOW_MS)]
      .filter((t) => !dismissedForKey.has(t.id));
    if (!windowTickets.includes(ticket)) return null;
    const eligible = (t: Ticket, incidentId?: string) => !incidentId || !(t.clusterExclusions ?? []).includes(incidentId);

    if (existing) {
      const toAdd = windowTickets.filter((t) => eligible(t, existing.id) && !existing.ticketIds.includes(t.id));
      if (toAdd.length === 0) return existing.ticketIds.includes(ticket.id) ? existing : null;
      for (const t of toAdd) {
        existing.ticketIds.push(t.id);
        this.audit(existing, SYSTEM_ACTOR, 'ticket_linked', t.id, 'Matched recurring-issue rule');
      }
      this.refresh(existing);
      this.setPriorityReason(existing);
      this.persist();
      return existing;
    }

    const distinct = new Set(windowTickets.map((t) => t.studentId).filter(Boolean));
    if (distinct.size < CLUSTER_THRESHOLD) return null;

    const now = new Date().toISOString();
    const incident: Incident = {
      id: `IN-${String(this.counter++).padStart(4, '0')}`,
      source: 'auto_cluster',
      title: `Recurring ${ticket.category} issue${concept !== 'general' ? ` (${concept})` : ''} in ${ticket.building}`,
      status: 'active',
      category: ticket.category,
      building: ticket.building,
      area: ticket.floor ? `Floor ${ticket.floor}` : ticket.location,
      ticketIds: windowTickets.map((t) => t.id),
      distinctReporters: distinct.size,
      firstReportAt: ticket.createdAt,
      latestReportAt: ticket.createdAt,
      priority: 'High',
      clusterKey: key,
      createdAt: now,
      updatedAt: now,
      audit: []
    };
    this.incidents.set(incident.id, incident);
    this.audit(incident, SYSTEM_ACTOR, 'created', undefined, `${distinct.size} distinct reporters within 2 hours`);
    this.refresh(incident);
    this.setPriorityReason(incident);
    this.persist();
    return incident;
  }

  private primaryConcept(ticket: Ticket, related: Ticket[]): string {
    const counts = new Map<string, number>();
    for (const other of related) {
      for (const c of areRelated(ticket, other).sharedConcepts) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    return best ? best[0] : 'general';
  }

  private setPriorityReason(incident: Incident) {
    incident.priority = 'High';
    incident.priorityReason = `${incident.distinctReporters} distinct students reported related ${incident.category} issues in ${incident.building} between ${incident.firstReportAt} and ${incident.latestReportAt} (rule: at least ${CLUSTER_THRESHOLD} within a rolling 2-hour window).`;
  }

  createManual(actor: User, title: string, ticketIds: string[]): { incident?: Incident; error?: string } {
    const tickets = [...new Set(ticketIds)].map((id) => ticketRepository.getRawById(id));
    if (tickets.length < 2) return { error: 'Select at least two tickets to link' };
    if (tickets.some((t) => !t)) return { error: 'One or more tickets do not exist' };
    const list = tickets as Ticket[];
    const now = new Date().toISOString();
    const incident: Incident = {
      id: `IN-${String(this.counter++).padStart(4, '0')}`,
      source: 'staff',
      title,
      status: 'active',
      category: list[0].category,
      building: list[0].building,
      ticketIds: list.map((t) => t.id),
      distinctReporters: 0,
      firstReportAt: now,
      latestReportAt: now,
      createdAt: now,
      updatedAt: now,
      audit: []
    };
    this.incidents.set(incident.id, incident);
    this.audit(incident, actor, 'created', undefined, `Linked ${list.length} tickets`);
    this.refresh(incident);
    this.persist();
    return { incident };
  }

  link(incidentId: string, ticketId: string, actor: User): { incident?: Incident; error?: string } {
    const incident = this.incidents.get(incidentId);
    if (!incident) return { error: 'Incident not found' };
    if (incident.status === 'dismissed') return { error: 'Dismissed incidents cannot be changed' };
    if (!ticketRepository.getRawById(ticketId)) return { error: 'Ticket not found' };
    if (!incident.ticketIds.includes(ticketId)) {
      incident.ticketIds.push(ticketId);
      this.audit(incident, actor, 'ticket_linked', ticketId);
      this.refresh(incident);
      this.persist();
    }
    return { incident };
  }

  unlink(incidentId: string, ticketId: string, actor: User, note: string): { incident?: Incident; error?: string } {
    const incident = this.incidents.get(incidentId);
    if (!incident) return { error: 'Incident not found' };
    if (!incident.ticketIds.includes(ticketId)) return { error: 'Ticket is not linked to this incident' };
    incident.ticketIds = incident.ticketIds.filter((id) => id !== ticketId);
    // Never re-add this ticket to this cluster automatically
    if (incident.source === 'auto_cluster') ticketRepository.excludeFromCluster(ticketId, incident.id);
    this.audit(incident, actor, 'ticket_unlinked', ticketId, note);
    this.refresh(incident, [ticketId]);
    if (incident.source === 'auto_cluster') this.setPriorityReason(incident);
    this.persist();
    return { incident };
  }

  setStatus(incidentId: string, status: 'reviewed' | 'dismissed' | 'resolved', actor: User, note: string): { incident?: Incident; error?: string } {
    const incident = this.incidents.get(incidentId);
    if (!incident) return { error: 'Incident not found' };
    if (incident.status === 'dismissed') return { error: 'Incident already dismissed' };
    incident.status = status;
    if (status === 'dismissed') {
      // Dismissal records that the grouping was wrong; these tickets will not regroup into it
      for (const id of incident.ticketIds) {
        if (incident.source === 'auto_cluster') ticketRepository.excludeFromCluster(id, incident.id);
      }
    }
    this.audit(incident, actor, status, undefined, note);
    this.refresh(incident);
    this.persist();
    return { incident };
  }
}

export const incidentStore = new IncidentStore();
