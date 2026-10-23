import React, { useEffect, useState } from 'react';
import {
  Wrench,
  Zap,
  Sparkles,
  Wifi,
  Search,
  ArrowRight,
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Building2,
  HardHat,
  MessageSquare,
  Inbox,
  Lock,
  PlusCircle,
  AlertOctagon,
  UserCircle,
  Activity,
  HelpCircle
} from 'lucide-react';
import { ComplaintForm } from './ComplaintForm.js';
import { TicketConfirmation } from './TicketConfirmation.js';
import { TicketTracker } from './TicketTracker.js';
import { MyComplaintsList } from './MyComplaintsList.js';
import { ProfilePage } from './ProfilePage.js';
import { EmergencyFlow } from './EmergencyFlow.js';
import { CampusPulse } from './CampusPulse.js';
import { apiClient } from '../../services/apiClient.js';
import { PROFILE_FIELD_LABELS } from '../../shared/validation.js';
import { Ticket, TicketCategory } from '../../shared/types.js';
import { useAuth } from '../../context/AuthContext.js';

type PortalTab = 'report' | 'track' | 'my-complaints' | 'profile' | 'pulse';

interface StudentPortalProps {
  onNavigateToStaff: () => void;
  onOpenAuthModal: (mode?: 'student-login' | 'staff-login' | 'register') => void;
  onOpenDemoGuide: () => void;
  initialMode?: PortalTab;
  initialTicketId?: string;
}

export const StudentPortal: React.FC<StudentPortalProps> = ({
  onNavigateToStaff,
  onOpenAuthModal,
  onOpenDemoGuide,
  initialMode = 'report',
  initialTicketId = ''
}) => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<PortalTab>(
    user ? (initialMode || 'my-complaints') : 'report'
  );
  const [submittedTicket, setSubmittedTicket] = useState<Ticket | null>(null);
  const [ticketToTrack, setTicketToTrack] = useState<string>(initialTicketId);
  const [prefillScenario, setPrefillScenario] = useState<{
    building?: string;
    location?: string;
    description?: string;
    category?: TicketCategory;
  } | undefined>(undefined);
  const [emergencyOpen, setEmergencyOpen] = useState(false);
  const [missingProfile, setMissingProfile] = useState<string[]>([]);
  const isStudent = user?.role === 'student';

  // First-time setup: prompt (never force) the student to complete their profile
  useEffect(() => {
    if (!isStudent) {
      setMissingProfile([]);
      return;
    }
    apiClient
      .getProfile()
      .then((res) => setMissingProfile(res.missingFields.map((f) => PROFILE_FIELD_LABELS[f])))
      .catch(() => setMissingProfile([]));
  }, [user?.id, activeTab]);

  const handleComplaintSubmitted = (ticket: Ticket) => {
    setSubmittedTicket(ticket);
  };

  const handleTrackTicket = (id: string) => {
    setSubmittedTicket(null);
    setTicketToTrack(id);
    setActiveTab('track');
  };

  const handleStartNewComplaint = () => {
    setSubmittedTicket(null);
    setPrefillScenario(undefined);
    setActiveTab('report');
  };

  const handleCategoryCardClick = (cat: TicketCategory) => {
    setPrefillScenario({ category: cat });
    setSubmittedTicket(null);
    setActiveTab('report');
  };


  return (
    <div className="space-y-8 pb-12">
      {/* Hero Section */}
      <div className="relative rounded-3xl bg-gradient-to-b from-blue-900 via-indigo-950 to-slate-950 text-white overflow-hidden shadow-xl border border-blue-900/40">
        <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px]" />

        <div className="relative max-w-5xl mx-auto px-6 py-10 sm:py-14 text-center space-y-5">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-500/20 border border-blue-400/30 text-blue-200 text-xs font-semibold backdrop-blur-md">
            <Sparkles size={14} className="text-blue-300" />
            <span>Optional AI-assisted triage</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white max-w-3xl mx-auto leading-tight">
            Report campus issues. <span className="bg-gradient-to-r from-blue-400 to-sky-300 bg-clip-text text-transparent">Track every fix.</span>
          </h1>

          <p className="text-xs sm:text-sm text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Report maintenance issues in your own words. Facilities staff review every report, route it to the right team, and post updates you can track.
          </p>

          {isStudent && (
            <div className="pt-1">
              <button
                onClick={() => setEmergencyOpen(true)}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-base font-black shadow-lg shadow-rose-900/40 ring-4 ring-rose-400/40 focus-visible:ring-white cursor-pointer"
                aria-haspopup="dialog"
              >
                <AlertOctagon size={22} /> Emergency
              </button>
              <p className="text-[11px] text-rose-200 mt-1">For medical or security emergencies. In immediate danger, also call emergency services directly.</p>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            {user && (
              <button
                onClick={() => {
                  setSubmittedTicket(null);
                  setActiveTab('my-complaints');
                }}
                className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer shadow-md flex items-center gap-1.5 ${
                  activeTab === 'my-complaints' && !submittedTicket
                    ? 'bg-blue-600 text-white shadow-blue-500/30 ring-2 ring-blue-400'
                    : 'bg-white/10 hover:bg-white/15 text-slate-200 backdrop-blur-sm'
                }`}
              >
                <Inbox size={15} />
                <span>My Complaints</span>
              </button>
            )}

            <button
              onClick={() => {
                setSubmittedTicket(null);
                setActiveTab('report');
              }}
              className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer shadow-md flex items-center gap-1.5 ${
                activeTab === 'report' && !submittedTicket
                  ? 'bg-blue-600 text-white shadow-blue-500/30 ring-2 ring-blue-400'
                  : 'bg-white/10 hover:bg-white/15 text-slate-200 backdrop-blur-sm'
              }`}
            >
              <PlusCircle size={15} />
              <span>Report New Issue</span>
            </button>

            <button
              onClick={() => {
                setSubmittedTicket(null);
                setActiveTab('track');
              }}
              className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer shadow-md flex items-center gap-1.5 ${
                activeTab === 'track'
                  ? 'bg-blue-600 text-white shadow-blue-500/30 ring-2 ring-blue-400'
                  : 'bg-white/10 hover:bg-white/15 text-slate-200 backdrop-blur-sm'
              }`}
            >
              <Search size={15} />
              <span>Track Ticket</span>
            </button>

            {isStudent && (
              <button
                onClick={() => {
                  setSubmittedTicket(null);
                  setActiveTab('profile');
                }}
                className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer shadow-md flex items-center gap-1.5 ${
                  activeTab === 'profile' ? 'bg-blue-600 text-white ring-2 ring-blue-400' : 'bg-white/10 hover:bg-white/15 text-slate-200'
                }`}
              >
                <UserCircle size={15} />
                <span>Profile</span>
              </button>
            )}

            <button
              onClick={() => {
                setSubmittedTicket(null);
                setActiveTab('pulse');
              }}
              className={`px-4 py-2 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer shadow-md flex items-center gap-1.5 ${
                activeTab === 'pulse' ? 'bg-blue-600 text-white ring-2 ring-blue-400' : 'bg-white/10 hover:bg-white/15 text-slate-200'
              }`}
            >
              <Activity size={15} />
              <span>Campus Pulse</span>
            </button>

            {!user && (
              <button
                onClick={() => onOpenAuthModal('student-login')}
                className="px-4 py-2 rounded-xl font-bold text-xs sm:text-sm bg-white/10 hover:bg-white/20 text-blue-200 border border-blue-400/40 transition-all cursor-pointer flex items-center gap-1.5"
              >
                <Lock size={14} />
                <span>Sign In to Save History</span>
              </button>
            )}
          </div>
        </div>

        {/* 4 Supported Categories Banner */}
        <div className="relative border-t border-slate-800 bg-slate-950/70 p-4 sm:p-5">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-2.5">
              <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                Choose a category to start a report:
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              {[
                { cat: 'Plumbing' as TicketCategory, icon: Wrench, color: 'text-blue-400', border: 'hover:border-blue-500/40', desc: 'Leaks, faucets, drains, toilets' },
                { cat: 'Electricity' as TicketCategory, icon: Zap, color: 'text-amber-400', border: 'hover:border-amber-500/40', desc: 'Outlets, sparks, lights, breakers' },
                { cat: 'Cleanliness' as TicketCategory, icon: Sparkles, color: 'text-emerald-400', border: 'hover:border-emerald-500/40', desc: 'Spills, trash, sanitation, odors' },
                { cat: 'Internet Connectivity' as TicketCategory, icon: Wifi, color: 'text-indigo-400', border: 'hover:border-indigo-500/40', desc: 'Wi-Fi drops, APs, ethernet, slow LAN' },
                { cat: 'Other' as TicketCategory, icon: HelpCircle, color: 'text-slate-300', border: 'hover:border-slate-400/40', desc: 'Anything else — add a short title' },
              ].map(({ cat, icon: Icon, color, border, desc }) => (
                <button
                  key={cat}
                  onClick={() => handleCategoryCardClick(cat)}
                  className={`p-3 rounded-xl bg-slate-900/80 border border-slate-800 ${border} text-left transition-all hover:scale-[1.02] cursor-pointer group`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Icon size={15} className={color} />
                    <span className="font-bold text-xs text-slate-200 group-hover:text-white">
                      {cat}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    {desc}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-4">
        {isStudent && missingProfile.length > 0 && activeTab !== 'profile' && (
          <div className="max-w-3xl mx-auto p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex flex-wrap items-center justify-between gap-2">
            <span>Complete your profile so emergency alerts include your details (missing: {missingProfile.join(', ')}).</span>
            <button onClick={() => setActiveTab('profile')} className="font-bold underline cursor-pointer">Complete profile</button>
          </div>
        )}
        {submittedTicket ? (
          <TicketConfirmation
            ticket={submittedTicket}
            onTrackTicket={handleTrackTicket}
            onNewComplaint={handleStartNewComplaint}
          />
        ) : activeTab === 'profile' && isStudent ? (
          <ProfilePage />
        ) : activeTab === 'pulse' ? (
          <CampusPulse />
        ) : activeTab === 'my-complaints' && user ? (
          <MyComplaintsList
            onSelectTicket={handleTrackTicket}
            onNewComplaint={handleStartNewComplaint}
          />
        ) : activeTab === 'report' ? (
          <ComplaintForm
            onSuccess={handleComplaintSubmitted}
            onNavigateToTrack={handleTrackTicket}
            onRequireSignIn={() => onOpenAuthModal('student-login')}
            prefillData={prefillScenario}
            key={prefillScenario?.category ?? 'blank'}
          />
        ) : (
          <TicketTracker
            initialTicketId={ticketToTrack}
            onNavigateToNewComplaint={handleStartNewComplaint}
            onRequireSignIn={() => onOpenAuthModal('student-login')}
          />
        )}
      </div>

      <EmergencyFlow open={emergencyOpen} onClose={() => setEmergencyOpen(false)} />
    </div>
  );
};
