import React, { useEffect, useState } from 'react';
import { AlertOctagon, MapPin, Phone, RefreshCw, Siren } from 'lucide-react';
import { apiClient, ResponderIncident } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.js';

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  sending: 'Sending',
  accepted: 'Accepted by provider (delivery not confirmed)',
  delivered: 'Delivered (provider receipt)',
  failed: 'Failed',
  not_configured: 'Not sent — provider not configured',
  no_contact: 'Not sent — no contact details'
};

/** Restricted view for medical/security responders (and administrators). */
export const ResponderDashboard: React.FC = () => {
  const { user } = useAuth();
  const [incidents, setIncidents] = useState<ResponderIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = async () => {
    try {
      const res = await apiClient.getResponderIncidents();
      setIncidents(res.incidents);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Could not load incidents');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || (user.role !== 'responder' && user.role !== 'admin')) return;
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [user?.id]);

  if (!user || (user.role !== 'responder' && user.role !== 'admin')) {
    return <p className="max-w-xl mx-auto text-sm text-slate-700 bg-white border border-slate-200 rounded-2xl p-6">This area is restricted to authorised medical and security responders.</p>;
  }

  const act = async (id: string, action: 'acknowledge' | 'responding' | 'updates' | 'close' | 'escalate', field?: 'note' | 'outcome' | 'reason') => {
    const value = field ? (notes[`${id}:${action}`] ?? '').trim() : '';
    if (field && value.length < 1) {
      setMessage(`Enter ${field === 'outcome' ? 'closure outcome notes' : field === 'reason' ? 'an escalation reason' : 'an update'} first.`);
      return;
    }
    setBusy(`${id}:${action}`);
    setMessage(null);
    try {
      await apiClient.responderAction(id, action, field ? { [field]: value } : undefined);
      setNotes((n) => ({ ...n, [`${id}:${action}`]: '' }));
      setMessage(`${id}: ${action === 'updates' ? 'update recorded' : action === 'responding' ? 'marked responding' : `${action}d`}.`);
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  };

  const open = incidents.filter((i) => i.status !== 'closed');
  const closed = incidents.filter((i) => i.status === 'closed');
  const inputCls = 'flex-1 px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs';

  const renderIncident = (i: ResponderIncident) => (
    <li key={i.id} className={`bg-white rounded-2xl border-2 p-4 space-y-3 ${i.status === 'open' ? 'border-rose-500' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-black text-rose-800">{i.id}</span>
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-slate-300">{i.status}</span>
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-slate-300">{i.type}</span>
        {i.escalationLevel > 0 && <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-orange-100 border border-orange-300 text-orange-900">Escalation L{i.escalationLevel}</span>}
        <span className="text-xs text-slate-500">{new Date(i.createdAt).toLocaleString()}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <div>
          <p className="font-bold">{i.reporter.name}</p>
          {i.reporter.studentId && <p className="text-xs">Student ID: {i.reporter.studentId}</p>}
          {i.reporter.phone ? (
            <a className="text-xs text-blue-700 underline flex items-center gap-1" href={`tel:${i.reporter.phone.replace(/\s/g, '')}`}><Phone size={12} /> {i.reporter.phone}</a>
          ) : (
            <p className="text-xs text-slate-500">No phone on file</p>
          )}
        </div>
        <div className="text-xs">
          <p className="flex items-center gap-1 font-semibold"><MapPin size={12} /> {[i.location.campus, i.location.building, i.location.floor && `Floor ${i.location.floor}`, i.location.room && `Room ${i.location.room}`].filter(Boolean).join(', ') || 'No saved location'}</p>
          {i.location.details && <p>{i.location.details}</p>}
          {i.location.gps ? (
            <a className="text-blue-700 underline" target="_blank" rel="noopener noreferrer"
              href={`https://www.openstreetmap.org/?mlat=${i.location.gps.latitude}&mlon=${i.location.gps.longitude}#map=18/${i.location.gps.latitude}/${i.location.gps.longitude}`}>
              GPS {i.location.gps.latitude.toFixed(5)}, {i.location.gps.longitude.toFixed(5)} ±{Math.round(i.location.gps.accuracyMeters)} m ({new Date(i.location.gps.capturedAt).toLocaleTimeString()})
            </a>
          ) : (
            <p className="text-slate-500">GPS: {i.location.gpsStatus === 'denied' ? 'permission denied' : i.location.gpsStatus === 'unavailable' ? 'unavailable' : 'not provided'}</p>
          )}
        </div>
      </div>

      <p className="text-xs"><strong>Alert state:</strong> {i.alertState} — {i.alertDetail}</p>
      {i.acknowledgedBy && <p className="text-xs">Acknowledged by {i.acknowledgedBy.name} at {new Date(i.acknowledgedBy.at).toLocaleTimeString()}</p>}

      {i.status !== 'closed' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {!i.acknowledgedBy && (
              <button disabled={busy !== null} onClick={() => act(i.id, 'acknowledge')} className="px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold cursor-pointer disabled:opacity-50">Acknowledge</button>
            )}
            {!i.respondingIds.includes(user.id) && (
              <button disabled={busy !== null} onClick={() => act(i.id, 'responding')} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold cursor-pointer disabled:opacity-50">I'm responding</button>
            )}
          </div>
          {([
            ['updates', 'note', 'Add update', 'e.g. On scene, patient conscious'],
            ['escalate', 'reason', 'Escalate', 'Why escalate to backups?'],
            ['close', 'outcome', 'Close incident', 'Outcome notes (required)']
          ] as const).map(([action, field, label, placeholder]) => (
            <div key={action} className="flex gap-2">
              <input
                aria-label={label}
                className={inputCls}
                placeholder={placeholder}
                value={notes[`${i.id}:${action}`] ?? ''}
                onChange={(e) => setNotes((n) => ({ ...n, [`${i.id}:${action}`]: e.target.value }))}
              />
              <button disabled={busy !== null} onClick={() => act(i.id, action, field)} className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap">{label}</button>
            </div>
          ))}
        </div>
      )}
      {i.outcome && <p className="text-xs"><strong>Outcome:</strong> {i.outcome}</p>}

      <details className="text-xs">
        <summary className="cursor-pointer font-semibold">Notification and event history ({i.notifications.length} messages, {i.events.length} events)</summary>
        <ul className="mt-2 space-y-1">
          {i.notifications.map((n) => (
            <li key={n.id}>• {new Date(n.createdAt).toLocaleTimeString()} {n.purpose.replace('_', ' ')} → {n.recipientName}: <strong>{STATUS_LABEL[n.status] ?? n.status}</strong>{n.error ? ` (${n.error})` : ''}{n.attempts > 1 ? `, ${n.attempts} attempts` : ''}</li>
          ))}
          {i.events.map((e) => (
            <li key={e.id}>• {new Date(e.at).toLocaleTimeString()} {e.actorName}: {e.type}{e.note ? ` — ${e.note}` : ''}</li>
          ))}
        </ul>
      </details>
    </li>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase text-rose-700 flex items-center gap-1"><Siren size={14} /> Emergency response</p>
          <h2 className="text-2xl font-black text-slate-900">Responder dashboard</h2>
          <p className="text-xs text-slate-600">Shows incidents you were alerted to, are handling, or that fall in a zone you are on duty for. Refreshes every 10 seconds.</p>
        </div>
        <button onClick={load} className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold flex items-center gap-1 cursor-pointer" aria-label="Refresh incidents">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
      {message && <p className="text-sm text-slate-800" role="status">{message}</p>}
      {error && <p className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3" role="alert">{error}</p>}
      {!loading && open.length === 0 && (
        <p className="text-sm text-slate-600 bg-white border border-slate-200 rounded-2xl p-6 flex items-center gap-2"><AlertOctagon size={16} /> No open incidents visible to you.</p>
      )}
      <ul className="space-y-4" aria-label="Open incidents">{open.map(renderIncident)}</ul>
      {closed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-700">Closed incidents ({closed.length})</summary>
          <ul className="space-y-4 mt-3">{closed.map(renderIncident)}</ul>
        </details>
      )}
    </div>
  );
};
