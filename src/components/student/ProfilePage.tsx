import React, { useEffect, useState } from 'react';
import { Loader2, Save, UserCircle } from 'lucide-react';
import { PROFILE_REQUIRED_FIELDS, StudentProfile } from '../../shared/types.js';
import { PROFILE_FIELD_LABELS, validateProfileInput } from '../../shared/validation.js';
import { apiClient } from '../../services/apiClient.js';
import { useAuth } from '../../context/AuthContext.js';

type FieldErrors = Partial<Record<keyof StudentProfile, string>>;

const EMPTY: StudentProfile = {
  fullName: '',
  studentId: '',
  phone: '',
  collegeEmail: '',
  department: '',
  yearOrSemester: '',
  campus: '',
  livesInHostel: false
};

interface Props {
  onSaved?: (complete: boolean) => void;
}

/**
 * Student profile, stored on the server against the signed-in account (never trusted
 * from a client-supplied id). Used to autofill emergency reports.
 */
export const ProfilePage: React.FC<Props> = ({ onSaved }) => {
  const { user, refreshUser } = useAuth();
  const [profile, setProfile] = useState<StudentProfile>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [missing, setMissing] = useState<(keyof StudentProfile)[]>([]);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await apiClient.getProfile();
      setProfile({ ...EMPTY, collegeEmail: user?.email ?? '', fullName: user?.name ?? '', ...(res.profile ?? {}) });
      setMissing(res.missingFields);
    } catch (err: any) {
      setLoadError(err.message || 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user?.id]);

  const set = (key: keyof StudentProfile, value: string | boolean) => {
    setProfile((p) => ({ ...p, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setStatus(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus(null);
    const { errors: clientErrors } = validateProfileInput(profile as unknown as Record<string, unknown>);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      setStatus({ ok: false, text: 'Please correct the highlighted fields.' });
      return;
    }
    setSaving(true);
    try {
      const res = await apiClient.saveProfile(profile);
      setProfile({ ...EMPTY, ...(res.profile ?? {}) });
      setMissing(res.missingFields);
      setErrors({});
      // Only reported as saved after the server confirmed it
      setStatus({ ok: true, text: res.isComplete ? 'Profile saved.' : `Profile saved. Still missing: ${res.missingFields.map((f) => PROFILE_FIELD_LABELS[f]).join(', ')}.` });
      await refreshUser();
      onSaved?.(res.isComplete);
    } catch (err: any) {
      setErrors(err.fieldErrors ?? {});
      setStatus({ ok: false, text: err.message || 'Saving failed. Your changes are still on this page; please try again.' });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="max-w-3xl mx-auto text-sm text-slate-600 flex items-center gap-2" role="status">
        <Loader2 size={16} className="animate-spin" /> Loading your profile…
      </p>
    );
  }
  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm" role="alert">
        {loadError}{' '}
        <button onClick={load} className="underline font-semibold cursor-pointer">Try again</button>
      </div>
    );
  }

  const field = (key: keyof StudentProfile, opts: { type?: string; placeholder?: string; autoComplete?: string } = {}) => {
    const required = PROFILE_REQUIRED_FIELDS.includes(key) || (key === 'building' && profile.livesInHostel);
    const id = `pf-${key}`;
    const err = errors[key];
    return (
      <div>
        <label htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1">
          {PROFILE_FIELD_LABELS[key]} {required ? <span className="text-rose-600">(required)</span> : <span className="text-slate-400">(optional)</span>}
        </label>
        <input
          id={id}
          type={opts.type ?? 'text'}
          value={(profile[key] as string) ?? ''}
          onChange={(e) => set(key, e.target.value)}
          placeholder={opts.placeholder}
          autoComplete={opts.autoComplete}
          aria-required={required}
          aria-invalid={Boolean(err)}
          aria-describedby={err ? `${id}-err` : undefined}
          className={`w-full px-3 py-2 rounded-xl border text-sm text-slate-800 ${err ? 'border-rose-500' : 'border-slate-300'}`}
        />
        {err && <p id={`${id}-err`} className="text-xs text-rose-700 mt-1">{err}</p>}
      </div>
    );
  };

  return (
    <form onSubmit={save} noValidate className="max-w-3xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
      <div className="flex items-start gap-3">
        <UserCircle className="text-blue-600 shrink-0" size={28} />
        <div>
          <h2 className="text-xl font-bold text-slate-900">Your profile</h2>
          <p className="text-xs text-slate-600">
            Saved to your account, so it is available on any device you sign in from. It is used to fill in your details when you report an emergency.
          </p>
        </div>
      </div>

      {missing.length > 0 && (
        <p className="text-xs p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900">
          Missing: {missing.map((f) => PROFILE_FIELD_LABELS[f]).join(', ')}. You can still report an emergency without a complete profile.
        </p>
      )}

      <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <legend className="sr-only">Personal and academic details</legend>
        {field('fullName', { autoComplete: 'name' })}
        {field('studentId', { placeholder: 'e.g. 2023CS101' })}
        {field('phone', { type: 'tel', autoComplete: 'tel', placeholder: '+91 98765 43210' })}
        {field('collegeEmail', { type: 'email', autoComplete: 'email' })}
        {field('department', { placeholder: 'e.g. B.Tech Computer Science' })}
        {field('yearOrSemester', { placeholder: 'e.g. 2nd year / Sem 4' })}
        {field('campus', { placeholder: 'e.g. Main campus' })}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-xs font-bold text-slate-500 uppercase tracking-wider">Where you usually are</legend>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={profile.livesInHostel} onChange={(e) => set('livesInHostel', e.target.checked)} />
          I live in a hostel / campus residence
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {field('building', { placeholder: profile.livesInHostel ? 'Hostel name / block' : 'Building you are usually in' })}
          {field('floor')}
          {field('room')}
        </div>
      </fieldset>

      <fieldset className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <legend className="text-xs font-bold text-slate-500 uppercase tracking-wider">Emergency contact (optional)</legend>
        {field('emergencyContactName')}
        {field('emergencyContactPhone', { type: 'tel' })}
      </fieldset>

      {status && (
        <p role={status.ok ? 'status' : 'alert'} className={`text-sm p-3 rounded-xl border ${status.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
          {status.text}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] text-slate-500">{profile.updatedAt ? `Last saved ${new Date(profile.updatedAt).toLocaleString()}` : 'Not saved yet'}</p>
        <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-2 cursor-pointer disabled:opacity-50">
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {saving ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  );
};
