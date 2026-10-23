/**
 * CampusConnect - User Management & Authentication Storage
 * File-backed persistence in .data/users.json with secure password hashing (PBKDF2/scrypt)
 * and token-based session management.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { Department, User, UserRole } from '../shared/types.js';

/** Data directory, resolved when a store is constructed so tests can point at a temp dir. */
export function resolveDataDir(): string {
  return path.resolve(process.env.CAMPUSCONNECT_DATA_DIR || path.join(process.cwd(), '.data'));
}

// Records created before this field existed were hashed with 10k iterations
const LEGACY_PBKDF2_ITERATIONS = 10000;
const PBKDF2_ITERATIONS = 210000;
const VALID_ROLES: readonly UserRole[] = ['student', 'staff', 'admin'];

export const isDemoSeedEnabled = () => process.env.CAMPUSCONNECT_DEMO_SEED === 'true';

interface StoredUserRecord extends User {
  passwordHash: string;
  salt: string;
  hashIterations?: number;
}

interface StoredSession {
  // SHA-256 of the bearer token; the raw token is never written to disk
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class UserStore {
  private users: Map<string, StoredUserRecord> = new Map(); // keyed by id
  private emailIndex: Map<string, string> = new Map(); // email -> id
  private sessions: Map<string, StoredSession> = new Map(); // tokenHash -> session
  private readonly dataDir = resolveDataDir();
  private readonly usersFile = path.join(this.dataDir, 'users.json');

  constructor() {
    this.initStore();
    this.ensureBootstrapAdmin();
  }

  private hashPassword(password: string, salt: string, iterations: number = PBKDF2_ITERATIONS): string {
    return crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  }

  private verifyPassword(record: StoredUserRecord, password: string): boolean {
    const computed = Buffer.from(
      this.hashPassword(password, record.salt, record.hashIterations ?? LEGACY_PBKDF2_ITERATIONS),
      'hex'
    );
    const stored = Buffer.from(record.passwordHash, 'hex');
    return computed.length === stored.length && crypto.timingSafeEqual(computed, stored);
  }

  private setPassword(record: StoredUserRecord, password: string) {
    record.salt = crypto.randomBytes(16).toString('hex');
    record.hashIterations = PBKDF2_ITERATIONS;
    record.passwordHash = this.hashPassword(password, record.salt);
  }

  private issueSession(userId: string): string {
    const token = crypto.randomBytes(32).toString('hex');
    const now = new Date();
    this.sessions.set(hashToken(token), {
      tokenHash: hashToken(token),
      userId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    return token;
  }

  /**
   * Creates the first administrator from ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD
   * when no active admin exists. No admin account is ever created with a built-in password.
   */
  private ensureBootstrapAdmin() {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    const hasActiveAdmin = Array.from(this.users.values()).some((u) => u.role === 'admin' && u.isActive);
    if (hasActiveAdmin || !email || !password) {
      if (!hasActiveAdmin) {
        console.warn('[UserStore] No active admin account. Set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD to create one.');
      }
      return;
    }
    if (password.length < 12) {
      console.error('[UserStore] ADMIN_BOOTSTRAP_PASSWORD must be at least 12 characters; bootstrap admin not created.');
      return;
    }
    if (this.emailIndex.has(email)) {
      console.error(`[UserStore] ADMIN_BOOTSTRAP_EMAIL belongs to an existing non-admin account; bootstrap admin not created.`);
      return;
    }

    const record: StoredUserRecord = {
      id: `user-admin-${crypto.randomUUID()}`,
      name: 'Administrator',
      email,
      passwordHash: '',
      salt: '',
      role: 'admin',
      isActive: true,
      createdAt: new Date().toISOString()
    };
    this.setPassword(record, password);
    this.users.set(record.id, record);
    this.emailIndex.set(email, record.id);
    this.persistToDisk();
    console.log(`[UserStore] Bootstrap administrator created for ${email}.`);
  }

  private initStore() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.usersFile)) {
        const raw = fs.readFileSync(this.usersFile, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.users)) {
          for (const u of data.users) {
            this.users.set(u.id, u);
            this.emailIndex.set(u.email.toLowerCase(), u.id);
          }
        }
        if (Array.isArray(data.sessions)) {
          const now = Date.now();
          for (const s of data.sessions) {
            // Legacy sessions stored the raw token; they are dropped so those users sign in again
            if (typeof s.tokenHash === 'string' && new Date(s.expiresAt).getTime() > now) {
              this.sessions.set(s.tokenHash, s);
            }
          }
        }
        console.log(`[UserStore] Loaded ${this.users.size} user accounts.`);
        return;
      }
    } catch (err) {
      console.warn('[UserStore] Error loading users from disk:', err);
    }

    if (isDemoSeedEnabled()) {
      console.warn('[UserStore] CAMPUSCONNECT_DEMO_SEED=true: seeding demo accounts with published passwords. Do not use in production.');
      this.seedDefaultUsers();
    }
    this.persistToDisk();
  }

  private persistToDisk() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const payload = {
        updatedAt: new Date().toISOString(),
        users: Array.from(this.users.values()),
        sessions: Array.from(this.sessions.values())
      };
      const tempPath = `${this.usersFile}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.usersFile);
    } catch (err) {
      console.error('[UserStore] Failed to write users to disk:', err);
    }
  }

  private seedDefaultUsers() {
    const defaultAccounts: Array<{
      id: string;
      name: string;
      email: string;
      password: string;
      role: UserRole;
      department?: Department;
    }> = [
      {
        id: 'user-admin-1',
        name: 'Facilities Administrator',
        email: 'admin@campus.edu',
        password: 'AdminPass2026!',
        role: 'admin'
      },
      {
        id: 'user-staff-1',
        name: 'Sarah Martinez (Triage Supervisor)',
        email: 'sarah.supervisor@campus.edu',
        password: 'StaffPass2026!',
        role: 'staff',
        department: 'Plumbing Maintenance Department'
      },
      {
        id: 'user-staff-2',
        name: 'Carlos Rivera (Master Plumber)',
        email: 'carlos.rivera@campus.edu',
        password: 'StaffPass2026!',
        role: 'staff',
        department: 'Plumbing Maintenance Department'
      },
      {
        id: 'user-staff-3',
        name: 'Marcus Vance (Senior Electrician)',
        email: 'marcus.vance@campus.edu',
        password: 'StaffPass2026!',
        role: 'staff',
        department: 'Electrical Systems & Safety Division'
      },
      {
        id: 'user-staff-4',
        name: 'Elena Gomez (Custodial Lead)',
        email: 'elena.gomez@campus.edu',
        password: 'StaffPass2026!',
        role: 'staff',
        department: 'Campus Custodial & Sanitation Services'
      },
      {
        id: 'user-staff-5',
        name: 'Maya Lin (NOC Wireless Engineer)',
        email: 'maya.lin@campus.edu',
        password: 'StaffPass2026!',
        role: 'staff',
        department: 'IT & Network Infrastructure Team'
      },
      {
        id: 'user-student-1',
        name: 'Alex Chen',
        email: 'alex.chen@campus.edu',
        password: 'StudentPass2026!',
        role: 'student'
      },
      {
        id: 'user-student-2',
        name: 'Priya Patel',
        email: 'priya.patel@campus.edu',
        password: 'StudentPass2026!',
        role: 'student'
      }
    ];

    for (const acc of defaultAccounts) {
      const userRecord: StoredUserRecord = {
        id: acc.id,
        name: acc.name,
        email: acc.email.toLowerCase(),
        passwordHash: '',
        salt: '',
        role: acc.role,
        department: acc.department,
        isActive: true,
        createdAt: new Date().toISOString()
      };
      this.setPassword(userRecord, acc.password);
      this.users.set(userRecord.id, userRecord);
      this.emailIndex.set(userRecord.email, userRecord.id);
    }
  }

  public authenticate(email: string, password: string): { user: User; token: string } | null {
    if (!email || !password) return null;
    const cleanEmail = email.trim().toLowerCase();
    const userId = this.emailIndex.get(cleanEmail);
    if (!userId) return null;

    const record = this.users.get(userId);
    if (!record || !record.isActive) return null;

    if (!this.verifyPassword(record, password)) return null;

    // Upgrade legacy low-iteration hashes now that we know the plaintext
    if ((record.hashIterations ?? LEGACY_PBKDF2_ITERATIONS) < PBKDF2_ITERATIONS) {
      this.setPassword(record, password);
    }

    // Secure session token (30 days validity)
    const token = this.issueSession(record.id);
    this.persistToDisk();

    return {
      user: this.toPublicUser(record),
      token
    };
  }

  public registerStudent(name: string, email: string, password: string): { user: User; token: string } {
    const cleanEmail = email.trim().toLowerCase();
    if (this.emailIndex.has(cleanEmail)) {
      throw new Error('An account with this email address already exists.');
    }

    if (password.length < 6) {
      throw new Error('Password must be at least 6 characters long.');
    }

    const id = `user-student-${crypto.randomUUID()}`;

    const record: StoredUserRecord = {
      id,
      name: name.trim(),
      email: cleanEmail,
      passwordHash: '',
      salt: '',
      role: 'student',
      isActive: true,
      createdAt: new Date().toISOString()
    };
    this.setPassword(record, password);

    this.users.set(id, record);
    this.emailIndex.set(cleanEmail, id);

    const token = this.issueSession(id);
    this.persistToDisk();
    return {
      user: this.toPublicUser(record),
      token
    };
  }

  public validateSession(token: string): User | null {
    if (!token) return null;
    const key = hashToken(token);
    const session = this.sessions.get(key);
    if (!session) return null;

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      this.sessions.delete(key);
      this.persistToDisk();
      return null;
    }

    const userRecord = this.users.get(session.userId);
    if (!userRecord || !userRecord.isActive) return null;

    return this.toPublicUser(userRecord);
  }

  public logout(token: string): boolean {
    if (!token) return false;
    const deleted = this.sessions.delete(hashToken(token));
    if (deleted) this.persistToDisk();
    return deleted;
  }

  public createStaffMember(params: {
    name: string;
    email: string;
    password: string;
    department: Department;
    role: 'staff' | 'admin';
  }): User {
    const cleanEmail = params.email.trim().toLowerCase();
    if (this.emailIndex.has(cleanEmail)) {
      throw new Error('User with this email already exists');
    }

    const id = `user-staff-${crypto.randomUUID()}`;

    const record: StoredUserRecord = {
      id,
      name: params.name.trim(),
      email: cleanEmail,
      passwordHash: '',
      salt: '',
      role: params.role,
      department: params.department,
      isActive: true,
      createdAt: new Date().toISOString()
    };
    this.setPassword(record, params.password);

    this.users.set(id, record);
    this.emailIndex.set(cleanEmail, id);
    this.persistToDisk();

    return this.toPublicUser(record);
  }

  /**
   * Updates a staff/admin account. Inputs must already be type-checked by the caller;
   * this enforces the business rules (no student targets, no self-demotion/suspension,
   * at least one active admin remains).
   */
  public updateStaffMember(
    id: string,
    updates: { department?: Department; isActive?: boolean; role?: 'staff' | 'admin' },
    actor: User
  ): { user?: User; error?: string; status: number } {
    const record = this.users.get(id);
    if (!record || (record.role !== 'staff' && record.role !== 'admin')) {
      return { error: 'Staff member not found', status: 404 };
    }
    if (updates.role !== undefined && !VALID_ROLES.includes(updates.role)) {
      return { error: 'Invalid role', status: 400 };
    }

    const isSelf = record.id === actor.id;
    if (isSelf && updates.role !== undefined && updates.role !== record.role) {
      return { error: 'You cannot change your own role.', status: 403 };
    }
    if (isSelf && updates.isActive === false) {
      return { error: 'You cannot suspend your own account.', status: 403 };
    }

    const losesAdmin =
      record.role === 'admin' &&
      record.isActive &&
      ((updates.role !== undefined && updates.role !== 'admin') || updates.isActive === false);
    if (losesAdmin) {
      const otherActiveAdmins = Array.from(this.users.values()).filter(
        (u) => u.role === 'admin' && u.isActive && u.id !== record.id
      );
      if (otherActiveAdmins.length === 0) {
        return { error: 'At least one active administrator must remain.', status: 409 };
      }
    }

    const roleChanged = updates.role !== undefined && updates.role !== record.role;
    if (updates.department !== undefined) record.department = updates.department;
    if (updates.isActive !== undefined) record.isActive = updates.isActive;
    if (updates.role !== undefined) record.role = updates.role;

    // Suspension or role change revokes existing sessions so the change takes effect immediately
    if (updates.isActive === false || roleChanged) {
      for (const [key, s] of this.sessions) {
        if (s.userId === record.id) this.sessions.delete(key);
      }
    }

    this.persistToDisk();
    return { user: this.toPublicUser(record), status: 200 };
  }

  public getAllStaff(): User[] {
    return Array.from(this.users.values())
      .filter((u) => u.role === 'staff' || u.role === 'admin')
      .map(this.toPublicUser);
  }

  public getUserById(id: string): User | null {
    const u = this.users.get(id);
    return u ? this.toPublicUser(u) : null;
  }

  private toPublicUser(record: StoredUserRecord): User {
    return {
      id: record.id,
      name: record.name,
      email: record.email,
      role: record.role,
      department: record.department,
      isActive: record.isActive,
      createdAt: record.createdAt
    };
  }
}

export const userStore = new UserStore();
