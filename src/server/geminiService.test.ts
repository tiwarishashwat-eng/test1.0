/**
 * Automated Test Suite for CampusConnect AI Intelligence Features
 * Covers:
 * 1. Category Classification (Strictly 4 categories: Plumbing, Electricity, Cleanliness, Internet Connectivity)
 * 2. Responsible Maintenance Department Routing
 * 3. AI-Generated Concise Problem Summaries
 * 4. Missing Information Identification & Follow-Up Questions
 * 5. Multi-Factor Duplicate Complaint Detection (Text similarity, room numbers, building aliases)
 * 6. Multimodal Image Analysis Input Handling
 * 7. Graceful Fallback & Error Handling (Missing keys, API failures, zero-crash resilience)
 * 8. Staff Reviewability Policy (Advisory warnings only, never auto-rejects)
 */

import './testEnv.js';
import {
  ALLOWED_CATEGORIES,
  analyzeComplaintWithGemini,
  detectDuplicateCandidates,
  heuristicFallbackAnalysis
} from './geminiService.js';
import { CATEGORY_DEPARTMENT_ROUTING, Ticket, TicketCategory } from '../shared/types.js';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `- ${detail}` : ''}`);
    failedTests++;
  }
}

async function runTestSuite() {
  console.log('\n======================================================');
  console.log('🧪 Starting CampusConnect AI Intelligence Test Suite');
  console.log('======================================================\n');

  // --------------------------------------------------------------------------
  // TEST SUITE 1: Category Classification (Strictly 4 Categories)
  // --------------------------------------------------------------------------
  console.log('Test Suite 1: Category Classification (Strict 4-Category Boundary)');

  const plumbingInput = {
    description: 'Faucet dripping water steadily onto counter and floor under washbasin',
    building: 'Science & Engineering Complex',
    location: 'Room 204'
  };
  const plumbingResult = heuristicFallbackAnalysis(plumbingInput);
  assert(plumbingResult.suggestedCategory === 'Plumbing', 'Correctly classifies plumbing issue');
  assert(ALLOWED_CATEGORIES.includes(plumbingResult.suggestedCategory), 'Plumbing is in allowed categories list');

  const electricInput = {
    description: 'Wall outlet in classroom sparked and popped with burning ozone smell, breaker tripped',
    building: 'Main Academic Quad',
    location: 'Hall 101'
  };
  const electricResult = heuristicFallbackAnalysis(electricInput);
  assert(electricResult.suggestedCategory === 'Electricity', 'Correctly classifies electrical issue');
  assert(ALLOWED_CATEGORIES.includes(electricResult.suggestedCategory), 'Electricity is in allowed categories list');

  const cleanInput = {
    description: 'Overflowing garbage bin and sticky juice spilled across main entryway stairs',
    building: 'Student Union Center',
    location: 'Foyer Entrance'
  };
  const cleanResult = heuristicFallbackAnalysis(cleanInput);
  assert(cleanResult.suggestedCategory === 'Cleanliness', 'Correctly classifies cleanliness issue');
  assert(ALLOWED_CATEGORIES.includes(cleanResult.suggestedCategory), 'Cleanliness is in allowed categories list');

  const internetInput = {
    description: 'eduroam Wi-Fi drops connection every two minutes on the entire 3rd floor study desks',
    building: 'University Memorial Library',
    location: '3rd Floor North'
  };
  const internetResult = heuristicFallbackAnalysis(internetInput);
  assert(internetResult.suggestedCategory === 'Internet Connectivity', 'Correctly classifies internet issue');
  assert(ALLOWED_CATEGORIES.includes(internetResult.suggestedCategory), 'Internet Connectivity is in allowed categories list');

  // --------------------------------------------------------------------------
  // TEST SUITE 2: Department Routing
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 2: Responsible Maintenance Department Routing');

  const expectedRoutings: Record<TicketCategory, string> = {
    'Plumbing': 'Plumbing Maintenance Department',
    'Electricity': 'Electrical Systems & Safety Division',
    'Cleanliness': 'Campus Custodial & Sanitation Services',
    'Internet Connectivity': 'IT & Network Infrastructure Team'
  };

  for (const [cat, expectedDept] of Object.entries(expectedRoutings)) {
    const assignedDept = CATEGORY_DEPARTMENT_ROUTING[cat as TicketCategory];
    assert(assignedDept === expectedDept, `Category "${cat}" routes to "${expectedDept}"`);
  }

  assert(
    plumbingResult.recommendedDepartment === 'Plumbing Maintenance Department',
    'Analysis result reflects correct plumbing department'
  );
  assert(
    electricResult.recommendedDepartment === 'Electrical Systems & Safety Division',
    'Analysis result reflects correct electrical division'
  );

  // --------------------------------------------------------------------------
  // TEST SUITE 3: AI-Generated Concise Problem Summaries
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 3: AI-Generated Concise Summaries');

  assert(
    typeof plumbingResult.conciseSummary === 'string' && plumbingResult.conciseSummary.length > 10,
    'Produces non-empty concise summary string'
  );
  assert(
    plumbingResult.conciseSummary.toLowerCase().includes('plumbing') ||
    plumbingResult.conciseSummary.toLowerCase().includes('leak'),
    'Concise summary contains core technical issue terminology'
  );
  assert(
    plumbingResult.conciseSummary.length <= 200,
    'Concise summary adheres to length constraint (< 200 chars)'
  );

  // --------------------------------------------------------------------------
  // TEST SUITE 4: Missing Information & Follow-Up Questions
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 4: Missing Information & Follow-Up Questions');

  const vagueComplaint = {
    description: 'water leak',
    building: '',
    location: ''
  };
  const vagueResult = heuristicFallbackAnalysis(vagueComplaint);
  assert(
    vagueResult.missingDetailsIdentified.length >= 2,
    'Identifies missing building and specific room when omitted',
    `Found ${vagueResult.missingDetailsIdentified.length} missing details`
  );
  assert(
    vagueResult.followUpQuestions.length >= 2,
    'Generates relevant follow-up questions for omitted details',
    `Generated ${vagueResult.followUpQuestions.length} questions`
  );
  assert(
    vagueResult.followUpQuestions.length <= 3,
    'Follow-up questions do not overwhelm student (capped at 3)'
  );

  // --------------------------------------------------------------------------
  // TEST SUITE 5: Multi-Factor Duplicate Complaint Detection
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 5: Multi-Factor Duplicate Complaint Detection');

  const mockExistingTickets: Ticket[] = [
    {
      id: 'CC-1001',
      title: 'Continuous pipe leak under 2nd floor sink',
      description: 'Water is dripping steadily onto the tile floor from the second sink pipe in the west wing washroom. Floor is slippery.',
      rawStudentInput: 'Water dripping under sink in room 204 washroom',
      category: 'Plumbing',
      categorySource: 'student',
      building: 'Science & Engineering Complex',
      location: 'West Wing Men Restroom Room 204',
      studentId: 'user-student-1',
      studentName: 'Alex Chen',
      studentEmail: 'alex.chen@campus.edu',
      status: 'In Progress',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: []
    },
    {
      id: 'CC-1002',
      title: 'Lecture hall 101 power socket sparking',
      description: 'The surge strip plug at desk row 3 sparked when a student plugged in their laptop. Burning ozone smell noticed.',
      rawStudentInput: 'outlet sparking in 101',
      category: 'Electricity',
      categorySource: 'student',
      building: 'Main Academic Quad',
      location: 'Lecture Hall 101',
      studentId: 'user-student-2',
      studentName: 'Priya Patel',
      studentEmail: 'priya.patel@campus.edu',
      status: 'Assigned',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: []
    },
    {
      id: 'CC-1099',
      title: 'Old resolved leak in basement',
      description: 'Resolved basement water leak from last semester',
      rawStudentInput: 'basement pipe fixed',
      category: 'Plumbing',
      categorySource: 'student',
      building: 'Science & Engineering Complex',
      location: 'Basement Room 010',
      studentId: 'user-student-1',
      studentName: 'Alex Chen',
      studentEmail: 'alex.chen@campus.edu',
      status: 'Resolved', // Should be skipped since resolved
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statusHistory: []
    }
  ];

  // A student submits a duplicate about the Room 204 sink leak
  const candidateDuplicate = {
    description: 'Faucet dripping and pipe leaking water on floor in room 204 washroom',
    category: 'Plumbing' as TicketCategory,
    building: 'Science Complex', // Alias for Science & Engineering Complex
    location: 'Restroom 204'
  };

  const detectedDuplicates = detectDuplicateCandidates(candidateDuplicate, mockExistingTickets);
  assert(detectedDuplicates.length > 0, 'Detects duplicate candidate with alias building and room match');
  assert(detectedDuplicates[0]?.ticketId === 'CC-1001', 'Correctly identifies CC-1001 as primary duplicate candidate');
  assert(detectedDuplicates[0]?.similarityScore >= 0.5, 'Computes high similarity score (>= 0.5)');
  assert(detectedDuplicates[0]?.matchReason.includes('building'), 'Match reason explains building match');
  assert(detectedDuplicates[0]?.matchReason.includes('204'), 'Match reason details room number 204 match');

  // Verify resolved ticket CC-1099 is not flagged
  const foundResolved = detectedDuplicates.some(d => d.ticketId === 'CC-1099');
  assert(!foundResolved, 'Resolved tickets are excluded from active duplicate warnings');

  // --------------------------------------------------------------------------
  // TEST SUITE 6: Multimodal Photo Input Handling
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 6: Multimodal Photo Input Handling');

  const photoInput = {
    description: 'Water pooling near baseboard in hallway',
    building: 'Science & Engineering Complex',
    location: '2nd Floor Hallway',
    imageBase64: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD...',
    mimeType: 'image/jpeg'
  };
  const photoResult = heuristicFallbackAnalysis(photoInput);
  assert(
    typeof photoResult.imageObservations === 'string' && photoResult.imageObservations.length > 0,
    'Multimodal inspection field is populated when image is supplied'
  );

  const noPhotoInput = {
    description: 'Water pooling near baseboard in hallway',
    building: 'Science & Engineering Complex',
    location: '2nd Floor Hallway'
  };
  const noPhotoResult = heuristicFallbackAnalysis(noPhotoInput);
  assert(
    noPhotoResult.imageObservations === undefined,
    'Image observation is undefined when no image is supplied'
  );

  // --------------------------------------------------------------------------
  // TEST SUITE 7: Graceful Fallback & Error Resilience
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 7: Graceful Fallback & Resilience');

  // Test analyzeComplaintWithGemini with missing key or fallback
  const asyncResult = await analyzeComplaintWithGemini({
    description: 'Light switch in classroom 302 makes buzzing sound',
    building: 'Main Academic Quad',
    location: 'Room 302'
  });

  assert(Boolean(asyncResult), 'analyzeComplaintWithGemini completes without throwing unhandled exceptions');
  assert(
    ALLOWED_CATEGORIES.includes(asyncResult.suggestedCategory),
    'Async analysis result produces strictly one of 4 allowed categories'
  );
  assert(
    Boolean(asyncResult.recommendedDepartment),
    'Async analysis result produces valid department routing'
  );

  // --------------------------------------------------------------------------
  // TEST SUITE 8: Staff Reviewability Guarantee
  // --------------------------------------------------------------------------
  console.log('\nTest Suite 8: Staff Reviewability Guarantee');

  // Verify that duplicate detection never changes ticket status or mutates tickets
  assert(
    mockExistingTickets[0].status === 'In Progress',
    'Original ticket status remains untouched after duplicate scanning'
  );
  assert(
    detectedDuplicates.every(d => d.similarityScore <= 1.0 && d.similarityScore >= 0.0),
    'Duplicate similarity scores are normalized probabilities between 0.0 and 1.0'
  );

  console.log('\n======================================================');
  console.log(`📊 Test Suite Complete: ${passedTests} Passed, ${failedTests} Failed`);
  console.log('======================================================\n');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
