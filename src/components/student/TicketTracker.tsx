import React, { useState, useEffect } from 'react';
import {
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  Building,
  MapPin,
  User,
  Shield,
  RefreshCw,
  Calendar,
  Sparkles,
  ArrowRight,
  HardHat,
  MessageSquare
} from 'lucide-react';
import { Ticket, TicketStatus, TICKET_STATUSES } from '../../shared/types.js';
import { CategoryBadge } from '../common/CategoryBadge.js';
import { StatusBadge } from '../common/StatusBadge.js';
import { apiClient } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.js';
import { aiSourceTitle } from '../../shared/aiLabels.js';
import { StudentTicketExtras } from './StudentTicketExtras.js';

interface TicketTrackerProps {
  initialTicketId?: string;
  onNavigateToNewComplaint: () => void;
  onRequireSignIn: () => void;
}

export const TicketTracker: React.FC<TicketTrackerProps> = ({
  initialTicketId = '',
  onNavigateToNewComplaint,
  onRequireSignIn
}) => {
  const { user } = useAuth();
  const [ticketIdInput, setTicketIdInput] = useState(initialTicketId);
  const [currentTicket, setCurrentTicket] = useState<Ticket | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Only tickets this user actually looked up in this session
  const [recentLookups, setRecentLookups] = useState<string[]>([]);

  const fetchTicket = async (idToFetch: string) => {
    if (!idToFetch.trim()) {
      setErrorMessage('Please enter a ticket ID (e.g. CC-1001).');
      return;
    }

    if (!user) {
      setErrorMessage('Please sign in to view your tickets.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await apiClient.getTicketById(idToFetch);
      if (res.success && res.ticket) {
        setCurrentTicket(res.ticket);
        setTicketIdInput(res.ticket.id);

        // Update recent lookups
        setRecentLookups((prev) => {
          const filtered = prev.filter((id) => id !== res.ticket!.id);
          return [res.ticket!.id, ...filtered].slice(0, 5);
        });
      } else {
        setErrorMessage(res.error || `No ticket found with ID ${idToFetch}`);
        setCurrentTicket(null);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Error looking up ticket.');
      setCurrentTicket(null);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (initialTicketId && user) {
      fetchTicket(initialTicketId);
    }
  }, [initialTicketId, user]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchTicket(ticketIdInput);
  };

  // Status timeline step calculation
  const getStepIndex = (status: TicketStatus): number => {
    return TICKET_STATUSES.indexOf(status);
  };

  const currentStepIndex = currentTicket ? getStepIndex(currentTicket.status) : 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Lookup Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 sm:p-8">
        <div className="max-w-2xl mx-auto text-center space-y-2 mb-6">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            Track Maintenance Complaint Progress
          </h2>
          <p className="text-xs sm:text-sm text-slate-500">
            Enter your unique Ticket ID to see real-time triage, technician assignment, and resolution milestones.
          </p>
        </div>

        <form onSubmit={handleSearchSubmit} className="max-w-xl mx-auto">
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <div className="relative w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" />
              <input
                type="text"
                value={ticketIdInput}
                onChange={(e) => setTicketIdInput(e.target.value)}
                placeholder="Enter Ticket ID (e.g. CC-1001, CC-1002)"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 uppercase font-mono text-slate-800"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading || !ticketIdInput.trim()}
              className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-xs bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 shrink-0"
            >
              {isLoading ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  <span>Searching...</span>
                </>
              ) : (
                <>
                  <Search size={14} />
                  <span>Lookup Ticket</span>
                </>
              )}
            </button>
          </div>

          {!user && (
            <div className="mt-4 text-center text-xs text-slate-600">
              You need to sign in to look up your tickets.{' '}
              <button
                type="button"
                onClick={onRequireSignIn}
                className="font-semibold text-blue-700 underline hover:text-blue-800 cursor-pointer"
              >
                Sign in
              </button>
            </div>
          )}

          {recentLookups.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-xs">
            <span className="text-slate-400 font-medium">Recently viewed:</span>
            {recentLookups.map((id) => (
              <button
                type="button"
                key={id}
                onClick={() => {
                  setTicketIdInput(id);
                  fetchTicket(id);
                }}
                className="px-2.5 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-xs font-semibold cursor-pointer transition-colors"
              >
                {id}
              </button>
            ))}
          </div>
          )}
        </form>

        {errorMessage && (
          <div role="alert" className="max-w-xl mx-auto mt-4 p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0 text-rose-600" />
            <span>{errorMessage}</span>
          </div>
        )}
      </div>

      {/* Ticket Details & Timeline View */}
      {currentTicket && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden space-y-6 p-6 sm:p-8">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <span className="font-mono text-2xl font-extrabold text-blue-700">
                  {currentTicket.id}
                </span>
                <StatusBadge status={currentTicket.status} size="md" />
                <CategoryBadge category={currentTicket.category} size="md" />
              </div>
              <h3 className="text-lg font-bold text-slate-900">
                {currentTicket.title}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Submitted on {new Date(currentTicket.createdAt).toLocaleDateString()} at{' '}
                {new Date(currentTicket.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>

            <button
              onClick={() => fetchTicket(currentTicket.id)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 text-xs font-medium cursor-pointer"
            >
              <RefreshCw size={13} className={isLoading ? 'animate-spin' : ''} />
              <span>Refresh Status</span>
            </button>
          </div>

          <StudentTicketExtras ticket={currentTicket} onTicketUpdated={setCurrentTicket} />

          {/* Interactive Progress Timeline (5 Stages) */}
          <div className="space-y-4 py-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Resolution Progress Milestones
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              {TICKET_STATUSES.map((statusName, idx) => {
                const isPassed = idx < currentStepIndex;
                const isCurrent = idx === currentStepIndex;
                const isPending = idx > currentStepIndex;

                let cardBg = 'bg-slate-50 border-slate-200 text-slate-400';
                if (isCurrent) {
                  cardBg =
                    statusName === 'Resolved'
                      ? 'bg-emerald-50 border-emerald-300 ring-2 ring-emerald-500/20 text-emerald-800'
                      : 'bg-blue-50 border-blue-300 ring-2 ring-blue-500/20 text-blue-800';
                } else if (isPassed) {
                  cardBg = 'bg-emerald-50/50 border-emerald-200 text-emerald-700';
                }

                return (
                  <div
                    key={statusName}
                    className={`p-3 rounded-xl border transition-all text-xs flex flex-col justify-between ${cardBg}`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-[10px] uppercase font-bold text-slate-400">
                        Step 0{idx + 1}
                      </span>
                      {isPassed && <CheckCircle2 size={14} className="text-emerald-600" />}
                      {isCurrent && (
                        <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                      )}
                    </div>
                    <div className="font-bold text-slate-900">{statusName}</div>
                    <div className="text-[10px] mt-1 text-slate-500">
                      {isPassed ? 'Completed' : isCurrent ? 'Active Stage' : 'Queued'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Detailed Info Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            {/* Location & Details */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <h5 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <MapPin size={14} className="text-blue-600" />
                <span>Location &amp; Facility Context</span>
              </h5>
              <div className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">Building:</span>
                  <span className="font-semibold text-slate-800">{currentTicket.building}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Exact Area:</span>
                  <span className="font-semibold text-slate-800">{currentTicket.location}</span>
                </div>
                {currentTicket.studentName && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Reported By:</span>
                    <span className="font-medium text-slate-800">{currentTicket.studentName}</span>
                  </div>
                )}
              </div>

              {currentTicket.imageDataUri && (
                <div className="pt-2 border-t border-slate-200">
                  <span className="text-slate-500 block mb-1.5 font-medium">Attached Photo:</span>
                  <img
                    src={currentTicket.imageDataUri}
                    alt="Complaint visual"
                    className="w-full max-h-48 object-cover rounded-lg border border-slate-300"
                  />
                </div>
              )}
            </div>

            {/* Department Assignment & Triage */}
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3 text-xs">
              <h5 className="font-bold text-slate-700 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <HardHat size={14} className="text-amber-600" />
                <span>Department Assignment &amp; Routing</span>
              </h5>

              {currentTicket.assignment ? (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Responsible Dept:</span>
                    <span className="font-semibold text-slate-800">
                      {currentTicket.assignment.department}
                    </span>
                  </div>
                  {currentTicket.assignment.assignedTo && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Technician:</span>
                      <span className="font-semibold text-blue-700">
                        {currentTicket.assignment.assignedTo}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-slate-500">Priority Level:</span>
                    <span className="font-bold text-slate-800">
                      {currentTicket.assignment.priority}
                    </span>
                  </div>
                  {currentTicket.assignment.notes && (
                    <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-slate-700 mt-1">
                      <span className="font-semibold block text-slate-500 mb-0.5">Technician Remarks:</span>
                      {currentTicket.assignment.notes}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                  <p className="font-semibold">Awaiting Staff Assignment</p>
                  <p className="text-[11px] mt-0.5">
                    Target department recommended: {currentTicket.aiAnalysis?.recommendedDepartment || 'Campus Facilities Dispatch'}
                  </p>
                </div>
              )}

              {/* AI Triage Snippet */}
              {currentTicket.aiAnalysis && (
                <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-100 text-[11px] space-y-1">
                  <div className="flex items-center gap-1 text-indigo-900 font-bold">
                    <Sparkles size={12} className="text-indigo-600" />
                    <span>{aiSourceTitle(currentTicket.aiAnalysis)}</span>
                  </div>
                  <p className="text-indigo-950">
                    "{currentTicket.aiAnalysis.conciseSummary}"
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Full Chronological Status Audit Log */}
          <div className="space-y-3 pt-3 border-t border-slate-200">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={14} className="text-slate-500" />
              <span>Full Status Audit Trail &amp; Activity Log</span>
            </h4>

            <div className="space-y-2">
              {currentTicket.statusHistory.map((entry, idx) => (
                <div
                  key={entry.id || idx}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800">
                      {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                      <span className="text-blue-700 font-bold">{entry.toStatus}</span>
                    </span>
                    <span className="text-slate-400">•</span>
                    <span className="text-slate-600 font-medium">{entry.changedBy}</span>
                  </div>

                  <div className="flex items-center gap-3 text-slate-500 text-[11px]">
                    {entry.notes && (
                      <span className="italic text-slate-600">"{entry.notes}"</span>
                    )}
                    <span className="font-mono text-slate-400 shrink-0">
                      {new Date(entry.changedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
