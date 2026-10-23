import React, { useEffect, useRef, useState } from 'react';
import { AlertOctagon, Loader2, MapPin, Phone, X } from 'lucide-react';
import { EmergencyLocation, EmergencyType, StudentEmergencyView, StudentProfile } from '../../shared/types.js';
import { apiClient } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.js';

function newRequestId() {
  return globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `em-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

const DangerNotice = () => (
  <p className="text-sm font-semibold text-rose-900 bg-rose-100 border border-rose-300 rounded-xl p-3 flex gap-2" role="note">
    <Phone size={16} className="shrink-0 mt-0.5" />
    If anyone is in immediate danger, call local emergency services or the campus emergency desk directly now. This app does not replace emergency services.
  </p>
);

/**
 * Step 2 of the emergency flow (step 1 is the Emergency button). Shows the student's
 * saved details and optional GPS, then creates the incident on confirmation.
 * Nothing here waits for AI, a complete profile, or GPS permission.
 */
export const EmergencyFlow: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { user } = useAuth();
  const [requestId, setRequestId] = useState(newRequestId);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [profileState, setProfileState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [location, setLocation] = useState<EmergencyLocation>({ gpsStatus: 'not_requested' });
  const [type, setType] = useState<EmergencyType>('unspecified');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicateOf, setDuplicateOf] = useState<StudentEmergencyView | null>(null);
  const [incident, setIncident] = useState<StudentEmergencyView | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset for a fresh report each time the dialog opens
  useEffect(() => {
    if (!open) return;
    setRequestId(newRequestId());
    setIncident(null);
    setDuplicateOf(null);
    setError(null);
    setType('unspecified');
    setProfileState('loading');
    setLocation({ gpsStatus: 'not_requested' });
    dialogRef.current?.focus();

    apiClient
      .getProfile()
      .then((res) => {
        setProfile(res.profile);
        setProfileState('loaded');
        setLocation((l) => ({
          ...l,
          campus: l.campus ?? res.profile?.campus,
          building: l.building ?? res.profile?.building,
          floor: l.floor ?? res.profile?.floor,
          room: l.room ?? res.profile?.room
        }));
      })
      .catch(() => setProfileState('failed'));

    if ('geolocation' in navigator) {
      setLocation((l) => ({ ...l, gpsStatus: 'not_requested' }));
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setLocation((l) => ({
            ...l,
            gpsStatus: 'granted',
            gps: {
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracyMeters: pos.coords.accuracy,
              capturedAt: new Date(pos.timestamp).toISOString()
            }
          })),
        (err) => setLocation((l) => ({ ...l, gpsStatus: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable', gps: undefined })),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
      );
    } else {
      setLocation((l) => ({ ...l, gpsStatus: 'unavailable' }));
    }
  }, [open]);

  // Poll the server for truthful delivery/acknowledgement state while the dialog is open
  useEffect(() => {
    if (!open || !incident || incident.status === 'closed') return;
    const t = setInterval(() => {
      apiClient
        .getMyEmergencies()
        .then((res) => {
          const latest = res.incidents.find((i) => i.id === incident.id);
          if (latest) setIncident(latest);
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [open, incident?.id, incident?.status]);

  if (!open) return null;

  const confirm = async (confirmNew = false) => {
    if (sending) return; // rapid repeated taps are ignored; the request id also dedupes retries
    setSending(true);
    setError(null);
    try {
      const res = await apiClient.reportEmergency({ clientRequestId: requestId, type, location, confirmNew });
      if (res.possibleDuplicate) {
        setDuplicateOf(res.incident);
      } else {
        setDuplicateOf(null);
        setIncident(res.incident);
      }
    } catch (err: any) {
      setError(`${err.message || 'The alert could not be sent.'} Please try again, and call the campus emergency desk directly.`);
    } finally {
      setSending(false);
    }
  };

  const gpsText = {
    granted: location.gps ? `GPS ${location.gps.latitude.toFixed(5)}, ${location.gps.longitude.toFixed(5)} (±${Math.round(location.gps.accuracyMeters)} m) at ${new Date(location.gps.capturedAt).toLocaleTimeString()}` : 'GPS received',
    denied: 'Location permission denied — your saved/typed location will be used.',
    unavailable: 'GPS unavailable — your saved/typed location will be used.',
    not_requested: 'Getting your GPS position… (you can confirm without waiting)'
  }[location.gpsStatus];

  const inputCls = 'w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-900';

  return (
    <div className="fixed inset-0 z-[60] bg-slate-950/70 flex items-center justify-center p-3 overflow-y-auto">
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="em-title"
        className="bg-white rounded-3xl shadow-2xl border-4 border-rose-600 max-w-lg w-full p-5 sm:p-6 space-y-4 outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="em-title" className="text-xl font-black text-rose-800 flex items-center gap-2">
            <AlertOctagon size={22} /> {incident ? `Emergency ${incident.id}` : 'Confirm emergency alert'}
          </h2>
          <button onClick={onClose} aria-label={incident ? 'Close' : 'Cancel emergency'} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <DangerNotice />

        {incident ? (
          <div className="space-y-3" aria-live="polite">
            <div className="p-4 rounded-xl border-2 border-slate-300 bg-slate-50">
              <p className="text-xs uppercase font-bold text-slate-500">Alert status</p>
              <p className="text-lg font-black text-slate-900">{incident.alertState}</p>
              <p className="text-sm text-slate-700">{incident.alertDetail}</p>
              {incident.escalationLevel > 0 && <p className="text-xs text-slate-600 mt-1">Escalation level {incident.escalationLevel}.</p>}
            </div>
            <p className="text-xs text-slate-600">Reported {new Date(incident.createdAt).toLocaleString()}. This page refreshes the status every few seconds while it is open.</p>
            <button onClick={onClose} className="w-full py-2.5 rounded-xl border border-slate-300 font-semibold cursor-pointer">Close</button>
          </div>
        ) : duplicateOf ? (
          <div className="space-y-3" role="alert">
            <p className="text-sm text-slate-800">
              You reported emergency <strong>{duplicateOf.id}</strong> at {new Date(duplicateOf.createdAt).toLocaleTimeString()} (status: {duplicateOf.alertState}). Is this a different emergency?
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={() => { setIncident(duplicateOf); setDuplicateOf(null); }} className="flex-1 py-2.5 rounded-xl border border-slate-300 font-semibold cursor-pointer">
                Show my existing alert
              </button>
              <button onClick={() => confirm(true)} disabled={sending} className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white font-bold cursor-pointer disabled:opacity-60">
                Yes, this is a new emergency
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="text-sm space-y-1">
              <p><strong>Name:</strong> {profile?.fullName || user?.name}</p>
              <p><strong>Student ID:</strong> {profile?.studentId || <span className="text-slate-500">not in profile</span>}</p>
              <p><strong>Phone:</strong> {profile?.phone || <span className="text-slate-500">not in profile</span>}</p>
              {profileState === 'loading' && <p className="text-xs text-slate-500">Loading your saved details…</p>}
              {profileState === 'failed' && <p className="text-xs text-amber-800">Saved details could not be loaded; you can still send the alert.</p>}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-xs font-bold uppercase text-slate-500 flex items-center gap-1"><MapPin size={12} /> Location (correct if needed)</legend>
              <p className="text-xs text-slate-700" aria-live="polite">{gpsText}</p>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs">Campus<input className={inputCls} value={location.campus ?? ''} onChange={(e) => setLocation({ ...location, campus: e.target.value })} /></label>
                <label className="text-xs">Building / area<input className={inputCls} value={location.building ?? ''} onChange={(e) => setLocation({ ...location, building: e.target.value })} /></label>
                <label className="text-xs">Floor<input className={inputCls} value={location.floor ?? ''} onChange={(e) => setLocation({ ...location, floor: e.target.value })} /></label>
                <label className="text-xs">Room (if indoors)<input className={inputCls} value={location.room ?? ''} onChange={(e) => setLocation({ ...location, room: e.target.value })} /></label>
              </div>
              <label className="text-xs block">Where exactly? (optional)<input className={inputCls} value={location.details ?? ''} onChange={(e) => setLocation({ ...location, details: e.target.value })} placeholder="e.g. outside the library main gate" /></label>
            </fieldset>

            <label className="text-xs block">
              Type (optional)
              <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as EmergencyType)}>
                <option value="unspecified">Not sure / other</option>
                <option value="medical">Medical</option>
                <option value="security">Security / safety threat</option>
              </select>
            </label>

            {error && <p className="text-sm text-rose-800 bg-rose-50 border border-rose-200 rounded-xl p-3" role="alert">{error}</p>}

            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <button onClick={onClose} className="sm:flex-1 py-3 rounded-xl border border-slate-300 font-semibold cursor-pointer">Cancel</button>
              <button
                onClick={() => confirm(false)}
                disabled={sending}
                className="sm:flex-[2] py-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-base font-black cursor-pointer disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {sending && <Loader2 size={18} className="animate-spin" />}
                {sending ? 'Sending…' : 'Confirm Emergency Alert'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
