import React from 'react';
import { TicketStatus } from '../../shared/types.js';
import { Clock, Eye, UserCheck, PlayCircle, CheckCircle2 } from 'lucide-react';

interface StatusBadgeProps {
  status: TicketStatus;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  status,
  showIcon = true,
  size = 'md',
  className = ''
}) => {
  const config = {
    'Submitted': {
      bg: 'bg-slate-100 text-slate-700 border-slate-300 ring-slate-500/10',
      icon: Clock,
      dot: 'bg-slate-400'
    },
    'Under Review': {
      bg: 'bg-purple-50 text-purple-700 border-purple-200 ring-purple-500/10',
      icon: Eye,
      dot: 'bg-purple-500'
    },
    'Assigned': {
      bg: 'bg-sky-50 text-sky-700 border-sky-200 ring-sky-500/10',
      icon: UserCheck,
      dot: 'bg-sky-500'
    },
    'In Progress': {
      bg: 'bg-amber-50 text-amber-800 border-amber-300 ring-amber-500/15',
      icon: PlayCircle,
      dot: 'bg-amber-500 animate-pulse'
    },
    'Resolved': {
      bg: 'bg-emerald-50 text-emerald-800 border-emerald-300 ring-emerald-500/15',
      icon: CheckCircle2,
      dot: 'bg-emerald-500'
    }
  }[status] || {
    bg: 'bg-gray-100 text-gray-700 border-gray-300 ring-gray-500/10',
    icon: Clock,
    dot: 'bg-gray-400'
  };

  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1 font-medium',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-semibold',
    lg: 'text-sm px-3 py-1.5 gap-2 font-semibold'
  }[size];

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16
  }[size];

  return (
    <span
      className={`inline-flex items-center rounded-full border ring-1 ring-inset ${config.bg} ${sizeClasses} ${className}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {showIcon && <Icon size={iconSizes} className="shrink-0" />}
      <span>{status}</span>
    </span>
  );
};
