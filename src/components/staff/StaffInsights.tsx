import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CampusFacility, CampusRoom } from '../../shared/types.js';
import { apiClient } from '../../services/apiClient.js';

type Section = 'hotspots' | 'repeat' | 'readiness' | 'waste' | 'pulse' | 'facilities';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'hotspots', label: 'Campus X-Ray' },
  { id: 'repeat', label: 'Repeat offenders' },
  { id: 'readiness', label: 'Classroom readiness' },
  { id: 'waste', label: 'Waste detector' },
  { id: 'pulse', label: 'Campus Pulse signals' },
  { id: 'facilities', label: 'Facility availability' }
];

const Empty: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl p-4">{children}</p>
);

/**
 * Staff insights computed on the server from persisted tickets, configured campus data,
 * and staff-recorded checks. Each view says plainly when the data it needs is missing.
 */
export const StaffInsights: React.FC = () => {
  const [section, setSection] = useState<Section>('hotspots');
  const [data, setData] = useState<any>(null);
  const [campus, setCampus] = useState<{ rooms: CampusRoom[]; facilities: CampusFacility[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (section === 'facilities') {
        const c = await apiClient.getCampus();
        setCampus({ rooms: c.rooms, facilities: c.facilities });
        setData(null);
      } else {
        const kind = section === 'repeat' ? 'repeat-offenders' : section === 'pulse' ? 'pulse-signals' : section;
        setData(await apiClient.getInsight(kind as any));
        if (section === 'readiness') {
          const c = await apiClient.getCampus();
          setCampus({ rooms: c.rooms, facilities: c.facilities });
        }
      }
    } catch (err: any) {
      setError(err.message || 'Could not load insights');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setData(null);
    setMessage(null);
    load();
  }, [section]);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      await load();
    } catch (err: any) {
      setMessage(err.message || 'Action failed');
    }
  };

  return (
    <section aria-label="Insights" className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Insight type">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={section === s.id}
            onClick={() => setSection(s.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer ${
              section === s.id ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
            }`}
          >
            {s.label}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-xs font-semibold text-slate-600 flex items-center gap-1 cursor-pointer" aria-label="Refresh insights">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {message && <p className="text-xs text-slate-800" role="status">{message}</p>}
      {error && <p className="text-xs text-rose-700" role="alert">{error}</p>}
      {loading && !data && !campus && <p className="text-xs text-slate-500" role="status">Loading…</p>}

      {section === 'hotspots' && data && (
        <div className="space-y-2 text-xs">
          <p className="text-slate-600">
            Last {data.windowDays} days, grouped by building. {data.mapAvailable ? 'Building coordinates are configured for some buildings.' : 'Map view needs building coordinates (Admin Console → Configuration → Buildings); showing a list instead.'}
          </p>
          {data.hotspots.length === 0 ? (
            <Empty>No tickets in this period.</Empty>
          ) : (
            <table className="w-full text-left">
              <thead className="text-[10px] uppercase text-slate-500">
                <tr><th className="py-1">Building</th><th>Open</th><th>Resolved</th><th>Median time to resolve</th><th>By category</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.hotspots.map((h: any) => (
                  <tr key={h.building}>
                    <td className="py-1.5 font-semibold">
                      {h.building}
                      {!h.verifiedLocation && <span className="ml-1 text-[10px] font-normal text-amber-800">(not a configured building — unverified)</span>}
                    </td>
                    <td>{h.openCount}</td>
                    <td>{h.resolvedCount}</td>
                    <td>{h.medianResolutionHours !== undefined ? `${h.medianResolutionHours} h` : '—'}</td>
                    <td>{Object.entries(h.byCategory).map(([c, n]) => `${c}: ${n}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {section === 'repeat' && data && (
        <div className="space-y-2 text-xs">
          {data.configuredAssets === 0 ? (
            <Empty>No assets are configured. Add verified asset tags in Admin Console → Configuration → Assets, then link tickets to assets.</Empty>
          ) : data.offenders.length === 0 ? (
            <Empty>No asset has reached the repeat threshold. {data.ticketsWithAssets} ticket(s) are linked to configured assets.</Empty>
          ) : (
            data.offenders.map((o: any) => (
              <div key={o.assetId} className="border border-slate-200 rounded-xl p-3 space-y-1">
                <p className="font-bold">{o.assetName} <span className="font-mono text-slate-500">({o.assetId})</span> — {o.building}</p>
                <p>{o.ticketCount} reports in {o.windowDays} days: {o.ticketIds.join(', ')}</p>
                <ul className="list-disc ml-5 text-slate-700">{o.hypotheses.map((h: string) => <li key={h}>{h}</li>)}</ul>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'readiness' && data && (
        <div className="space-y-3 text-xs">
          {!data.configured ? (
            <Empty>No rooms are configured, so no readiness score can be shown. Add rooms and their equipment in Admin Console → Configuration.</Empty>
          ) : (
            data.rooms.map((r: any) => (
              <div key={r.roomId} className="border border-slate-200 rounded-xl p-3 space-y-2">
                <p className="font-bold">
                  {r.roomName} — {r.building}:{' '}
                  {r.available ? <span>Readiness {r.score}%</span> : <span className="text-amber-800">Readiness unavailable</span>}
                </p>
                <p className="text-slate-600">{r.explanation}</p>
                <ul className="space-y-1">
                  {r.items.map((i: any) => (
                    <li key={i.assetId} className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{i.assetName}</span>
                      <span className="px-1.5 rounded border text-[10px] font-bold uppercase">
                        {i.state === 'verified_working' ? 'Verified working' : i.state === 'known_issue' ? 'Known issue' : 'Unknown / stale'}
                      </span>
                      <span className="text-slate-600">{i.reason}{i.lastVerifiedAt ? ` (${new Date(i.lastVerifiedAt).toLocaleString()})` : ''}</span>
                      <button className="underline text-blue-700 cursor-pointer" onClick={() => run(() => apiClient.recordRoomCheck(r.roomId, { assetId: i.assetId, result: 'working' }), `${i.assetName} recorded as working.`)}>
                        Record working
                      </button>
                      <button
                        className="underline text-rose-700 cursor-pointer"
                        onClick={() => {
                          const note = window.prompt('Describe the issue') ?? undefined;
                          run(() => apiClient.recordRoomCheck(r.roomId, { assetId: i.assetId, result: 'issue', note }), `${i.assetName} recorded with an issue.`);
                        }}
                      >
                        Record issue
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'waste' && data && (
        <div className="space-y-2 text-xs">
          <p className="text-slate-600">Tickets whose text matches fixed leak / equipment-left-running rules. These are reports, not measurements; no utility readings or savings are estimated.</p>
          {data.signals.length === 0 ? (
            <Empty>No reports match the waste rules.</Empty>
          ) : (
            data.signals.map((w: any) => (
              <div key={w.ticketId} className="border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{w.ticketId}</span>
                <span>{w.label}</span>
                <span className="text-slate-600">{w.building} • {w.location} • {w.status}</span>
                <span className="px-1.5 rounded border text-[10px] font-bold uppercase">{w.verification}</span>
                <button className="underline text-blue-700 cursor-pointer" onClick={() => run(() => apiClient.setWasteReview(w.ticketId, 'confirmed', window.prompt('Evidence / note') ?? undefined), `${w.ticketId} confirmed as waste.`)}>Confirm</button>
                <button className="underline text-slate-700 cursor-pointer" onClick={() => run(() => apiClient.setWasteReview(w.ticketId, 'rejected', window.prompt('Why not waste?') ?? undefined), `${w.ticketId} marked not waste.`)}>Reject</button>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'pulse' && data && (
        <div className="space-y-2 text-xs">
          <p className="text-slate-600">Anonymous Campus Pulse feedback, shown only for groups that meet the minimum size. Signals are unverified unless matched by a ticket.</p>
          {data.signals.length === 0 ? (
            <Empty>No feedback groups meet the minimum size yet.</Empty>
          ) : (
            data.signals.map((s: any) => (
              <div key={`${s.building}-${s.topic}`} className="border border-slate-200 rounded-xl p-3">
                <p className="font-bold">{s.topic} — {s.building}: {s.count} reports</p>
                <p>{s.assessment}</p>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'facilities' && campus && (
        <div className="space-y-2 text-xs">
          <p className="text-slate-600">Workaround suggestions only list facilities verified as available within the freshness window.</p>
          {campus.facilities.length === 0 ? (
            <Empty>No facilities are configured. Add alternative classrooms, study areas, water stations, or Wi-Fi zones in Admin Console → Configuration.</Empty>
          ) : (
            campus.facilities.map((f) => (
              <div key={f.id} className="border border-slate-200 rounded-xl p-3 flex flex-wrap items-center gap-2">
                <span className="font-bold">{f.name}</span>
                <span className="text-slate-600">{f.type} • {f.building}{f.floor ? `, floor ${f.floor}` : ''}</span>
                <span className="px-1.5 rounded border text-[10px] font-bold uppercase">{f.status}</span>
                <span className="text-slate-500">{f.verifiedAt ? `verified ${new Date(f.verifiedAt).toLocaleString()} by ${f.verifiedBy}` : 'never verified'}</span>
                {(['available', 'unavailable'] as const).map((st) => (
                  <button key={st} className="underline text-blue-700 cursor-pointer" onClick={() => run(() => apiClient.verifyFacility(f.id, st), `${f.name} verified ${st}.`)}>
                    Verify {st}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
};
