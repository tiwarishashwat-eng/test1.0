/**
 * Impact-based maintenance priority engine. Deterministic and explainable; never
 * uses Gemini. Medical/security emergencies do NOT go through this engine.
 *
 * Scoring (points are additive):
 *   Safety risk ............................. +40  (declared by student/staff, or matched by the
 *                                                   fixed safety keyword list below)
 *   Category urgency ........................ +10 Electricity/Plumbing, +8 Internet, +5 others
 *   People affected ......................... +0 (1), +10 (2-9), +20 (10-49), +30 (50+)
 *   Accessibility impact .................... +15
 *   Critical service disruption ............. +15  (e.g. no water, power outage, lift down)
 *   No alternative available ................ +10  (+5 when availability is unknown)
 *   Overdue against SLA deadline ............ +15
 * Levels: score >= 60 Critical, >= 40 High, >= 20 Medium, otherwise Low.
 * Floors: a safety risk is never below High; a ticket in an active recurring-issue
 * cluster is never below High.
 */
import { ImpactInputs, PriorityAssessment, PriorityFactor, PriorityLevel, Ticket, TicketCategory } from '../shared/types.js';

export const PRIORITY_RANK: Record<PriorityLevel, number> = { Low: 0, Medium: 1, High: 2, Critical: 3 };

// Fixed English/Hindi keyword list for safety hazards (deterministic, not AI)
const SAFETY_PATTERNS = [
  /spark/i, /smoke/i, /fire/i, /burning/i, /shock/i, /exposed wire/i, /live wire/i, /gas leak/i,
  /electrocut/i, /short circuit/i, /flood/i, /collapse/i, /\bcurrent\b.*(lag|aa)/i, /karant/i,
  /aag\b/i, /dhuaa|dhuan/i, /chingari/i
];

const CATEGORY_POINTS: Record<TicketCategory, number> = {
  Electricity: 10,
  Plumbing: 10,
  'Internet Connectivity': 8,
  Cleanliness: 5,
  Other: 5
};

export function detectSafetyKeywords(text: string): string | null {
  const match = SAFETY_PATTERNS.find((p) => p.test(text));
  return match ? match.source : null;
}

export function levelForScore(score: number): PriorityLevel {
  if (score >= 60) return 'Critical';
  if (score >= 40) return 'High';
  if (score >= 20) return 'Medium';
  return 'Low';
}

export function maxLevel(a: PriorityLevel, b: PriorityLevel): PriorityLevel {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

/** Validates impact inputs from a request; returns an error message or the normalised value. */
export function parseImpactInputs(raw: unknown, source: 'student' | 'staff', updatedBy?: string): ImpactInputs | string {
  if (raw === undefined || raw === null) return 'Impact details are required';
  if (typeof raw !== 'object') return 'Impact details must be an object';
  const r = raw as Record<string, unknown>;
  const bool = (k: string) => r[k] === undefined ? false : typeof r[k] === 'boolean' ? (r[k] as boolean) : null;
  const safetyRisk = bool('safetyRisk');
  const accessibilityImpact = bool('accessibilityImpact');
  const criticalServiceDisruption = bool('criticalServiceDisruption');
  if (safetyRisk === null || accessibilityImpact === null || criticalServiceDisruption === null) {
    return 'Impact flags must be true or false';
  }
  const people = r.peopleAffected === undefined ? 1 : r.peopleAffected;
  if (typeof people !== 'number' || !Number.isInteger(people) || people < 1 || people > 100000) {
    return 'People affected must be a whole number of at least 1';
  }
  const alt = r.alternativesAvailable === undefined ? 'unknown' : r.alternativesAvailable;
  if (alt !== 'yes' && alt !== 'no' && alt !== 'unknown') return 'Alternatives available must be yes, no, or unknown';
  return {
    safetyRisk,
    peopleAffected: people,
    accessibilityImpact,
    criticalServiceDisruption,
    alternativesAvailable: alt,
    source,
    updatedAt: new Date().toISOString(),
    updatedBy
  };
}

export function assessPriority(
  ticket: Pick<Ticket, 'category' | 'description' | 'impact' | 'slaDeadline' | 'status'> & { title?: string; problemTitle?: string },
  context: { now?: Date; inActiveCluster?: boolean; clusterReporters?: number } = {}
): PriorityAssessment {
  const now = context.now ?? new Date();
  const impact = ticket.impact;
  const factors: PriorityFactor[] = [];
  const add = (factor: string, points: number, detail: string) => factors.push({ factor, points, detail });

  const keyword = detectSafetyKeywords(`${ticket.problemTitle ?? ''} ${ticket.title ?? ''} ${ticket.description}`);
  const safety = Boolean(impact?.safetyRisk) || Boolean(keyword);
  if (safety) {
    add('Safety risk', 40, impact?.safetyRisk ? `Reported as a safety risk (${impact.source})` : 'Description matches the safety keyword list');
  }

  add('Category urgency', CATEGORY_POINTS[ticket.category], `${ticket.category} base urgency`);

  const people = Math.max(impact?.peopleAffected ?? 1, context.clusterReporters ?? 0);
  const peoplePoints = people >= 50 ? 30 : people >= 10 ? 20 : people >= 2 ? 10 : 0;
  if (peoplePoints > 0) {
    add('People affected', peoplePoints, context.clusterReporters && context.clusterReporters >= people
      ? `${people} distinct students reported this recurring issue`
      : `About ${people} people affected (estimate)`);
  }
  if (impact?.accessibilityImpact) add('Accessibility impact', 15, 'Affects accessibility (e.g. lift, ramp, accessible restroom)');
  if (impact?.criticalServiceDisruption) add('Critical service disruption', 15, 'Disrupts a critical service');
  if (impact?.alternativesAvailable === 'no') add('No alternative', 10, 'No alternative is available');
  else if (!impact || impact.alternativesAvailable === 'unknown') add('Alternatives unknown', 5, 'Availability of alternatives is unknown');

  if (ticket.status !== 'Resolved' && ticket.slaDeadline && new Date(ticket.slaDeadline).getTime() < now.getTime()) {
    add('Overdue', 15, `Past the SLA deadline (${ticket.slaDeadline})`);
  }

  const score = factors.reduce((s, f) => s + f.points, 0);
  let level = levelForScore(score);
  const floors: string[] = [];
  if (safety && PRIORITY_RANK[level] < PRIORITY_RANK.High) {
    level = 'High';
    floors.push('raised to High because of a safety risk');
  }
  if (context.inActiveCluster && PRIORITY_RANK[level] < PRIORITY_RANK.High) {
    level = 'High';
    floors.push('raised to High because it is part of a recurring-issue cluster');
  }

  const explanation =
    `Score ${score}: ` +
    factors.map((f) => `${f.factor} +${f.points}`).join(', ') +
    `. Level ${level}${floors.length ? ` (${floors.join('; ')})` : ''}.`;

  return { score, level, factors, explanation, computedAt: now.toISOString() };
}

/** Effective priority: a staff override wins over the computed recommendation. */
export function effectivePriority(ticket: Pick<Ticket, 'priorityOverride' | 'priorityAssessment'>): PriorityLevel {
  return ticket.priorityOverride?.level ?? ticket.priorityAssessment?.level ?? 'Medium';
}
