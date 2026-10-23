import React, { useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Check,
  Search,
  ArrowRight,
  PlusCircle,
  Building,
  MapPin,
  Calendar,
  Sparkles,
  ShieldAlert
} from 'lucide-react';
import { Ticket } from '../../shared/types.js';
import { CategoryBadge } from '../common/CategoryBadge.js';
import { StatusBadge } from '../common/StatusBadge.js';

interface TicketConfirmationProps {
  ticket: Ticket;
  onTrackTicket: (ticketId: string) => void;
  onNewComplaint: () => void;
}

export const TicketConfirmation: React.FC<TicketConfirmationProps> = ({
  ticket,
  onTrackTicket,
  onNewComplaint
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyId = () => {
    navigator.clipboard.writeText(ticket.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="max-w-2xl mx-auto bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden text-slate-800">
      {/* Top Banner */}
      <div className="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 text-white p-6 sm:p-8 text-center">
        <div className="w-14 h-14 bg-white/20 backdrop-blur-md rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
          <CheckCircle2 size={32} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold">Complaint Successfully Submitted!</h2>
        <p className="text-emerald-100 text-xs sm:text-sm mt-1 max-w-md mx-auto">
          Your campus maintenance request has been recorded and queued for staff review.
        </p>
      </div>

      <div className="p-6 sm:p-8 space-y-6">
        {/* Ticket ID Box */}
        <div className="bg-slate-50 border-2 border-dashed border-slate-300 rounded-2xl p-5 text-center space-y-2">
          <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">
            Your Unique Ticket ID
          </span>
          <div className="flex items-center justify-center gap-3">
            <span className="font-mono text-3xl font-extrabold text-blue-700 tracking-wider">
              {ticket.id}
            </span>
            <button
              onClick={handleCopyId}
              className="p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 text-slate-600 hover:text-blue-600 transition-colors shadow-xs cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
              title="Copy Ticket ID to clipboard"
            >
              {copied ? (
                <>
                  <Check size={14} className="text-emerald-600" />
                  <span className="text-emerald-600">Copied</span>
                </>
              ) : (
                <>
                  <Copy size={14} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Save this ID to look up progress or check real-time resolution updates.
          </p>
        </div>

        {/* Ticket Details Summary */}
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs">
          <div className="p-3.5 flex items-center justify-between">
            <span className="text-slate-500 font-medium">Current Status</span>
            <StatusBadge status={ticket.status} size="md" />
          </div>

          <div className="p-3.5 flex items-center justify-between">
            <span className="text-slate-500 font-medium">Category</span>
            <CategoryBadge category={ticket.category} size="md" />
          </div>

          <div className="p-3.5 flex items-center justify-between">
            <span className="text-slate-500 font-medium">Campus Location</span>
            <span className="font-semibold text-slate-800 text-right">
              {ticket.building} • {ticket.location}
            </span>
          </div>

          <div className="p-3.5 flex items-center justify-between">
            <span className="text-slate-500 font-medium">Submitted At</span>
            <span className="text-slate-700 font-mono">
              {new Date(ticket.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {ticket.aiAnalysis && (
            <div className="p-3.5 bg-indigo-50/40 space-y-1">
              <div className="flex items-center gap-1.5 text-indigo-900 font-bold">
                <Sparkles size={13} className="text-indigo-600" />
                <span>AI Triage Summary</span>
              </div>
              <p className="text-indigo-950 font-medium">
                "{ticket.aiAnalysis.conciseSummary}"
              </p>
              <div className="text-[11px] text-indigo-700 pt-0.5">
                Target Department: <strong>{ticket.aiAnalysis.recommendedDepartment}</strong>
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
          <button
            onClick={() => onTrackTicket(ticket.id)}
            className="w-full sm:flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Search size={16} />
            <span>Track Progress Timeline</span>
            <ArrowRight size={14} />
          </button>

          <button
            onClick={onNewComplaint}
            className="w-full sm:w-auto py-3 px-4 rounded-xl font-semibold text-xs border border-slate-300 hover:bg-slate-50 text-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <PlusCircle size={14} />
            <span>Submit Another</span>
          </button>
        </div>
      </div>
    </div>
  );
};
