/**
 * CampusConnect - Production Data Models, User Roles, and API Contracts
 * Enforces strict 4-category classification, role-based access control,
 * audit logging, and human-supervised AI triage workflows.
 */

export const TICKET_CATEGORIES = [
  'Plumbing',
  'Electricity',
  'Cleanliness',
  'Internet Connectivity',
  'Other'
] as const;

export type TicketCategory = typeof TICKET_CATEGORIES[number];

export const TICKET_STATUSES = [
  'Submitted',
  'Under Review',
  'Assigned',
  'In Progress',
  'Resolved'
] as const;

export type TicketStatus = typeof TICKET_STATUSES[number];

export const DEPARTMENTS = [
  'Plumbing Maintenance Department',
  'Electrical Systems & Safety Division',
  'Campus Custodial & Sanitation Services',
  'IT & Network Infrastructure Team',
  'General Facilities Services'
] as const;

export type Department = typeof DEPARTMENTS[number];

/** Default routing; administrators can override it in the configuration store. */
export const CATEGORY_DEPARTMENT_ROUTING: Record<TicketCategory, Department> = {
  'Plumbing': 'Plumbing Maintenance Department',
  'Electricity': 'Electrical Systems & Safety Division',
  'Cleanliness': 'Campus Custodial & Sanitation Services',
  'Internet Connectivity': 'IT & Network Infrastructure Team',
  'Other': 'General Facilities Services'
};

/**
 * Valid workflow state transitions enforced by the backend.
 * Resolved additionally requires proof of fix (see ticketStore.updateStatus).
 */
export const VALID_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  'Submitted': ['Under Review', 'Assigned'],
  'Under Review': ['Assigned', 'In Progress', 'Resolved'],
  'Assigned': ['In Progress', 'Under Review'],
  'In Progress': ['Resolved', 'Assigned', 'Under Review'],
  'Resolved': ['In Progress', 'Under Review'] // reopening or review after a failed repair
};

/**
 * User Roles and Authentication Models
 */
export type UserRole = 'student' | 'staff' | 'admin' | 'responder';
export const USER_ROLES: readonly UserRole[] = ['student', 'staff', 'admin', 'responder'];
export type ResponderType = 'medical' | 'security';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department?: Department; // For staff members
  responderType?: ResponderType; // For responder accounts
  phone?: string; // Contact number used for alerts (staff/responders) or the student's registered phone
  isActive: boolean;
  createdAt: string;
}

/** Student profile, stored server-side on the account record. */
export interface StudentProfile {
  fullName: string;
  studentId: string;
  phone: string;
  collegeEmail: string;
  department: string;
  yearOrSemester: string;
  campus: string;
  livesInHostel: boolean;
  building?: string;
  floor?: string;
  room?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  updatedAt?: string;
}

export interface ProfileResponse {
  success: boolean;
  profile: StudentProfile | null;
  missingFields: (keyof StudentProfile)[];
  isComplete: boolean;
  error?: string;
}

export const PROFILE_REQUIRED_FIELDS: (keyof StudentProfile)[] = [
  'fullName',
  'studentId',
  'phone',
  'collegeEmail',
  'department',
  'yearOrSemester',
  'campus'
];

export interface AuthSession {
  user: User;
  token: string;
}

export interface InternalStaffNote {
  id: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

export interface StatusHistoryEntry {
  id: string;
  ticketId: string;
  fromStatus?: TicketStatus;
  toStatus: TicketStatus;
  changedAt: string; // ISO 8601 string
  changedBy: string; // User name or role
  changedById?: string;
  notes?: string;
}

export interface Assignment {
  department: Department;
  assignedTo?: string; // Technician or officer name
  assignedToId?: string; // User ID if matched to staff account
  assignedAt: string;
  assignedBy: string;
  assignedById?: string;
  // Legacy: priority chosen at assignment time (older records). New tickets use the priority engine.
  priority?: 'Low' | 'Medium' | 'High' | 'Emergency';
  notes?: string;
}

export interface AIAnalysis {
  suggestedCategory: TicketCategory;
  confidence: 'High' | 'Medium' | 'Low';
  confidenceScore: number; // 0.0 to 1.0
  conciseSummary: string;
  recommendedDepartment: Department;
  departmentRoutingReason?: string;
  missingDetailsIdentified: string[];
  followUpQuestions: string[];
  imageObservations?: string;
  urgencyAssessment: 'Routine' | 'Moderate' | 'Urgent' | 'Safety Hazard';
  analyzedAt: string;
  isAiFallback?: boolean; // true if fallback heuristic was used
  // Why Gemini was not used, safe to show to the student (never a raw provider error)
  fallbackReason?: AIFallbackReason;
  model?: string; // Gemini model that produced this analysis, when isAiFallback is false
  suggestedTitle?: string; // short title, mainly for the Other category
  detectedLanguage?: 'en' | 'hi' | 'hi-en';
}

export type AIFallbackReason =
  | 'not_configured'
  | 'rate_limited'
  | 'timeout'
  | 'model_unavailable'
  | 'invalid_key'
  | 'invalid_response'
  | 'service_error';

export interface DuplicateCandidate {
  ticketId: string;
  title: string;
  category: TicketCategory;
  location: string;
  status: TicketStatus;
  similarityScore: number; // 0.0 to 1.0
  matchReason: string;
}

export interface Ticket {
  id: string; // e.g. "CC-1001"
  title: string;
  description: string;
  rawStudentInput: string;
  category: TicketCategory;
  categorySource: 'student' | 'ai_suggested' | 'staff_override';
  location: string;
  building: string;
  roomOrArea?: string;
  
  // Ownership and privacy
  studentId: string;
  studentName: string;
  studentEmail: string;
  
  imageUrl?: string;
  imageDataUri?: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  
  aiAnalysis?: AIAnalysis;
  assignment?: Assignment;
  statusHistory: StatusHistoryEntry[];
  duplicateWarnings?: DuplicateCandidate[];
  duplicateReviewed?: boolean;
  duplicateReviewDecision?: 'confirmed' | 'dismissed';
  duplicateReviewNote?: string;
  duplicateReviewedBy?: string;
  
  studentFollowUpAnswers?: Record<string, string>;

  // Required when category is "Other"
  problemTitle?: string;
  // Structured location (building is the existing field)
  campus?: string;
  floor?: string;

  // Deterministic priority engine (see src/server/priorityEngine.ts)
  impact?: ImpactInputs;
  priorityAssessment?: PriorityAssessment;
  priorityOverride?: PriorityOverride;
  slaDeadline?: string;
  slaEscalations?: SlaEscalation[];

  resolutionProofs?: ResolutionProof[];
  reopenRequests?: ReopenRequest[];
  blockers?: Blocker[];
  etaEstimate?: EtaEstimate;
  etaHistory?: EtaEstimate[];

  assetId?: string; // verified asset from the configuration store
  incidentIds?: string[]; // shared incidents/clusters this ticket is linked to
  clusterExclusions?: string[]; // clusters staff removed this ticket from (never re-added automatically)
  clusterReporters?: number; // distinct reporters in the active cluster, used by the priority engine
  wasteReview?: WasteReview;
  clientSubmissionId?: string; // idempotency key for retried submissions

  // Internal staff notes - STRIPPED from student responses by server
  internalNotes?: InternalStaffNote[];
}

export const PRIORITY_LEVELS = ['Low', 'Medium', 'High', 'Critical'] as const;
export type PriorityLevel = typeof PRIORITY_LEVELS[number];

export interface ImpactInputs {
  safetyRisk: boolean;
  peopleAffected: number; // estimate, >= 1
  accessibilityImpact: boolean;
  criticalServiceDisruption: boolean;
  alternativesAvailable: 'yes' | 'no' | 'unknown';
  source: 'student' | 'staff';
  updatedAt: string;
  updatedBy?: string;
}

export interface PriorityFactor {
  factor: string;
  points: number;
  detail: string;
}

export interface PriorityAssessment {
  score: number;
  level: PriorityLevel;
  factors: PriorityFactor[];
  explanation: string;
  computedAt: string;
}

export interface PriorityOverride {
  level: PriorityLevel;
  reason: string;
  by: string;
  byId: string;
  at: string;
}

export interface SlaEscalation {
  level: number;
  at: string;
  reason: string;
  previousOwner: string;
  nextAuthority: string;
  notificationIds: string[];
}

export interface ResolutionProof {
  id: string;
  summary: string;
  uploadedBy: string;
  uploadedById: string;
  uploadedAt: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  superseded?: boolean; // kept for history when a ticket is reopened or proof is replaced
}

export interface ReopenRequest {
  id: string;
  reason: string;
  requestedAt: string;
  requestedById: string;
}

export interface Blocker {
  id: string;
  description: string;
  createdAt: string;
  createdBy: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

export interface EtaEstimate {
  earliest: string;
  latest: string;
  note?: string;
  changeReason?: string;
  setBy: string;
  setAt: string;
}

export interface WasteReview {
  status: 'confirmed' | 'rejected';
  note?: string;
  by: string;
  at: string;
}

/**
 * Public Ticket View (Safe for Student consumption)
 * Excludes private internal staff notes and staff-only duplicate review data, which
 * references other students' complaints.
 */
export const STAFF_ONLY_TICKET_FIELDS = [
  'internalNotes',
  'duplicateWarnings',
  'duplicateReviewed',
  'duplicateReviewDecision',
  'duplicateReviewNote',
  'duplicateReviewedBy',
  'priorityOverride',
  'slaEscalations',
  'incidentIds',
  'clusterExclusions',
  'clusterReporters',
  'wasteReview'
] as const;

export type StudentTicketView = Omit<Ticket, typeof STAFF_ONLY_TICKET_FIELDS[number]>;

/**
 * API Request & Response Contracts
 */

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface AuthResponse {
  success: boolean;
  user?: User;
  token?: string;
  error?: string;
}

export interface AnalyzeComplaintRequest {
  description: string;
  location?: string;
  building?: string;
  imageBase64?: string; // optional image payload
  mimeType?: string;
  analysisId?: string; // re-analyse the same draft
  clarifications?: Record<string, string>; // question -> answer
}

export interface AnalyzeComplaintResponse {
  success: boolean;
  // Pass back on submit; the server attaches its own stored copy of the analysis
  analysisId: string;
  analysis: AIAnalysis;
  // Students only receive their own matching tickets here
  duplicateCandidates: DuplicateCandidate[];
  // Number of similar open reports filed by other people (no identifying details)
  similarReportsByOthers?: number;
  message?: string;
}

export interface SubmitComplaintRequest {
  description: string;
  location: string;
  building: string;
  roomOrArea?: string;
  category: TicketCategory;
  categorySource?: 'student' | 'ai_suggested';
  imageBase64?: string;
  mimeType?: string;
  analysisId?: string;
  studentFollowUpAnswers?: Record<string, string>;
  campus?: string;
  floor?: string;
  problemTitle?: string;
  impact?: Pick<ImpactInputs, 'safetyRisk' | 'peopleAffected' | 'accessibilityImpact' | 'criticalServiceDisruption' | 'alternativesAvailable'>;
  assetId?: string;
  clientSubmissionId?: string;
}

export interface SubmitComplaintResponse {
  success: boolean;
  ticket?: StudentTicketView;
  error?: string;
}

export interface TicketListResponse {
  success: boolean;
  tickets: Ticket[] | StudentTicketView[];
  total: number;
  stats: {
    total: number;
    submitted: number;
    underReview: number;
    assigned: number;
    inProgress: number;
    resolved: number;
    byCategory: Record<TicketCategory, number>;
    byPriority: Record<PriorityLevel, number>;
    overdue: number;
  };
}

export interface TicketDetailResponse {
  success: boolean;
  ticket?: Ticket | StudentTicketView;
  error?: string;
}

export interface AssignTicketRequest {
  department: Department;
  assignedToId?: string; // must be an active staff account in the department
  notes?: string;
}

export interface UpdateTicketStatusRequest {
  status: TicketStatus;
  notes?: string;
}

export interface AddInternalNoteRequest {
  content: string;
}

export interface ReviewDuplicateRequest {
  action: 'confirm' | 'dismiss';
  duplicateTicketId?: string;
  note?: string;
}

export interface TicketHistoryResponse {
  success: boolean;
  ticketId: string;
  history: StatusHistoryEntry[];
}

export interface AdminCreateStaffRequest {
  name: string;
  email: string;
  password: string;
  role: 'staff' | 'admin' | 'responder';
  department?: Department;
  responderType?: 'medical' | 'security';
  phone?: string;
}

export type StaffRole = 'staff' | 'admin' | 'responder';

export interface AdminUpdateStaffRequest {
  role?: StaffRole;
  department?: Department;
  responderType?: ResponderType;
  phone?: string;
  isActive?: boolean;
}

// ============================================================================
// Emergency incidents and notifications
// ============================================================================

export type GpsStatus = 'granted' | 'denied' | 'unavailable' | 'not_requested';

export interface EmergencyLocation {
  campus?: string;
  building?: string;
  floor?: string;
  room?: string;
  details?: string; // free-text correction, e.g. "near the main gate"
  gps?: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string };
  gpsStatus: GpsStatus;
}

export type NotificationStatus =
  | 'pending'
  | 'sending'
  | 'accepted' // provider accepted the message (not proof of delivery)
  | 'delivered' // provider sent a delivery receipt
  | 'failed'
  | 'not_configured'
  | 'no_contact';

export interface NotificationAttempt {
  id: string;
  idempotencyKey: string;
  purpose: 'emergency_alert' | 'emergency_escalation' | 'sla_escalation';
  subjectId: string; // incident or ticket id
  recipientId: string;
  recipientName: string;
  channel: 'webhook' | 'none';
  status: NotificationStatus;
  providerMessageId?: string;
  error?: string;
  attempts: number;
  createdAt: string;
  updatedAt: string;
}

export type EmergencyStatus = 'open' | 'acknowledged' | 'responding' | 'closed';
export type EmergencyType = 'medical' | 'security' | 'unspecified';

export interface EmergencyEvent {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  type: 'created' | 'acknowledged' | 'responding' | 'update' | 'escalated' | 'closed' | 'location_corrected';
  note?: string;
}

export interface EmergencyIncident {
  id: string;
  type: EmergencyType;
  status: EmergencyStatus;
  reporterId: string;
  reporter: { name: string; studentId?: string; phone?: string };
  location: EmergencyLocation;
  zoneId?: string;
  createdAt: string;
  updatedAt: string;
  clientRequestId: string;
  notificationIds: string[];
  notifiedResponderIds: string[];
  acknowledgedBy?: { id: string; name: string; at: string };
  respondingIds: string[];
  escalationLevel: number;
  lastEscalatedAt?: string;
  events: EmergencyEvent[];
  closedAt?: string;
  outcome?: string;
}

/** Truthful alert state shown to the reporting student. */
export type EmergencyAlertState =
  | 'Sending'
  | 'Alert sent'
  | 'Awaiting acknowledgement'
  | 'Delivery failed'
  | 'Alerting not configured'
  | 'No on-duty responders configured'
  | 'Acknowledged'
  | 'Responder on the way'
  | 'Escalated'
  | 'Closed';

export interface StudentEmergencyView {
  id: string;
  type: EmergencyType;
  status: EmergencyStatus;
  alertState: EmergencyAlertState;
  alertDetail: string;
  createdAt: string;
  location: EmergencyLocation;
  acknowledgedAt?: string;
  escalationLevel: number;
  closedAt?: string;
}

// ============================================================================
// Shared incidents (automatic clusters and staff-linked incidents)
// ============================================================================

export interface IncidentAuditEntry {
  at: string;
  actorId: string;
  actorName: string;
  action: 'created' | 'ticket_linked' | 'ticket_unlinked' | 'updated' | 'dismissed' | 'resolved' | 'reviewed';
  ticketId?: string;
  note?: string;
}

export interface Incident {
  id: string;
  source: 'auto_cluster' | 'staff';
  title: string;
  status: 'active' | 'reviewed' | 'dismissed' | 'resolved';
  category: TicketCategory;
  building: string;
  area?: string;
  ticketIds: string[];
  distinctReporters: number;
  firstReportAt: string;
  latestReportAt: string;
  priority?: PriorityLevel;
  priorityReason?: string;
  clusterKey?: string;
  createdAt: string;
  updatedAt: string;
  audit: IncidentAuditEntry[];
}

// ============================================================================
// Administrator configuration
// ============================================================================

export interface CampusBuilding {
  id: string;
  name: string;
  campus: string;
  zoneId?: string;
  latitude?: number;
  longitude?: number;
}

export interface ResponderZone {
  id: string;
  name: string;
}

export interface ResponderShift {
  id: string;
  userId: string;
  zoneIds: string[]; // empty = all zones
  days: number[]; // 0 = Sunday ... 6 = Saturday
  start: string; // "HH:MM" in config.timezone
  end: string; // "HH:MM"; earlier than start means an overnight shift
  isBackup: boolean;
}

export const ASSET_TYPES = ['projector', 'lift', 'water_purifier', 'fan', 'wifi_ap', 'ac', 'other'] as const;
export type AssetType = typeof ASSET_TYPES[number];

export interface CampusAsset {
  id: string; // verified asset tag, e.g. "PRJ-LH101"
  name: string;
  type: AssetType;
  building: string;
  floor?: string;
  roomId?: string;
}

export interface CampusRoom {
  id: string;
  name: string;
  building: string;
  floor?: string;
  assetIds: string[];
}

export const FACILITY_TYPES = ['classroom', 'study_area', 'water_station', 'wifi_zone', 'restroom', 'other'] as const;
export type FacilityType = typeof FACILITY_TYPES[number];

export interface CampusFacility {
  id: string;
  name: string;
  type: FacilityType;
  building: string;
  floor?: string;
  accessible?: boolean; // only set when verified
  status: 'available' | 'unavailable' | 'unknown';
  verifiedAt?: string;
  verifiedBy?: string;
}

export interface SlaTargets {
  // Hours to resolve, by priority level; byCategory overrides individual values
  default: Record<PriorityLevel, number>;
  byCategory: Partial<Record<TicketCategory, Partial<Record<PriorityLevel, number>>>>;
}

export interface AppConfig {
  timezone: string;
  routing: Record<TicketCategory, Department>;
  buildings: CampusBuilding[];
  zones: ResponderZone[];
  shifts: ResponderShift[];
  emergencyAckTimeoutSeconds: number;
  emergencyDuplicateWindowSeconds: number;
  sla: SlaTargets;
  slaEscalationEnabled: boolean;
  assets: CampusAsset[];
  rooms: CampusRoom[];
  facilities: CampusFacility[];
  verificationFreshnessHours: number;
  repeatOffenderWindowDays: number;
  repeatOffenderThreshold: number;
  pulseMinGroupSize: number;
  updatedAt?: string;
  updatedBy?: string;
}

/** Fields of AppConfig an administrator may replace through the API. */
export const CONFIG_SECTIONS = [
  'timezone',
  'routing',
  'buildings',
  'zones',
  'shifts',
  'emergencyAckTimeoutSeconds',
  'emergencyDuplicateWindowSeconds',
  'sla',
  'slaEscalationEnabled',
  'assets',
  'rooms',
  'facilities',
  'verificationFreshnessHours',
  'repeatOffenderWindowDays',
  'repeatOffenderThreshold',
  'pulseMinGroupSize'
] as const;
export type ConfigSection = typeof CONFIG_SECTIONS[number];

export interface NotificationProviderStatus {
  provider: 'webhook' | 'none';
  configured: boolean;
  endpointHost?: string; // host only; never the full URL or secret
  receiptsEnabled: boolean;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: string;
}

export interface RoomCheck {
  id: string;
  roomId: string;
  assetId?: string;
  result: 'working' | 'issue';
  note?: string;
  checkedBy: string;
  checkedById: string;
  checkedAt: string;
}

// ============================================================================
// Campus Pulse (anonymous feedback)
// ============================================================================

export const PULSE_TOPICS = [
  'Water',
  'Power & Lighting',
  'Cleanliness',
  'Wi-Fi',
  'Classroom Equipment',
  'Safety & Access',
  'Other'
] as const;
export type PulseTopic = typeof PULSE_TOPICS[number];

export interface PulseAggregateGroup {
  building: string;
  topic: PulseTopic;
  count: number;
}

export interface PulseSummary {
  windowDays: number;
  minGroupSize: number;
  groups: PulseAggregateGroup[];
  suppressedCount: number; // reports in groups below the threshold (not broken down)
  totalReports: number;
}
