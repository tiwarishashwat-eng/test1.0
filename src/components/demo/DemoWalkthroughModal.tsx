import React from 'react';
import { X, BookOpen, ChevronRight } from 'lucide-react';
import { AppView } from '../common/Header.js';

interface DemoWalkthroughModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (view: AppView, ticketId?: string) => void;
}

interface GuideStep {
  stepNumber: number;
  title: string;
  actor: 'Student' | 'AI assistant' | 'Staff';
  description: string;
  actionText: string;
  view: AppView;
}

/**
 * Read-only "how it works" guide. It only navigates between views; it never
 * signs in, switches accounts, or creates/changes tickets on the user's behalf.
 */
export const DemoWalkthroughModal: React.FC<DemoWalkthroughModalProps> = ({
  isOpen,
  onClose,
  onNavigate
}) => {
  if (!isOpen) return null;

  const steps: GuideStep[] = [
    {
      stepNumber: 1,
      title: 'Sign in and describe the problem',
      actor: 'Student',
      description: 'A signed-in student enters the building, location, and a description in their own words.',
      actionText: 'Open Student Portal',
      view: 'student'
    },
    {
      stepNumber: 2,
      title: 'Optional AI suggestions',
      actor: 'AI assistant',
      description: 'If Gemini is configured on the server, it suggests a category and asks about missing details. If it is unavailable, the form says so and the student can still submit manually.',
      actionText: 'Open Student Portal',
      view: 'student'
    },
    {
      stepNumber: 3,
      title: 'Submit and receive a ticket ID',
      actor: 'Student',
      description: 'The student reviews or edits the suggestions, answers any follow-up questions, and submits. The server assigns a unique ticket ID.',
      actionText: 'Open Student Portal',
      view: 'student'
    },
    {
      stepNumber: 4,
      title: 'Staff review and possible duplicates',
      actor: 'Staff',
      description: 'Signed-in facilities staff see the ticket on the dashboard, along with any advisory duplicate matches to confirm or dismiss.',
      actionText: 'Go to Staff Dashboard',
      view: 'staff'
    },
    {
      stepNumber: 5,
      title: 'Assign and update status',
      actor: 'Staff',
      description: 'Staff assign a department and priority, then move the ticket through the server-enforced status workflow.',
      actionText: 'Go to Staff Dashboard',
      view: 'staff'
    },
    {
      stepNumber: 6,
      title: 'Track progress',
      actor: 'Student',
      description: 'The student looks up their own ticket ID to see the status history and public updates.',
      actionText: 'Open Ticket Tracker',
      view: 'track'
    }
  ];

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="demo-guide-title"
    >
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden text-slate-800">
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-purple-700 via-indigo-700 to-blue-700 text-white flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-purple-200 text-xs font-semibold uppercase tracking-wider mb-1">
              <BookOpen size={14} />
              <span>Guide</span>
            </div>
            <h3 id="demo-guide-title" className="text-2xl font-bold text-white">
              How CampusConnect Works
            </h3>
            <p className="text-purple-100 text-xs sm:text-sm mt-1 max-w-xl">
              The lifecycle of a maintenance complaint. Each step opens the relevant screen; you need to be signed in with an account that has the right role.
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
            aria-label="Close guide"
          >
            <X size={18} />
          </button>
        </div>

        <ol className="p-6 overflow-y-auto space-y-3">
          {steps.map((st) => (
            <li
              key={st.stepNumber}
              className="p-4 rounded-xl border bg-white border-slate-200 hover:border-slate-300 transition-all text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="flex items-start gap-3">
                <span className="w-5 h-5 mt-0.5 rounded-full bg-slate-100 border border-slate-300 text-slate-600 font-bold text-[10px] flex items-center justify-center shrink-0">
                  {st.stepNumber}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 text-sm">{st.title}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700">
                      {st.actor}
                    </span>
                  </div>
                  <p className="text-slate-600 text-xs mt-1 leading-relaxed">{st.description}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onNavigate(st.view);
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer transition-colors flex items-center justify-center gap-1 shrink-0 self-end sm:self-center"
              >
                <span>{st.actionText}</span>
                <ChevronRight size={13} />
              </button>
            </li>
          ))}
        </ol>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end text-xs">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 font-semibold text-slate-700 cursor-pointer"
          >
            Close Guide
          </button>
        </div>
      </div>
    </div>
  );
};
