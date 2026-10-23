import React, { useEffect, useState } from 'react';
import { Camera, Hourglass, MapPinned, RotateCcw } from 'lucide-react';
import { Ticket } from '../../shared/types.js';
import { apiClient } from '../../services/apiClient.js';

interface Props {
  ticket: Ticket;
  onTicketUpdated: (t: Ticket) => void;
}

/** Student-facing extras: timing, blockers, proof of fix, failed-repair report, workarounds. */
export const StudentTicketExtras: React.FC<Props> = ({ ticket, onTicketUpdated }) => {
  const [timing, setTiming] = useState<any>(null);
  const [workarounds, setWorkarounds] = useState<any>(null);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofError, setProofError] = useState<string | null>(null);
  const [reopenReason, setReopenReason] = useState('');
  const [showReopen, setShowReopen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const proof = [...(ticket.resolutionProofs ?? [])].reverse().find((p) => !p.superseded);

  useEffect(() => {
    apiClient.getTiming(ticket.id).then(setTiming).catch(() => setTiming(null));
    if (ticket.status !== 'Resolved') apiClient.getWorkarounds(ticket.id).then(setWorkarounds).catch(() => setWorkarounds(null));
  }, [ticket.id, ticket.updatedAt]);

  useEffect(() => {
    let url: string | null = null;
    setProofUrl(null);
    setProofError(null);
    if (proof) {
      apiClient
        .fetchBlobUrl(apiClient.evidenceUrl(ticket.id, proof.id))
        .then((u) => {
          url = u;
          setProofUrl(u);
        })
        .catch((e) => setProofError(e.message));
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [proof?.id]);

  const submitReopen = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const res = await apiClient.requestReopen(ticket.id, reopenReason.trim());
      onTicketUpdated(res.ticket as Ticket);
      setStatus({ ok: true, text: 'Thanks. Your ticket is back under review.' });
      setShowReopen(false);
      setReopenReason('');
    } catch (err: any) {
      setStatus({ ok: false, text: err.message || 'Could not send your report.' });
    } finally {
      setBusy(false);
    }
  };

  const openBlockers = (ticket.blockers ?? []).filter((b) => !b.resolvedAt);
  const card = 'p-4 rounded-xl border border-slate-200 bg-slate-50 text-xs space-y-2';

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {ticket.status !== 'Resolved' && (
        <section className={card} aria-labelledby={`timing-${ticket.id}`}>
          <h4 id={`timing-${ticket.id}`} className="font-bold text-slate-800 flex items-center gap-1.5"><Hourglass size={14} /> Timing</h4>
          {ticket.slaDeadline && (
            <p>
              <strong>Service target:</strong> {new Date(ticket.slaDeadline).toLocaleString()}
              {new Date(ticket.slaDeadline).getTime() < Date.now() && <span className="font-bold text-rose-700"> — past target</span>}
              <br />
              <span className="text-slate-500">A target, not a guarantee.</span>
            </p>
          )}
          {ticket.etaEstimate ? (
            <p>
              <strong>Staff estimate:</strong> between {new Date(ticket.etaEstimate.earliest).toLocaleString()} and {new Date(ticket.etaEstimate.latest).toLocaleString()}
              {ticket.etaEstimate.note && <> — {ticket.etaEstimate.note}</>}
              {ticket.etaEstimate.changeReason && <><br /><span className="text-slate-600">Changed because: {ticket.etaEstimate.changeReason}</span></>}
            </p>
          ) : (
            <p className="text-slate-600">No staff estimate yet.</p>
          )}
          {timing?.historical?.samples && <p className="text-slate-600">{timing.historical.note} Typical: {timing.historical.p25Hours}–{timing.historical.p75Hours} hours.</p>}
          {openBlockers.length > 0 ? (
            <div>
              <strong>Currently blocked by:</strong>
              <ul className="list-disc ml-5">{openBlockers.map((b) => <li key={b.id}>{b.description}</li>)}</ul>
            </div>
          ) : (
            <p className="text-slate-600">No blockers reported.</p>
          )}
        </section>
      )}

      {ticket.studentFollowUpAnswers && Object.keys(ticket.studentFollowUpAnswers).length > 0 && (
        <section className={card}>
          <h4 className="font-bold text-slate-800">Your clarifications</h4>
          <ul className="space-y-1">
            {Object.entries(ticket.studentFollowUpAnswers).map(([q, a]) => (
              <li key={q}><span className="text-slate-500">{q}</span><br />{a}</li>
            ))}
          </ul>
        </section>
      )}

      {proof && (
        <section className={card} aria-labelledby={`proof-s-${ticket.id}`}>
          <h4 id={`proof-s-${ticket.id}`} className="font-bold text-slate-800 flex items-center gap-1.5"><Camera size={14} /> Proof of fix</h4>
          <p>{proof.summary}</p>
          <p className="text-slate-500">By {proof.uploadedBy}, {new Date(proof.uploadedAt).toLocaleString()}</p>
          {proofUrl ? <img src={proofUrl} alt="Photo of the completed repair" className="max-h-48 rounded-lg border border-slate-300" /> : proofError ? <p className="text-rose-700">{proofError}</p> : <p className="text-slate-500">Loading photo…</p>}
        </section>
      )}

      {ticket.status === 'Resolved' && (
        <section className={card}>
          <h4 className="font-bold text-slate-800 flex items-center gap-1.5"><RotateCcw size={14} /> Still not fixed?</h4>
          {!showReopen ? (
            <button onClick={() => setShowReopen(true)} className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 font-semibold cursor-pointer">Report that the repair didn't work</button>
          ) : (
            <div className="space-y-2">
              <label htmlFor={`reopen-${ticket.id}`} className="block font-semibold">What is still wrong? (at least 5 characters)</label>
              <textarea id={`reopen-${ticket.id}`} rows={2} value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-slate-300" />
              <div className="flex gap-2">
                <button onClick={submitReopen} disabled={busy || reopenReason.trim().length < 5} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold cursor-pointer disabled:opacity-50">Send for review</button>
                <button onClick={() => setShowReopen(false)} className="px-3 py-1.5 rounded-lg border border-slate-300 cursor-pointer">Cancel</button>
              </div>
            </div>
          )}
        </section>
      )}
      {status && <p role={status.ok ? 'status' : 'alert'} className={`text-xs ${status.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{status.text}</p>}

      {workarounds && workarounds.suggestions.length > 0 && (
        <section className={card}>
          <h4 className="font-bold text-slate-800 flex items-center gap-1.5"><MapPinned size={14} /> Alternatives while you wait</h4>
          <p>{workarounds.message}</p>
          <ul className="space-y-1">
            {workarounds.suggestions.map((w: any) => (
              <li key={w.facility.id}>
                <strong>{w.facility.name}</strong> ({w.facility.building}{w.facility.floor ? `, floor ${w.facility.floor}` : ''}) — {w.availability === 'available' ? 'Available' : w.availability === 'unavailable' ? 'Unavailable' : 'Availability unknown'}
                <span className="text-slate-500"> · {w.reason}</span>
                {w.facility.accessible === true && <span> · Accessible (verified)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};
