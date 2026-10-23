/**
 * End-to-end tests (real Express routes, temp data dir) for profiles, emergencies,
 * responders, Gemini intake (MOCKED client), Other category, idempotent submission,
 * clustering, proof of fix, SLA escalation, insights, Campus Pulse, and role checks.
 *
 * Notification provider and Gemini are mocked; no external service is contacted.
 */
import './testEnv.js';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AddressInfo } from 'net';
import { TEST_DATA_DIR } from './testEnv.js';
import { createApiApp } from '../../server.js';
import { setAiClientForTesting } from './geminiService.js';
import { notificationStore, setNotificationProviderForTesting, NotificationProvider, OutboundMessage } from './notificationService.js';
import { runSchedulerTick } from './scheduler.js';
import { UserStore } from './userStore.js';

let passed = 0;
let failed = 0;
function assert(condition: boolean, name: string, detail?: unknown) {
  if (condition) {
    console.log(`  ✓ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${name}${detail !== undefined ? ` - ${JSON.stringify(detail)}` : ''}`);
    failed++;
  }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(64)]).toString('base64');
const JPEG_BYTES_AS_PNG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(64)]).toString('base64');

let base = '';
async function call(method: string, url: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(base + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const type = res.headers.get('content-type') || '';
  const json: any = type.includes('json') ? await res.json().catch(() => null) : null;
  return { status: res.status, json, type };
}
const login = async (email: string, password: string) => (await call('POST', '/api/auth/login', undefined, { email, password })).json?.token as string;
const register = async (name: string, email: string) => (await call('POST', '/api/auth/register', undefined, { name, email, password: 'student-pass-123' })).json?.token as string;
const uuid = () => crypto.randomUUID();

async function main() {
  console.log('\n🧪 CampusConnect Feature Workflow Tests (mocked Gemini + mocked notifications)\n');
  setAiClientForTesting(null);
  setNotificationProviderForTesting(null);
  const server = createApiApp().listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    const admin = await login('admin@campus.edu', 'AdminPass2026!');
    const plumberStaff = await login('carlos.rivera@campus.edu', 'StaffPass2026!'); // Plumbing dept
    const electricStaff = await login('marcus.vance@campus.edu', 'StaffPass2026!');
    const alex = await login('alex.chen@campus.edu', 'StudentPass2026!');
    const priya = await login('priya.patel@campus.edu', 'StudentPass2026!');
    const medical = await login('medical.desk@campus.edu', 'ResponderPass2026!');
    const security = await login('security.desk@campus.edu', 'ResponderPass2026!');

    // ------------------------------------------------------------------
    console.log('Suite 1: Student profile');
    let r = await call('GET', '/api/profile', alex);
    assert(r.status === 200 && r.json.isComplete === false, 'New profile is reported incomplete');
    r = await call('PUT', '/api/profile', alex, { fullName: 'Alex Chen', phone: '12', collegeEmail: 'bad' });
    assert(r.status === 400 && r.json.fieldErrors?.phone && r.json.fieldErrors?.collegeEmail, 'Invalid phone/email rejected with field errors', r.json);
    r = await call('PUT', '/api/profile', alex, {
      fullName: 'Alex Chen', studentId: '2023CS101', phone: '+91 98765 43210', collegeEmail: 'alex.chen@campus.edu',
      department: 'B.Tech CSE', yearOrSemester: 'Year 2', campus: 'Main', livesInHostel: true, building: 'Hostel A', floor: '3', room: '312',
      userId: 'user-student-2', id: 'user-student-2' // must be ignored
    });
    assert(r.status === 200 && r.json.isComplete === true, 'Complete profile saves');
    const priyaProfile = await call('GET', '/api/profile', priya);
    assert(priyaProfile.json.profile === null, 'Client-supplied user id cannot write another student\'s profile');
    r = await call('PUT', '/api/profile', priya, { fullName: 'Priya', livesInHostel: true });
    assert(r.status === 400 && r.json.fieldErrors?.building, 'Hostel residents must give a building');
    r = await call('PUT', '/api/profile', priya, { fullName: 'Priya Patel', livesInHostel: false, phone: '+91 91234 56789' });
    assert(r.status === 200 && r.json.isComplete === false && r.json.missingFields.includes('studentId'), 'Partial profile saves and lists missing fields (no hostel needed)');
    await call('POST', '/api/auth/logout', alex);
    const alex2 = await login('alex.chen@campus.edu', 'StudentPass2026!');
    r = await call('GET', '/api/profile', alex2);
    assert(r.json.profile?.room === '312', 'Profile persists after logout/login (new session)');
    const reloaded = new UserStore();
    assert(reloaded.getProfile('user-student-1')?.studentId === '2023CS101', 'Profile persists after a store reload (application restart)');
    assert((await call('GET', '/api/profile', plumberStaff)).status === 403, 'Staff cannot use the student profile endpoint');

    // ------------------------------------------------------------------
    console.log('\nSuite 2: Emergency reporting');
    const req1 = uuid();
    r = await call('POST', '/api/emergencies', alex2, {
      clientRequestId: req1,
      type: 'medical',
      location: { gpsStatus: 'granted', gps: { latitude: 28.6, longitude: 77.2, accuracyMeters: 15, capturedAt: new Date().toISOString() } },
      reporter: { name: 'Forged Name', phone: '000' } // must be ignored
    });
    assert(r.status === 201 && r.json.created, 'Emergency created immediately');
    const em1 = r.json.incident;
    assert(em1.alertState === 'Alerting not configured', 'Unconfigured alerting is reported honestly', em1.alertState);
    assert(em1.location.building === 'Hostel A' && em1.location.room === '312', 'Location autofilled from the saved profile');
    const repeat = await Promise.all([1, 2, 3].map(() => call('POST', '/api/emergencies', alex2, { clientRequestId: req1, type: 'medical', location: {} })));
    assert(repeat.every((x) => x.status === 200 && x.json.incident.id === em1.id && !x.json.created), 'Rapid repeated taps / retries return the same incident');
    r = await call('POST', '/api/emergencies', alex2, { clientRequestId: uuid(), type: 'medical', location: {} });
    assert(r.json.possibleDuplicate === true && r.json.incident.id === em1.id, 'A second report moments later asks for confirmation');
    r = await call('POST', '/api/emergencies', alex2, { clientRequestId: uuid(), type: 'security', location: { gpsStatus: 'denied' }, confirmNew: true });
    assert(r.status === 201 && r.json.incident.id !== em1.id, 'A confirmed new emergency is created');

    // Student with an incomplete profile and denied GPS can still report
    const sam = await register('Sam Incomplete', 'sam.incomplete@campus.edu');
    r = await call('POST', '/api/emergencies', sam, { clientRequestId: uuid(), type: 'unspecified', location: { gpsStatus: 'denied', details: 'Near the main gate' } });
    assert(r.status === 201 && r.json.incident.location.gpsStatus === 'denied', 'Missing profile + denied GPS does not block submission');
    r = await call('POST', '/api/emergencies', sam, { clientRequestId: uuid(), location: { gpsStatus: 'granted', gps: { latitude: 999, longitude: 0, accuracyMeters: 1, capturedAt: 'x' } } });
    assert(r.status === 400, 'Invalid GPS coordinates are rejected');

    // Privacy
    r = await call('GET', '/api/emergencies/mine', priya);
    assert(r.json.incidents.length === 0, "Students only see their own emergencies");
    assert((await call('GET', '/api/responder/emergencies', plumberStaff)).status === 403, 'Maintenance staff cannot see emergencies');
    assert((await call('GET', '/api/responder/emergencies', alex2)).status === 403, 'Students cannot use the responder view');
    r = await call('GET', '/api/responder/emergencies', medical);
    assert(r.status === 200 && r.json.incidents.length === 0, 'Off-duty, un-notified responder sees no incidents');

    // Configure zones, building, and shifts (all-day, every day)
    const allDay = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '23:59' };
    assert((await call('PUT', '/api/admin/config/zones', admin, { value: [{ id: 'north', name: 'North' }] })).status === 200, 'Admin saves zones');
    r = await call('PUT', '/api/admin/config/buildings', admin, { value: [{ id: 'ha', name: 'Hostel A', campus: 'Main', zoneId: 'north' }, { id: 'lib', name: 'Library', campus: 'Main' }] });
    assert(r.status === 200, 'Admin saves buildings');
    r = await call('PUT', '/api/admin/config/shifts', admin, { value: [{ id: 'x', userId: 'user-staff-2', zoneIds: [], ...allDay }] });
    assert(r.status === 400, 'Shift for a non-responder account is rejected');
    r = await call('PUT', '/api/admin/config/shifts', admin, {
      value: [
        { id: 's-med', userId: 'user-responder-1', zoneIds: ['north'], ...allDay, isBackup: false },
        { id: 's-sec', userId: 'user-responder-2', zoneIds: ['north'], ...allDay, isBackup: true }
      ]
    });
    assert(r.status === 200, 'Admin saves responder shifts');
    await call('PATCH', '/api/admin/staff/user-responder-1', admin, { phone: '+91 90000 00001' });
    await call('PATCH', '/api/admin/staff/user-responder-2', admin, { phone: '+91 90000 00002' });

    // Provider that fails
    const sent: OutboundMessage[] = [];
    const failing: NotificationProvider = { name: 'webhook', send: async (m) => { sent.push(m); return { status: 'failed', error: 'Provider responded 500', retryable: false }; } };
    setNotificationProviderForTesting(failing);
    const bob = await register('Bob Hostel', 'bob.hostel@campus.edu');
    await call('PUT', '/api/profile', bob, { fullName: 'Bob Hostel', livesInHostel: true, building: 'Hostel A', phone: '+91 93333 33333' });
    r = await call('POST', '/api/emergencies', bob, { clientRequestId: uuid(), type: 'medical', location: {} });
    await notificationStore.settle();
    const failState = (await call('GET', '/api/emergencies/mine', bob)).json.incidents[0];
    assert(sent.length === 1 && sent[0].recipient.id === 'user-responder-1', 'Only the on-duty primary responder for the zone is alerted', sent.map((m) => m.recipient.id));
    assert(failState.alertState === 'Delivery failed', 'Provider failure shows "Delivery failed"', failState.alertState);

    // Provider that accepts, then a signed receipt confirms delivery
    const accepted: OutboundMessage[] = [];
    setNotificationProviderForTesting({ name: 'webhook', send: async (m) => { accepted.push(m); return { status: 'accepted', providerMessageId: `msg-${accepted.length}` }; } });
    const cara = await register('Cara Hostel', 'cara.hostel@campus.edu');
    await call('PUT', '/api/profile', cara, { fullName: 'Cara Hostel', livesInHostel: true, building: 'Hostel A' });
    r = await call('POST', '/api/emergencies', cara, { clientRequestId: uuid(), type: 'medical', location: {} });
    const emCara = r.json.incident.id;
    await notificationStore.settle();
    let caraView = (await call('GET', '/api/emergencies/mine', cara)).json.incidents[0];
    assert(caraView.alertState === 'Awaiting acknowledgement' && /not yet confirmed/.test(caraView.alertDetail), 'Accepted (unconfirmed) is not presented as delivered', caraView);

    process.env.NOTIFY_RECEIPT_SECRET = 'receipt-secret';
    const attemptId = notificationStore.listFor(emCara)[0].id;
    const receiptBody = JSON.stringify({ notificationId: attemptId, status: 'delivered' });
    r = await call('POST', '/api/notifications/receipt', undefined, receiptBody, { 'X-CampusConnect-Signature': 'deadbeef' });
    assert(r.status === 401, 'Receipt with a bad signature is rejected');
    const sig = crypto.createHmac('sha256', 'receipt-secret').update(receiptBody).digest('hex');
    r = await call('POST', '/api/notifications/receipt', undefined, receiptBody, { 'X-CampusConnect-Signature': sig });
    assert(r.status === 200, 'Signed delivery receipt accepted');
    caraView = (await call('GET', '/api/emergencies/mine', cara)).json.incidents[0];
    assert(caraView.alertState === 'Alert sent' && /Delivery confirmed for 1/.test(caraView.alertDetail), 'Confirmed delivery shows "Alert sent"', caraView);

    // Escalation by the server-side scheduler, idempotent
    const later = new Date(Date.now() + 121 * 1000);
    const tick1 = await runSchedulerTick(later);
    await notificationStore.settle();
    assert(tick1.emergencies.includes(emCara), 'Unacknowledged emergency escalates after the timeout');
    const backupMsgs = accepted.filter((m) => m.purpose === 'emergency_escalation' && m.subjectId === emCara);
    assert(backupMsgs.length === 1 && backupMsgs[0].recipient.id === 'user-responder-2', 'Escalation alerts the backup responder');
    await runSchedulerTick(later);
    await notificationStore.settle();
    assert(accepted.filter((m) => m.purpose === 'emergency_escalation' && m.subjectId === emCara).length === 1, 'Repeated scheduler ticks do not resend notifications');

    // Responder access and actions
    r = await call('GET', '/api/responder/emergencies', medical);
    assert(r.json.incidents.some((i: any) => i.id === emCara && i.reporter.name === 'Cara Hostel'), 'Notified responder sees incident with reporter details');
    r = await call('POST', `/api/responder/emergencies/${emCara}/acknowledge`, medical);
    assert(r.status === 200 && r.json.incident.acknowledgedBy.id === 'user-responder-1', 'Responder acknowledges');
    caraView = (await call('GET', '/api/emergencies/mine', cara)).json.incidents[0];
    assert(caraView.alertState === 'Acknowledged', 'Student sees "Acknowledged"');
    assert((await call('POST', `/api/responder/emergencies/${emCara}/responding`, security)).json.incident.status === 'responding', 'Second responder marks responding');
    assert((await call('POST', `/api/responder/emergencies/${emCara}/close`, medical, {})).status === 400, 'Closing requires outcome notes');
    assert((await call('POST', `/api/responder/emergencies/${emCara}/close`, medical, { outcome: 'Treated on site' })).json.incident.status === 'closed', 'Responder closes with outcome');
    const rita = await call('POST', '/api/admin/staff', admin, { name: 'Rita Responder', email: 'rita.responder@campus.edu', password: 'responder-pass-1', role: 'responder', responderType: 'medical' });
    const ritaToken = await login('rita.responder@campus.edu', 'responder-pass-1');
    assert(rita.status === 201 && (await call('GET', `/api/responder/emergencies/${emCara}`, ritaToken)).status === 404, 'Responder without duty or alert cannot open the incident');
    setNotificationProviderForTesting(null);

    // ------------------------------------------------------------------
    console.log('\nSuite 3: Gemini complaint intake (MOCKED client)');
    let lastParams: any = null;
    const mockReply = (obj: object) => ({ models: { generateContent: async (p: any) => { lastParams = p; return { text: JSON.stringify(obj) }; } } });
    setAiClientForTesting(mockReply({
      suggestedCategory: 'Plumbing', confidence: 'High', confidenceScore: 0.9, conciseSummary: 'Washroom tap leaking on floor 2 of the Library.',
      missingDetailsIdentified: [], followUpQuestions: [], urgencyAssessment: 'Moderate', detectedLanguage: 'en'
    }));
    r = await call('POST', '/api/complaints/analyze', alex2, { description: 'Tap leaking in room 204 washroom, water on the floor', building: 'Library', location: 'Room 204' });
    assert(r.json.analysis.isAiFallback === false && r.json.analysis.followUpQuestions.length === 0, 'Complete complaint: Gemini result with no follow-ups');

    setAiClientForTesting(mockReply({
      suggestedCategory: 'Plumbing', confidence: 'Medium', confidenceScore: 0.7, conciseSummary: 'Water leak reported; location unclear.',
      missingDetailsIdentified: ['Room number'], followUpQuestions: ['Kis room mein paani tapak raha hai?'], urgencyAssessment: 'Moderate', detectedLanguage: 'hi-en'
    }));
    r = await call('POST', '/api/complaints/analyze', alex2, {
      description: 'Washroom mein nal se paani tapak raha hai', building: 'Library', location: 'washroom',
      imageBase64: `data:image/png;base64,${PNG}`, mimeType: 'image/png'
    });
    const draftId = r.json.analysisId;
    assert(r.json.analysis.followUpQuestions.length === 1 && r.json.analysis.detectedLanguage === 'hi-en', 'Incomplete Hinglish complaint gets a follow-up question');
    assert(lastParams.contents.parts.some((p: any) => p.inlineData?.mimeType === 'image/png'), 'Optional photo is sent to Gemini for analysis');
    assert(/data, not instructions/.test(lastParams.contents.parts.at(-1).text), 'Student text is passed as delimited data');

    r = await call('POST', '/api/complaints/analyze', alex2, {
      description: 'Washroom mein nal se paani tapak raha hai', building: 'Library', location: 'washroom',
      analysisId: draftId, clarifications: { 'Kis room mein paani tapak raha hai?': 'Room 204 ke saamne' }
    });
    assert(r.json.analysisId === draftId, 'Clarification re-analysis keeps the same draft id');
    assert(/Room 204 ke saamne/.test(lastParams.contents.parts.at(-1).text), 'Clarification answers are included in the same draft');
    const beforeCount = (await call('GET', '/api/tickets', admin)).json.total;
    r = await call('POST', '/api/complaints/submit', alex2, {
      description: 'Washroom mein nal se paani tapak raha hai', building: 'Library', location: 'washroom', category: 'Plumbing',
      analysisId: draftId, studentFollowUpAnswers: { 'Kis room mein paani tapak raha hai?': 'Room 204 ke saamne' }, clientSubmissionId: uuid()
    });
    const afterCount = (await call('GET', '/api/tickets', admin)).json.total;
    assert(r.status === 201 && afterCount === beforeCount + 1, 'Clarifications produce exactly one ticket');
    assert(r.json.ticket.rawStudentInput === 'Washroom mein nal se paani tapak raha hai', 'Original complaint text is preserved unchanged');

    setAiClientForTesting(mockReply({ suggestedCategory: 'Carpentry', confidence: 'High', confidenceScore: 0.9, conciseSummary: 'Door hinge broken in hall.', missingDetailsIdentified: [], followUpQuestions: [], urgencyAssessment: 'Routine' }));
    r = await call('POST', '/api/complaints/analyze', alex2, { description: 'Door hinge broken', building: 'Library', location: 'Hall' });
    assert(r.json.analysis.suggestedCategory === 'Other' && r.json.analysis.confidence === 'Low', 'Unknown model category becomes Other with low confidence');
    setAiClientForTesting(mockReply({ suggestedCategory: 'Plumbing', confidence: 'High', conciseSummary: '', missingDetailsIdentified: [], followUpQuestions: [], urgencyAssessment: 'Routine' }));
    r = await call('POST', '/api/complaints/analyze', alex2, { description: 'Tap leaking', building: 'Library', location: 'Hall' });
    assert(r.json.analysis.isAiFallback === true && r.json.analysis.fallbackReason === 'invalid_response', 'Model output without a summary is treated as invalid (fallback)');
    setAiClientForTesting(null);
    r = await call('POST', '/api/complaints/analyze', alex2, { description: 'Bijli nahi aa rahi aur pankha band hai', building: 'Library', location: 'Room 5' });
    assert(r.json.analysis.isAiFallback === true && r.json.analysis.suggestedCategory === 'Electricity', 'Keyword fallback understands Hinglish (Electricity)', r.json.analysis.suggestedCategory);
    r = await call('POST', '/api/complaints/analyze', alex2, { description: 'My laptop charger socket is loose', building: 'Library', location: 'Room 5' });
    assert(r.json.analysis.suggestedCategory === 'Electricity', 'Whole-word matching ("ap" inside "laptop" no longer counts as Internet)', r.json.analysis.suggestedCategory);

    // ------------------------------------------------------------------
    console.log('\nSuite 4: Other category, unique IDs, idempotent submission');
    r = await call('POST', '/api/complaints/submit', alex2, { description: 'Window latch broken', building: 'Library', location: 'Room 9', category: 'Other' });
    assert(r.status === 400, 'Other without a problem title is rejected');
    r = await call('POST', '/api/complaints/submit', alex2, { description: 'Window latch broken', building: 'Library', location: 'Room 9', category: 'Other', problemTitle: 'Broken window latch' });
    assert(r.status === 201 && r.json.ticket.title === 'Broken window latch' && r.json.ticket.problemTitle === 'Broken window latch', 'Other with a title saves and shows the title');
    const subId = uuid();
    const burst = await Promise.all([1, 2, 3, 4, 5].map(() => call('POST', '/api/complaints/submit', alex2, { description: 'Fan not working', building: 'Library', location: 'Room 3', category: 'Electricity', clientSubmissionId: subId })));
    assert(new Set(burst.map((b) => b.json.ticket.id)).size === 1, 'Concurrent retries with one submission id create one ticket', burst.map((b) => b.json?.ticket?.id));
    const ids = await Promise.all([1, 2, 3].map((n) => call('POST', '/api/complaints/submit', alex2, { description: `Separate issue ${n}`, building: 'Library', location: `Room ${n}`, category: 'Cleanliness', clientSubmissionId: uuid() })));
    assert(new Set(ids.map((b) => b.json.ticket.id)).size === 3, 'Independent complaints get unique ticket IDs');

    // ------------------------------------------------------------------
    console.log('\nSuite 5: Recurring-issue clustering (10 in 2 hours)');
    const students: string[] = [];
    for (let i = 0; i < 10; i++) students.push(await register(`Cluster Student ${i}`, `cluster${i}@campus.edu`));
    // Unrelated noise: same category, different building / different issue
    await call('POST', '/api/complaints/submit', students[0], { description: 'Tap leaking badly', building: 'Science Block', location: 'Lab 1', category: 'Plumbing' });
    const clusterTickets: string[] = [];
    for (let i = 0; i < 9; i++) {
      const t = await call('POST', '/api/complaints/submit', students[i], { description: `No water in the taps, paani nahi aa raha (${i})`, building: 'Engineering Hall', location: `Floor 2 washroom`, category: 'Plumbing' });
      clusterTickets.push(t.json.ticket.id);
    }
    // The same student repeating does not count as a new reporter
    for (let k = 0; k < 3; k++) {
      await call('POST', '/api/complaints/submit', students[0], { description: 'Still no water in the taps', building: 'Engineering Hall', location: 'Floor 2 washroom', category: 'Plumbing' });
    }
    let incidents = (await call('GET', '/api/incidents', plumberStaff)).json.incidents.filter((i: any) => i.source === 'auto_cluster');
    assert(incidents.length === 0, '9 distinct reporters (plus repeats) do not create a cluster', incidents.length);
    const t10 = await call('POST', '/api/complaints/submit', students[9], { description: 'Water supply stopped in washroom taps', building: 'Engineering Hall', location: 'Floor 2', category: 'Plumbing' });
    incidents = (await call('GET', '/api/incidents', plumberStaff)).json.incidents.filter((i: any) => i.source === 'auto_cluster');
    const cluster = incidents[0];
    assert(incidents.length === 1 && cluster.distinctReporters === 10, 'The 10th distinct reporter creates a cluster', incidents);
    assert(cluster.priority === 'High' && /at least 10/.test(cluster.priorityReason), 'Cluster is HIGH with an explanation');
    const linked = (await call('GET', `/api/tickets/${t10.json.ticket.id}`, plumberStaff)).json.ticket;
    assert(['High', 'Critical'].includes(linked.priorityAssessment.level) && linked.incidentIds.includes(cluster.id), 'Linked tickets are raised to at least High and keep their own ID');
    const ownView = (await call('GET', `/api/tickets/${clusterTickets[1]}`, students[1])).json.ticket;
    assert(ownView.studentId && !('incidentIds' in ownView), 'Student still sees their own ticket (without other students\' links)');
    const noise = (await call('GET', '/api/tickets?query=Science%20Block', plumberStaff)).json.tickets[0];
    assert(!cluster.ticketIds.includes(noise.id), 'Same category in another building is not clustered');
    r = await call('POST', `/api/incidents/${cluster.id}/unlink`, plumberStaff, { ticketId: clusterTickets[0], note: 'Different washroom' });
    assert(r.status === 200 && !r.json.incident.ticketIds.includes(clusterTickets[0]), 'Staff can unlink a wrongly grouped ticket');
    const audit = (await call('GET', `/api/admin/audit?targetType=incident&targetId=${cluster.id}`, admin)).json.entries;
    assert(audit.some((e: any) => e.action === 'incident.ticket_unlinked'), 'Unlinking is recorded in the audit history');
    r = await call('POST', `/api/incidents/${cluster.id}/status`, plumberStaff, { status: 'dismissed', note: 'Coincidence' });
    assert(r.json.incident.status === 'dismissed', 'Staff can dismiss a grouping');
    const stillOpen = (await call('GET', `/api/tickets/${t10.json.ticket.id}`, plumberStaff)).json.ticket;
    assert(stillOpen.status === 'Submitted' && stillOpen.incidentIds.length === 0, 'Dismissal leaves tickets open and unmerged');

    // ------------------------------------------------------------------
    console.log('\nSuite 6: Proof of fix');
    const pt = (await call('POST', '/api/complaints/submit', alex2, { description: 'Basin pipe dripping', building: 'Library', location: 'Room 11', category: 'Plumbing', clientSubmissionId: uuid() })).json.ticket.id;
    await call('POST', `/api/tickets/${pt}/status`, plumberStaff, { status: 'Under Review' });
    r = await call('POST', `/api/tickets/${pt}/status`, plumberStaff, { status: 'Resolved' });
    assert(r.status === 400 && /proof of fix/i.test(r.json.error), 'Resolved is blocked without proof');
    r = await call('POST', `/api/tickets/${pt}/resolution-proof`, electricStaff, { summary: 'Replaced the washer', imageBase64: PNG, mimeType: 'image/png' });
    assert(r.status === 403, 'Staff from another department cannot upload proof');
    r = await call('POST', `/api/tickets/${pt}/resolution-proof`, plumberStaff, { summary: 'Replaced the washer', imageBase64: JPEG_BYTES_AS_PNG, mimeType: 'image/png' });
    assert(r.status === 400, 'Mismatched file content is rejected');
    r = await call('POST', `/api/tickets/${pt}/resolution-proof`, plumberStaff, { summary: 'Replaced the washer', imageBase64: '', mimeType: 'image/png' });
    assert(r.status === 400, 'Empty/failed upload is rejected');
    r = await call('POST', `/api/tickets/${pt}/resolution-proof`, plumberStaff, { summary: 'short', imageBase64: PNG, mimeType: 'image/png' });
    assert(r.status === 400, 'A meaningful summary is required');
    r = await call('POST', `/api/tickets/${pt}/resolution-proof`, alex2, { summary: 'Replaced the washer', imageBase64: PNG, mimeType: 'image/png' });
    assert(r.status === 403, 'Students cannot upload proof');
    r = await call('POST', `/api/tickets/${pt}/resolution-proof`, plumberStaff, { summary: 'Replaced the washer and dried the floor', imageBase64: PNG, mimeType: 'image/png' });
    const proof = r.json.ticket.resolutionProofs[0];
    assert(r.status === 201 && proof.uploadedBy && proof.sha256, 'Valid proof is stored with uploader and checksum');
    assert(fs.existsSync(path.join(TEST_DATA_DIR, 'evidence', `${proof.id}.png`)), 'Evidence file stored in the private data directory');
    r = await call('POST', `/api/tickets/${pt}/status`, plumberStaff, { status: 'Resolved', notes: 'Fixed' });
    assert(r.status === 200 && r.json.ticket.status === 'Resolved', 'Resolved succeeds with proof');
    const ev = await fetch(`${base}/api/tickets/${pt}/evidence/${proof.id}`, { headers: { Authorization: `Bearer ${alex2}` } });
    assert(ev.status === 200 && ev.headers.get('content-type') === 'image/png' && /no-store/.test(ev.headers.get('cache-control') || ''), 'Owner can view evidence (private, no-store)');
    assert((await fetch(`${base}/api/tickets/${pt}/evidence/${proof.id}`, { headers: { Authorization: `Bearer ${priya}` } })).status === 404, "Another student cannot view the evidence");
    assert((await fetch(`${base}/api/tickets/${pt}/evidence/${proof.id}`)).status === 401, 'Anonymous evidence access is refused');
    r = await call('POST', `/api/tickets/${pt}/reopen-request`, priya, { reason: 'Not my ticket but broken' });
    assert(r.status === 404, 'Only the owner can report a failed repair');
    r = await call('POST', `/api/tickets/${pt}/reopen-request`, alex2, { reason: 'Still dripping after one day' });
    assert(r.status === 200 && r.json.ticket.status === 'Under Review', 'Owner reports failed repair; ticket goes back to review');
    const staffAfter = (await call('GET', `/api/tickets/${pt}`, plumberStaff)).json.ticket;
    assert(staffAfter.resolutionProofs.length === 1 && staffAfter.resolutionProofs[0].superseded === true, 'Old evidence is kept but no longer counts');
    assert((await call('POST', `/api/tickets/${pt}/status`, plumberStaff, { status: 'Resolved' })).status === 400, 'Resolving again requires new proof');
    assert(staffAfter.statusHistory.some((h: any) => /unsuccessful/.test(h.notes)), 'Reopen request is in the ticket history');

    // ------------------------------------------------------------------
    console.log('\nSuite 7: Priority override, SLA escalation, ETA');
    const st = (await call('POST', '/api/complaints/submit', alex2, { description: 'Drain slow', building: 'Library', location: 'Room 12', category: 'Plumbing', clientSubmissionId: uuid() })).json.ticket.id;
    assert((await call('POST', `/api/tickets/${st}/priority-override`, plumberStaff, { level: 'Critical' })).status === 400, 'Override needs a reason');
    r = await call('POST', `/api/tickets/${st}/priority-override`, plumberStaff, { level: 'Critical', reason: 'Exam hall next door tomorrow' });
    const deadline = Date.parse(r.json.ticket.slaDeadline);
    assert(r.json.ticket.priorityOverride.level === 'Critical' && deadline - Date.parse(r.json.ticket.createdAt) === 4 * 3600 * 1000, 'Override recorded and SLA deadline follows the Critical target (4h)');
    assert((await call('GET', `/api/tickets/${st}`, alex2)).json.ticket.priorityOverride === undefined, 'Override reason is not shown to students');
    let tick = await runSchedulerTick(new Date(deadline + 60 * 1000));
    let sTicket = (await call('GET', `/api/tickets/${st}`, plumberStaff)).json.ticket;
    assert(tick.slaEscalations.includes(`${st}:L1`) && sTicket.slaEscalations[0].nextAuthority.includes('Plumbing'), 'Overdue ticket escalates to department staff (level 1)');
    assert(sTicket.priorityAssessment.factors.some((f: any) => f.factor === 'Overdue'), 'Overdue is a priority factor');
    tick = await runSchedulerTick(new Date(deadline + 60 * 1000));
    assert(!tick.slaEscalations.includes(`${st}:L1`), 'Escalation is not repeated on the next tick');
    tick = await runSchedulerTick(new Date(deadline + 3 * 3600 * 1000));
    sTicket = (await call('GET', `/api/tickets/${st}`, plumberStaff)).json.ticket;
    assert(tick.slaEscalations.includes(`${st}:L2`) && sTicket.slaEscalations.length === 2 && sTicket.slaEscalations[1].nextAuthority.startsWith('Administrators'), 'Still overdue later escalates to administrators (level 2)');
    assert(sTicket.slaEscalations.every((e: any) => e.previousOwner && e.reason && e.at), 'Escalations record previous owner, reason, and time');
    r = await call('POST', `/api/tickets/${st}/eta`, plumberStaff, { earliest: new Date(Date.now() + 3600e3).toISOString(), latest: new Date(Date.now() + 7200e3).toISOString() });
    assert(r.status === 200, 'Staff set an estimate window');
    r = await call('POST', `/api/tickets/${st}/eta`, plumberStaff, { earliest: new Date(Date.now() + 3600e3).toISOString(), latest: new Date(Date.now() + 9e6).toISOString() });
    assert(r.status === 400, 'Changing the estimate requires a reason');
    r = await call('GET', `/api/tickets/${st}/timing`, alex2);
    assert(r.status === 200 && /Not enough history|resolved/.test(r.json.historical.note) && /not a guarantee/.test(r.json.slaNote), 'Timing is explained honestly to the student');
    r = await call('POST', `/api/tickets/${st}/status`, plumberStaff, { status: 'Resolved' });
    assert(r.status === 400, 'Invalid transition (Submitted -> Resolved) is rejected');
    r = await call('POST', `/api/tickets/${st}/assign`, plumberStaff, { department: 'Plumbing Maintenance Department', assignedToId: 'user-staff-3' });
    assert(r.status === 400, 'Assignee from another department is rejected');
    r = await call('POST', `/api/tickets/${st}/assign`, plumberStaff, { department: 'Plumbing Maintenance Department', assignedToId: 'user-staff-2' });
    assert(r.status === 200 && r.json.ticket.assignment.assignedToId === 'user-staff-2', 'Assignment to a real department staff account works');

    // ------------------------------------------------------------------
    console.log('\nSuite 8: Readiness, repeat offenders, workarounds, waste');
    r = await call('GET', '/api/insights/readiness', plumberStaff);
    assert(r.json.configured === false, 'Readiness reports "not configured" without room data');
    await call('PUT', '/api/admin/config/assets', admin, { value: [{ id: 'PRJ-1', name: 'Projector LH1', type: 'projector', building: 'Library' }, { id: 'FAN-1', name: 'Fan LH1', type: 'fan', building: 'Library' }] });
    r = await call('PUT', '/api/admin/config/rooms', admin, { value: [{ id: 'LH1', name: 'Lecture Hall 1', building: 'Library', assetIds: ['PRJ-1', 'FAN-1'] }] });
    assert(r.status === 200, 'Admin configures assets and rooms');
    r = await call('GET', '/api/insights/readiness', plumberStaff);
    assert(r.json.rooms[0].available === false, 'Room with no checks shows readiness unavailable (no fake score)');
    await call('POST', '/api/rooms/LH1/checks', plumberStaff, { assetId: 'PRJ-1', result: 'working' });
    r = await call('POST', '/api/rooms/LH1/checks', plumberStaff, { assetId: 'FAN-1', result: 'working' });
    assert(r.json.readiness.available === true && r.json.readiness.score === 100, 'Verified checks produce a score with explanation');
    for (let i = 0; i < 3; i++) {
      await call('POST', '/api/complaints/submit', alex2, { description: `Projector flickering ${i}`, building: 'Library', location: 'Lecture Hall 1', category: 'Electricity', assetId: 'PRJ-1', clientSubmissionId: uuid() });
    }
    r = await call('GET', '/api/insights/repeat-offenders', plumberStaff);
    assert(r.json.offenders[0]?.assetId === 'PRJ-1' && r.json.offenders[0].hypotheses.every((h: string) => h.startsWith('Unverified')), 'Repeat offender detected with unverified hypotheses');
    r = await call('GET', '/api/insights/readiness', plumberStaff);
    assert(r.json.rooms[0].items.find((i: any) => i.assetId === 'PRJ-1').state === 'known_issue', 'Open ticket on an asset is a known issue');
    await call('PUT', '/api/admin/config/facilities', admin, { value: [{ id: 'ws1', name: 'Water station B', type: 'water_station', building: 'Engineering Hall', status: 'available' }] });
    const wt = (await call('POST', '/api/complaints/submit', alex2, { description: 'Water cooler broken', building: 'Library', location: 'Floor 1', category: 'Plumbing', clientSubmissionId: uuid() })).json.ticket.id;
    r = await call('GET', `/api/tickets/${wt}/workarounds`, alex2);
    assert(r.json.suggestions[0].availability === 'unknown' && /No confirmed workaround/.test(r.json.message), 'Unverified facility is shown as unknown, not available');
    await call('POST', '/api/facilities/ws1/verify', plumberStaff, { status: 'available' });
    r = await call('GET', `/api/tickets/${wt}/workarounds`, alex2);
    assert(r.json.suggestions[0].availability === 'available', 'Staff-verified facility is suggested as available');
    r = await call('GET', '/api/insights/waste', plumberStaff);
    assert(r.json.signals.some((s: any) => s.kind === 'water' && s.verification === 'unverified'), 'Leak reports appear as unverified waste signals');
    r = await call('GET', '/api/insights/hotspots', plumberStaff);
    assert(r.json.hotspots.some((h: any) => h.building === 'Unrecognised location'), 'Tickets in unconfigured buildings are labelled unrecognised');

    // ------------------------------------------------------------------
    console.log('\nSuite 9: Campus Pulse privacy');
    for (let i = 0; i < 4; i++) await call('POST', '/api/pulse', undefined, { topic: 'Wi-Fi', building: 'Library', message: 'Slow wifi' }, { 'X-Forwarded-For': `10.0.0.${i}` });
    r = await call('GET', '/api/pulse/summary', alex2);
    assert(r.json.summary.groups.length === 0 && r.json.summary.totalReports === 0, 'Groups below the minimum size are suppressed (even totals)');
    await call('POST', '/api/pulse', alex2, { topic: 'Wi-Fi', building: 'Library' });
    r = await call('GET', '/api/pulse/summary', alex2);
    assert(r.json.summary.groups[0]?.count === 5 && !JSON.stringify(r.json).includes('Slow wifi'), 'Group shown at threshold without message text');
    const pulseFile = fs.readFileSync(path.join(TEST_DATA_DIR, 'pulse.json'), 'utf8');
    assert(!/user-student|alex|127\.0\.0\.1|10\.0\.0/.test(pulseFile), 'Stored feedback has no account or IP');
    assert((await call('POST', '/api/pulse', undefined, { topic: 'Wi-Fi', building: 'Nowhere' })).status === 400, 'Only configured buildings are accepted');
    assert((await call('GET', '/api/admin/pulse/raw', plumberStaff)).status === 403, 'Raw feedback is admin-only');
    let limited = 0;
    for (let i = 0; i < 6; i++) if ((await call('POST', '/api/pulse', undefined, { topic: 'Water', building: 'Library' })).status === 429) limited++;
    assert(limited >= 1, 'Repeated submissions are rate limited');

    // ------------------------------------------------------------------
    console.log('\nSuite 10: Role restrictions');
    assert((await call('GET', '/api/admin/config', plumberStaff)).status === 403, 'Staff cannot read admin configuration');
    assert((await call('PUT', '/api/admin/config/routing', alex2, { value: {} })).status === 403, 'Students cannot change configuration');
    assert((await call('GET', '/api/admin/audit', medical)).status === 403, 'Responders cannot read the audit log');
    assert((await call('GET', '/api/tickets', medical)).status === 200 && (await call('GET', '/api/tickets', medical)).json.tickets.length === 0, 'Responders see no maintenance tickets');
    assert((await call('POST', `/api/tickets/${st}/priority-override`, medical, { level: 'Low', reason: 'responder attempt' })).status === 403, 'Responders cannot change ticket priority');
    assert((await call('GET', '/api/incidents', alex2)).status === 403, 'Students cannot read shared incidents');
    assert((await call('POST', '/api/complaints/submit', plumberStaff, { description: 'x', building: 'x', location: 'x', category: 'Plumbing' })).status === 403, 'Staff cannot file complaints as students');
    assert((await call('PATCH', '/api/admin/staff/user-responder-1', medical, { role: 'admin' })).status === 403, 'Responder cannot grant themselves admin');
    assert((await call('PUT', '/api/admin/config/sla', admin, { value: { default: { Low: 0 } } })).status === 400, 'Invalid SLA configuration is rejected');
    assert((await call('PUT', '/api/admin/config/nope', admin, { value: 1 })).status === 404, 'Unknown configuration section is rejected');
  } finally {
    server.close();
    setAiClientForTesting(undefined);
    setNotificationProviderForTesting(undefined);
  }

  console.log(`\n📊 Feature Workflow Suite Complete: ${passed} Passed, ${failed} Failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Test runner crashed:', err);
  process.exit(1);
});
