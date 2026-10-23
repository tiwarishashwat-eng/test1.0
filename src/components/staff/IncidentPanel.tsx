import React, { useEffect, useState } from 'react';
import { AlertTriangle, Layers, RefreshCw } from 'lucide-react';
import { Incident } from '../../shared/types.js';
import { apiClient } from '../../services/apiClient.js';

interface IncidentPanelProps {
  refreshKey: number;
  onOpenTicket: (ticketId: string) => void;
  onChanged: () => void;
}

/**
 * Shared incidents: automatic recurring-issue clusters (10+ distinct reporters in 2h)
 * and staff-linked incidents. Active clusters appear first and prominently.
 */
export const IncidentPanel: React.FC<IncidentPanelProps> = ({ refreshKey, onOpenTicket, onChanged }) => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.getIncidents();
      setIncidents(res.incidents.filter((i) => i.status !== 'dismissed' && i.status !== 'resolved'));
    } catch (err: any) {
      setError(err.message || 'Could not load incidents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const act = async (incident: Incident, fn: () => Promise<unknown>, done: string) => {
    setBusy(incident.id);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      await load();
      onChanged();
    } catch (err: any) {
      setMessage(err.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const askNote = (label: string) => {
    const note = window.prompt(label);
    return note && note.trim().length >= 3 ? note.trim() : null;
  };

  if (loading && incidents.length === 0) return null;
  if (error) {
    return (
      <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3" role="alert">
        Incidents unavailable: {error}{' '}
        <button className="underline font-semibold" onClick={load}>Retry</button>
      </p>
    );
  }
  if (incidents.length === 0) return null;

  const sorted = [...incidents].sort((a, b) => (a.source === b.source ? 0 : a.source === 'auto_cluster' ? -1 : 1));

  return (
    <section aria-labelledby="incident-panel-title" className="rounded-2xl border-2 border-orange-300 bg-orange-50/60 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="incident-panel-title" className="text-sm font-black text-orange-950 flex items-center gap-2">
          <Layers size={16} /> Shared incidents ({incidents.length})
        </h3>
        <button onClick={load} className="text-xs font-semibold text-orange-900 flex items-center gap-1 cursor-pointer" aria-label="Refresh incidents">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {message && <p className="text-xs text-slate-800" role="status">{message}</p>}
      <ul className="space-y-3">
        {sorted.map((i) => (
          <li key={i.id} className="bg-white rounded-xl border border-orange-200 p-3 text-xs space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold text-orange-800">{i.id}</span>
              <span className="font-bold text-slate-900">{i.title}</span>
              <span className="px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase bg-slate-100 border-slate-300 text-slate-700">
                {i.source === 'auto_cluster' ? 'Automatic cluster' : 'Staff-linked'}
              </span>
              <span className="px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase bg-slate-50 border-slate-300 text-slate-700">{i.status}</span>
              {i.priority && (
                <span className="px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase bg-orange-100 border-orange-300 text-orange-900 flex items-center gap-1">
                  <AlertTriangle size={10} /> {i.priority} priority
                </span>
              )}
            </div>
            <p className="text-slate-700">
              <strong>{i.ticketIds.length}</strong> linked tickets
              {i.source === 'auto_cluster' && <> from <strong>{i.distinctReporters}</strong> distinct students</>} • {i.building}
              {i.area ? ` • ${i.area}` : ''} • first {new Date(i.firstReportAt).toLocaleString()} • latest {new Date(i.latestReportAt).toLocaleString()}
            </p>
            {i.priorityReason && <p className="text-slate-600"><span className="font-semibold">Why:</span> {i.priorityReason}</p>}
            <div className="flex flex-wrap gap-1.5">
              {i.ticketIds.map((t) => (
                <span key={t} className="inline-flex items-center rounded-md border border-slate-200 bg-slate-50">
                  <button className="px-2 py-0.5 font-mono font-semibold text-blue-700 hover:underline cursor-pointer" onClick={() => onOpenTicket(t)}>
                    {t}
                  </button>
                  <button
                    className="px-1.5 py-0.5 text-slate-500 hover:text-rose-700 border-l border-slate-200 cursor-pointer"
                    aria-label={`Unlink ${t} from ${i.id}`}
                    title="Unlink (wrongly grouped)"
                    disabled={busy === i.id}
                    onClick={() => {
                      const note = askNote(`Why is ${t} not part of ${i.id}?`);
                      if (note) act(i, () => apiClient.unlinkIncident(i.id, t, note), `${t} unlinked from ${i.id}.`);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              {i.status === 'active' && (
                <button
                  disabled={busy === i.id}
                  className="px-2.5 py-1 rounded-lg bg-slate-900 text-white font-semibold cursor-pointer disabled:opacity-50"
                  onClick={() => {
                    const note = askNote('Review note (what was confirmed?)');
                    if (note) act(i, () => apiClient.setIncidentStatus(i.id, 'reviewed', note), `${i.id} marked reviewed.`);
                  }}
                >
                  Mark reviewed
                </button>
              )}
              <button
                disabled={busy === i.id}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold cursor-pointer disabled:opacity-50"
                onClick={() => {
                  const note = askNote('Why is this grouping incorrect? (tickets stay open and unchanged)');
                  if (note) act(i, () => apiClient.setIncidentStatus(i.id, 'dismissed', note), `${i.id} dismissed; tickets are unchanged.`);
                }}
              >
                Dismiss grouping
              </button>
              <button
                disabled={busy === i.id}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold cursor-pointer disabled:opacity-50"
                onClick={() => {
                  const ticketId = window.prompt('Ticket ID to link (e.g. CC-1010)');
                  if (ticketId) act(i, () => apiClient.linkIncident(i.id, ticketId.trim().toUpperCase()), `${ticketId} linked.`);
                }}
              >
                Link ticket
              </button>
              <button
                disabled={busy === i.id}
                className="px-2.5 py-1 rounded-lg border border-slate-300 bg-white font-semibold cursor-pointer disabled:opacity-50"
                onClick={() => {
                  const note = askNote('Resolution note for the shared incident (each ticket keeps its own status)');
                  if (note) act(i, () => apiClient.setIncidentStatus(i.id, 'resolved', note), `${i.id} marked resolved.`);
                }}
              >
                Close incident
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
