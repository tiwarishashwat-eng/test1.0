import React from 'react';
import { PriorityLevel, Ticket } from '../../shared/types.js';

const STYLES: Record<PriorityLevel, string> = {
  Critical: 'bg-rose-600 text-white border-rose-700',
  High: 'bg-orange-100 text-orange-900 border-orange-300',
  Medium: 'bg-sky-50 text-sky-800 border-sky-200',
  Low: 'bg-slate-100 text-slate-700 border-slate-200'
};

/** Effective priority (staff override wins) with an overdue label; text is never colour-only. */
export const PriorityBadge: React.FC<{ ticket: Pick<Ticket, 'priorityAssessment' | 'priorityOverride' | 'slaDeadline' | 'status'> }> = ({ ticket }) => {
  const level = ticket.priorityOverride?.level ?? ticket.priorityAssessment?.level;
  if (!level) return null;
  const overdue = ticket.status !== 'Resolved' && ticket.slaDeadline && new Date(ticket.slaDeadline).getTime() < Date.now();
  return (
    <span className="inline-flex items-center gap-1 mt-1">
      <span
        className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border ${STYLES[level]}`}
        title={ticket.priorityOverride ? `Overridden by ${ticket.priorityOverride.by}: ${ticket.priorityOverride.reason}` : ticket.priorityAssessment?.explanation}
      >
        {level}
        {ticket.priorityOverride ? ' (override)' : ''}
      </span>
      {overdue && <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded border bg-rose-50 text-rose-800 border-rose-300">Overdue</span>}
    </span>
  );
};
