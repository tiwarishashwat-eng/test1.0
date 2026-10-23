/**
 * Tests for the security and honesty fixes:
 * - Demo data is opt-in; first admin comes from env; tokens are stored hashed
 * - Ownerless tickets are not handed to an arbitrary student
 * - /api/complaints/analyze requires sign-in and does not leak other students' tickets
 * - Client-supplied AI output is ignored; only server-produced analyses are attached
 * - Student responses omit staff-only duplicate data; 404 does not reveal ticket existence
 * - Admin staff updates are validated (no student promotion, no self-demotion/suspension)
 * - Gemini failures are reported with a specific reason (mocked client; no real API call)
 */

import './testEnv.js';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';
import { ApiError } from '@google/genai';
import { TEST_DATA_DIR, makeTempDataDir } from './testEnv.js';
import { UserStore } from './userStore.js';
import { TicketRepository } from './ticketStore.js';
import {
  analyzeComplaintWithGemini,
  getGeminiStatus,
  setAiClientForTesting,
  GeminiClientLike
} from './geminiService.js';
import { User } from '../shared/types.js';
import { createApiApp } from '../../server.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `- ${detail}` : ''}`);
    failed++;
  }
}

/** Runs fn with env vars temporarily set (undefined deletes), then restores them. */
function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const sampleInput = {
  description: 'Washroom tap is leaking',
  building: 'Main Academic Quad',
  location: 'Room 204'
};

async function runStoreTests() {
  console.log('Test Suite 1: Demo seed, bootstrap admin, and session storage');

  const emptyStore = withEnv(
    { CAMPUSCONNECT_DATA_DIR: makeTempDataDir(), CAMPUSCONNECT_DEMO_SEED: 'false' },
    () => new UserStore()
  );
  assert(emptyStore.getAllStaff().length === 0, 'Without demo seed, no staff/admin accounts are created');
  assert(
    emptyStore.authenticate('alex.chen@campus.edu', 'StudentPass2026!') === null,
    'Without demo seed, the published demo student password does not work'
  );

  const bootstrapStore = withEnv(
    {
      CAMPUSCONNECT_DATA_DIR: makeTempDataDir(),
      CAMPUSCONNECT_DEMO_SEED: 'false',
      ADMIN_BOOTSTRAP_EMAIL: 'Root@Example.edu',
      ADMIN_BOOTSTRAP_PASSWORD: 'a-long-bootstrap-pass'
    },
    () => new UserStore()
  );
  const bootAuth = bootstrapStore.authenticate('root@example.edu', 'a-long-bootstrap-pass');
  assert(bootAuth?.user.role === 'admin', 'Bootstrap admin is created from ADMIN_BOOTSTRAP_* env vars');

  const weakBootstrap = withEnv(
    {
      CAMPUSCONNECT_DATA_DIR: makeTempDataDir(),
      CAMPUSCONNECT_DEMO_SEED: 'false',
      ADMIN_BOOTSTRAP_EMAIL: 'root@example.edu',
      ADMIN_BOOTSTRAP_PASSWORD: 'short'
    },
    () => new UserStore()
  );
  assert(weakBootstrap.getAllStaff().length === 0, 'Bootstrap admin is refused when the password is under 12 characters');

  // Session tokens are stored only as hashes
  const tokenDir = makeTempDataDir();
  const tokenStore = withEnv({ CAMPUSCONNECT_DATA_DIR: tokenDir, CAMPUSCONNECT_DEMO_SEED: 'true' }, () => new UserStore());
  const auth = tokenStore.authenticate('alex.chen@campus.edu', 'StudentPass2026!')!;
  const usersFile = fs.readFileSync(path.join(tokenDir, 'users.json'), 'utf-8');
  assert(!usersFile.includes(auth.token), 'Raw session token is not written to users.json');
  assert(/"tokenHash"/.test(usersFile), 'Sessions are persisted as token hashes');

  // A store reloaded from disk still validates the token (persistence across restarts)
  const reloaded = withEnv({ CAMPUSCONNECT_DATA_DIR: tokenDir }, () => new UserStore());
  assert(reloaded.validateSession(auth.token)?.id === auth.user.id, 'Hashed session survives a server restart');

  // Legacy plaintext sessions from older data files are dropped
  const legacyDir = makeTempDataDir();
  const legacyUsers = JSON.parse(usersFile);
  legacyUsers.sessions = [
    { token: 'legacy-plain-token', userId: auth.user.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }
  ];
  fs.writeFileSync(path.join(legacyDir, 'users.json'), JSON.stringify(legacyUsers));
  const legacyStore = withEnv({ CAMPUSCONNECT_DATA_DIR: legacyDir }, () => new UserStore());
  assert(legacyStore.validateSession('legacy-plain-token') === null, 'Legacy plaintext sessions are not accepted');

  console.log('\nTest Suite 2: Ownerless tickets are not reassigned');

  const orphanDir = makeTempDataDir();
  fs.writeFileSync(
    path.join(orphanDir, 'tickets.json'),
    JSON.stringify({
      nextIdCounter: 2001,
      tickets: [
        {
          id: 'CC-2000',
          title: 'Ownerless record',
          description: 'Imported without an owner',
          rawStudentInput: 'Imported without an owner',
          category: 'Plumbing',
          categorySource: 'student',
          location: 'Room 1',
          building: 'Library',
          studentName: 'Unknown',
          studentEmail: '',
          status: 'Submitted',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          statusHistory: []
        }
      ]
    })
  );
  const orphanRepo = withEnv({ CAMPUSCONNECT_DATA_DIR: orphanDir }, () => new TicketRepository());
  const student1: User = { id: 'user-student-1', name: 'Alex', email: 'a@x', role: 'student', isActive: true, createdAt: '' };
  const staff: User = { id: 'user-staff-1', name: 'Staff', email: 's@x', role: 'staff', isActive: true, createdAt: '' };
  assert(orphanRepo.getByIdForUser('CC-2000', student1) === null, 'Ownerless ticket is NOT visible to user-student-1');
  assert(orphanRepo.getByIdForUser('CC-2000', staff) !== null, 'Ownerless ticket remains visible to staff');

  const noSeedRepo = withEnv(
    { CAMPUSCONNECT_DATA_DIR: makeTempDataDir(), CAMPUSCONNECT_DEMO_SEED: 'false' },
    () => new TicketRepository()
  );
  assert(noSeedRepo.getAllTicketsForSystem().length === 0, 'Without demo seed, no sample tickets are created');
}

async function runGeminiTests() {
  console.log('\nTest Suite 3: Gemini outcomes are reported truthfully (mocked client)');

  const validJson = JSON.stringify({
    suggestedCategory: 'Plumbing',
    confidence: 'High',
    confidenceScore: 0.9,
    conciseSummary: 'Leaking tap in room 204 washroom.',
    missingDetailsIdentified: [],
    followUpQuestions: [],
    urgencyAssessment: 'Moderate'
  });

  const mock = (impl: GeminiClientLike['models']['generateContent']): GeminiClientLike => ({ models: { generateContent: impl } });

  setAiClientForTesting(mock(async () => ({ text: validJson })));
  const ok = await analyzeComplaintWithGemini(sampleInput);
  assert(ok.isAiFallback === false && typeof ok.model === 'string', 'Successful mocked call is labelled as Gemini with a model id');
  assert(getGeminiStatus().lastCallOk === true, 'Status reports the last call succeeded');

  const cases: Array<[string, GeminiClientLike, string]> = [
    ['429 quota', mock(async () => { throw new ApiError({ message: 'RESOURCE_EXHAUSTED', status: 429 }); }), 'rate_limited'],
    ['404 model', mock(async () => { throw new ApiError({ message: 'models/x is not found', status: 404 }); }), 'model_unavailable'],
    ['403 key', mock(async () => { throw new ApiError({ message: 'API key not valid', status: 403 }); }), 'invalid_key'],
    ['500 error', mock(async () => { throw new ApiError({ message: 'Internal', status: 500 }); }), 'service_error'],
    ['malformed JSON', mock(async () => ({ text: '{not json' })), 'invalid_response'],
    ['empty text', mock(async () => ({ text: '' })), 'invalid_response'],
    ['JSON array', mock(async () => ({ text: '[1,2]' })), 'invalid_response'],
    ['network failure', mock(async () => { throw new TypeError('fetch failed'); }), 'service_error']
  ];
  for (const [label, client, expected] of cases) {
    setAiClientForTesting(client);
    const r = await analyzeComplaintWithGemini(sampleInput);
    assert(
      r.isAiFallback === true && r.fallbackReason === expected,
      `${label} -> labelled fallback with reason "${expected}"`,
      `got isAiFallback=${r.isAiFallback} reason=${r.fallbackReason}`
    );
  }
  assert(getGeminiStatus().lastCallOk === false, 'Status reports the last call failed after an error');

  // Timeout: the mock never answers until aborted
  await withEnv({ GEMINI_TIMEOUT_MS: '50' }, async () => {
    setAiClientForTesting(
      mock(
        (params: any) =>
          new Promise((_resolve, reject) => {
            params.config.abortSignal.addEventListener('abort', () => {
              reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
            });
          })
      )
    );
    const started = Date.now();
    const r = await analyzeComplaintWithGemini(sampleInput);
    assert(r.isAiFallback === true && r.fallbackReason === 'timeout', 'Hung request is aborted and labelled "timeout"');
    assert(Date.now() - started < 2000, 'Timeout returns promptly');
  });

  setAiClientForTesting(null);
  const missing = await analyzeComplaintWithGemini(sampleInput);
  assert(missing.isAiFallback === true && missing.fallbackReason === 'not_configured', 'Missing key -> reason "not_configured"');
  assert(getGeminiStatus().configured === false, 'Status reports Gemini as not configured');
}

async function runHttpTests() {
  console.log('\nTest Suite 4: HTTP authorization and privacy');

  setAiClientForTesting(null);
  const server = createApiApp().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, url: string, token?: string, body?: unknown) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* empty body */ }
    return { status: res.status, json };
  };
  const login = async (email: string, password: string) => (await call('POST', '/api/auth/login', undefined, { email, password })).json.token as string;

  try {
    const alex = await login('alex.chen@campus.edu', 'StudentPass2026!');
    const priya = await login('priya.patel@campus.edu', 'StudentPass2026!');
    const staffToken = await login('sarah.supervisor@campus.edu', 'StaffPass2026!');
    const admin = await login('admin@campus.edu', 'AdminPass2026!');

    // Analyze requires authentication
    const anon = await call('POST', '/api/complaints/analyze', undefined, { description: 'leak' });
    assert(anon.status === 401, 'Anonymous /api/complaints/analyze is rejected with 401');

    // Similar to Priya's CC-1002; Alex must not see its details
    const sparkComplaint = {
      description: 'Power socket sparking at Lecture Hall 101 row 3, burnt smell',
      building: 'Main Academic Quad',
      location: 'Lecture Hall 101'
    };
    const alexAnalyze = await call('POST', '/api/complaints/analyze', alex, sparkComplaint);
    assert(alexAnalyze.status === 200, 'Signed-in student can request AI suggestions');
    assert(
      !alexAnalyze.json.duplicateCandidates.some((c: any) => c.ticketId === 'CC-1002'),
      "Student does not receive another student's ticket in duplicate candidates"
    );
    assert(alexAnalyze.json.similarReportsByOthers >= 1, "Other students' similar reports are reported only as a count");
    assert(alexAnalyze.json.analysis.isAiFallback === true && alexAnalyze.json.analysis.fallbackReason === 'not_configured', 'Analyze response says AI is not configured');

    const priyaAnalyze = await call('POST', '/api/complaints/analyze', priya, sparkComplaint);
    assert(
      priyaAnalyze.json.duplicateCandidates.some((c: any) => c.ticketId === 'CC-1002'),
      'Student does see their own matching ticket'
    );

    const badMime = await call('POST', '/api/complaints/analyze', alex, { ...sparkComplaint, imageBase64: 'AAAA', mimeType: 'image/svg+xml' });
    assert(badMime.status === 400, 'SVG upload is rejected');
    const tooBig = await call('POST', '/api/complaints/analyze', alex, { ...sparkComplaint, imageBase64: 'A'.repeat(7 * 1024 * 1024), mimeType: 'image/png' });
    assert(tooBig.status === 400 || tooBig.status === 413, 'Oversized photo is rejected');
    assert(typeof tooBig.json?.error === 'string' && !/at \w+ \(/.test(tooBig.json.error), 'Oversized request gets a JSON error without a stack trace');
    const malformed = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert(malformed.status === 400 && (await malformed.json()).error === 'Request body is not valid JSON.', 'Malformed JSON gets a clean 400');

    // Forged AI output is ignored
    const forged = await call('POST', '/api/complaints/submit', alex, {
      ...sparkComplaint,
      category: 'Electricity',
      aiAnalysis: { isAiFallback: false, conciseSummary: 'FORGED', suggestedCategory: 'Electricity' }
    });
    assert(forged.status === 201 && forged.json.ticket.aiAnalysis === undefined, 'Client-supplied aiAnalysis is not stored');
    assert(!('duplicateWarnings' in forged.json.ticket) && !('duplicateWarnings' in forged.json), 'Submit response to a student omits duplicate warnings');

    // Staff still see the duplicate warnings on that ticket
    const staffView = await call('GET', `/api/tickets/${forged.json.ticket.id}`, staffToken);
    assert(staffView.json.ticket.duplicateWarnings?.some((d: any) => d.ticketId === 'CC-1002'), 'Staff view keeps duplicate warnings for review');

    // Analysis ids are bound to the user and single-use
    const stolen = await call('POST', '/api/complaints/submit', priya, { ...sparkComplaint, category: 'Electricity', analysisId: alexAnalyze.json.analysisId });
    assert(stolen.status === 201 && stolen.json.ticket.aiAnalysis === undefined, "Another user's analysisId is not attached");
    const own = await call('POST', '/api/complaints/submit', alex, { ...sparkComplaint, category: 'Electricity', analysisId: alexAnalyze.json.analysisId });
    assert(own.json.ticket.aiAnalysis?.isAiFallback === true, "Server's own analysis (correctly labelled as fallback) is attached");
    const reused = await call('POST', '/api/complaints/submit', alex, { ...sparkComplaint, category: 'Electricity', analysisId: alexAnalyze.json.analysisId });
    assert(reused.json.ticket.aiAnalysis === undefined, 'An analysisId can be used only once');
    assert(new Set([forged, own, reused].map((r) => r.json.ticket.id)).size === 3, 'Each submission gets its own ticket ID');

    // Ticket existence is not revealed
    const otherTicket = await call('GET', '/api/tickets/CC-1002', alex);
    const missingTicket = await call('GET', '/api/tickets/CC-999999', alex);
    assert(otherTicket.status === 404 && missingTicket.status === 404, "Another student's ticket returns 404, like a missing one");
    assert(otherTicket.json.error === missingTicket.json.error, 'Both cases return the same message');

    const alexList = await call('GET', '/api/tickets', alex);
    assert(
      alexList.json.tickets.every((t: any) => t.studentId !== undefined && !('internalNotes' in t) && !('duplicateWarnings' in t)),
      'Student ticket list contains no internal notes or duplicate data'
    );

    // Health and storage
    const health = await call('GET', '/api/health');
    assert(!JSON.stringify(health.json).includes(TEST_DATA_DIR.replace(/\\/g, '\\\\')) && health.json.storage.storageFile === undefined, 'Public health check does not reveal the storage path');
    assert(health.json.gemini.configured === false && health.json.demoMode === true, 'Health reports real AI configuration and demo mode');
    assert((await call('GET', '/api/storage/status', alex)).status === 403, 'Storage status is admin-only');
    assert((await call('GET', '/api/nope', alex)).status === 404, 'Unknown API route returns 404 JSON');

    console.log('\nTest Suite 5: Admin staff management rules');

    assert((await call('PATCH', '/api/admin/staff/user-student-1', admin, { role: 'admin' })).status === 404, 'Admin cannot promote a student account via staff PATCH');
    assert((await call('PATCH', '/api/admin/staff/user-staff-1', admin, { role: 'superuser' })).status === 400, 'Unknown role is rejected');
    assert((await call('PATCH', '/api/admin/staff/user-staff-1', admin, { isActive: 'no' })).status === 400, 'Non-boolean isActive is rejected');
    assert((await call('PATCH', '/api/admin/staff/user-staff-1', admin, { department: 'Space Agency' })).status === 400, 'Unknown department is rejected');
    assert((await call('PATCH', '/api/admin/staff/user-admin-1', admin, { role: 'staff' })).status === 403, 'Admin cannot demote themselves');
    assert((await call('PATCH', '/api/admin/staff/user-admin-1', admin, { isActive: false })).status === 403, 'Admin cannot suspend themselves');
    assert((await call('PATCH', '/api/admin/staff/user-staff-1', staffToken, { role: 'admin' })).status === 403, 'Staff cannot grant themselves admin');

    const shortPw = await call('POST', '/api/admin/staff', admin, { name: 'T', email: 't@campus.edu', password: 'short', department: 'Plumbing Maintenance Department' });
    assert(shortPw.status === 400, 'Staff account with a password under 12 characters is rejected');

    const created = await call('POST', '/api/admin/staff', admin, {
      name: 'Temp Staff',
      email: 'temp.staff@campus.edu',
      password: 'temporary-staff-pass',
      department: 'Plumbing Maintenance Department'
    });
    assert(created.status === 201, 'Admin can create a staff account');
    const tempToken = await login('temp.staff@campus.edu', 'temporary-staff-pass');
    assert((await call('GET', '/api/auth/me', tempToken)).status === 200, 'New staff account can sign in');
    await call('PATCH', `/api/admin/staff/${created.json.staff.id}`, admin, { isActive: false });
    assert((await call('GET', '/api/auth/me', tempToken)).status === 401, 'Suspending an account revokes its existing session');
  } finally {
    server.close();
  }
}

async function main() {
  console.log('\n======================================================');
  console.log('🧪 Starting CampusConnect Security & Honesty Tests');
  console.log('======================================================\n');

  await runStoreTests();
  await runGeminiTests();
  await runHttpTests();
  setAiClientForTesting(undefined);

  console.log('\n======================================================');
  console.log(`📊 Security & Honesty Suite Complete: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
