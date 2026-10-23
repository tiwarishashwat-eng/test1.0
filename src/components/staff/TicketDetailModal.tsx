import React, { useState, useEffect } from 'react';
import {
  X,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Sparkles,
  HardHat,
  User,
  ShieldAlert,
  Send,
  ArrowRight,
  FileText,
  MapPin,
  ExternalLink,
  Layers,
  Lock,
  MessageSquare
} from 'lucide-react';
import {
  Ticket,
  TicketStatus,
  TICKET_STATUSES,
  DEPARTMENTS,
  Department,
  CATEGORY_DEPARTMENT_ROUTING,
  VALID_STATUS_TRANSITIONS
} from '../../shared/types.js';
import { CategoryBadge } from '../common/CategoryBadge.js';
import { StatusBadge } from '../common/StatusBadge.js';
import { apiClient } from '../../services/apiClient.js';
import { StaffTicketOperations } from './StaffTicketOperations.js';
import { useAuth } from '../../context/AuthContext.js';
import { aiSourceDetail, aiSourceTitle } from '../../shared/aiLabels.js';

interface TicketDetailModalProps {
  ticket: Ticket;
  onClose: () => void;
  onTicketUpdated: (updatedTicket: Ticket) => void;
  onNavigateToTicket: (ticketId: string) => void;
}

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  onClose,
  onTicketUpdated,
  onNavigateToTicket
}) => {
  const { user } = useAuth();

  // Status update state
  const [statusNote, setStatusNote] = useState('');
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  // Assignment state
  const [assignDept, setAssignDept] = useState<Department>(
    ticket.assignment?.department || CATEGORY_DEPARTMENT_ROUTING[ticket.category]
  );
  const [assigneeId, setAssigneeId] = useState(ticket.assignment?.assignedToId || '');
  const [assignableStaff, setAssignableStaff] = useState<{ id: string; name: string }[]>([]);
  const [staffLoadError, setStaffLoadError] = useState<string | null>(null);

  // Real, active staff accounts in the selected department
  useEffect(() => {
    let cancelled = false;
    setStaffLoadError(null);
    apiClient
      .getAssignableStaff(assignDept)
      .then((res) => {
        if (!cancelled) setAssignableStaff(res.staff);
      })
      .catch((err) => {
        if (!cancelled) {
          setAssignableStaff([]);
          setStaffLoadError(err.message || 'Could not load staff list');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assignDept]);
  const [assignNotes, setAssignNotes] = useState(ticket.assignment?.notes || '');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  // Internal staff note state
  const [newInternalNote, setNewInternalNote] = useState('');
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  // Duplicate review state
  const [isReviewingDuplicate, setIsReviewingDuplicate] = useState(false);

  // Handle status update through validated transitions
  const handleUpdateStatus = async (newStatus: TicketStatus) => {
    setIsUpdatingStatus(true);
    setStatusError(null);

    try {
      const res = await apiClient.updateStatus(ticket.id, {
        status: newStatus,
        notes: statusNote.trim() || undefined
      });

      if (res.success && res.ticket) {
        setStatusNote('');
        onTicketUpdated(res.ticket);
      } else {
        setStatusError('Failed to update status');
      }
    } catch (err: any) {
      setStatusError(err.message || 'Error communicating with ticket server');
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  // Handle assignment
  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAssigning(true);
    setAssignError(null);
    setAssignSuccess(null);

    try {
      const res = await apiClient.assignTicket(ticket.id, {
        department: assignDept,
        assignedToId: assigneeId || undefined,
        notes: assignNotes.trim() || undefined
      });

      if (res.success && res.ticket) {
        setAssignSuccess(`Assigned to ${assignDept}`);
        onTicketUpdated(res.ticket);
        setTimeout(() => setAssignSuccess(null), 3000);
      } else {
        setAssignError('Failed to assign ticket');
      }
    } catch (err: any) {
      setAssignError(err.message || 'Error saving assignment');
    } finally {
      setIsAssigning(false);
    }
  };

  // Handle adding private internal note
  const handleAddInternalNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newInternalNote.trim()) return;

    setIsAddingNote(true);
    setNoteError(null);

    try {
      const res = await apiClient.addInternalNote(ticket.id, newInternalNote.trim());
      if (res.success && res.note) {
        const updatedTicket: Ticket = {
          ...ticket,
          internalNotes: [...(ticket.internalNotes || []), res.note]
        };
        onTicketUpdated(updatedTicket);
        setNewInternalNote('');
      } else {
        setNoteError('Failed to add note');
      }
    } catch (err: any) {
      setNoteError(err.message || 'Error saving note');
    } finally {
      setIsAddingNote(false);
    }
  };

  // Handle duplicate review decision
  const handleDuplicateReview = async (action: 'confirm' | 'dismiss') => {
    setIsReviewingDuplicate(true);
    try {
      const res = await apiClient.reviewDuplicate(ticket.id, {
        action,
        note: action === 'confirm' ? 'Verified duplicate complaint' : 'Dismissed as distinct issue'
      });
      if (res.success && res.ticket) {
        onTicketUpdated(res.ticket);
      }
    } catch (err: any) {
      alert(`Error reviewing duplicate: ${err.message}`);
    } finally {
      setIsReviewingDuplicate(false);
    }
  };

  // Valid next transitions from current status
  const allowedTransitions = VALID_STATUS_TRANSITIONS[ticket.status] || [];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ticket-modal-title"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <span className="font-mono text-xl font-extrabold text-blue-400">
              {ticket.id}
            </span>
            <StatusBadge status={ticket.status} size="sm" />
            <CategoryBadge category={ticket.category} size="sm" />
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
            aria-label="Close ticket details"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-slate-800 text-sm">
          {/* Title & Metadata */}
          <div className="space-y-1">
            <h3 id="ticket-modal-title" className="text-xl font-bold text-slate-950">
              {ticket.title}
            </h3>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1 font-semibold text-slate-700">
                <MapPin size={13} className="text-blue-600" />
                {ticket.building} • {ticket.location}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock size={13} />
                {new Date(ticket.createdAt).toLocaleString()}
              </span>
              <span>•</span>
              <span>Student: <strong className="text-slate-800">{ticket.studentName}</strong> ({ticket.studentEmail})</span>
            </div>
          </div>

          {/* AI Triage Assessment */}
          {ticket.aiAnalysis && (
            <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-indigo-600" />
                  <span
                    className="text-xs font-bold uppercase tracking-wider text-indigo-950"
                    title={aiSourceDetail(ticket.aiAnalysis)}
                  >
                    {aiSourceTitle(ticket.aiAnalysis)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-800 border border-indigo-200">
                    Confidence: {ticket.aiAnalysis.confidence} ({Math.round(ticket.aiAnalysis.confidenceScore * 100)}%)
                  </span>
                  {ticket.aiAnalysis.urgencyAssessment === 'Safety Hazard' && (
                    <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 border border-rose-300 flex items-center gap-1">
                      <ShieldAlert size={12} />
                      Safety Hazard
                    </span>
                  )}
                </div>
              </div>

              <div className="text-xs space-y-1">
                <span className="text-slate-500 font-medium">Factual Technical Summary:</span>
                <p className="text-slate-900 font-semibold text-sm">
                  "{ticket.aiAnalysis.conciseSummary}"
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs pt-1 border-t border-indigo-100 text-slate-600">
                <div>
                  <span className="text-slate-400">Suggested Dept: </span>
                  <span className="font-semibold text-slate-800">{ticket.aiAnalysis.recommendedDepartment}</span>
                </div>
                <div>
                  <span className="text-slate-400">Urgency Assessment: </span>
                  <span className="font-semibold text-slate-800">{ticket.aiAnalysis.urgencyAssessment}</span>
                </div>
              </div>
            </div>
          )}

          {/* Duplicate Warnings & Review */}
          {ticket.duplicateWarnings && ticket.duplicateWarnings.length > 0 && (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-amber-950">
                      Possible Duplicate Complaint Detected ({ticket.duplicateWarnings.length})
                    </h4>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Advisory warning for staff review. Human staff confirm or dismiss duplicate suggestions.
                    </p>
                  </div>
                </div>

                {ticket.duplicateReviewed && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    ticket.duplicateReviewDecision === 'confirmed'
                      ? 'bg-amber-200 text-amber-900'
                      : 'bg-slate-200 text-slate-800'
                  }`}>
                    Review: {ticket.duplicateReviewDecision}
                  </span>
                )}
              </div>

              <div className="space-y-2">
                {ticket.duplicateWarnings.map((dup) => (
                  <div
                    key={dup.ticketId}
                    className="p-3 rounded-xl bg-white border border-amber-200 text-xs flex items-center justify-between gap-3 shadow-2xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-blue-700">{dup.ticketId}</span>
                        <StatusBadge status={dup.status} size="sm" />
                        <span className="font-semibold text-slate-800">{dup.title}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Location: {dup.location} • Match: {dup.matchReason} (Similarity: {Math.round(dup.similarityScore * 100)}%)
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onNavigateToTicket(dup.ticketId)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-100 hover:bg-amber-200 text-amber-950 transition-colors flex items-center gap-1 shrink-0"
                    >
                      <span>Inspect {dup.ticketId}</span>
                      <ExternalLink size={12} />
                    </button>
                  </div>
                ))}
              </div>

              {!ticket.duplicateReviewed && (
                <div className="flex items-center gap-2 pt-1 border-t border-amber-200">
                  <span className="text-xs text-amber-900 font-medium">Staff Decision:</span>
                  <button
                    type="button"
                    onClick={() => handleDuplicateReview('confirm')}
                    disabled={isReviewingDuplicate}
                    className="px-3 py-1 rounded-md text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
                  >
                    Confirm as Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDuplicateReview('dismiss')}
                    disabled={isReviewingDuplicate}
                    className="px-3 py-1 rounded-md text-xs font-semibold bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 cursor-pointer"
                  >
                    Dismiss Warning (Distinct Issue)
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Description & Photo */}
          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Student Complaint Description
            </h4>
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 whitespace-pre-line leading-relaxed text-xs sm:text-sm">
              {ticket.description}
            </div>

            {ticket.imageDataUri && (
              <div className="pt-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Attached Photo Evidence
                </span>
                <img
                  src={ticket.imageDataUri}
                  alt="Student complaint evidence"
                  className="max-h-64 rounded-xl border border-slate-300 object-cover"
                />
              </div>
            )}
          </div>

          {/* Status Workflow Controls */}
          <div className="p-5 rounded-2xl bg-slate-100 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Layers size={15} />
                <span>Validated Status Progression</span>
              </h4>
              <span className="text-xs text-slate-500">
                Current: <strong className="text-slate-800">{ticket.status}</strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {allowedTransitions.length > 0 ? (
                allowedTransitions.map((st) => (
                  <button
                    type="button"
                    key={st}
                    onClick={() => handleUpdateStatus(st)}
                    disabled={isUpdatingStatus}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer transition-colors shadow-xs disabled:opacity-50"
                  >
                    Transition to {st}
                  </button>
                ))
              ) : (
                <span className="text-xs text-slate-500 italic">
                  Ticket is in final state ({ticket.status}).
                </span>
              )}
            </div>

            <div className="pt-1">
              <input
                type="text"
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="Optional transition reason / work log note..."
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white text-slate-800"
              />
            </div>

            {statusError && (
              <p className="text-xs text-rose-600 font-medium" role="alert">{statusError}</p>
            )}
          </div>

          {/* Priority, proof of fix, blockers, ETA, asset, workarounds */}
          <StaffTicketOperations ticket={ticket} onTicketUpdated={onTicketUpdated} />

          {/* Department & Staff Assignment Controls */}
          <form onSubmit={handleAssign} className="p-5 rounded-2xl bg-slate-50 border border-slate-200 space-y-4">
            <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <HardHat size={15} className="text-amber-600" />
              <span>Department &amp; Certified Staff Assignment</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">
                  Responsible Department
                </label>
                <select
                  value={assignDept}
                  onChange={(e) => {
                    setAssignDept(e.target.value as Department);
                    setAssigneeId('');
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 font-medium"
                >
                  {DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>{dept}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="assignee-select" className="block text-slate-600 font-semibold mb-1">
                  Assign Staff Member (optional)
                </label>
                <select
                  id="assignee-select"
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800 font-medium"
                >
                  <option value="">Department queue (no individual)</option>
                  {assignableStaff.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {staffLoadError && <p className="text-[11px] text-rose-700 mt-1" role="alert">{staffLoadError}</p>}
                {!staffLoadError && assignableStaff.length === 0 && (
                  <p className="text-[11px] text-slate-500 mt-1">No active staff accounts in this department yet.</p>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-500">Priority is set by the impact-based priority engine below (staff may override with a reason).</p>

            <div>
              <label className="block text-slate-600 font-semibold mb-1 text-xs">
                Internal Dispatch Notes
              </label>
              <input
                type="text"
                value={assignNotes}
                onChange={(e) => setAssignNotes(e.target.value)}
                placeholder="e.g. Bring replacement breaker switch and multimeter."
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-[11px] text-slate-500">
                Advances status to <strong>Assigned</strong> automatically.
              </span>
              <button
                type="submit"
                disabled={isAssigning}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer transition-colors shadow-xs"
              >
                {isAssigning ? 'Saving Assignment...' : 'Save Department Assignment'}
              </button>
            </div>

            {assignSuccess && (
              <p className="text-xs text-emerald-700 bg-emerald-50 p-2 rounded-md border border-emerald-200">
                {assignSuccess}
              </p>
            )}
            {assignError && (
              <p className="text-xs text-rose-700 bg-rose-50 p-2 rounded-md border border-rose-200" role="alert">
                {assignError}
              </p>
            )}
          </form>

          {/* Internal Staff Notes (Private - Never exposed to students!) */}
          <div className="p-5 rounded-2xl bg-amber-500/10 border border-amber-300 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-amber-950 font-bold text-xs uppercase tracking-wider">
                <Lock size={14} className="text-amber-700" />
                <span>Internal Staff Notes (Restricted - Not Visible to Students)</span>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded bg-amber-200 text-amber-900 font-mono font-bold">
                STAFF CONFIDENTIAL
              </span>
            </div>

            {/* Note items */}
            <div className="space-y-2">
              {ticket.internalNotes && ticket.internalNotes.length > 0 ? (
                ticket.internalNotes.map((note) => (
                  <div key={note.id} className="p-3 rounded-xl bg-white border border-amber-200 text-xs space-y-1">
                    <div className="flex items-center justify-between text-slate-500 text-[11px]">
                      <span className="font-bold text-slate-800">{note.authorName}</span>
                      <span className="font-mono">{new Date(note.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="text-slate-800">{note.content}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-amber-800 italic">No internal staff notes recorded yet.</p>
              )}
            </div>

            {/* Add note input */}
            <form onSubmit={handleAddInternalNote} className="flex gap-2">
              <input
                type="text"
                value={newInternalNote}
                onChange={(e) => setNewInternalNote(e.target.value)}
                placeholder="Add confidential technician note..."
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-amber-300 bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
              <button
                type="submit"
                disabled={isAddingNote || !newInternalNote.trim()}
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white cursor-pointer disabled:opacity-50"
              >
                {isAddingNote ? 'Saving...' : 'Add Note'}
              </button>
            </form>

            {noteError && (
              <p className="text-xs text-rose-600 font-medium">{noteError}</p>
            )}
          </div>

          {/* Chronological Status Audit Log */}
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={14} />
              <span>Full Status Audit Trail &amp; Activity Log</span>
            </h4>

            <div className="space-y-2">
              {ticket.statusHistory.map((h, i) => (
                <div
                  key={h.id || i}
                  className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1.5"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-900">
                        {h.fromStatus ? `${h.fromStatus} → ` : ''}
                        <span className="text-blue-700 font-bold">{h.toStatus}</span>
                      </span>
                      <span className="text-slate-400">•</span>
                      <span className="text-slate-600 font-medium">{h.changedBy}</span>
                    </div>
                    {h.notes && <p className="text-slate-600 italic">"{h.notes}"</p>}
                  </div>
                  <span className="font-mono text-slate-400 text-[11px] shrink-0">
                    {new Date(h.changedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
          <span>Acting Staff: <strong>{user?.name}</strong> ({user?.role})</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer"
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
