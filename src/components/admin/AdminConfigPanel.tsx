import React, { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import {
  AppConfig,
  ConfigSection,
  DEPARTMENTS,
  NotificationProviderStatus,
  PRIORITY_LEVELS,
  TICKET_CATEGORIES,
  User
} from '../../shared/types.js';
import { apiClient } from '../../services/apiClient.js';

type ListSection = 'zones' | 'buildings' | 'shifts' | 'assets' | 'rooms' | 'facilities';

const LIST_HELP: Record<ListSection, { title: string; example: string; note: string }> = {
  zones: {
    title: 'Responder zones',
    note: 'Save zones before buildings that refer to them.',
    example: '[{ "id": "north", "name": "North campus" }]'
  },
  buildings: {
    title: 'Campus buildings',
    note: 'Used for forms, Campus Pulse, zone routing of emergencies, and the Campus X-Ray. Latitude/longitude are optional.',
    example: '[{ "id": "lib", "name": "Central Library", "campus": "Main", "zoneId": "north", "latitude": 28.61, "longitude": 77.21 }]'
  },
  shifts: {
    title: 'Responder duty shifts',
    note: 'userId must be an active responder (see list below). days: 0=Sun..6=Sat. zoneIds empty = all zones. Times use the configured timezone.',
    example: '[{ "id": "s1", "userId": "user-staff-...", "zoneIds": [], "days": [1,2,3,4,5], "start": "08:00", "end": "20:00", "isBackup": false }]'
  },
  assets: {
    title: 'Verified assets',
    note: 'Only real asset tags. Save rooms first if you set roomId. type: projector, lift, water_purifier, fan, wifi_ap, ac, other.',
    example: '[{ "id": "PRJ-LH101", "name": "Projector LH-101", "type": "projector", "building": "Central Library", "floor": "1" }]'
  },
  rooms: {
    title: 'Rooms (classroom readiness)',
    note: 'assetIds must already exist in Assets.',
    example: '[{ "id": "LH101", "name": "Lecture Hall 101", "building": "Central Library", "floor": "1", "assetIds": ["PRJ-LH101"] }]'
  },
  facilities: {
    title: 'Alternative facilities (workarounds)',
    note: 'Staff verify availability from the Insights tab; a new or changed status starts as "unknown" until verified. type: classroom, study_area, water_station, wifi_zone, restroom, other.',
    example: '[{ "id": "ws-1", "name": "Water station near library", "type": "water_station", "building": "Central Library", "floor": "G", "status": "unknown" }]'
  }
};

export const AdminConfigPanel: React.FC = () => {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [provider, setProvider] = useState<NotificationProviderStatus | null>(null);
  const [responders, setResponders] = useState<User[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<ListSection, string>>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ section: string; ok: boolean; text: string } | null>(null);

  const load = async () => {
    setLoadError(null);
    try {
      const [res, staff] = await Promise.all([apiClient.getAdminConfig(), apiClient.getAdminStaff()]);
      setConfig(res.config);
      setProvider(res.notificationProvider);
      setResponders(staff.staff.filter((s) => s.role === 'responder'));
      setDrafts({});
    } catch (err: any) {
      setLoadError(err.message || 'Could not load configuration');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (section: ConfigSection, value: unknown) => {
    setSaving(section);
    setFeedback(null);
    try {
      const res = await apiClient.updateConfigSection(section, value);
      setConfig(res.config);
      setDrafts((d) => ({ ...d, [section]: undefined }));
      setFeedback({ section, ok: true, text: 'Saved.' });
    } catch (err: any) {
      setFeedback({ section, ok: false, text: err.message || 'Save failed' });
    } finally {
      setSaving(null);
    }
  };

  const Feedback = ({ section }: { section: string }) =>
    feedback?.section === section ? (
      <p role={feedback.ok ? 'status' : 'alert'} className={`text-xs ${feedback.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{feedback.text}</p>
    ) : null;

  if (loadError) return <p className="text-sm text-rose-700" role="alert">{loadError} <button className="underline" onClick={load}>Retry</button></p>;
  if (!config) return <p className="text-sm text-slate-600 flex items-center gap-2" role="status"><Loader2 size={14} className="animate-spin" /> Loading configuration…</p>;

  const card = 'bg-white rounded-2xl border border-slate-200 p-5 space-y-3 text-xs';
  const input = 'px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-800';
  const btn = 'px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50';

  const numberSetting = (section: ConfigSection, label: string, help: string) => (
    <form
      key={section}
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const v = Number(new FormData(e.currentTarget).get('v'));
        save(section, v);
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="font-semibold">{label}</span>
        <input name="v" type="number" defaultValue={config[section] as number} className={`${input} w-32`} />
        <span className="text-slate-500">{help}</span>
      </label>
      <button type="submit" className={btn} disabled={saving === section}><Save size={12} /> Save</button>
      <Feedback section={section} />
    </form>
  );

  return (
    <div className="space-y-5">
      <section className={card}>
        <h3 className="text-sm font-bold text-slate-900">Notifications</h3>
        {provider?.configured ? (
          <p>Provider: <strong>signed webhook</strong> to <code>{provider.endpointHost}</code>. Delivery receipts: {provider.receiptsEnabled ? 'enabled' : 'not configured (only "accepted by provider" can be shown)'}.</p>
        ) : (
          <p className="text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-2">
            No notification provider is configured. Emergency alerts and SLA escalations are recorded but <strong>not sent</strong>. Set NOTIFY_WEBHOOK_URL (and NOTIFY_WEBHOOK_SECRET, NOTIFY_RECEIPT_SECRET) on the server.
          </p>
        )}
        <p className="text-slate-500">Secrets are configured only through server environment variables and are never shown here.</p>
      </section>

      <section className={card}>
        <h3 className="text-sm font-bold text-slate-900">Category routing</h3>
        <form
          className="grid grid-cols-1 md:grid-cols-2 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save('routing', Object.fromEntries(TICKET_CATEGORIES.map((c) => [c, fd.get(c)])));
          }}
        >
          {TICKET_CATEGORIES.map((c) => (
            <label key={c} className="flex items-center justify-between gap-2">
              <span className="font-semibold">{c}</span>
              <select name={c} defaultValue={config.routing[c]} className={input}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          ))}
          <div className="flex items-center gap-2">
            <button type="submit" className={btn} disabled={saving === 'routing'}><Save size={12} /> Save routing</button>
            <Feedback section="routing" />
          </div>
        </form>
      </section>

      <section className={card}>
        <h3 className="text-sm font-bold text-slate-900">SLA targets (hours to resolve)</h3>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            save('sla', { default: Object.fromEntries(PRIORITY_LEVELS.map((p) => [p, Number(fd.get(p))])), byCategory: config.sla.byCategory });
          }}
        >
          {PRIORITY_LEVELS.map((p) => (
            <label key={p} className="flex flex-col gap-1">
              <span className="font-semibold">{p}</span>
              <input name={p} type="number" min={1} defaultValue={config.sla.default[p]} className={`${input} w-24`} />
            </label>
          ))}
          <button type="submit" className={btn} disabled={saving === 'sla'}><Save size={12} /> Save SLA</button>
          <Feedback section="sla" />
        </form>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={config.slaEscalationEnabled} onChange={(e) => save('slaEscalationEnabled', e.target.checked)} />
          Escalate overdue tickets automatically (level 1: department staff; level 2: administrators)
        </label>
        <Feedback section="slaEscalationEnabled" />
      </section>

      <section className={card}>
        <h3 className="text-sm font-bold text-slate-900">Emergency and data settings</h3>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save('timezone', String(new FormData(e.currentTarget).get('tz')));
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Timezone for duty shifts</span>
            <input name="tz" defaultValue={config.timezone} className={input} />
          </label>
          <button type="submit" className={btn} disabled={saving === 'timezone'}><Save size={12} /> Save</button>
          <Feedback section="timezone" />
        </form>
        {numberSetting('emergencyAckTimeoutSeconds', 'Acknowledgement timeout (seconds)', 'Unacknowledged emergencies escalate to backups after this.')}
        {numberSetting('emergencyDuplicateWindowSeconds', 'Duplicate-tap window (seconds)', 'A second report within this window asks the student to confirm it is new.')}
        {numberSetting('verificationFreshnessHours', 'Verification freshness (hours)', 'Room checks and facility verifications older than this count as stale.')}
        {numberSetting('repeatOffenderWindowDays', 'Repeat-offender window (days)', '')}
        {numberSetting('repeatOffenderThreshold', 'Repeat-offender threshold (reports)', '')}
        {numberSetting('pulseMinGroupSize', 'Campus Pulse minimum group size', 'Groups smaller than this are never shown.')}
      </section>

      {(Object.keys(LIST_HELP) as ListSection[]).map((section) => {
        const help = LIST_HELP[section];
        const value = drafts[section] ?? JSON.stringify(config[section], null, 2);
        return (
          <section key={section} className={card} aria-labelledby={`cfg-${section}`}>
            <h3 id={`cfg-${section}`} className="text-sm font-bold text-slate-900">{help.title} ({(config[section] as unknown[]).length})</h3>
            <p className="text-slate-600">{help.note}</p>
            <p className="text-slate-500">Example: <code className="break-all">{help.example}</code></p>
            {section === 'shifts' && (
              <p className="text-slate-600">
                Active responders: {responders.length === 0 ? 'none — create responder accounts in Staff Management first.' : responders.map((r) => `${r.name} (${r.id}, ${r.responderType}${r.phone ? '' : ', no phone'})`).join('; ')}
              </p>
            )}
            <label className="sr-only" htmlFor={`cfg-text-${section}`}>{help.title} JSON</label>
            <textarea
              id={`cfg-text-${section}`}
              rows={Math.min(14, Math.max(4, value.split('\n').length))}
              value={value}
              onChange={(e) => setDrafts((d) => ({ ...d, [section]: e.target.value }))}
              className={`${input} w-full font-mono text-[11px]`}
              spellCheck={false}
            />
            <div className="flex items-center gap-2">
              <button
                className={btn}
                disabled={saving === section}
                onClick={() => {
                  try {
                    save(section, JSON.parse(value));
                  } catch {
                    setFeedback({ section, ok: false, text: 'This is not valid JSON.' });
                  }
                }}
              >
                <Save size={12} /> Save {help.title.toLowerCase()}
              </button>
              {drafts[section] !== undefined && (
                <button className="underline cursor-pointer" onClick={() => setDrafts((d) => ({ ...d, [section]: undefined }))}>Discard changes</button>
              )}
              <Feedback section={section} />
            </div>
          </section>
        );
      })}
      {config.updatedAt && <p className="text-[11px] text-slate-500">Last changed {new Date(config.updatedAt).toLocaleString()} by {config.updatedBy}.</p>}
    </div>
  );
};
