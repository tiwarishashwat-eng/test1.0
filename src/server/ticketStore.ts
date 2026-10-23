/**
 * CampusConnect - Production Ticket Repository & Storage Engine
 * Enforces ownership access controls, IDOR protection, validated state transitions,
 * private internal staff notes, human-supervised duplicate reviews, and atomic persistence.
 */

import fs from 'fs';
import path from 'path';
import {
  Department,
  DuplicateCandidate,
  InternalStaffNote,
  StatusHistoryEntry,
  StudentTicketView,
  Ticket,
  TicketCategory,
  TicketStatus,
  User,
  STAFF_ONLY_TICKET_FIELDS,
  VALID_STATUS_TRANSITIONS
} from '../shared/types.js';
import { isDemoSeedEnabled, resolveDataDir } from './userStore.js';


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
      console.warn('[TicketStore] Could not read disk persistence, starting a fresh store:', err);
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

    // Role-based ownership restriction
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
    if (!ticket) return null;

    if (user.role === 'student') {
      if (ticket.studentId !== user.id) {
        return null; // IDOR protected
      }
      return toStudentView(ticket);
    }

    return ticket;
  }

  public createTicket(params: {
    description: string;
    location: string;
    building: string;
    roomOrArea?: string;
    category: TicketCategory;
    categorySource?: 'student' | 'ai_suggested';
    studentUser: User;
    imageBase64?: string;
    mimeType?: string;
    aiAnalysis?: any;
    studentFollowUpAnswers?: Record<string, string>;
    duplicateWarnings?: DuplicateCandidate[];
  }): Ticket {
    const id = `CC-${this.nextIdCounter++}`;
    const now = new Date().toISOString();

    const title = params.aiAnalysis?.conciseSummary
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
      internalNotes: []
    };

    this.tickets.set(id, newTicket);
    this.persistToDisk();
    return newTicket;
  }

  public assignTicket(
    id: string,
    department: Department,
    assignedTo?: string,
    priority: 'Low' | 'Medium' | 'High' | 'Emergency' = 'Medium',
    notes?: string,
    assignedByUser?: User
  ): Ticket | undefined {
    const ticket = this.getRawById(id);
    if (!ticket) return undefined;

    const now = new Date().toISOString();
    const assignedByName = assignedByUser ? assignedByUser.name : 'Staff Dispatcher';

    ticket.assignment = {
      department,
      assignedTo: assignedTo?.trim() || undefined,
      assignedAt: now,
      assignedBy: assignedByName,
      assignedById: assignedByUser?.id,
      priority,
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
        'Internet Connectivity': 0
      } as Record<TicketCategory, number>
    };

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
