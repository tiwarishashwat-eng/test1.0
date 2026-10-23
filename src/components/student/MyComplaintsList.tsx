import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Clock,
  ArrowRight,
  RefreshCw,
  Search,
  Filter,
  AlertCircle,
  Building,
  CheckCircle2
} from 'lucide-react';
import { StudentTicketView, TicketCategory, TicketStatus, TICKET_CATEGORIES, TICKET_STATUSES } from '../../shared/types.js';
import { CategoryBadge } from '../common/CategoryBadge.js';
import { StatusBadge } from '../common/StatusBadge.js';
import { apiClient } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.js';

interface MyComplaintsListProps {
  onSelectTicket: (ticketId: string) => void;
  onNewComplaint: () => void;
}

export const MyComplaintsList: React.FC<MyComplaintsListProps> = ({
  onSelectTicket,
  onNewComplaint
}) => {
  const { user } = useAuth();
  const [tickets, setTickets] = useState<StudentTicketView[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');

  const loadMyTickets = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.getTickets({
        category: categoryFilter,
        status: statusFilter,
        query: query.trim() || undefined
      });

      if (res.success) {
        setTickets(res.tickets as StudentTicketView[]);
      } else {
        setError('Failed to load your complaints');
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with ticket server');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadMyTickets();
    }
  }, [user, categoryFilter, statusFilter]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadMyTickets();
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8 space-y-6">
      {/* Top Title & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Inbox className="text-blue-600" />
            <span>My Submitted Maintenance Requests</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Viewing records filed under <strong>{user?.name}</strong> ({user?.email})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={loadMyTickets}
            disabled={isLoading}
            className="p-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-600 cursor-pointer"
            title="Refresh complaints"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
          </button>

          <button
            onClick={onNewComplaint}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer shadow-xs"
          >
            Report New Issue
          </button>
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <form onSubmit={handleSearch} className="relative sm:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-3.5 h-3.5" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search my complaints..."
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-300 text-xs text-slate-800"
          />
        </form>

        <div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 font-medium"
          >
            <option value="ALL">All Categories</option>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        <div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white text-slate-700 font-medium"
          >
            <option value="ALL">All Statuses</option>
            {TICKET_STATUSES.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </select>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="p-10 text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
          <p className="text-xs text-slate-500">Retrieving your complaints...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0 text-rose-600" />
          <span>{error}</span>
        </div>
      ) : tickets.length === 0 ? (
        <div className="p-12 text-center space-y-3 bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
          <div className="w-12 h-12 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto">
            <Inbox size={22} />
          </div>
          <h3 className="font-bold text-slate-800 text-sm">No Complaints Found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            You haven't submitted any maintenance requests matching the current filters.
          </p>
          <button
            onClick={onNewComplaint}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer shadow-xs"
          >
            Submit a Maintenance Request
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <div
              key={t.id}
              onClick={() => onSelectTicket(t.id)}
              className="p-4 rounded-xl border border-slate-200 hover:border-blue-400 bg-white hover:bg-blue-50/30 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs group"
            >
              <div className="space-y-1 max-w-xl">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-blue-700 text-sm">{t.id}</span>
                  <StatusBadge status={t.status} size="sm" />
                  <CategoryBadge category={t.category} size="sm" />
                </div>
                <h4 className="font-bold text-slate-900 group-hover:text-blue-700 transition-colors">
                  {t.title}
                </h4>
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  <Building size={12} className="text-slate-400 shrink-0" />
                  <span>{t.building} • {t.location}</span>
                  <span>•</span>
                  <span>{new Date(t.createdAt).toLocaleDateString()}</span>
                </p>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center">
                <span className="text-xs font-semibold text-blue-600 group-hover:underline">
                  Track Timeline
                </span>
                <ArrowRight size={14} className="text-blue-600 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
