/**
 * CampusConnect - Production Ticket Repository & Storage Engine
 * Enforces ownership access controls, IDOR protection, validated state transitions,
 * private internal staff notes, human-supervised duplicate reviews, and atomic persistence.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  AIAnalysis,
  Department,
  DuplicateCandidate,
  EtaEstimate,
  ImpactInputs,
  InternalStaffNote,
  PriorityLevel,
  ResolutionProof,
  SlaEscalation,
  StatusHistoryEntry,
  StudentTicketView,
  Ticket,
  TicketCategory,
  TicketStatus,
  TICKET_CATEGORIES,
  User,
  WasteReview,
  STAFF_ONLY_TICKET_FIELDS,
  VALID_STATUS_TRANSITIONS
} from '../shared/types.js';
import { isDemoSeedEnabled, resolveDataDir } from './userStore.js';
import { configStore } from './configStore.js';
import { assessPriority, effectivePriority } from './priorityEngine.js';
import { SYSTEM_ACTOR } from './auditStore.js';


/** Removes internal notes and staff-only duplicate review data. */
export function toStudentView(ticket: Ticket): StudentTicketView {
  const safeView: Record<string, unknown> = { ...ticket };
  for (const field of STAFF_ONLY_TICKET_FIELDS) {
    delete safeView[field];
  }
  return safeView as StudentTicketView;
}

export class TicketRepository {
  private tickets: Map<string, Ticket> = new Map();
  private nextIdCounter: number = 1005;
  private isStorageInitialized: boolean = false;
  private readonly dataDir = resolveDataDir();
  private readonly dbFile = path.join(this.dataDir, 'tickets.json');

  constructor() {
    this.initStore();
  }

  private initStore() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }

      if (fs.existsSync(this.dbFile)) {
        const raw = fs.readFileSync(this.dbFile, 'utf-8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.tickets)) {
          let orphaned = 0;
          for (const t of data.tickets) {
            // A ticket without an owner stays ownerless (staff-only). It is never
            // assigned to an arbitrary student, which would expose it to that student.
            if (!t.studentId) orphaned++;
            if (!t.internalNotes) t.internalNotes = [];
            if (!TICKET_CATEGORIES.includes(t.category)) t.category = 'Other';
            // Older records: add a priority recommendation and SLA deadline (nothing else changes)
            if (!t.priorityAssessment) this.refreshPriority(t);
            this.tickets.set(t.id, t);
          }
          if (orphaned > 0) {
            console.warn(`[TicketStore] ${orphaned} ticket(s) have no owning student and are visible to staff only.`);
          }
          if (typeof data.nextIdCounter === 'number') {
            this.nextIdCounter = data.nextIdCounter;
          }
          console.log(`[TicketStore] Loaded ${this.tickets.size} tickets from disk persistence.`);
          this.isStorageInitialized = true;
          return;
        }
      }
    } catch (err) {
      // Never overwrite a ticket file we failed to read; that would silently discard records
      if (fs.existsSync(this.dbFile)) {
        throw new Error(`[TicketStore] ${this.dbFile} exists but could not be read. Fix or move it before starting. ${err}`);
      }
      console.warn('[TicketStore] Could not initialise storage, starting a fresh store:', err);
    }

    if (isDemoSeedEnabled()) {
      this.seedDefaultTickets();
    }
    this.persistToDisk();
    this.isStorageInitialized = true;
  }

  private persistToDisk() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
      }
      const payload = {
        updatedAt: new Date().toISOString(),
        storageType: 'file-backed-json-store',
        nextIdCounter: this.nextIdCounter,
        tickets: Array.from(this.tickets.values())
      };
      const tempPath = `${this.dbFile}.tmp.${Date.now()}`;
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.dbFile);
    } catch (err) {
      console.error('[TicketStore] Failed to write to disk:', err);
    }
  }

  private seedDefaultTickets() {
    const now = Date.now();
    const timeAgo = (mins: number) => new Date(now - mins * 60 * 1000).toISOString();

    const seeds: Ticket[] = [
      {
        id: 'CC-1001',
        title: 'Continuous pipe leak under 2nd floor sink',
        description: 'Water is dripping steadily onto the tile floor from the second sink pipe in the west wing washroom. Floor is slippery.',
        rawStudentInput: 'Hey washroom near room 204 has water dripping from the sink pipe onto the floor someone might slip',
        category: 'Plumbing',
        categorySource: 'ai_suggested',
        location: 'West Wing Men\'s Restroom 2nd Floor',
        building: 'Science & Engineering Complex',
        roomOrArea: 'Restroom opposite Room 204',
        studentId: 'user-student-1',
        studentName: 'Alex Chen',
        studentEmail: 'alex.chen@campus.edu',
        status: 'In Progress',
        createdAt: timeAgo(140),
        updatedAt: timeAgo(20),
        aiAnalysis: {
          suggestedCategory: 'Plumbing',
          confidence: 'High',
          confidenceScore: 0.94,
          conciseSummary: 'Continuous pipe leak under washbasin causing slip hazard.',
          recommendedDepartment: 'Plumbing Maintenance Department',
          departmentRoutingReason: 'Water pipe leak requiring fixture replacement',
          missingDetailsIdentified: [],
          followUpQuestions: [],
          urgencyAssessment: 'Moderate',
          analyzedAt: timeAgo(140)
        },
        assignment: {
          department: 'Plumbing Maintenance Department',
          assignedTo: 'Carlos Rivera (Master Plumber)',
          assignedToId: 'user-staff-2',
          assignedAt: timeAgo(90),
          assignedBy: 'Sarah Martinez (Triage Supervisor)',
          priority: 'High',
          notes: 'Dispatched with replacement P-trap seal and warning cones.'
        },
        internalNotes: [
          {
            id: 'note-1',
            ticketId: 'CC-1001',
            authorId: 'user-staff-2',
            authorName: 'Carlos Rivera (Master Plumber)',
            content: 'Turned off isolation valve under sink 2. Awaiting 1.5 inch slip joint washer from central depot.',
            createdAt: timeAgo(30)
          }
        ],
        statusHistory: [
          {
            id: 'h-1',
            ticketId: 'CC-1001',
            toStatus: 'Submitted',
            changedAt: timeAgo(140),
            changedBy: 'Alex Chen (Student)',
            notes: 'Complaint submitted through student portal.'
          },
          {
            id: 'h-2',
            ticketId: 'CC-1001',
            fromStatus: 'Submitted',
            toStatus: 'Under Review',
            changedAt: timeAgo(110),
            changedBy: 'Sarah Martinez (Triage Supervisor)',
            notes: 'Verified location and slip hazard potential.'
          },
          {
            id: 'h-3',
            ticketId: 'CC-1001',
            fromStatus: 'Under Review',
            toStatus: 'Assigned',
            changedAt: timeAgo(90),
            changedBy: 'Sarah Martinez (Triage Supervisor)',
            notes: 'Assigned to Plumbing Maintenance Division.'
          },
          {
            id: 'h-4',
            ticketId: 'CC-1001',
            fromStatus: 'Assigned',
            toStatus: 'In Progress',
            changedAt: timeAgo(20),
            changedBy: 'Carlos Rivera (Master Plumber)',
            notes: 'On site, valve shut off, currently fitting new pipe connector.'
          }
        ]
      },
      {
        id: 'CC-1002',
        title: 'Lecture hall 101 power socket sparking and tripped breaker',
        description: 'The surge strip plug at desk row 3 sparked when a student plugged in their laptop. Burning ozone smell noticed.',
        rawStudentInput: 'There was a spark and popping sound from row 3 plug in hall 101 during physics lecture. Outlet smells burnt.',
        category: 'Electricity',
        categorySource: 'ai_suggested',
        location: 'Lecture Hall 101, Row 3 Desk Strip',
        building: 'Main Academic Quad',
        roomOrArea: 'Hall 101',
        studentId: 'user-student-2',
        studentName: 'Priya Patel',
        studentEmail: 'priya.patel@campus.edu',
        status: 'Assigned',
        createdAt: timeAgo(75),
        updatedAt: timeAgo(45),
        aiAnalysis: {
          suggestedCategory: 'Electricity',
          confidence: 'High',
          confidenceScore: 0.98,
          conciseSummary: 'Power strip electrical arc spark and ozone odor in lecture hall.',
          recommendedDepartment: 'Electrical Systems & Safety Division',
          departmentRoutingReason: 'Live electrical arcing is an immediate safety concern',
          missingDetailsIdentified: [],
          followUpQuestions: [],
          urgencyAssessment: 'Safety Hazard',
          analyzedAt: timeAgo(75)
        },
        assignment: {
          department: 'Electrical Systems & Safety Division',
          assignedTo: 'Marcus Vance (Senior Electrician)',
          assignedToId: 'user-staff-3',
          assignedAt: timeAgo(45),
          assignedBy: 'Sarah Martinez (Triage Supervisor)',
          priority: 'Emergency',
          notes: 'Circuit 12B breaker locked out remotely, electrician inspecting wiring.'
        },
        internalNotes: [
          {
            id: 'note-2',
            ticketId: 'CC-1002',
            authorId: 'user-staff-3',
            authorName: 'Marcus Vance (Senior Electrician)',
            content: 'Breaker panel 4 lock-out tag placed. Student laptop charger had a shorted neutral prong.',
            createdAt: timeAgo(40)
          }
        ],
        statusHistory: [
          {
            id: 'h-5',
            ticketId: 'CC-1002',
            toStatus: 'Submitted',
            changedAt: timeAgo(75),
            changedBy: 'Priya Patel (Student)',
            notes: 'Urgent electrical hazard reported.'
          },
          {
            id: 'h-6',
            ticketId: 'CC-1002',
            fromStatus: 'Submitted',
            toStatus: 'Assigned',
            changedAt: timeAgo(45),
            changedBy: 'Sarah Martinez (Triage Supervisor)',
            notes: 'Fast-tracked directly to Electrical Systems due to safety rating.'
          }
        ]
      },
      {
        id: 'CC-1003',
        title: 'Recycling station overflow and sticky beverage spill',
        description: 'Large soda cups and food containers spilled across floor by the central courtyard entry stairs. High foot traffic.',
        rawStudentInput: 'Huge spill near courtyard stairs and trash bins are overflowing with drink cups everywhere',
        category: 'Cleanliness',
        categorySource: 'student',
        location: 'Courtyard Entry Foyer, Ground Floor',
        building: 'Student Union Center',
        roomOrArea: 'Stairwell B Entrance',
        studentId: 'user-student-1',
        studentName: 'Alex Chen',
        studentEmail: 'alex.chen@campus.edu',
        status: 'Under Review',
        createdAt: timeAgo(50),
        updatedAt: timeAgo(30),
        aiAnalysis: {
          suggestedCategory: 'Cleanliness',
          confidence: 'High',
          confidenceScore: 0.92,
          conciseSummary: 'Overfilled waste receptacles and sticky liquid spill at primary stairwell.',
          recommendedDepartment: 'Campus Custodial & Sanitation Services',
          departmentRoutingReason: 'Sanitation and waste clearing required',
          missingDetailsIdentified: [],
          followUpQuestions: [],
          urgencyAssessment: 'Moderate',
          analyzedAt: timeAgo(50)
        },
        internalNotes: [],
        statusHistory: [
          {
            id: 'h-7',
            ticketId: 'CC-1003',
            toStatus: 'Submitted',
            changedAt: timeAgo(50),
            changedBy: 'Alex Chen (Student)',
            notes: 'Cleanliness service request logged.'
          },
          {
            id: 'h-8',
            ticketId: 'CC-1003',
            fromStatus: 'Submitted',
            toStatus: 'Under Review',
            changedAt: timeAgo(30),
            changedBy: 'Sarah Martinez (Triage Supervisor)',
            notes: 'Custodial team lead notified for sweep.'
          }
        ]
      },
      {
        id: 'CC-1004',
        title: 'eduroam Wi-Fi drops continually in 3rd floor quiet zone',
        description: 'Access Point AP-North-3F appears to be failing DHCP leases or rejecting auth. 20+ study desks unable to connect.',
        rawStudentInput: 'Internet keeps disconnecting every minute on the 3rd floor library. None of our laptops can stay on eduroam.',
        category: 'Internet Connectivity',
        categorySource: 'ai_suggested',
        location: '3rd Floor North Quiet Study Wing',
        building: 'University Memorial Library',
        roomOrArea: 'Desks 301-325',
        studentId: 'user-student-2',
        studentName: 'Priya Patel',
        studentEmail: 'priya.patel@campus.edu',
        status: 'Resolved',
        createdAt: timeAgo(320),
        updatedAt: timeAgo(60),
        resolvedAt: timeAgo(60),
        aiAnalysis: {
          suggestedCategory: 'Internet Connectivity',
          confidence: 'High',
          confidenceScore: 0.95,
          conciseSummary: 'Repeated wireless disconnection and DHCP negotiation failures on Library 3F AP.',
          recommendedDepartment: 'IT & Network Infrastructure Team',
          departmentRoutingReason: 'Campus Wi-Fi hardware and network switch service',
          missingDetailsIdentified: [],
          followUpQuestions: [],
          urgencyAssessment: 'Moderate',
          analyzedAt: timeAgo(320)
        },
        assignment: {
          department: 'IT & Network Infrastructure Team',
          assignedTo: 'Maya Lin (NOC Wireless Engineer)',
          assignedToId: 'user-staff-5',
          assignedAt: timeAgo(280),
          assignedBy: 'Sarah Martinez (Triage Supervisor)',
          priority: 'High',
          notes: 'Remote diagnostics performed on Cisco AP-302.'
        },
        internalNotes: [
          {
            id: 'note-3',
            ticketId: 'CC-1004',
            authorId: 'user-staff-5',
            authorName: 'Maya Lin (NOC Wireless Engineer)',
            content: 'PoE port power reset on IDF-3 switch. Firmware pushed successfully.',
            createdAt: timeAgo(65)
          }
        ],
        statusHistory: [
          {
            id: 'h-9',
            ticketId: 'CC-1004',
            toStatus: 'Submitted',
            changedAt: timeAgo(320),
            changedBy: 'Priya Patel (Student)',
            notes: 'Network connectivity ticket generated.'
          },
          {
            id: 'h-10',
            ticketId: 'CC-1004',
            fromStatus: 'Submitted',
            toStatus: 'Assigned',
            changedAt: timeAgo(280),
            changedBy: 'Sarah Martinez (Triage Supervisor)',
            notes: 'Routed to campus wireless engineering.'
          },
          {
            id: 'h-11',
            ticketId: 'CC-1004',
            fromStatus: 'Assigned',
            toStatus: 'In Progress',
            changedAt: timeAgo(150),
            changedBy: 'Maya Lin (NOC Wireless Engineer)',
            notes: 'Rebooted local PoE switch port and updated AP firmware.'
          },
          {
            id: 'h-12',
            ticketId: 'CC-1004',
            fromStatus: 'In Progress',
            toStatus: 'Resolved',
            changedAt: timeAgo(60),
            changedBy: 'Maya Lin (NOC Wireless Engineer)',
            notes: 'AP rebooted and ping stability verified across all 24 connected clients.'
          }
        ]
      }
    ];

    for (const s of seeds) {
      this.tickets.set(s.id, s);
    }
  }

  /**
   * Retrieves all tickets with role-based filtering:
   * - Students ONLY see their own tickets.
   * - Internal notes are stripped for students.
   * - Staff/Admins see all tickets matching query filters.
   */
  public getTicketsForUser(
    user: User,
    filters?: {
      category?: string;
      status?: string;
      query?: string;
      building?: string;
      department?: string;
    }
  ): Ticket[] | StudentTicketView[] {
    let list = Array.from(this.tickets.values());

    // Role-based ownership restriction. Responders have emergency access only, never maintenance tickets.
    if (user.role === 'responder') return [];
    if (user.role === 'student') {
      list = list.filter((t) => t.studentId === user.id);
    }

    if (filters?.category && filters.category !== 'ALL') {
      list = list.filter((t) => t.category === filters.category);
    }

    if (filters?.status && filters.status !== 'ALL') {
      list = list.filter((t) => t.status === filters.status);
    }

    if (filters?.department && filters.department !== 'ALL') {
      list = list.filter((t) => t.assignment?.department === filters.department);
    }

    if (filters?.building && filters.building !== 'ALL') {
      list = list.filter((t) => t.building.toLowerCase().includes(filters.building!.toLowerCase()));
    }

    if (filters?.query && filters.query.trim()) {
      const q = filters.query.toLowerCase().trim();
      list = list.filter(
        (t) =>
          t.id.toLowerCase().includes(q) ||
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.location.toLowerCase().includes(q) ||
          t.building.toLowerCase().includes(q) ||
          t.studentName.toLowerCase().includes(q)
      );
    }

    // Sort newest first
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    // Strip staff-only fields if requesting user is a student
    if (user.role === 'student') {
      return list.map(toStudentView);
    }

    return list;
  }

  /**
   * Every ticket, unfiltered, for server-side processing such as duplicate detection.
   * Never return this directly to a client.
   */
  public getAllTicketsForSystem(): Ticket[] {
    return Array.from(this.tickets.values());
  }

  /**
   * Internal method to fetch a raw ticket for server-side processing
   */
  public getRawById(id: string): Ticket | undefined {
    const cleanId = id.trim().toUpperCase();
    return this.tickets.get(cleanId);
  }

  /**
   * Secure lookup by ID with ownership enforcement:
   * Returns null if student attempts to read another user's ticket (IDOR prevention).
   */
  public getByIdForUser(id: string, user: User): Ticket | StudentTicketView | null {
    const ticket = this.getRawById(id);
    if (!ticket || user.role === 'responder') return null;

    if (user.role === 'student') {
      if (ticket.studentId !== user.id) {
        return null; // IDOR protected
      }
      return toStudentView(ticket);
    }

    return ticket;
  }

  /** Returns an existing ticket for a retried submission (same user + idempotency key). */
  public findBySubmissionId(studentId: string, clientSubmissionId: string): Ticket | undefined {
    for (const t of this.tickets.values()) {
      if (t.studentId === studentId && t.clientSubmissionId === clientSubmissionId) return t;
    }
    return undefined;
  }

  public createTicket(params: {
    description: string;
    location: string;
    building: string;
    roomOrArea?: string;
    campus?: string;
    floor?: string;
    problemTitle?: string;
    category: TicketCategory;
    categorySource?: 'student' | 'ai_suggested';
    studentUser: User;
    imageBase64?: string;
    mimeType?: string;
    aiAnalysis?: AIAnalysis;
    studentFollowUpAnswers?: Record<string, string>;
    duplicateWarnings?: DuplicateCandidate[];
    impact?: ImpactInputs;
    assetId?: string;
    clientSubmissionId?: string;
  }): Ticket {
    const id = `CC-${this.nextIdCounter++}`;
    const now = new Date().toISOString();

    const title = params.problemTitle
      ? params.problemTitle.slice(0, 90)
      : params.aiAnalysis?.conciseSummary
      ? params.aiAnalysis.conciseSummary.slice(0, 90)
      : params.description.slice(0, 80);

    const initialHistoryEntry: StatusHistoryEntry = {
      id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      ticketId: id,
      toStatus: 'Submitted',
      changedAt: now,
      changedBy: `${params.studentUser.name} (Student)`,
      changedById: params.studentUser.id,
      notes: 'Complaint submitted through student portal.'
    };

    let imageDataUri: string | undefined = undefined;
    if (params.imageBase64 && params.mimeType) {
      imageDataUri = `data:${params.mimeType};base64,${params.imageBase64.replace(/^data:[^;]+;base64,/, '')}`;
    }

    const newTicket: Ticket = {
      id,
      title,
      description: params.description,
      rawStudentInput: params.description,
      category: params.category,
      categorySource: params.categorySource || 'student',
      location: params.location,
      building: params.building,
      roomOrArea: params.roomOrArea,
      studentId: params.studentUser.id,
      studentName: params.studentUser.name,
      studentEmail: params.studentUser.email,
      imageDataUri,
      status: 'Submitted',
      createdAt: now,
      updatedAt: now,
      aiAnalysis: params.aiAnalysis,
      statusHistory: [initialHistoryEntry],
      duplicateWarnings: params.duplicateWarnings || [],
      studentFollowUpAnswers: params.studentFollowUpAnswers || {},
      problemTitle: params.problemTitle,
      campus: params.campus,
      floor: params.floor,
      impact: params.impact,
      assetId: params.assetId,
      clientSubmissionId: params.clientSubmissionId,
      internalNotes: []
    };

    this.refreshPriority(newTicket);
    this.tickets.set(id, newTicket);
    this.persistToDisk();
    return newTicket;
  }

  // --------------------------------------------------------------------------
  // Priority & SLA (deterministic; see priorityEngine.ts)
  // --------------------------------------------------------------------------

  /** Recomputes the recommendation and the SLA deadline for the effective priority. */
  private refreshPriority(ticket: Ticket, now = new Date()) {
    const inActiveCluster = (ticket.clusterReporters ?? 0) > 0;
    ticket.priorityAssessment = assessPriority(ticket, { now, inActiveCluster, clusterReporters: ticket.clusterReporters });
    const hours = configStore.slaHoursFor(ticket.category, effectivePriority(ticket));
    ticket.slaDeadline = new Date(new Date(ticket.createdAt).getTime() + hours * 3600 * 1000).toISOString();
    // A newly-overdue ticket gets the overdue factor on the next pass
    if (ticket.status !== 'Resolved' && new Date(ticket.slaDeadline).getTime() < now.getTime()) {
      ticket.priorityAssessment = assessPriority(ticket, { now, inActiveCluster, clusterReporters: ticket.clusterReporters });
    }
  }

  private pushHistory(ticket: Ticket, actor: Pick<User, 'id' | 'name'>, notes: string, toStatus?: TicketStatus, fromStatus?: TicketStatus) {
    ticket.statusHistory.push({
      id: `hist-${crypto.randomUUID()}`,
      ticketId: ticket.id,
      fromStatus,
      toStatus: toStatus ?? ticket.status,
      changedAt: new Date().toISOString(),
      changedBy: actor.name,
      changedById: actor.id,
      notes
    });
    ticket.updatedAt = new Date().toISOString();
  }

  public setImpact(id: string, impact: ImpactInputs, actor: User): Ticket | null {
    const ticket = this.getRawById(id);
    if (!ticket) return null;
    ticket.impact = impact;
    this.refreshPriority(ticket);
    this.pushHistory(ticket, actor, `Impact details updated. Recommended priority: ${ticket.priorityAssessment!.level}.`);
    this.persistToDisk();
    return ticket;
  }

  public overridePriority(id: string, level: PriorityLevel | null, reason: string, actor: User): Ticket | null {
    const ticket = this.getRawById(id);
    if (!ticket) return null;
    const previous = effectivePriority(ticket);
    ticket.priorityOverride = level
      ? { level, reason, by: actor.name, byId: actor.id, at: new Date().toISOString() }
      : undefined;
    this.refreshPriority(ticket);
    this.pushHistory(
      ticket,
      actor,
      level ? `Priority overridden from ${previous} to ${level}. Reason: ${reason}` : `Priority override removed. Reason: ${reason}`
    );
    this.persistToDisk();
    return ticket;
  }

  /** Called by the incident service whenever incident membership changes. */
  public setIncidentLinks(id: string, incidentIds: string[], clusterReporters: number | undefined) {
    const ticket = this.getRawById(id);
    if (!ticket) return;
    ticket.incidentIds = incidentIds;
    ticket.clusterReporters = clusterReporters;
    this.refreshPriority(ticket);
    this.persistToDisk();
  }

  public excludeFromCluster(id: string, incidentId: string) {
    const ticket = this.getRawById(id);
    if (!ticket) return;
    ticket.clusterExclusions = [...new Set([...(ticket.clusterExclusions ?? []), incidentId])];
    this.persistToDisk();
  }

  /** Re-evaluates every open ticket (overdue factor changes with time). Returns tickets now overdue. */
  public refreshAllPriorities(now = new Date()): Ticket[] {
    const overdue: Ticket[] = [];
    for (const t of this.tickets.values()) {
      if (t.status === 'Resolved') continue;
      this.refreshPriority(t, now);
      if (t.slaDeadline && new Date(t.slaDeadline).getTime() < now.getTime()) overdue.push(t);
    }
    this.persistToDisk();
    return overdue;
  }

  public recordSlaEscalation(id: string, escalation: SlaEscalation) {
    const ticket = this.getRawById(id);
    if (!ticket) return;
    ticket.slaEscalations = [...(ticket.slaEscalations ?? []), escalation];
    this.pushHistory(ticket, SYSTEM_ACTOR, `SLA escalation level ${escalation.level}: ${escalation.reason} Escalated to ${escalation.nextAuthority}.`);
    this.persistToDisk();
  }

  // --------------------------------------------------------------------------
  // Proof of fix, reopening, blockers, ETA, assets, waste review
  // --------------------------------------------------------------------------

  /** The proof that currently satisfies the Resolved requirement, if any. */
  public currentProof(ticket: Ticket): ResolutionProof | undefined {
    return [...(ticket.resolutionProofs ?? [])].reverse().find((p) => !p.superseded);
  }

  public addResolutionProof(id: string, proof: ResolutionProof, actor: User): Ticket | null {
    const ticket = this.getRawById(id);
    if (!ticket) return null;
    // Replacing evidence keeps the old record, marked superseded
    for (const p of ticket.resolutionProofs ?? []) p.superseded = true;
    ticket.resolutionProofs = [...(ticket.resolutionProofs ?? []), proof];
    this.pushHistory(ticket, actor, `Proof of fix uploaded: ${proof.summary}`);
    this.persistToDisk();
    return ticket;
  }

  public requestReopen(id: string, student: User, reason: string): { ticket?: Ticket; error?: string; status: number } {
    const ticket = this.getRawById(id);
    if (!ticket || ticket.studentId !== student.id) return { error: 'No ticket with that ID was found in your complaints.', status: 404 };
    if (ticket.status !== 'Resolved') return { error: 'Only resolved tickets can be reported as not fixed.', status: 409 };
    const previous = ticket.status;
    ticket.reopenRequests = [
      ...(ticket.reopenRequests ?? []),
      { id: `reopen-${crypto.randomUUID()}`, reason, requestedAt: new Date().toISOString(), requestedById: student.id }
    ];
    // Existing proof no longer counts; staff must upload new evidence to resolve again
    for (const p of ticket.resolutionProofs ?? []) p.superseded = true;
    ticket.status = 'Under Review';
    ticket.resolvedAt = undefined;
    this.pushHistory(ticket, student, `Student reported the repair was unsuccessful and requested review: ${reason}`, 'Under Review', previous);
    this.refreshPriority(ticket);
    this.persistToDisk();
    return { ticket, status: 200 };
  }

  public addBlocker(id: string, description: string, actor: User): Ticket | null {
    const ticket = this.getRawById(id);
    if (!ticket) return null;
    ticket.blockers = [
      ...(ticket.blockers ?? []),
      { id: `blk-${crypto.randomUUID()}`, description, createdAt: new Date().toISOString(), createdBy: actor.name }
    ];
    this.pushHistory(ticket, actor, `Blocker added: ${description}`);
    this.persistToDisk();
    return ticket;
  }

  public resolveBlocker(id: string, blockerId: string, actor: User): Ticket | null {
    const ticket = this.getRawById(id);
    const blocker = ticket?.blockers?.find((b) => b.id === blockerId && !b.resolvedAt);
    if (!ticket || !blocker) return null;
    blocker.resolvedAt = new Date().toISOString();
    blocker.resolvedBy = actor.name;
    this.pushHistory(ticket, actor, `Blocker cleared: ${blocker.description}`);
    this.persistToDisk();
    return ticket;
  }

  public setEta(id: string, eta: Omit<EtaEstimate, 'setBy' | 'setAt'>, actor: User): Ticket | null {
    const ticket = this.getRawById(id);
    if (!ticket) return null;
    const entry: EtaEstimate = { ...eta, setBy: actor.name, setAt: new Date().toISOString() };
    if (ticket.etaEstimate) ticket.etaHistory = [...(ticket.etaHistory ?? []), ticket.etaEstimate];
    ticket.etaEstimate = entry;
    const window = `${new Date(eta.earliest).toISOString()} – ${new Date(eta.latest).toISOString()}`;
    this.pushHistory(ticket, actor, `Staff estimate updated to ${window}${eta.changeReason ? `. Reason: ${eta.changeReason}` : ''}`);
    this.persistToDisk();
    return ticket;
  }

  public setAsset(id: string, assetId: string | undefined, actor: User): Ticket | null {
    const ticket = this.getRawById(id);
    if (!ticket) return null;
    ticket.assetId = assetId;
    this.pushHistory(ticket, actor, assetId ? `Linked to asset ${assetId}` : 'Asset link removed');
    this.persistToDisk();
    return ticket;
  }

  public setWasteReview(id: string, review: WasteReview, actor: User): Ticket | null {
    const ticket = this.getRawById(id);
    if (!ticket) return null;
    ticket.wasteReview = review;
    this.pushHistory(ticket, actor, `Resource-waste report ${review.status}${review.note ? `: ${review.note}` : ''}`);
    this.persistToDisk();
    return ticket;
  }

  /**
   * Assigns a ticket to a department and, optionally, a specific staff account.
   * The caller must have validated that `assignee` is an active staff member of `department`.
   */
  public assignTicket(
    id: string,
    department: Department,
    assignee: User | undefined,
    notes: string | undefined,
    assignedByUser: User
  ): Ticket | undefined {
    const ticket = this.getRawById(id);
    if (!ticket) return undefined;

    const now = new Date().toISOString();
    const assignedByName = assignedByUser.name;
    const assignedTo = assignee?.name;

    ticket.assignment = {
      department,
      assignedTo,
      assignedToId: assignee?.id,
      assignedAt: now,
      assignedBy: assignedByName,
      assignedById: assignedByUser.id,
      notes: notes?.trim() || undefined
    };

    const previousStatus = ticket.status;
    if (ticket.status === 'Submitted' || ticket.status === 'Under Review') {
      ticket.status = 'Assigned';
    }

    ticket.updatedAt = now;
    ticket.statusHistory.push({
      id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      ticketId: id,
      fromStatus: previousStatus,
      toStatus: ticket.status,
      changedAt: now,
      changedBy: assignedByName,
      changedById: assignedByUser?.id,
      notes: `Assigned to ${department}${assignedTo ? ` (${assignedTo})` : ''}.${notes ? ` Note: ${notes}` : ''}`
    });

    this.persistToDisk();
    return ticket;
  }

  public updateStatus(
    id: string,
    newStatus: TicketStatus,
    notes?: string,
    changedByUser?: User
  ): { success: boolean; ticket?: Ticket; error?: string } {
    const ticket = this.getRawById(id);
    if (!ticket) {
      return { success: false, error: `Ticket ${id} not found` };
    }

    // Validate workflow state transition
    const allowed = VALID_STATUS_TRANSITIONS[ticket.status] || [];
    if (!allowed.includes(newStatus)) {
      return {
        success: false,
        error: `Invalid transition from "${ticket.status}" to "${newStatus}". Allowed transitions: ${allowed.join(', ') || 'None'}`
      };
    }

    // Proof of fix: Resolved requires a current (non-superseded) summary + photo
    if (newStatus === 'Resolved' && !this.currentProof(ticket)) {
      return {
        success: false,
        error: 'Upload proof of fix (resolution summary and photo) before marking this ticket Resolved.'
      };
    }

    const previousStatus = ticket.status;
    const now = new Date().toISOString();
    const changerName = changedByUser ? changedByUser.name : 'Staff Dispatcher';

    ticket.status = newStatus;
    ticket.updatedAt = now;

    if (newStatus === 'Resolved') {
      ticket.resolvedAt = now;
    } else {
      ticket.resolvedAt = undefined;
    }

    ticket.statusHistory.push({
      id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      ticketId: id,
      fromStatus: previousStatus,
      toStatus: newStatus,
      changedAt: now,
      changedBy: changerName,
      changedById: changedByUser?.id,
      notes: notes || `Status transitioned to ${newStatus}`
    });

    // Reopening without a student request: old evidence no longer proves the current state
    if (previousStatus === 'Resolved') {
      for (const p of ticket.resolutionProofs ?? []) p.superseded = true;
    }

    this.refreshPriority(ticket);
    this.persistToDisk();
    return { success: true, ticket };
  }

  public addInternalNote(ticketId: string, author: User, content: string): InternalStaffNote | null {
    const ticket = this.getRawById(ticketId);
    if (!ticket) return null;

    if (!ticket.internalNotes) {
      ticket.internalNotes = [];
    }

    const note: InternalStaffNote = {
      id: `note-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      ticketId: ticket.id,
      authorId: author.id,
      authorName: author.name,
      content: content.trim(),
      createdAt: new Date().toISOString()
    };

    ticket.internalNotes.push(note);
    ticket.updatedAt = new Date().toISOString();
    this.persistToDisk();
    return note;
  }

  public reviewDuplicate(
    ticketId: string,
    decision: 'confirmed' | 'dismissed',
    reviewer: User,
    note?: string
  ): Ticket | null {
    const ticket = this.getRawById(ticketId);
    if (!ticket) return null;

    ticket.duplicateReviewed = true;
    ticket.duplicateReviewDecision = decision;
    ticket.duplicateReviewNote = note?.trim() || undefined;
    ticket.duplicateReviewedBy = reviewer.name;
    ticket.updatedAt = new Date().toISOString();

    ticket.statusHistory.push({
      id: `hist-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      ticketId: ticket.id,
      toStatus: ticket.status,
      changedAt: new Date().toISOString(),
      changedBy: reviewer.name,
      changedById: reviewer.id,
      notes: `Staff duplicate review: ${decision.toUpperCase()}${note ? ` - ${note}` : ''}`
    });

    this.persistToDisk();
    return ticket;
  }

  public getStatsForUser(user: User) {
    const all = this.getTicketsForUser(user);
    const stats = {
      total: all.length,
      submitted: 0,
      underReview: 0,
      assigned: 0,
      inProgress: 0,
      resolved: 0,
      byCategory: {
        'Plumbing': 0,
        'Electricity': 0,
        'Cleanliness': 0,
        'Internet Connectivity': 0,
        'Other': 0
      } as Record<TicketCategory, number>,
      byPriority: { Low: 0, Medium: 0, High: 0, Critical: 0 } as Record<PriorityLevel, number>,
      overdue: 0
    };
    const nowMs = Date.now();
    for (const t of all as Ticket[]) {
      if (t.status === 'Resolved') continue;
      stats.byPriority[effectivePriority(t)]++;
      if (t.slaDeadline && new Date(t.slaDeadline).getTime() < nowMs) stats.overdue++;
    }

    for (const t of all) {
      if (t.status === 'Submitted') stats.submitted++;
      else if (t.status === 'Under Review') stats.underReview++;
      else if (t.status === 'Assigned') stats.assigned++;
      else if (t.status === 'In Progress') stats.inProgress++;
      else if (t.status === 'Resolved') stats.resolved++;

      if (stats.byCategory[t.category] !== undefined) {
        stats.byCategory[t.category]++;
      }
    }

    return stats;
  }

  public getStorageStatus() {
    return {
      storageType: 'Persistent File-Backed JSON Store',
      storageFile: this.dbFile,
      isInitialized: this.isStorageInitialized,
      recordCount: this.tickets.size
    };
  }
}

export const ticketRepository = new TicketRepository();
