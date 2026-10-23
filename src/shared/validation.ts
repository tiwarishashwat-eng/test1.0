/**
 * Validation rules shared by the browser and the server. The server always
 * re-validates; client checks only give faster feedback.
 */
import { PROFILE_REQUIRED_FIELDS, StudentProfile } from './types.js';

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Digits with optional leading +, spaces, or dashes; 7-15 digits in total
export const PHONE_PATTERN = /^\+?[0-9][0-9\s-]{5,18}[0-9]$/;
export const STUDENT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/._-]{2,29}$/;

export function digitCount(phone: string): number {
  return (phone.match(/\d/g) || []).length;
}

export function isValidPhone(phone: string): boolean {
  const p = phone.trim();
  return PHONE_PATTERN.test(p) && digitCount(p) >= 7 && digitCount(p) <= 15;
}

export const PROFILE_FIELD_LABELS: Record<keyof StudentProfile, string> = {
  fullName: 'Full name',
  studentId: 'Student ID / enrollment number',
  phone: 'Registered mobile number',
  collegeEmail: 'College email',
  department: 'Course or department',
  yearOrSemester: 'Year or semester',
  campus: 'Campus or site',
  livesInHostel: 'Lives in a hostel',
  building: 'Hostel or building/block',
  floor: 'Floor',
  room: 'Room number',
  emergencyContactName: 'Emergency contact name',
  emergencyContactPhone: 'Emergency contact phone',
  updatedAt: 'Last updated'
};

const MAX_LENGTHS: Partial<Record<keyof StudentProfile, number>> = {
  fullName: 100,
  collegeEmail: 120,
  department: 100,
  yearOrSemester: 30,
  campus: 100,
  building: 100,
  floor: 20,
  room: 20,
  emergencyContactName: 100
};

/**
 * Validates profile input. Returns per-field error messages (empty when valid) and
 * the normalised profile. Required fields may be missing (`allowIncomplete`) so a
 * student can save partial progress; anything provided must still be well-formed.
 */
export function validateProfileInput(
  input: Record<string, unknown>,
  { allowIncomplete = true } = {}
): { errors: Partial<Record<keyof StudentProfile, string>>; profile: StudentProfile } {
  const errors: Partial<Record<keyof StudentProfile, string>> = {};
  const text = (key: keyof StudentProfile): string => {
    const v = input[key];
    if (v === undefined || v === null) return '';
    if (typeof v !== 'string') {
      errors[key] = `${PROFILE_FIELD_LABELS[key]} must be text`;
      return '';
    }
    const trimmed = v.trim();
    const max = MAX_LENGTHS[key];
    if (max && trimmed.length > max) errors[key] = `${PROFILE_FIELD_LABELS[key]} must be at most ${max} characters`;
    return trimmed;
  };

  const livesInHostel = input.livesInHostel === true;
  const profile: StudentProfile = {
    fullName: text('fullName'),
    studentId: text('studentId'),
    phone: text('phone'),
    collegeEmail: text('collegeEmail').toLowerCase(),
    department: text('department'),
    yearOrSemester: text('yearOrSemester'),
    campus: text('campus'),
    livesInHostel,
    building: text('building') || undefined,
    floor: text('floor') || undefined,
    room: text('room') || undefined,
    emergencyContactName: text('emergencyContactName') || undefined,
    emergencyContactPhone: text('emergencyContactPhone') || undefined
  };

  if (profile.studentId && !STUDENT_ID_PATTERN.test(profile.studentId)) {
    errors.studentId = 'Use 3-30 letters, digits, or / . _ -';
  }
  if (profile.phone && !isValidPhone(profile.phone)) {
    errors.phone = 'Enter a valid phone number (7-15 digits, optional +country code)';
  }
  if (profile.collegeEmail && !EMAIL_PATTERN.test(profile.collegeEmail)) {
    errors.collegeEmail = 'Enter a valid email address';
  }
  if (profile.emergencyContactPhone && !isValidPhone(profile.emergencyContactPhone)) {
    errors.emergencyContactPhone = 'Enter a valid phone number';
  }
  if (profile.emergencyContactPhone && !profile.emergencyContactName) {
    errors.emergencyContactName = 'Add a name for the emergency contact';
  }
  if (livesInHostel && !profile.building) {
    errors.building = 'Hostel or building/block is required if you live in a hostel';
  }

  if (!allowIncomplete) {
    for (const field of PROFILE_REQUIRED_FIELDS) {
      if (!profile[field]) errors[field] = `${PROFILE_FIELD_LABELS[field]} is required`;
    }
  }

  return { errors, profile };
}

export function missingProfileFields(profile: StudentProfile | null | undefined): (keyof StudentProfile)[] {
  if (!profile) return [...PROFILE_REQUIRED_FIELDS];
  const missing = PROFILE_REQUIRED_FIELDS.filter((f) => !profile[f]);
  if (profile.livesInHostel && !profile.building) missing.push('building');
  return missing;
}

/** Image types accepted for complaint photos and proof-of-fix evidence. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
