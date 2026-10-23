import React, { useEffect, useState } from 'react';
import { Camera, ClipboardCheck, Gauge, Hourglass, Wrench } from 'lucide-react';
import { ImpactInputs, PRIORITY_LEVELS, PriorityLevel, Ticket } from '../../shared/types.js';
import { apiClient } from '../../services/apiClient.js';
import { readImageFile } from '../common/imageFile.js';

interface Props {
  ticket: Ticket;
  onTicketUpdated: (t: Ticket) => void;
}

const box = 'p-5 rounded-2xl bg-white border border-slate-200 space-y-3 text-xs';
const h4 = 'text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5';
const input = 'w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800';
const btn = 'px-3 py-1.5 rounded-lg font-bold bg-slate-900 hover:bg-slate-800 text-white cursor-pointer disabled:opacity-50';

function toLocalInput(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export const StaffTicketOperations: React.FC<Props> = ({ ticket, onTicketUpdated }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ area: string; text: string; ok: boolean } | null>(null);

  // Impact & override
  const [impact, setImpact] = useState<Partial<ImpactInputs>>({
    safetyRisk: ticket.impact?.safetyRisk ?? false,
    peopleAffected: ticket.impact?.peopleAffected ?? 1,
    accessibilityImpact: ticket.impact?.accessibilityImpact ?? false,
    criticalServiceDisruption: ticket.impact?.criticalServiceDisruption ?? false,
    alternativesAvailable: ticket.impact?.alternativesAvailable ?? 'unknown'
  });
  const [overrideLevel, setOverrideLevel] = useState<PriorityLevel | ''>(ticket.priorityOverride?.level ?? '');
  const [overrideReason, setOverrideReason] = useState('');

  // Proof of fix
  const [proofSummary, setProofSummary] = useState('');
  const [proofFile, setProofFile] = useState<{ dataUri: string; mimeType: string } | null>(null);
  const [proofPreview, setProofPreview] = useState<string | null>(null);

  // Blockers & ETA
  const [blocker, setBlocker] = useState('');
  const [etaEarliest, setEtaEarliest] = useState(toLocalInput(ticket.etaEstimate?.earliest));
  const [etaLatest, setEtaLatest] = useState(toLocalInput(ticket.etaEstimate?.latest));
  const [etaNote, setEtaNote] = useState('');
  const [etaReason, setEtaReason] = useState('');
  const [timing, setTiming] = useState<any>(null);

  // Asset & workarounds
  const [assets, setAssets] = useState<{ id: string; name: string; building: string }[]>([]);
  const [workarounds, setWorkarounds] = useState<any>(null);

  useEffect(() => {
    apiClient.getTiming(ticket.id).then(setTiming).catch(() => setTiming(null));
    apiClient.getWorkarounds(ticket.id).then(setWorkarounds).catch(() => setWorkarounds(null));
    apiClient.getCampus().then((c) => setAssets(c.assets)).catch(() => setAssets([]));
  }, [ticket.id, ticket.updatedAt]);

  const currentProof = [...(ticket.resolutionProofs ?? [])].reverse().find((p) => !p.superseded);
  useEffect(() => {
    let url: string | null = null;
    setProofPreview(null);
    if (currentProof) {
      apiClient
        .fetchBlobUrl(apiClient.evidenceUrl(ticket.id, currentProof.id))
        .then((u) => {
          url = u;
          setProofPreview(u);
        })
        .catch(() => setProofPreview(null));
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [currentProof?.id]);

  const run = async (area: string, fn: () => Promise<{ ticket: Ticket }>, ok: string, after?: () => void) => {
    setBusy(area);
    setFeedback(null);
    try {
      const res = await fn();
      onTicketUpdated(res.ticket);
      setFeedback({ area, text: ok, ok: true });
      after?.();
    } catch (err: any) {
      setFeedback({ area, text: err.message || 'Action failed', ok: false });
    } finally {
      setBusy(null);
    }
  };

  const Feedback = ({ area }: { area: string }) =>
    feedback?.area === area ? (
      <p role={feedback.ok ? 'status' : 'alert'} className={feedback.ok ? 'text-emerald-700' : 'text-rose-700'}>
        {feedback.text}
      </p>
    ) : null;

  const effective = ticket.priorityOverride?.level ?? ticket.priorityAssessment?.level;
  const openBlockers = (ticket.blockers ?? []).filter((b) => !b.resolvedAt);

  return (
    <div className="space-y-4">
      {/* Priority engine */}
      <section className={box} aria-labelledby={`prio-${ticket.id}`}>
        <h4 id={`prio-${ticket.id}`} className={h4}><Gauge size={15} /> Impact-based priority</h4>
        <p>
          Effective priority: <strong>{effective ?? 'not computed'}</strong>
          {ticket.priorityOverride && <> (staff override by {ticket.priorityOverride.by}: “{ticket.priorityOverride.reason}”; recommendation was {ticket.priorityAssessment?.level})</>}
        </p>
        {ticket.priorityAssessment && <p className="text-slate-600">{ticket.priorityAssessment.explanation}</p>}
        {ticket.slaDeadline && (
          <p>
            SLA target: <strong>{new Date(ticket.slaDeadline).toLocaleString()}</strong>
            {ticket.status !== 'Resolved' && new Date(ticket.slaDeadline).getTime() < Date.now() && <span className="ml-1 font-bold text-rose-700">(overdue)</span>}
          </p>
        )}
        {(ticket.slaEscalations ?? []).length > 0 && (
          <ul className="list-disc ml-5 text-slate-700">
            {ticket.slaEscalations!.map((e) => (
              <li key={`${e.level}-${e.at}`}>L{e.level} {new Date(e.at).toLocaleString()}: {e.reason} → {e.nextAuthority} (was {e.previousOwner})</li>
            ))}
          </ul>
        )}

        <fieldset className="grid grid-cols-2 sm:grid-cols-3 gap-2 border border-slate-200 rounded-xl p-3">
          <legend className="px-1 font-semibold text-slate-600">Impact details</legend>
          {([
            ['safetyRisk', 'Safety risk'],
            ['accessibilityImpact', 'Accessibility impact'],
            ['criticalServiceDisruption', 'Critical service down']
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2">
              <input type="checkbox" checked={Boolean(impact[key])} onChange={(e) => setImpact({ ...impact, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
          <label className="flex flex-col gap-1">
            People affected (estimate)
            <input type="number" min={1} className={input} value={impact.peopleAffected ?? 1} onChange={(e) => setImpact({ ...impact, peopleAffected: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
          <label className="flex flex-col gap-1">
            Alternative available?
            <select className={input} value={impact.alternativesAvailable} onChange={(e) => setImpact({ ...impact, alternativesAvailable: e.target.value as ImpactInputs['alternativesAvailable'] })}>
              <option value="unknown">Unknown</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <div className="flex items-end">
            <button className={btn} disabled={busy === 'impact'} onClick={() => run('impact', () => apiClient.setImpact(ticket.id, impact), 'Impact saved; priority recalculated.')}>
              Save impact
            </button>
          </div>
        </fieldset>
        <Feedback area="impact" />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
          <label className="flex flex-col gap-1">
            Override priority
            <select className={input} value={overrideLevel} onChange={(e) => setOverrideLevel(e.target.value as PriorityLevel | '')}>
              <option value="">No override (use recommendation)</option>
              {PRIORITY_LEVELS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            Reason (required, recorded in history)
            <input className={input} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder="e.g. Exam scheduled in this hall tomorrow" />
          </label>
        </div>
        <button
          className={btn}
          disabled={busy === 'override' || overrideReason.trim().length < 5}
          onClick={() => run('override', () => apiClient.overridePriority(ticket.id, overrideLevel || null, overrideReason.trim()), 'Priority override saved.', () => setOverrideReason(''))}
        >
          Save override
        </button>
        <Feedback area="override" />
      </section>

      {/* Proof of fix */}
      <section className={box} aria-labelledby={`proof-${ticket.id}`}>
        <h4 id={`proof-${ticket.id}`} className={h4}><Camera size={15} /> Proof of fix (required before Resolved)</h4>
        {currentProof ? (
          <div className="flex gap-3 items-start">
            {proofPreview ? <img src={proofPreview} alt="Resolution evidence" className="w-28 h-28 object-cover rounded-lg border border-slate-300" /> : <span className="text-slate-500">Loading photo…</span>}
            <div>
              <p className="font-semibold">{currentProof.summary}</p>
              <p className="text-slate-500">Uploaded by {currentProof.uploadedBy} on {new Date(currentProof.uploadedAt).toLocaleString()} ({Math.round(currentProof.sizeBytes / 1024)} KB)</p>
            </div>
          </div>
        ) : (
          <p className="text-slate-600">No current proof. Upload a summary and photo to enable the Resolved transition.</p>
        )}
        {(ticket.resolutionProofs ?? []).some((p) => p.superseded) && (
          <p className="text-slate-500">{ticket.resolutionProofs!.filter((p) => p.superseded).length} earlier proof record(s) kept in history.</p>
        )}
        {ticket.status !== 'Resolved' && (
          <>
            <label className="flex flex-col gap-1">
              Resolution summary (at least 10 characters)
              <textarea rows={2} className={input} value={proofSummary} onChange={(e) => setProofSummary(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1">
              Resolution photo (JPEG, PNG, or WebP, max 5MB)
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  setProofFile(null);
                  if (!file) return;
                  try {
                    setProofFile(await readImageFile(file));
                  } catch (err: any) {
                    setFeedback({ area: 'proof', text: err.message, ok: false });
                  }
                }}
              />
            </label>
            <button
              className={btn}
              disabled={busy === 'proof' || !proofFile || proofSummary.trim().length < 10}
              onClick={() =>
                run('proof', () => apiClient.uploadResolutionProof(ticket.id, proofSummary.trim(), proofFile!.dataUri, proofFile!.mimeType), 'Proof of fix uploaded. You can now mark the ticket Resolved.', () => {
                  setProofSummary('');
                  setProofFile(null);
                })
              }
            >
              {busy === 'proof' ? 'Uploading…' : 'Upload proof of fix'}
            </button>
          </>
        )}
        <Feedback area="proof" />
        {(ticket.reopenRequests ?? []).length > 0 && (
          <div className="border-t border-slate-200 pt-2">
            <p className="font-semibold text-rose-800">Student reported the repair as unsuccessful:</p>
            <ul className="list-disc ml-5">
              {ticket.reopenRequests!.map((r) => <li key={r.id}>{new Date(r.requestedAt).toLocaleString()}: {r.reason}</li>)}
            </ul>
          </div>
        )}
      </section>

      {/* Blockers & ETA */}
      <section className={box} aria-labelledby={`eta-${ticket.id}`}>
        <h4 id={`eta-${ticket.id}`} className={h4}><Hourglass size={15} /> Blockers and estimate</h4>
        {openBlockers.length > 0 ? (
          <ul className="space-y-1">
            {openBlockers.map((b) => (
              <li key={b.id} className="flex items-center gap-2">
                <span>• {b.description} <span className="text-slate-500">({b.createdBy}, {new Date(b.createdAt).toLocaleDateString()})</span></span>
                <button className="underline text-blue-700 cursor-pointer" onClick={() => run('blocker', () => apiClient.resolveBlocker(ticket.id, b.id), 'Blocker cleared.')}>Clear</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-slate-500">No open blockers.</p>
        )}
        <div className="flex gap-2">
          <input className={input} value={blocker} onChange={(e) => setBlocker(e.target.value)} placeholder="e.g. Waiting for replacement part" aria-label="New blocker" />
          <button className={btn} disabled={busy === 'blocker' || blocker.trim().length < 3} onClick={() => run('blocker', () => apiClient.addBlocker(ticket.id, blocker.trim()), 'Blocker added.', () => setBlocker(''))}>
            Add
          </button>
        </div>
        <Feedback area="blocker" />

        {timing && (
          <div className="text-slate-700 space-y-1 border-t border-slate-200 pt-2">
            <p>{timing.historical?.samples ? `${timing.historical.note} ${timing.historical.p25Hours}–${timing.historical.p75Hours} hours.` : timing.historical?.note}</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">Earliest completion<input type="datetime-local" className={input} value={etaEarliest} onChange={(e) => setEtaEarliest(e.target.value)} /></label>
          <label className="flex flex-col gap-1">Latest completion<input type="datetime-local" className={input} value={etaLatest} onChange={(e) => setEtaLatest(e.target.value)} /></label>
          <label className="flex flex-col gap-1">Note for the student (optional)<input className={input} value={etaNote} onChange={(e) => setEtaNote(e.target.value)} /></label>
          {ticket.etaEstimate && (
            <label className="flex flex-col gap-1">Why the estimate changed (required)<input className={input} value={etaReason} onChange={(e) => setEtaReason(e.target.value)} /></label>
          )}
        </div>
        <button
          className={btn}
          disabled={busy === 'eta' || !etaEarliest || !etaLatest}
          onClick={() =>
            run('eta', () => apiClient.setEta(ticket.id, {
              earliest: new Date(etaEarliest).toISOString(),
              latest: new Date(etaLatest).toISOString(),
              note: etaNote.trim() || undefined,
              changeReason: etaReason.trim() || undefined
            }), 'Estimate saved (shown to the student as an estimate, not a guarantee).', () => setEtaReason(''))
          }
        >
          Save estimate window
        </button>
        <Feedback area="eta" />
      </section>

      {/* Asset & workarounds */}
      <section className={box} aria-labelledby={`asset-${ticket.id}`}>
        <h4 id={`asset-${ticket.id}`} className={h4}><Wrench size={15} /> Asset and workarounds</h4>
        {assets.length === 0 ? (
          <p className="text-slate-500">No assets are configured (Admin Console → Configuration → Assets).</p>
        ) : (
          <label className="flex flex-col gap-1">
            Verified asset
            <select
              className={input}
              value={ticket.assetId ?? ''}
              onChange={(e) => run('asset', () => apiClient.setTicketAsset(ticket.id, e.target.value || null), 'Asset link saved.')}
            >
              <option value="">Not linked to an asset</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.id}) — {a.building}</option>)}
            </select>
          </label>
        )}
        <Feedback area="asset" />
        {workarounds && (
          <div className="border-t border-slate-200 pt-2">
            <p className="font-semibold flex items-center gap-1"><ClipboardCheck size={13} /> {workarounds.message}</p>
            <ul className="list-disc ml-5">
              {workarounds.suggestions.map((w: any) => (
                <li key={w.facility.id}>{w.facility.name} ({w.facility.building}) — <strong>{w.availability}</strong>: {w.reason}</li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
};
