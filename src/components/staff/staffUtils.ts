/**
 * CampusConnect Staff Dashboard Utilities
 * Date formatters, search helpers, and department tech presets
 */

import { Department } from '../../shared/types.js';

export function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = Date.now();
    const diffMs = now - date.getTime();
    
    if (diffMs < 0) return 'Just now';
    
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 45) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return dateString;
  }
}

export function formatFullDateTime(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return dateString;
  }
}

/**
 * Suggested certified technician presets per department for quick staff dispatch
 */
export const DEPARTMENT_TECHNICIANS: Record<Department, string[]> = {
  'Plumbing Maintenance Department': [
    'Carlos Rivera (Master Plumber)',
    'Samira Khan (Plumbing Tech II)',
    'Duty Emergency Plumber'
  ],
  'Electrical Systems & Safety Division': [
    'Marcus Vance (Senior Electrician)',
    'Jason Brody (High-Voltage Tech)',
    'Duty Electrician Dispatch'
  ],
  'Campus Custodial & Sanitation Services': [
    'Elena Gomez (Custodial Lead)',
    'Devante Washington (Sanitation Specialist)',
    'Floor Care Response Team'
  ],
  'IT & Network Infrastructure Team': [
    'Maya Lin (NOC Wireless Engineer)',
    'Kevin Zhao (Network Ops)',
    'Campus Helpdesk Tech'
  ]
};
