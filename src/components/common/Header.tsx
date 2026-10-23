import React from 'react';
import {
  Building2,
  HardHat,
  Search,
  PlusCircle,
  PlaySquare,
  Server,
  LogIn,
  LogOut,
  User as UserIcon,
  Shield,
  GraduationCap,
  Sparkles
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';

export type AppView = 'student' | 'staff' | 'track' | 'admin';

interface HeaderProps {
  currentView: AppView;
  onNavigate: (view: AppView, ticketIdToTrack?: string) => void;
  onOpenAuthModal: (defaultMode?: 'student-login' | 'staff-login' | 'register') => void;
  onOpenDemoGuide: () => void;
  serverStatus?: ServerStatus;
}

export interface ServerStatus {
  gemini: {
    configured: boolean;
    model: string | null;
    lastCallOk: boolean | null;
  };
  demoMode: boolean;
}

/** Describes AI availability from what the server has actually observed. */
function describeAiStatus(status?: ServerStatus): { text: string; dot: string; tone: string } {
  if (!status) return { text: 'AI status unknown', dot: 'bg-slate-500', tone: 'text-slate-400' };
  const { configured, model, lastCallOk } = status.gemini;
  if (!configured) return { text: 'AI suggestions: not configured', dot: 'bg-slate-500', tone: 'text-slate-400' };
  if (lastCallOk === false) return { text: 'AI suggestions: last request failed', dot: 'bg-amber-400', tone: 'text-amber-300' };
  if (lastCallOk === true) return { text: `AI suggestions: available (${model})`, dot: 'bg-emerald-400', tone: 'text-emerald-400' };
  return { text: `AI suggestions: configured (${model}), not yet used`, dot: 'bg-sky-400', tone: 'text-sky-300' };
}

export const Header: React.FC<HeaderProps> = ({
  currentView,
  onNavigate,
  onOpenAuthModal,
  onOpenDemoGuide,
  serverStatus
}) => {
  const { user, logout } = useAuth();
  const aiStatus = describeAiStatus(serverStatus);

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 shadow-xs">
      {/* Top Campus Alert Bar */}
      <div className="bg-slate-900 text-slate-300 text-xs px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
            CAMPUS DISPATCH
          </span>
          <span className="hidden sm:inline">Active facility management for Plumbing, Electricity, Cleanliness & Internet.</span>
        </div>
        <div className="flex items-center gap-4 text-[11px]">
          {serverStatus?.demoMode && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-slate-900" role="status">
              DEMO DATA — not real accounts
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`w-2 h-2 rounded-full ${aiStatus.dot}`} />
            <span className={`font-medium ${aiStatus.tone}`}>{aiStatus.text}</span>
          </span>
          <span className="hidden md:flex items-center gap-1 text-slate-400">
            <Server size={11} />
            <span>Server File Database</span>
          </span>
        </div>
      </div>

      {/* Main navigation */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-3">
          {/* Brand */}
          <div
            className="flex items-center gap-3 cursor-pointer group"
            onClick={() => onNavigate(user?.role === 'staff' ? 'staff' : user?.role === 'admin' ? 'admin' : 'student')}
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-blue-700 via-indigo-600 to-sky-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20 group-hover:scale-105 transition-transform">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg tracking-tight text-slate-900">
                  Campus<span className="text-blue-600">Connect</span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded border border-slate-200">
                  Facility System
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                AI Maintenance Triage &amp; Resolution Platform
              </p>
            </div>
          </div>

          {/* Navigation Links (Role Scoped) */}
          <nav className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs sm:text-sm font-medium" aria-label="Main Navigation">
            {/* If Student or Public */}
            {(!user || user.role === 'student') && (
              <>
                <button
                  onClick={() => onNavigate('student')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    currentView === 'student'
                      ? 'bg-white text-blue-700 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <PlusCircle size={15} />
                  <span>{user ? 'My Complaints' : 'Student Portal'}</span>
                </button>

                <button
                  onClick={() => onNavigate('track')}
                  className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                    currentView === 'track'
                      ? 'bg-white text-blue-700 shadow-xs font-semibold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                >
                  <Search size={15} />
                  <span>Track Ticket</span>
                </button>
              </>
            )}

            {/* If Staff or Admin */}
            {(user?.role === 'staff' || user?.role === 'admin') && (
              <button
                onClick={() => onNavigate('staff')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'staff'
                    ? 'bg-slate-900 text-white shadow-xs font-semibold'
                    : 'text-slate-700 hover:text-slate-950 hover:bg-slate-200/60'
                }`}
              >
                <HardHat size={15} className="text-amber-400" />
                <span>Staff Dispatch Board</span>
              </button>
            )}

            {/* If Admin */}
            {user?.role === 'admin' && (
              <button
                onClick={() => onNavigate('admin')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 cursor-pointer ${
                  currentView === 'admin'
                    ? 'bg-purple-900 text-white shadow-xs font-semibold'
                    : 'text-purple-700 hover:text-purple-950 hover:bg-purple-100/60'
                }`}
              >
                <Shield size={15} className="text-purple-300" />
                <span>Admin Console</span>
              </button>
            )}
          </nav>

          {/* Right Action Controls: Demo Walkthrough + User Auth Profile */}
          <div className="flex items-center gap-2">
            <button
              onClick={onOpenDemoGuide}
              className="hidden lg:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 text-white hover:from-purple-700 hover:to-indigo-700 shadow-xs transition-all cursor-pointer"
              title="How CampusConnect works"
            >
              <PlaySquare size={14} className="text-purple-200" />
              <span>How It Works</span>
            </button>

            {user ? (
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
                <div className="hidden sm:block text-right">
                  <div className="text-xs font-bold text-slate-800 leading-tight">
                    {user.name}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium">
                    {user.role === 'admin'
                      ? 'Administrator'
                      : user.role === 'staff'
                      ? `Staff • ${user.department || 'Triage'}`
                      : 'Campus Student'}
                  </div>
                </div>

                <button
                  onClick={() => logout()}
                  className="p-2 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 hover:text-rose-600 transition-colors cursor-pointer"
                  title="Sign out of account"
                  aria-label="Sign out"
                >
                  <LogOut size={15} />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => onOpenAuthModal('student-login')}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors cursor-pointer shadow-xs"
                >
                  Sign In
                </button>

                <button
                  onClick={() => onOpenAuthModal('staff-login')}
                  className="hidden sm:inline-flex px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
                >
                  Staff Portal
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
