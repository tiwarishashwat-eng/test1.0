/**
 * CampusConnect - Production Full-Stack Server
 * Features:
 * - Real role-based authentication (Student, Staff, Admin)
 * - Server-side authorization on every protected route (no client-side bypass)
 * - Insecure Direct Object Reference (IDOR) prevention
 * - Internal staff notes separation (stripped from student API responses)
 * - Validated workflow state transitions
 * - Server-side Gemini 3.8 Flash AI integration
 * - Host: 0.0.0.0, Port: 3000
 */

// Must be the first import: the stores read env vars (data dir, demo seed, bootstrap admin) when imported
import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  DEPARTMENTS,
  AIAnalysis,
  TicketCategory,
  TicketStatus,
  Department,
  ImpactInputs,
  PRIORITY_LEVELS,
  PriorityLevel,
  Ticket,
  User
} from './src/shared/types.js';
import {
  analyzeComplaintWithGemini,
  detectDuplicateCandidates,
  getGeminiStatus
} from './src/server/geminiService.js';
import { ticketRepository, toStudentView } from './src/server/ticketStore.js';
import { userStore, isDemoSeedEnabled } from './src/server/userStore.js';
import { auditStore } from './src/server/auditStore.js';
import { configStore } from './src/server/configStore.js';
import { emergencyStore } from './src/server/emergencyService.js';
import { incidentStore } from './src/server/incidentService.js';
import { effectivePriority, parseImpactInputs } from './src/server/priorityEngine.js';
import { registerFeatureRoutes } from './src/server/featureRoutes.js';
import { startScheduler } from './src/server/scheduler.js';
import { getNotificationProviderStatus } from './src/server/notificationService.js';
import { isValidPhone } from './src/shared/validation.js';

/** Validates an optional { question: answer } map of short strings. */
function validateTextMap(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return `${label} must be question/answer pairs`;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 10) return `${label}: at most 10 entries`;
  for (const [k, v] of entries) {
    if (typeof v !== 'string' || k.length > 300 || v.length > 1000) return `${label} must be short text`;
  }
  return null;
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// `npm start` passes --production so a deployment never runs the Vite dev server
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Returns an error message if the optional base64 photo is not an allowed type or size. */
function validateImagePayload(imageBase64: unknown, mimeType: unknown): string | null {
  if (imageBase64 === undefined || imageBase64 === null || imageBase64 === '') return null;
  if (typeof imageBase64 !== 'string' || typeof mimeType !== 'string' || !ALLOWED_IMAGE_MIME_TYPES.includes(mimeType)) {
    return 'Photo must be JPEG, PNG, or WebP format.';
  }
  const base64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return 'Photo data is not valid.';
  }
  if (Math.floor((base64.length * 3) / 4) > MAX_IMAGE_BYTES) {
    return 'Photo must be 5MB or smaller.';
  }
  return null;
}

// Server-produced analyses awaiting submission, so clients cannot forge AI results.
// In-memory only: after a restart the student simply submits without the AI analysis.
const ANALYSIS_TTL_MS = 60 * 60 * 1000;
const pendingAnalyses = new Map<string, { userId: string; analysis: AIAnalysis; expiresAt: number }>();

/**
 * Stores a server-produced analysis. Passing the draft's existing id (owned by the same
 * user) replaces that draft's analysis instead of creating a new one, so answering
 * follow-up questions refines the same complaint draft.
 */
function rememberAnalysis(userId: string, analysis: AIAnalysis, existingId?: string): string {
  const now = Date.now();
  for (const [key, entry] of pendingAnalyses) {
    if (entry.expiresAt < now) pendingAnalyses.delete(key);
  }
  const existing = existingId ? pendingAnalyses.get(existingId) : undefined;
  const id = existing && existing.userId === userId ? existingId! : crypto.randomUUID();
  pendingAnalyses.set(id, { userId, analysis, expiresAt: now + ANALYSIS_TTL_MS });
  return id;
}

function takeAnalysis(userId: string, analysisId: string): AIAnalysis | undefined {
  const entry = pendingAnalyses.get(analysisId);
  if (!entry || entry.userId !== userId || entry.expiresAt < Date.now()) return undefined;
  pendingAnalyses.delete(analysisId);
  return entry.analysis;
}

// Extend Express Request to carry authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Builds the Express app with all /api routes. No frontend, no listening; used by tests. */
export function createApiApp() {
  const app = express();

  // Middleware for JSON bodies (supports up to 5MB for base64 photo attachments)
  app.use(
    express.json({
      limit: '8mb',
      // Keep the exact bytes for HMAC verification of provider delivery receipts
      verify: (req, _res, buf) => {
        if ((req as Request).originalUrl === '/api/notifications/receipt') (req as any).rawBody = buf.toString('utf8');
      }
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '6mb' }));

  // Security Headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
  });

  // Authentication Middleware: Extracts Bearer token
  const authenticateToken = (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (token) {
      const user = userStore.validateSession(token);
      if (user) {
        req.user = user;
      }
    }
    next();
  };

  app.use(authenticateToken);

  // Guard: Requires any authenticated user
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please sign in to access this resource.'
      });
    }
    next();
  };

  // Guard: Requires staff or admin role
  const requireStaff = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (req.user.role !== 'staff' && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: This action requires campus facilities staff authorization.'
      });
    }
    next();
  };

  // Guard: Requires admin role
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: Administrator privileges required.'
      });
    }
    next();
  };

  // --------------------------------------------------------------------------
  // AUTHENTICATION ROUTES
  // --------------------------------------------------------------------------

  // Sign In (Students, Staff, Admin)
  app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ success: false, error: 'Email and password are required' });
      }

      const result = userStore.authenticate(email, password);
      if (!result) {
        return res.status(401).json({
          success: false,
          error: 'Invalid campus credentials or inactive account.'
        });
      }

      return res.json({
        success: true,
        user: result.user,
        token: result.token
      });
    } catch (err: any) {
      return res.status(500).json({ success: false, error: 'Sign-in failed due to a server error' });
    }
  });

  // Student Registration
  app.post('/api/auth/register', (req: Request, res: Response) => {
    try {
      const { name, email, password } = req.body;
      if (!name || !name.trim()) {
        return res.status(400).json({ success: false, error: 'Full name is required' });
      }
      if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: 'Valid campus email is required' });
      }
      if (!password || password.length < 6) {
        return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
      }

      const result = userStore.registerStudent(name, email, password);
      return res.status(201).json({
        success: true,
        user: result.user,
        token: result.token
      });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  // Get Current Authenticated Profile
  app.get('/api/auth/me', requireAuth, (req: Request, res: Response) => {
    return res.json({
      success: true,
      user: req.user
    });
  });

  // Sign Out
  app.post('/api/auth/logout', (req: Request, res: Response) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (token) {
      userStore.logout(token);
    }
    return res.json({ success: true, message: 'Logged out successfully' });
  });

  // --------------------------------------------------------------------------
  // HEALTH & DIAGNOSTICS ROUTES
  // --------------------------------------------------------------------------

  // Public health check: reports configuration state only, never paths, keys, or record contents
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      gemini: getGeminiStatus(),
      notifications: { configured: getNotificationProviderStatus().configured },
      demoMode: isDemoSeedEnabled(),
      // Public campus emergency number, shown only if an administrator configured it
      emergencyContact: process.env.CAMPUS_EMERGENCY_CONTACT?.trim().slice(0, 60) || null,
      storage: { storageType: ticketRepository.getStorageStatus().storageType }
    });
  });

  app.get('/api/storage/status', requireAdmin, (_req: Request, res: Response) => {
    res.json({
      success: true,
      storage: ticketRepository.getStorageStatus()
    });
  });

  // --------------------------------------------------------------------------
  // AI COMPLAINT TRIAGE ROUTES
  // --------------------------------------------------------------------------

  app.post('/api/complaints/analyze', requireAuth, async (req: Request, res: Response) => {
    try {
      const { description, location, building, imageBase64, mimeType, analysisId, clarifications } = req.body ?? {};

      if (!description || typeof description !== 'string' || description.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: 'Complaint description is required for triage analysis.'
        });
      }
      if (description.length > 4000) {
        return res.status(400).json({ success: false, error: 'Description must be at most 4000 characters.' });
      }

      const imageError = validateImagePayload(imageBase64, mimeType);
      if (imageError) {
        return res.status(400).json({ success: false, error: imageError });
      }

      const clarificationError = validateTextMap(clarifications, 'Clarification answers');
      if (clarificationError) {
        return res.status(400).json({ success: false, error: clarificationError });
      }

      // The only Gemini call in the application: student complaint intake
      const analysis = await analyzeComplaintWithGemini({
        description: description.trim(),
        location: typeof location === 'string' ? location.trim() : undefined,
        building: typeof building === 'string' ? building.trim() : undefined,
        imageBase64,
        mimeType,
        clarifications
      });

      // Duplicate candidates come from real persisted tickets (rule-based, not the model)
      const allCandidates = detectDuplicateCandidates(
        {
          description,
          category: analysis.suggestedCategory,
          location,
          building
        },
        ticketRepository.getAllTicketsForSystem()
      );

      // Students may only see details of their own tickets; others are reported as a count
      let duplicateCandidates = allCandidates;
      let similarReportsByOthers = 0;
      if (req.user!.role === 'student') {
        duplicateCandidates = allCandidates.filter(
          (c) => ticketRepository.getRawById(c.ticketId)?.studentId === req.user!.id
        );
        similarReportsByOthers = allCandidates.length - duplicateCandidates.length;
      }

      return res.json({
        success: true,
        // Re-analysing with clarification answers keeps the same draft id
        analysisId: rememberAnalysis(req.user!.id, analysis, typeof analysisId === 'string' ? analysisId : undefined),
        analysis,
        duplicateCandidates,
        similarReportsByOthers
      });
    } catch (error: any) {
      console.error('[API /api/complaints/analyze Error]', error);
      return res.status(500).json({
        success: false,
        error: 'Internal error during complaint analysis'
      });
    }
  });

  // --------------------------------------------------------------------------
  // TICKET CRUD & WORKFLOW ROUTES (SERVER-ENFORCED ACCESS)
  // --------------------------------------------------------------------------

  // Submit Complaint (students only)
  app.post('/api/complaints/submit', requireAuth, async (req: Request, res: Response) => {
    try {
      if (req.user!.role !== 'student') {
        return res.status(403).json({ success: false, error: 'Only student accounts can submit complaints.' });
      }
      const {
        description,
        location,
        building,
        roomOrArea,
        campus,
        floor,
        problemTitle,
        category,
        categorySource,
        imageBase64,
        mimeType,
        analysisId,
        studentFollowUpAnswers,
        impact,
        assetId,
        clientSubmissionId
      } = req.body ?? {};

      // Retried submission (same idempotency key): return the ticket already created
      if (clientSubmissionId !== undefined) {
        if (typeof clientSubmissionId !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(clientSubmissionId)) {
          return res.status(400).json({ success: false, error: 'Invalid submission id' });
        }
        const existing = ticketRepository.findBySubmissionId(req.user!.id, clientSubmissionId);
        if (existing) {
          return res.status(200).json({ success: true, ticket: toStudentView(existing), duplicateSubmission: true });
        }
      }

      if (typeof description !== 'string' || !description.trim()) {
        return res.status(400).json({ success: false, error: 'Description is required' });
      }
      if (description.length > 4000) {
        return res.status(400).json({ success: false, error: 'Description must be at most 4000 characters' });
      }

      if (typeof building !== 'string' || !building.trim()) {
        return res.status(400).json({ success: false, error: 'Campus building is required' });
      }

      if (typeof location !== 'string' || !location.trim()) {
        return res.status(400).json({ success: false, error: 'Specific location or room is required' });
      }

      for (const [value, label, max] of [
        [roomOrArea, 'Room or area', 100],
        [campus, 'Campus', 100],
        [floor, 'Floor', 20],
        [problemTitle, 'Problem title', 90],
        [building, 'Building', 120],
        [location, 'Location', 200]
      ] as const) {
        if (value !== undefined && (typeof value !== 'string' || value.length > max)) {
          return res.status(400).json({ success: false, error: `${label} must be text of at most ${max} characters` });
        }
      }

      if (categorySource !== undefined && categorySource !== 'student' && categorySource !== 'ai_suggested') {
        return res.status(400).json({ success: false, error: 'Invalid category source' });
      }

      const answersError = validateTextMap(studentFollowUpAnswers, 'Follow-up answers');
      if (answersError) {
        return res.status(400).json({ success: false, error: answersError });
      }

      if (!TICKET_CATEGORIES.includes(category as TicketCategory)) {
        return res.status(400).json({
          success: false,
          error: `Invalid category: "${category}". Must be one of: ${TICKET_CATEGORIES.join(', ')}`
        });
      }
      if (category === 'Other' && (typeof problemTitle !== 'string' || problemTitle.trim().length < 3)) {
        return res.status(400).json({ success: false, error: 'A problem title (at least 3 characters) is required for the Other category' });
      }

      let impactInputs: ImpactInputs | undefined;
      if (impact !== undefined) {
        const parsed = parseImpactInputs(impact, 'student', req.user!.name);
        if (typeof parsed === 'string') return res.status(400).json({ success: false, error: parsed });
        impactInputs = parsed;
      }

      if (assetId !== undefined && (typeof assetId !== 'string' || !configStore.get().assets.some((a) => a.id === assetId))) {
        return res.status(400).json({ success: false, error: 'Unknown asset' });
      }

      const imageError = validateImagePayload(imageBase64, mimeType);
      if (imageError) {
        return res.status(400).json({ success: false, error: imageError });
      }

      // Only an analysis this server produced for this user is attached; client-supplied
      // AI output is never trusted (it could claim Gemini ran when it did not).
      const aiAnalysis = typeof analysisId === 'string' ? takeAnalysis(req.user!.id, analysisId) : undefined;

      const duplicateWarnings = detectDuplicateCandidates(
        { description, category, location, building },
        ticketRepository.getAllTicketsForSystem()
      );

      const ticket = ticketRepository.createTicket({
        description: description.trim(),
        location: location.trim(),
        building: building.trim(),
        roomOrArea: roomOrArea?.trim() || undefined,
        campus: campus?.trim() || undefined,
        floor: floor?.trim() || undefined,
        problemTitle: category === 'Other' ? problemTitle.trim() : problemTitle?.trim() || undefined,
        category,
        categorySource: categorySource || 'student',
        studentUser: req.user!,
        imageBase64,
        mimeType,
        aiAnalysis,
        studentFollowUpAnswers,
        duplicateWarnings,
        impact: impactInputs,
        assetId,
        clientSubmissionId
      });

      // Deterministic recurring-issue clustering (never delays or blocks the submission)
      try {
        incidentStore.evaluateForTicket(ticket.id);
      } catch (err) {
        console.error('[Clustering] Evaluation failed for', ticket.id, err);
      }

      return res.status(201).json({
        success: true,
        ticket: toStudentView(ticketRepository.getRawById(ticket.id)!)
      });
    } catch (error: any) {
      console.error('[API /api/complaints/submit Error]', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to submit complaint'
      });
    }
  });

  // List Tickets (Scoped by role: Students only see their own!)
  app.get('/api/tickets', requireAuth, (req: Request, res: Response) => {
    try {
      const { category, status, query, building, department, priority, from, to, sort } = req.query;
      const fromMs = typeof from === 'string' && from ? Date.parse(from) : NaN;
      const toMs = typeof to === 'string' && to ? Date.parse(to) : NaN;
      if ((typeof from === 'string' && from && Number.isNaN(fromMs)) || (typeof to === 'string' && to && Number.isNaN(toMs))) {
        return res.status(400).json({ success: false, error: 'Dates must be valid (YYYY-MM-DD)' });
      }

      let tickets = ticketRepository.getTicketsForUser(req.user!, {
        category: typeof category === 'string' ? category : undefined,
        status: typeof status === 'string' ? status : undefined,
        building: typeof building === 'string' ? building : undefined,
        department: typeof department === 'string' ? department : undefined,
        query: typeof query === 'string' ? query : undefined
      }) as Ticket[];

      if (typeof priority === 'string' && PRIORITY_LEVELS.includes(priority as PriorityLevel)) {
        tickets = tickets.filter((t) => effectivePriority(t) === priority);
      }
      if (!Number.isNaN(fromMs)) tickets = tickets.filter((t) => Date.parse(t.createdAt) >= fromMs);
      // "to" is inclusive of the whole day
      if (!Number.isNaN(toMs)) tickets = tickets.filter((t) => Date.parse(t.createdAt) < toMs + 24 * 3600 * 1000);
      if (sort === 'priority') {
        const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 } as const;
        tickets = [...tickets].sort((a, b) => rank[effectivePriority(a)] - rank[effectivePriority(b)] || b.createdAt.localeCompare(a.createdAt));
      } else if (sort === 'deadline') {
        tickets = [...tickets].sort((a, b) => (a.slaDeadline ?? '9').localeCompare(b.slaDeadline ?? '9'));
      } else if (sort === 'oldest') {
        tickets = [...tickets].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      }

      const stats = ticketRepository.getStatsForUser(req.user!);

      return res.json({
        success: true,
        tickets,
        total: tickets.length,
        stats
      });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: 'Failed to load tickets' });
    }
  });

  // Ticket Lookup by ID (IDOR Protected: Students cannot view other students' tickets)
  app.get('/api/tickets/:id', requireAuth, (req: Request, res: Response) => {
    const rawId = req.params.id;
    let cleanId = rawId.trim().toUpperCase();
    if (/^\d+$/.test(cleanId)) {
      cleanId = `CC-${cleanId}`;
    }

    const ticket = ticketRepository.getByIdForUser(cleanId, req.user!);
    if (!ticket) {
      // Same response whether the ticket is missing or belongs to someone else,
      // so students cannot probe which ticket IDs exist.
      return res.status(404).json({
        success: false,
        error: 'No ticket with that ID was found in your complaints.'
      });
    }

    return res.json({
      success: true,
      ticket
    });
  });

  // Assign Ticket (Staff / Admin only)
  app.post('/api/tickets/:id/assign', requireStaff, (req: Request, res: Response) => {
    const { id } = req.params;
    const { department, assignedToId, notes } = req.body ?? {};

    if (!department || !DEPARTMENTS.includes(department as Department)) {
      return res.status(400).json({
        success: false,
        error: `Department must be one of: ${DEPARTMENTS.join(', ')}`
      });
    }
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1000)) {
      return res.status(400).json({ success: false, error: 'Notes must be text of at most 1000 characters' });
    }

    // Assignee must be a real, active staff account in that department
    let assignee: User | undefined;
    if (assignedToId !== undefined && assignedToId !== null && assignedToId !== '') {
      const candidate = typeof assignedToId === 'string' ? userStore.getUserById(assignedToId) : null;
      if (!candidate || candidate.role !== 'staff' || !candidate.isActive || candidate.department !== department) {
        return res.status(400).json({ success: false, error: 'Assignee must be an active staff member of the selected department' });
      }
      assignee = candidate;
    }

    const ticket = ticketRepository.assignTicket(id, department as Department, assignee, notes, req.user!);

    if (!ticket) {
      return res.status(404).json({ success: false, error: `Ticket ${id} not found` });
    }

    auditStore.record(req.user!, 'ticket.assigned', 'ticket', ticket.id, `${department}${assignee ? ` / ${assignee.name}` : ''}`);
    return res.json({
      success: true,
      ticket,
      message: `Ticket ${id} assigned to ${department}`
    });
  });

  // Staff who can be assigned in a department (real accounts only)
  app.get('/api/staff/assignable', requireStaff, (req: Request, res: Response) => {
    const department = typeof req.query.department === 'string' ? req.query.department : undefined;
    if (department && !DEPARTMENTS.includes(department as Department)) {
      return res.status(400).json({ success: false, error: 'Unknown department' });
    }
    const staff = userStore
      .getActiveUsersByRole('staff', department as Department | undefined)
      .map((u) => ({ id: u.id, name: u.name, department: u.department }));
    return res.json({ success: true, staff });
  });

  // Update Status (Staff / Admin only with state machine validation)
  app.post('/api/tickets/:id/status', requireStaff, (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, notes } = req.body;

    if (!status || !TICKET_STATUSES.includes(status as TicketStatus)) {
      return res.status(400).json({
        success: false,
        error: `Status must be exactly one of: ${TICKET_STATUSES.join(', ')}`
      });
    }

    const result = ticketRepository.updateStatus(
      id,
      status as TicketStatus,
      notes,
      req.user!
    );

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      ticket: result.ticket,
      message: `Status updated to ${status}`
    });
  });

  // Add Internal Staff Note (Staff / Admin only - NOT visible to students)
  app.post('/api/tickets/:id/notes', requireStaff, (req: Request, res: Response) => {
    const { id } = req.params;
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: 'Note content cannot be empty' });
    }

    const note = ticketRepository.addInternalNote(id, req.user!, content);
    if (!note) {
      return res.status(404).json({ success: false, error: `Ticket ${id} not found` });
    }

    return res.status(201).json({
      success: true,
      note,
      message: 'Internal note added successfully'
    });
  });

  // Review Duplicate Suggestion (Staff / Admin only)
  app.post('/api/tickets/:id/duplicate-review', requireStaff, (req: Request, res: Response) => {
    const { id } = req.params;
    const { action, note } = req.body;

    if (action !== 'confirm' && action !== 'dismiss') {
      return res.status(400).json({
        success: false,
        error: 'Action must be "confirm" or "dismiss"'
      });
    }

    const updated = ticketRepository.reviewDuplicate(
      id,
      action === 'confirm' ? 'confirmed' : 'dismissed',
      req.user!,
      note
    );

    if (!updated) {
      return res.status(404).json({ success: false, error: `Ticket ${id} not found` });
    }

    return res.json({
      success: true,
      ticket: updated,
      message: `Duplicate warning ${action === 'confirm' ? 'confirmed' : 'dismissed'} by staff.`
    });
  });

  // Ticket Audit History (Protected)
  app.get('/api/tickets/:id/history', requireAuth, (req: Request, res: Response) => {
    const { id } = req.params;
    const ticket = ticketRepository.getByIdForUser(id, req.user!);

    if (!ticket) {
      return res.status(404).json({ success: false, error: `Ticket ${id} not found or access denied.` });
    }

    return res.json({
      success: true,
      ticketId: ticket.id,
      history: ticket.statusHistory
    });
  });

  // --------------------------------------------------------------------------
  // ADMINISTRATOR ROUTES
  // --------------------------------------------------------------------------

  // List all staff members
  app.get('/api/admin/staff', requireAdmin, (_req: Request, res: Response) => {
    const staff = userStore.getAllStaff();
    return res.json({ success: true, staff });
  });

  // Create new staff, admin, or responder account
  app.post('/api/admin/staff', requireAdmin, (req: Request, res: Response) => {
    try {
      const { name, email, password, department, role, responderType, phone } = req.body ?? {};
      const accountRole = role ?? 'staff';
      if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ success: false, error: 'Name, email, and password are required' });
      }
      if (name.trim().length > 100) {
        return res.status(400).json({ success: false, error: 'Name must be at most 100 characters' });
      }
      if (!EMAIL_PATTERN.test(email.trim())) {
        return res.status(400).json({ success: false, error: 'A valid email address is required' });
      }
      if (password.length < 12) {
        return res.status(400).json({ success: false, error: 'Staff passwords must be at least 12 characters' });
      }
      if (accountRole !== 'staff' && accountRole !== 'admin' && accountRole !== 'responder') {
        return res.status(400).json({ success: false, error: 'Role must be "staff", "admin", or "responder"' });
      }
      if (accountRole !== 'responder' && !DEPARTMENTS.includes(department as Department)) {
        return res.status(400).json({ success: false, error: 'Invalid department' });
      }
      if (accountRole === 'responder' && responderType !== 'medical' && responderType !== 'security') {
        return res.status(400).json({ success: false, error: 'Responder type must be "medical" or "security"' });
      }
      if (phone !== undefined && phone !== '' && (typeof phone !== 'string' || !isValidPhone(phone))) {
        return res.status(400).json({ success: false, error: 'Invalid phone number' });
      }

      const newStaff = userStore.createStaffMember({
        name,
        email,
        password,
        department,
        role: accountRole,
        responderType,
        phone
      });
      auditStore.record(req.user!, 'staff.created', 'user', newStaff.id, `${accountRole} ${newStaff.email}`);

      return res.status(201).json({ success: true, staff: newStaff });
    } catch (err: any) {
      return res.status(400).json({ success: false, error: err.message });
    }
  });

  // Update staff member
  app.patch('/api/admin/staff/:id', requireAdmin, (req: Request, res: Response) => {
    const { id } = req.params;
    const { department, isActive, role, responderType, phone } = req.body ?? {};

    if (department !== undefined && !DEPARTMENTS.includes(department as Department)) {
      return res.status(400).json({ success: false, error: 'Invalid department' });
    }
    if (isActive !== undefined && typeof isActive !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isActive must be true or false' });
    }
    if (role !== undefined && role !== 'staff' && role !== 'admin' && role !== 'responder') {
      return res.status(400).json({ success: false, error: 'Role must be "staff", "admin", or "responder"' });
    }
    if (responderType !== undefined && responderType !== 'medical' && responderType !== 'security') {
      return res.status(400).json({ success: false, error: 'Responder type must be "medical" or "security"' });
    }
    if (phone !== undefined && typeof phone !== 'string') {
      return res.status(400).json({ success: false, error: 'Phone must be text' });
    }

    const result = userStore.updateStaffMember(id, { department, isActive, role, responderType, phone }, req.user!);
    if (!result.user) {
      return res.status(result.status).json({ success: false, error: result.error });
    }
    auditStore.record(req.user!, 'staff.updated', 'user', id, JSON.stringify({ department, isActive, role, responderType, phoneChanged: phone !== undefined }));

    return res.json({ success: true, staff: result.user });
  });

  // System Operational Metrics (computed from stored records)
  app.get('/api/admin/metrics', requireAdmin, (req: Request, res: Response) => {
    const staff = userStore.getAllStaff();
    const stats = ticketRepository.getStatsForUser(req.user!);
    const emergencies = emergencyStore.all();

    return res.json({
      success: true,
      metrics: {
        totalTickets: stats.total,
        submitted: stats.submitted,
        underReview: stats.underReview,
        assigned: stats.assigned,
        inProgress: stats.inProgress,
        resolved: stats.resolved,
        byCategory: stats.byCategory,
        byPriority: stats.byPriority,
        overdue: stats.overdue,
        staffCount: staff.filter((s) => s.role !== 'responder').length,
        activeStaffCount: staff.filter((s) => s.isActive && s.role !== 'responder').length,
        responderCount: staff.filter((s) => s.role === 'responder' && s.isActive).length,
        openEmergencies: emergencies.filter((e) => e.status !== 'closed').length,
        totalEmergencies: emergencies.length,
        activeIncidents: incidentStore.list({ status: 'active' }).length,
        storageStatus: ticketRepository.getStorageStatus()
      }
    });
  });

  registerFeatureRoutes(app, { requireAuth, requireStaff, requireAdmin });

  // Unknown API routes must not fall through to the SPA index.html
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ success: false, error: 'Not found' });
  });

  // JSON errors without stack traces (Express's default handler sends HTML stacks outside production)
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = Number(err?.status || err?.statusCode) || 500;
    if (status >= 500) console.error('[API Error]', err);
    const message =
      status === 413
        ? 'Request is too large. Photos must be 5MB or smaller.'
        : err?.type === 'entity.parse.failed'
        ? 'Request body is not valid JSON.'
        : status < 500
        ? 'Bad request.'
        : 'Internal server error.';
    res.status(status).json({ success: false, error: message });
  });

  return app;
}

async function createServer() {
  const app = createApiApp();

  // --------------------------------------------------------------------------
  // FRONTEND MOUNTING (VITE / STATIC)
  // --------------------------------------------------------------------------

  if (!isProduction) {
    // Defence in depth alongside vite.config.ts server.fs: never let the dev server
    // hand out runtime data, server code, or project files.
    app.use((req: Request, res: Response, next: NextFunction) => {
      const p = decodeURIComponent(req.path).replace(/\\/g, '/').toLowerCase();
      const blocked = /(^|\/)\.(data|env|git)(\/|$)|^\/(archive|scripts|src\/server)(\/|$)|^\/[^/]+\.(ts|json|md)$/.test(p);
      if (blocked) return res.status(404).end();
      next();
    });

    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    if (!fs.existsSync(path.join(distPath, 'index.html'))) {
      throw new Error('Production mode requires a frontend build. Run "npm run build" first.');
    }
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  startScheduler();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CampusConnect Server] Running at http://0.0.0.0:${PORT} (env: ${isProduction ? 'prod' : 'dev'})`);
  });
}

// Start only when run directly (tsx server.ts), not when imported by tests
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  createServer().catch((err) => {
    console.error('[CampusConnect Fatal Server Startup Error]', err);
    process.exit(1);
  });
}
