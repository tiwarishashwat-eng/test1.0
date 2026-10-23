import React from 'react';
import {
  Inbox,
  Eye,
  UserCheck,
  PlayCircle,
  CheckCircle2,
  AlertTriangle,
  Layers
} from 'lucide-react';
import { TicketCategory, TicketStatus } from '../../shared/types.js';

interface StaffMetricsProps {
  stats: {
    total: number;
    submitted: number;
    underReview: number;
    assigned: number;
    inProgress: number;
    resolved: number;
    byCategory: Record<TicketCategory, number>;
  };
  duplicateCount: number;
  activeStatusFilter: string;
  onSelectStatusFilter: (status: string) => void;
}

export const StaffMetrics: React.FC<StaffMetricsProps> = ({
  stats,
  duplicateCount,
  activeStatusFilter,
  onSelectStatusFilter
}) => {
  const cards = [
    {
      label: 'All Tickets',
      value: stats.total,
      filter: 'ALL',
      icon: Layers,
      color: 'text-slate-700 bg-slate-100 border-slate-200'
    },
    {
      label: 'Submitted (New)',
      value: stats.submitted,
      filter: 'Submitted',
      icon: Inbox,
      color: 'text-blue-700 bg-blue-50 border-blue-200'
    },
    {
      label: 'Under Review',
      value: stats.underReview,
      filter: 'Under Review',
      icon: Eye,
      color: 'text-purple-700 bg-purple-50 border-purple-200'
    },
    {
      label: 'In Progress',
      value: stats.inProgress,
      filter: 'In Progress',
      icon: PlayCircle,
      color: 'text-amber-700 bg-amber-50 border-amber-200'
    },
    {
      label: 'Resolved',
      value: stats.resolved,
      filter: 'Resolved',
      icon: CheckCircle2,
      color: 'text-emerald-700 bg-emerald-50 border-emerald-200'
    }
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = activeStatusFilter === c.filter;

        return (
          <button
            type="button"
            key={c.label}
            onClick={() => onSelectStatusFilter(c.filter)}
            className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${c.color} ${
              isActive
                ? 'ring-2 ring-blue-600 shadow-sm scale-[1.02]'
                : 'hover:border-slate-400/60 opacity-90 hover:opacity-100'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-slate-600">{c.label}</span>
              <Icon size={16} className="shrink-0" />
            </div>
            <div className="text-2xl font-black tracking-tight text-slate-900">
              {c.value}
            </div>
          </button>
        );
      })}
    </div>
  );
};
