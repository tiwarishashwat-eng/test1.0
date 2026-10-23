import React, { useState, useEffect } from 'react';
import {
  Search,
  Filter,
  HardHat,
  RefreshCw,
  AlertTriangle,
  Building,
  User,
  ShieldCheck,
  Clock,
  Sparkles,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
  Inbox,
  Lock,
  LogIn
} from 'lucide-react';
import {
  Ticket,
  TicketCategory,
  TicketStatus,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  DEPARTMENTS,
  Department
} from '../../shared/types.js';
import { CategoryBadge } from '../common/CategoryBadge.js';
import { StatusBadge } from '../common/StatusBadge.js';
import { StaffMetrics } from './StaffMetrics.js';
import { TicketDetailModal } from './TicketDetailModal.js';
import { apiClient } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.js';

interface StaffDashboardProps {
  onOpenDemoGuide: () => void;
  onOpenAuthModal?: () => void;
}

export const StaffDashboard: React.FC<StaffDashboardProps> = ({
  onOpenDemoGuide,
  onOpenAuthModal
}) => {
  const { user } = useAuth();

  // Data state
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    submitted: 0,
    underReview: 0,
    assigned: 0,
    inProgress: 0,
    resolved: 0,
    byCategory: {
      'Plumbing': 0,
      'Electricity': 0,
      'Cleanliness': 0,
      'Internet Connectivity': 0
    }
  });

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [departmentFilter, setDepartmentFilter] = useState<string>('ALL');
  const [buildingFilter, setBuildingFilter] = useState<string>('ALL');

  // UI state
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);

  // Load tickets with filters
  const fetchTickets = async () => {
    if (!user || (user.role !== 'staff' && user.role !== 'admin')) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await apiClient.getTickets({
        query: searchQuery.trim() || undefined,
        status: statusFilter,
        category: categoryFilter,
        department: departmentFilter,
        building: buildingFilter
      });

      if (res.success) {
        setTickets(res.tickets as Ticket[]);
        setStats(res.stats);
      } else {
        setError('Failed to load tickets');
      }
    } catch (err: any) {
      setError(err.message || 'Error communicating with ticket server');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, [user, statusFilter, categoryFilter, departmentFilter, buildingFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTickets();
  };

  const handleTicketUpdated = (updatedTicket: Ticket) => {
    setTickets((prev) =>
      prev.map((t) => (t.id === updatedTicket.id ? updatedTicket : t))
    );
    setSelectedTicket(updatedTicket);
    fetchTickets();
  };

  // Guard: If not staff or admin, render authorization barrier
  if (!user || (user.role !== 'staff' && user.role !== 'admin')) {
    return (
      <div className="max-w-2xl mx-auto my-12 bg-white rounded-3xl border border-slate-200 shadow-md p-8 text-center space-y-4 text-slate-800">
        <div className="w-14 h-14 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200 shadow-inner">
          <Lock size={28} />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Protected Facilities Staff Area</h2>
        <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
          Access to campus dispatch operations, technician assignment, duplicate review, and status management is restricted to authorized campus facilities personnel.
        </p>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={() => onOpenAuthModal && onOpenAuthModal()}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <LogIn size={15} />
            <span>Sign In with Staff Account</span>
          </button>
        </div>
      </div>
    );
  }

  // Duplicate warnings count
  const duplicateWarningCount = tickets.reduce(
    (acc, t) => acc + (t.duplicateWarnings && t.duplicateWarnings.length > 0 && !t.duplicateReviewed ? 1 : 0),
    0
  );

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Top Bar: Title & Identity */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-600 mb-1">
            <HardHat size={14} />
            <span>Facilities Operations &amp; Dispatch</span>
          </div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">
            Campus Maintenance Resolution Board
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Authenticated as <strong>{user.name}</strong> ({user.department || 'All Campus Dispatch'})
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchTickets}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          <button
            onClick={onOpenDemoGuide}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer"
          >
            <Sparkles size={13} />
            <span>How It Works</span>
          </button>
        </div>
      </div>

      {/* Metrics Cards from real persistent records */}
      <StaffMetrics
        stats={stats}
        duplicateCount={duplicateWarningCount}
        activeStatusFilter={statusFilter}
        onSelectStatusFilter={setStatusFilter}
      />

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          {/* Search Input */}
          <form onSubmit={handleSearchSubmit} className="relative sm:col-span-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by ticket ID, summary, building, room..."
              className="w-full pl-9 pr-16 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 text-slate-800"
            />
            <button
              type="submit"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-700 cursor-pointer"
            >
              Search
            </button>
          </form>

          {/* Category Filter */}
          <div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-700"
            >
              <option value="ALL">All Categories</option>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c} ({stats.byCategory[c] || 0})
                </option>
              ))}
            </select>
          </div>

          {/* Department Filter */}
          <div>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white font-medium text-slate-700"
            >
              <option value="ALL">All Departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Tickets List Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center space-y-3">
            <RefreshCw className="w-8 h-8 text-blue-600 animate-spin mx-auto" />
            <p className="text-xs text-slate-500 font-medium">Loading campus maintenance tickets...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center space-y-2 text-rose-700 bg-rose-50/50">
            <AlertTriangle className="w-6 h-6 mx-auto text-rose-600" />
            <p className="text-sm font-semibold">{error}</p>
            <button
              onClick={fetchTickets}
              className="text-xs font-bold underline cursor-pointer"
            >
              Try Again
            </button>
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
              <Inbox size={24} />
            </div>
            <h4 className="text-base font-bold text-slate-800">No Tickets Match Filters</h4>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              There are currently no tickets matching your search query or criteria.
            </p>
            <button
              onClick={() => {
                setStatusFilter('ALL');
                setCategoryFilter('ALL');
                setDepartmentFilter('ALL');
                setSearchQuery('');
              }}
              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 cursor-pointer"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs divide-y divide-slate-200" aria-label="Maintenance tickets table">
              <thead className="bg-slate-50 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                <tr>
                  <th scope="col" className="px-4 py-3">ID &amp; Urgency</th>
                  <th scope="col" className="px-4 py-3">Category</th>
                  <th scope="col" className="px-4 py-3">Issue Summary &amp; Location</th>
                  <th scope="col" className="px-4 py-3">Status</th>
                  <th scope="col" className="px-4 py-3">Assigned Dept / Tech</th>
                  <th scope="col" className="px-4 py-3">Flags</th>
                  <th scope="col" className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {tickets.map((t) => {
                  const hasDuplicates = t.duplicateWarnings && t.duplicateWarnings.length > 0 && !t.duplicateReviewed;
                  const isHazard = t.aiAnalysis?.urgencyAssessment === 'Safety Hazard';

                  return (
                    <tr
                      key={t.id}
                      className="hover:bg-blue-50/40 transition-colors group cursor-pointer"
                      onClick={() => setSelectedTicket(t)}
                    >
                      {/* ID & Urgency */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-blue-700 text-sm">
                            {t.id}
                          </span>
                          {isHazard && (
                            <span
                              title={t.aiAnalysis?.isAiFallback ? 'Possible safety hazard (keyword rules)' : 'Possible safety hazard (AI suggestion)'}
                              className="w-2 h-2 rounded-full bg-rose-500 animate-pulse"
                            />
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 block font-mono">
                          {new Date(t.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <CategoryBadge category={t.category} size="sm" />
                      </td>

                      {/* Summary & Location */}
                      <td className="px-4 py-3.5 max-w-xs">
                        <p className="font-semibold text-slate-900 truncate">
                          {t.title}
                        </p>
                        <p className="text-[11px] text-slate-500 truncate flex items-center gap-1 mt-0.5">
                          <Building size={11} className="shrink-0 text-slate-400" />
                          <span>{t.building} • {t.location}</span>
                        </p>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        <StatusBadge status={t.status} size="sm" />
                      </td>

                      {/* Assignment */}
                      <td className="px-4 py-3.5 max-w-[180px]">
                        {t.assignment ? (
                          <div>
                            <span className="font-medium text-slate-800 text-[11px] truncate block">
                              {t.assignment.department.replace(' Department', '').replace(' Services', '').replace(' Team', '')}
                            </span>
                            <span className="text-[10px] text-blue-600 truncate block">
                              {t.assignment.assignedTo || 'Technician Assigned'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-slate-400 text-[11px] italic">
                            Unassigned
                          </span>
                        )}
                      </td>

                      {/* Warnings / Duplicate Flags */}
                      <td className="px-4 py-3.5 whitespace-nowrap">
                        {hasDuplicates ? (
                          <span
                            title="Duplicate Warning: Needs staff confirmation or dismissal"
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300"
                          >
                            <AlertTriangle size={11} />
                            <span>Duplicate? ({t.duplicateWarnings!.length})</span>
                          </span>
                        ) : (
                          <span className="text-slate-300 text-[11px]">—</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedTicket(t);
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-blue-600 hover:text-white text-slate-700 transition-colors shadow-2xs cursor-pointer"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ticket Details Modal */}
      {selectedTicket && (
        <TicketDetailModal
          ticket={selectedTicket}
          onClose={() => setSelectedTicket(null)}
          onTicketUpdated={handleTicketUpdated}
          onNavigateToTicket={(id) => {
            const found = tickets.find((t) => t.id === id);
            if (found) {
              setSelectedTicket(found);
            } else {
              apiClient.getTicketById(id).then((res) => {
                if (res.ticket) setSelectedTicket(res.ticket as Ticket);
              });
            }
          }}
        />
      )}
    </div>
  );
};
