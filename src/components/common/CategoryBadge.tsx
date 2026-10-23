import React from 'react';
import { TicketCategory } from '../../shared/types.js';
import { Wrench, Zap, Sparkles, Wifi, HelpCircle } from 'lucide-react';

interface CategoryBadgeProps {
  category: TicketCategory;
  showIcon?: boolean;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const CategoryBadge: React.FC<CategoryBadgeProps> = ({
  category,
  showIcon = true,
  size = 'md',
  className = ''
}) => {
  const config = ({
    'Other': {
      bg: 'bg-slate-100 text-slate-700 border-slate-300 ring-slate-500/10',
      icon: HelpCircle,
      dot: 'bg-slate-500'
    },
    'Plumbing': {
      bg: 'bg-blue-50 text-blue-700 border-blue-200 ring-blue-500/10',
      icon: Wrench,
      dot: 'bg-blue-500'
    },
    'Electricity': {
      bg: 'bg-amber-50 text-amber-700 border-amber-200 ring-amber-500/10',
      icon: Zap,
      dot: 'bg-amber-500'
    },
    'Cleanliness': {
      bg: 'bg-emerald-50 text-emerald-700 border-emerald-200 ring-emerald-500/10',
      icon: Sparkles,
      dot: 'bg-emerald-500'
    },
    'Internet Connectivity': {
      bg: 'bg-indigo-50 text-indigo-700 border-indigo-200 ring-indigo-500/10',
      icon: Wifi,
      dot: 'bg-indigo-500'
    }
  } as Record<TicketCategory, { bg: string; icon: typeof Wrench; dot: string }>)[category] || {
    bg: 'bg-slate-50 text-slate-700 border-slate-200 ring-slate-500/10',
    icon: Wrench,
    dot: 'bg-slate-400'
  };

  const Icon = config.icon;

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5 font-medium',
    lg: 'text-sm px-3 py-1.5 gap-2 font-medium'
  }[size];

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16
  }[size];

  return (
    <span
      className={`inline-flex items-center rounded-md border ring-1 ring-inset ${config.bg} ${sizeClasses} ${className}`}
    >
      {showIcon && <Icon size={iconSizes} className="shrink-0" />}
      <span>{category}</span>
    </span>
  );
};
