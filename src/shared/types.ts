/**
 * CampusConnect - Production Data Models, User Roles, and API Contracts
 * Enforces strict 4-category classification, role-based access control,
 * audit logging, and human-supervised AI triage workflows.
 */

export const TICKET_CATEGORIES = [
  'Plumbing',
  'Electricity',
  'Cleanliness',
  'Internet Connectivity'
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
  'IT & Network Infrastructure Team'
] as const;

export type Department = typeof DEPARTMENTS[number];

export const CATEGORY_DEPARTMENT_ROUTING: Record<TicketCategory, Department> = {
  'Plumbing': 'Plumbing Maintenance Department',
  'Electricity': 'Electrical Systems & Safety Division',
  'Cleanliness': 'Campus Custodial & Sanitation Services',
  'Internet Connectivity': 'IT & Network Infrastructure Team'
};

/**
 * Valid workflow state transitions enforced by the backend
 */
export const VALID_STATUS_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  'Submitted': ['Under Review', 'Assigned'],
  'Under Review': ['Assigned', 'In Progress', 'Resolved'],
  'Assigned': ['In Progress', 'Under Review'],
  'In Progress': ['Resolved', 'Assigned', 'Under Review'],
  'Resolved': ['In Progress'] // reopening if issue recurs
};

/**
 * User Roles and Authentication Models
 */
export type UserRole = 'student' | 'staff' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department?: Department; // For staff members
  isActive: boolean;
  createdAt: string;
}

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
  priority: 'Low' | 'Medium' | 'High' | 'Emergency';
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
  
  // Internal staff notes - STRIPPED from student responses by server
  internalNotes?: InternalStaffNote[];
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
  'duplicateReviewedBy'
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
  };
}

export interface TicketDetailResponse {
  success: boolean;
  ticket?: Ticket | StudentTicketView;
  error?: string;
}

export interface AssignTicketRequest {
  department: Department;
  assignedTo?: string;
  priority: 'Low' | 'Medium' | 'High' | 'Emergency';
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
  role: 'staff' | 'admin';
  department: Department;
}

export interface AdminUpdateStaffRequest {
  role?: 'staff' | 'admin';
  department?: Department;
  isActive?: boolean;
}
