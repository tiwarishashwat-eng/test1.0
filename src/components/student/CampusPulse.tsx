import React, { useEffect, useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { PulseSummary, PULSE_TOPICS } from '../../shared/types.js';
import { apiClient } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.js';

/**
 * Anonymous Campus Pulse feedback plus privacy-thresholded trends.
 * Submissions are sent without the session token, so they are not linked to an account.
 */
export const CampusPulse: React.FC = () => {
  const { user } = useAuth();
  const [buildings, setBuildings] = useState<string[] | null>(null);
  const [topic, setTopic] = useState('');
  const [building, setBuilding] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // honeypot
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [summary, setSummary] = useState<PulseSummary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const loadSummary = () => {
    if (!user) return;
    apiClient
      .getPulseSummary()
      .then((r) => setSummary(r.summary))
      .catch((e) => setSummaryError(e.message || 'Trends unavailable'));
  };

  useEffect(() => {
    apiClient.getPulseBuildings().then(setBuildings).catch(() => setBuildings([]));
    loadSummary();
  }, [user?.id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    if (!topic || !building) {
      setStatus({ ok: false, text: 'Choose a topic and a building.' });
      return;
    }
    setSending(true);
    try {
      await apiClient.submitPulse({ topic, building, message: message.trim() || undefined, website });
      setStatus({ ok: true, text: 'Thanks — your feedback was recorded anonymously.' });
      setMessage('');
      loadSummary();
    } catch (err: any) {
      setStatus({ ok: false, text: err.message || 'Could not send feedback.' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><Activity size={20} className="text-blue-600" /> Campus Pulse</h2>
        <div className="text-xs text-slate-700 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-1">
          <p><strong>What this is:</strong> quick anonymous feedback about recurring problems. It is <strong>not</strong> a complaint: nobody is assigned and you will not get updates. To get something fixed, submit a complaint instead.</p>
          <p><strong>What we store:</strong> the topic, the building, your optional message, and the hour it was sent. We do not store your account, name, or IP address with it.</p>
          <p><strong>Limits:</strong> if you write identifying details in the message (your name, room number), it is no longer anonymous. Messages are visible only to administrators and are never shown in public trends.</p>
        </div>
        {buildings && buildings.length === 0 ? (
          <p className="text-sm text-slate-600">Campus Pulse is not available yet: no buildings have been configured.</p>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-xs font-semibold text-slate-700 flex flex-col gap-1">
                Topic
                <select value={topic} onChange={(e) => setTopic(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-300 bg-white font-normal">
                  <option value="">Choose…</option>
                  {PULSE_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="text-xs font-semibold text-slate-700 flex flex-col gap-1">
                Building
                <select value={building} onChange={(e) => setBuilding(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-300 bg-white font-normal">
                  <option value="">Choose…</option>
                  {(buildings ?? []).map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </label>
            </div>
            <label className="text-xs font-semibold text-slate-700 flex flex-col gap-1">
              Message (optional, max 500 characters — avoid personal details)
              <textarea rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} className="px-3 py-2 rounded-xl border border-slate-300 font-normal" />
            </label>
            <div className="hidden" aria-hidden="true">
              <label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
            </div>
            {status && <p role={status.ok ? 'status' : 'alert'} className={`text-sm ${status.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{status.text}</p>}
            <button type="submit" disabled={sending} className="px-5 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white cursor-pointer disabled:opacity-50 flex items-center gap-2">
              {sending && <Loader2 size={15} className="animate-spin" />} Send anonymous feedback
            </button>
          </>
        )}
      </form>

      {user && (
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3" aria-labelledby="pulse-trends">
          <h3 id="pulse-trends" className="text-sm font-bold text-slate-900">Recent trends</h3>
          {summaryError && <p className="text-xs text-rose-700" role="alert">{summaryError}</p>}
          {summary && (
            <>
              <p className="text-xs text-slate-600">
                Last {summary.windowDays} days. Only groups with at least {summary.minGroupSize} reports are shown, to protect anonymity.
                {summary.suppressedCount > 0 && ` ${summary.suppressedCount} more report(s) are in smaller groups and not broken down.`}
              </p>
              {summary.groups.length === 0 ? (
                <p className="text-xs text-slate-600">No trend has enough reports to show yet.</p>
              ) : (
                <ul className="text-sm space-y-1">
                  {summary.groups.map((g) => <li key={`${g.building}-${g.topic}`}>{g.topic} — {g.building}: <strong>{g.count}</strong> reports</li>)}
                </ul>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
};
