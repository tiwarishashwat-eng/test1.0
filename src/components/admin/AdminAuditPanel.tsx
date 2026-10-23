import React, { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { AuditEntry } from '../../shared/types.js';
import { apiClient } from '../../services/apiClient.js';

/** Recent audit history recorded by the server (newest first). */
export const AdminAuditPanel: React.FC = () => {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const load = () => {
    setError(null);
    apiClient
      .getAuditLog(500)
      .then((r) => setEntries(r.entries))
      .catch((e) => setError(e.message || 'Could not load audit history'));
  };

  useEffect(load, []);

  const shown = (entries ?? []).filter((e) => !filter || `${e.action} ${e.targetType} ${e.targetId ?? ''} ${e.actorName}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-bold text-slate-900">Audit history</h3>
        <label className="sr-only" htmlFor="audit-filter">Filter audit entries</label>
        <input id="audit-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by action, ticket, or person" className="px-2.5 py-1.5 rounded-lg border border-slate-300 flex-1 min-w-48" />
        <button onClick={load} className="flex items-center gap-1 font-semibold cursor-pointer" aria-label="Refresh audit history"><RefreshCw size={12} /> Refresh</button>
      </div>
      {error && <p className="text-rose-700" role="alert">{error}</p>}
      {entries && shown.length === 0 && <p className="text-slate-600">No audit entries{filter ? ' match this filter' : ' yet'}.</p>}
      {shown.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-[10px] uppercase text-slate-500">
              <tr><th className="py-1 pr-2">Time</th><th className="pr-2">Actor</th><th className="pr-2">Action</th><th className="pr-2">Target</th><th>Details</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((e) => (
                <tr key={e.id}>
                  <td className="py-1 pr-2 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                  <td className="pr-2">{e.actorName}</td>
                  <td className="pr-2 font-mono">{e.action}</td>
                  <td className="pr-2 font-mono">{e.targetType}{e.targetId ? `:${e.targetId}` : ''}</td>
                  <td className="break-all">{e.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
