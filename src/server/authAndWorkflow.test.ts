/**
 * Automated Test Suite for CampusConnect Authentication, Authorization,
 * IDOR Protection, and Workflow State Transitions.
 */

import './testEnv.js';
import { userStore } from './userStore.js';
import { ticketRepository } from './ticketStore.js';
import { User, VALID_STATUS_TRANSITIONS } from '../shared/types.js';

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

async function runAuthAndWorkflowTests() {
  console.log('\n======================================================');
  console.log('🧪 Starting CampusConnect Auth & Workflow Security Tests');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  // TEST SUITE 1: Authentication & Password Hashing
  // --------------------------------------------------------------------------
  console.log('Test Suite 1: Authentication & Password Hashing');

  // Valid student login
  const studentAuth = userStore.authenticate('alex.chen@campus.edu', 'StudentPass2026!');
  assert(studentAuth !== null, 'Valid student credentials authenticate successfully');
  assert(studentAuth?.user.role === 'student', 'Student account has role "student"');
  assert(typeof studentAuth?.token === 'string' && studentAuth.token.length >= 32, 'Session token generated with sufficient entropy');

  // Invalid password
  const badAuth = userStore.authenticate('alex.chen@campus.edu', 'WrongPassword123');
  assert(badAuth === null, 'Incorrect password correctly rejected');

  // Non-existent email
  const ghostAuth = userStore.authenticate('nobody@campus.edu', 'AnyPass123');
  assert(ghostAuth === null, 'Non-existent account correctly rejected');

  // Staff login
  const staffAuth = userStore.authenticate('sarah.supervisor@campus.edu', 'StaffPass2026!');
  assert(staffAuth !== null, 'Staff credentials authenticate successfully');
  assert(staffAuth?.user.role === 'staff', 'Staff account has role "staff"');
  assert(staffAuth?.user.department === 'Plumbing Maintenance Department', 'Staff account has assigned department');

  // Admin login
  const adminAuth = userStore.authenticate('admin@campus.edu', 'AdminPass2026!');
  assert(adminAuth !== null, 'Admin credentials authenticate successfully');
  assert(adminAuth?.user.role === 'admin', 'Admin account has role "admin"');

  // Session validation
  const sessionUser = userStore.validateSession(studentAuth!.token);
  assert(sessionUser?.id === studentAuth?.user.id, 'Session token validates to correct user');

  const invalidSession = userStore.validateSession('fake-token-xyz-123');
  assert(invalidSession === null, 'Invalid session token returns null');

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Student Ticket Ownership & IDOR Protection
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 2: Student Ticket Ownership & IDOR Protection');

  const studentAlex = studentAuth!.user;
  const studentPriya = userStore.authenticate('priya.patel@campus.edu', 'StudentPass2026!')!.user;

  // CC-1001 was submitted by Alex Chen
  const alexViewOwn = ticketRepository.getByIdForUser('CC-1001', studentAlex);
  assert(alexViewOwn !== null, 'Student can view their own ticket (CC-1001)');

  // Priya attempts to view Alex's ticket (CC-1001) -> IDOR check must block it!
  const priyaViewAlexTicket = ticketRepository.getByIdForUser('CC-1001', studentPriya);
  assert(priyaViewAlexTicket === null, 'Student is blocked from viewing another student\'s ticket (IDOR Prevention)');

  // Staff can view tickets across all students
  const staffView = ticketRepository.getByIdForUser('CC-1001', staffAuth!.user);
  assert(staffView !== null, 'Staff can view student tickets for triage');

  // --------------------------------------------------------------------------
  // TEST SUITE 3: Private Internal Staff Notes Isolation
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 3: Private Internal Staff Notes Isolation');

  // Add internal staff note to CC-1001
  const note = ticketRepository.addInternalNote(
    'CC-1001',
    staffAuth!.user,
    'Confidential test note: Replaced valve seal on west wing riser.'
  );
  assert(note !== null, 'Staff can add internal note to ticket');

  // Staff view contains internal notes
  const staffTicketView = ticketRepository.getByIdForUser('CC-1001', staffAuth!.user) as any;
  assert(Array.isArray(staffTicketView.internalNotes), 'Staff view includes internalNotes array');
  assert(staffTicketView.internalNotes.length > 0, 'Internal note is present in staff response');

  // Student view MUST NOT contain internal notes
  const studentTicketView = ticketRepository.getByIdForUser('CC-1001', studentAlex) as any;
  assert(studentTicketView.internalNotes === undefined, 'Internal notes are completely stripped from student view');

  // --------------------------------------------------------------------------
  // TEST SUITE 4: Validated Workflow State Transitions
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 4: Validated Workflow State Transitions');

  // Create a fresh test ticket in "Submitted" status
  const testTicket = ticketRepository.createTicket({
    description: 'Sink leaking continuously in lab 3',
    location: 'Lab 305',
    building: 'Science & Engineering Complex',
    category: 'Plumbing',
    studentUser: studentAlex
  });

  assert(testTicket.status === 'Submitted', 'New ticket initializes in "Submitted" status');

  // Invalid transition: Submitted -> Resolved directly (must be rejected!)
  const invalidTransition = ticketRepository.updateStatus(testTicket.id, 'Resolved', 'Skipping steps', staffAuth!.user);
  assert(!invalidTransition.success, 'State machine rejects skipping from "Submitted" directly to "Resolved"');
  assert(typeof invalidTransition.error === 'string', 'State machine provides clear error explanation for rejected transition');

  // Valid transition: Submitted -> Under Review
  const validTransition1 = ticketRepository.updateStatus(testTicket.id, 'Under Review', 'Verified on site', staffAuth!.user);
  assert(validTransition1.success, 'Valid transition "Submitted" -> "Under Review" succeeded');

  // Valid transition: Under Review -> Assigned
  const validTransition2 = ticketRepository.updateStatus(testTicket.id, 'Assigned', 'Assigned to plumber', staffAuth!.user);
  assert(validTransition2.success, 'Valid transition "Under Review" -> "Assigned" succeeded');

  // Valid transition: Assigned -> In Progress
  const validTransition3 = ticketRepository.updateStatus(testTicket.id, 'In Progress', 'Work commenced', staffAuth!.user);
  assert(validTransition3.success, 'Valid transition "Assigned" -> "In Progress" succeeded');

  // Proof of fix is required before Resolved
  const withoutProof = ticketRepository.updateStatus(testTicket.id, 'Resolved', 'No proof yet', staffAuth!.user);
  assert(!withoutProof.success && /proof of fix/i.test(withoutProof.error || ''), 'Resolved is blocked until proof of fix is uploaded');
  ticketRepository.addResolutionProof(
    testTicket.id,
    {
      id: 'ev-00000000-0000-4000-8000-000000000000',
      summary: 'Replaced the leaking trap seal',
      uploadedBy: staffAuth!.user.name,
      uploadedById: staffAuth!.user.id,
      uploadedAt: new Date().toISOString(),
      mimeType: 'image/png',
      sizeBytes: 100,
      sha256: 'test'
    },
    staffAuth!.user
  );

  // Valid transition: In Progress -> Resolved
  const validTransition4 = ticketRepository.updateStatus(testTicket.id, 'Resolved', 'Work completed and tested', staffAuth!.user);
  assert(validTransition4.success, 'Valid transition "In Progress" -> "Resolved" succeeded');
  assert(testTicket.resolvedAt !== undefined, 'Ticket records resolution timestamp upon reaching "Resolved"');

  // --------------------------------------------------------------------------
  // TEST SUITE 5: Human Supervised Duplicate Review Policy
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 5: Human Supervised Duplicate Review Policy');

  const reviewed = ticketRepository.reviewDuplicate(
    testTicket.id,
    'confirmed',
    staffAuth!.user,
    'Confirmed identical leak to CC-1001'
  );

  assert(reviewed !== null, 'Staff duplicate review recorded successfully');
  assert(reviewed?.duplicateReviewed === true, 'Duplicate reviewed flag set to true');
  assert(reviewed?.duplicateReviewDecision === 'confirmed', 'Duplicate review decision matches "confirmed"');
  assert(reviewed?.status === 'Resolved', 'Status was not automatically closed or rejected solely due to duplicate review');

  // --------------------------------------------------------------------------
  // SUMMARY
  // --------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(`📊 Auth & Workflow Suite Complete: ${passed} Passed, ${failed} Failed`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAuthAndWorkflowTests().catch((err) => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});
