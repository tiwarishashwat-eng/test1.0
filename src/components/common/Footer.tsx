import React from 'react';
import { Building2, ShieldCheck, Wrench, Zap, Sparkles, Wifi, Lock } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-slate-900 text-slate-400 text-xs border-t border-slate-800 mt-16" role="contentinfo">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
          {/* Col 1: Brand & Service Scope */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-white font-bold text-base">
              <div className="w-6 h-6 rounded-md bg-blue-600 flex items-center justify-center text-white text-xs">
                <Building2 size={14} />
              </div>
              <span>CampusConnect</span>
            </div>
            <p className="text-slate-400 text-xs leading-relaxed">
              Standardized campus facilities maintenance reporting, automated triage classification, and real-time resolution milestone tracking.
            </p>
            <div className="flex items-center gap-1.5 text-emerald-400 text-[11px]">
              <ShieldCheck size={14} />
              <span>Server-Enforced Authorization &amp; Auditing</span>
            </div>
          </div>

          {/* Col 2: Supported Categories */}
          <div>
            <h4 className="text-white font-semibold text-xs tracking-wider uppercase mb-3">
              Standardized Service Categories
            </h4>
            <ul className="space-y-2">
              <li className="flex items-center gap-2">
                <Wrench size={13} className="text-blue-400" />
                <span>Plumbing (Leaks, drainage, washroom fixtures)</span>
              </li>
              <li className="flex items-center gap-2">
                <Zap size={13} className="text-amber-400" />
                <span>Electricity (Power outlets, lighting, breakers)</span>
              </li>
              <li className="flex items-center gap-2">
                <Sparkles size={13} className="text-emerald-400" />
                <span>Cleanliness (Sanitation, waste removal, spills)</span>
              </li>
              <li className="flex items-center gap-2">
                <Wifi size={13} className="text-indigo-400" />
                <span>Internet Connectivity (Wi-Fi access points, LAN)</span>
              </li>
            </ul>
          </div>

          {/* Col 3: Data Protection & Privacy */}
          <div>
            <h4 className="text-white font-semibold text-xs tracking-wider uppercase mb-3">
              Privacy &amp; Data Security
            </h4>
            <ul className="space-y-2 text-slate-400 text-[11px] leading-relaxed">
              <li className="flex items-start gap-1.5">
                <Lock size={12} className="text-blue-400 shrink-0 mt-0.5" />
                <span>Student complaints are private and restricted to the reporting student and certified staff.</span>
              </li>
              <li>
                Internal technician dispatch notes are isolated from student view.
              </li>
              <li>
                AI suggestions are advisory and require human staff review before assignment and closure.
              </li>
            </ul>
          </div>

          {/* Col 4: Urgent Facility Support */}
          <div>
            <h4 className="text-white font-semibold text-xs tracking-wider uppercase mb-3">
              Facility Emergency Protocol
            </h4>
            <p className="text-slate-400 mb-2 leading-relaxed">
              For active water main ruptures, exposed electrical arcing, gas odors, or fire hazards, notify physical plant dispatch immediately.
            </p>
            <div className="bg-slate-800/80 rounded-xl p-3 border border-slate-700 space-y-1 font-mono text-[11px]">
              <div className="text-amber-300 font-semibold">Facilities Desk: Ext. 4444</div>
              <div className="text-slate-400 text-[10px]">Campus Maintenance Dispatch Office</div>
            </div>
          </div>
        </div>

        <div className="pt-6 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500 text-[11px]">
          <div>
            &copy; {new Date().getFullYear()} CampusConnect Facility Maintenance System. All rights reserved.
          </div>
          <div className="flex items-center gap-4">
            <span>File-backed storage</span>
            <span>Optional AI suggestions (Gemini)</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
