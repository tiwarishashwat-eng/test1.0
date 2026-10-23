/**
 * Server-side scheduler (never a browser timer). Each tick:
 *  1. Escalates emergencies with no acknowledgement within the configured timeout.
 *  2. Refreshes maintenance priorities and escalates overdue tickets:
 *       level 1 when past the SLA deadline -> active staff in the responsible department
 *       level 2 when past deadline + 50% of the SLA period -> administrators
 *  3. Retries failed, retryable notifications.
 * Every step is idempotent (escalation levels are recorded; notification keys are unique),
 * so overlapping or repeated ticks never duplicate escalations or messages.
 *
 * Runs in-process with setInterval: a single server instance must be running for it to
 * work. For multi-instance or serverless hosting, call runSchedulerTick from one cron job.
 */
import { SlaEscalation, Ticket } from '../shared/types.js';
import { auditStore, SYSTEM_ACTOR } from './auditStore.js';
import { configStore } from './configStore.js';
import { emergencyStore } from './emergencyService.js';
import { notificationStore } from './notificationService.js';
import { effectivePriority } from './priorityEngine.js';
import { ticketRepository } from './ticketStore.js';
import { userStore } from './userStore.js';

let running = false;
let timer: NodeJS.Timeout | null = null;

function escalateTicket(ticket: Ticket, level: number, now: Date) {
  const department = ticket.assignment?.department ?? configStore.routeFor(ticket.category);
  const recipients = level === 1 ? userStore.getActiveUsersByRole('staff', department) : userStore.getActiveUsersByRole('admin');
  const nextAuthority = level === 1 ? `${department} staff` : 'Administrators';
  const notificationIds = recipients.map(
    (r) =>
      notificationStore.enqueue({
        idempotencyKey: `sla_escalation:${ticket.id}:${level}:${ticket.slaDeadline}:${r.id}`,
        purpose: 'sla_escalation',
        subjectId: ticket.id,
        recipient: r,
        subject: `SLA escalation L${level}: ${ticket.id} is overdue`,
        body: `${ticket.id} (${ticket.category}, ${effectivePriority(ticket)}) in ${ticket.building} passed its SLA deadline ${ticket.slaDeadline}. Status: ${ticket.status}.`
      }).id
  );
  const escalation: SlaEscalation = {
    level,
    at: now.toISOString(),
    reason: level === 1 ? `Past SLA deadline ${ticket.slaDeadline}` : 'Still unresolved after a further 50% of the SLA period',
    previousOwner: ticket.assignment?.assignedTo ?? ticket.assignment?.department ?? 'Unassigned',
    nextAuthority: recipients.length ? nextAuthority : `${nextAuthority} (no active accounts to notify)`,
    notificationIds
  };
  ticketRepository.recordSlaEscalation(ticket.id, escalation);
  auditStore.record(SYSTEM_ACTOR, 'ticket.sla_escalated', 'ticket', ticket.id, `level ${level}`);
}

export async function runSchedulerTick(now = new Date()): Promise<{ emergencies: string[]; slaEscalations: string[] }> {
  if (running) return { emergencies: [], slaEscalations: [] };
  running = true;
  try {
    const emergencies = emergencyStore.escalateOverdue(now);
    const slaEscalations: string[] = [];
    const overdue = ticketRepository.refreshAllPriorities(now);
    if (configStore.get().slaEscalationEnabled) {
      for (const ticket of overdue) {
        const deadline = Date.parse(ticket.slaDeadline!);
        const period = deadline - Date.parse(ticket.createdAt);
        // Only escalations for the current deadline count (a priority change moves it)
        const done = (ticket.slaEscalations ?? []).filter((e) => Date.parse(e.at) >= deadline).map((e) => e.level);
        const due = now.getTime() >= deadline + period * 0.5 ? 2 : 1;
        for (let level = 1; level <= due; level++) {
          if (!done.includes(level)) {
            escalateTicket(ticket, level, now);
            slaEscalations.push(`${ticket.id}:L${level}`);
          }
        }
      }
    }
    notificationStore.retryFailed();
    return { emergencies, slaEscalations };
  } finally {
    running = false;
  }
}

export function startScheduler(intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS) || 30000) {
  if (timer) return;
  timer = setInterval(() => {
    runSchedulerTick().catch((err) => console.error('[Scheduler] Tick failed:', err));
  }, intervalMs);
  timer.unref();
  console.log(`[Scheduler] Running every ${Math.round(intervalMs / 1000)}s.`);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}
