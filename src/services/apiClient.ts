/**
 * CampusConnect - Frontend API Client
 * Manages authorization headers, session tokens, error parsing, and typed endpoint methods.
 */

import {
  AdminCreateStaffRequest,
  AdminUpdateStaffRequest,
  AnalyzeComplaintRequest,
  AnalyzeComplaintResponse,
  AssignTicketRequest,
  AuthResponse,
  LoginRequest,
  RegisterRequest,
  ReviewDuplicateRequest,
  StudentTicketView,
  SubmitComplaintRequest,
  SubmitComplaintResponse,
  Ticket,
  TicketDetailResponse,
  TicketHistoryResponse,
  TicketListResponse,
  UpdateTicketStatusRequest,
  User,
  AppConfig,
  AuditEntry,
  ConfigSection,
  EmergencyIncident,
  EmergencyLocation,
  EmergencyType,
  ImpactInputs,
  Incident,
  NotificationAttempt,
  NotificationProviderStatus,
  PriorityLevel,
  ProfileResponse,
  PulseSummary,
  StudentEmergencyView,
  StudentProfile,
  CampusRoom,
  CampusFacility
} from '../shared/types.js';

class ApiClient {
  private token: string | null = null;

  constructor() {
    // Restore token from localStorage if available
    try {
      this.token = localStorage.getItem('campusconnect_token');
    } catch {
      // In SSR or sandboxed environment
    }
  }

  public setToken(token: string | null) {
    this.token = token;
    try {
      if (token) {
        localStorage.setItem('campusconnect_token', token);
      } else {
        localStorage.removeItem('campusconnect_token');
      }
    } catch {
      // Ignore storage errors
    }
  }

  public getToken(): string | null {
    return this.token;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {})
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(endpoint, {
      ...options,
      headers
    });

    if (!res.ok) {
      let errorMsg = `Request failed with status ${res.status}`;
      try {
        const errorData = await res.json();
        if (errorData.error) errorMsg = errorData.error;
      } catch {
        // Fallback
      }
      throw new Error(errorMsg);
    }

    return res.json() as Promise<T>;
  }

  // --------------------------------------------------------------------------
  // AUTHENTICATION
  // --------------------------------------------------------------------------

  public async login(creds: LoginRequest): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(creds)
    });
    if (res.success && res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  public async register(payload: RegisterRequest): Promise<AuthResponse> {
    const res = await this.request<AuthResponse>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (res.success && res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  public async getCurrentUser(): Promise<{ success: boolean; user?: User }> {
    return this.request<{ success: boolean; user?: User }>('/api/auth/me');
  }

  public async logout(): Promise<{ success: boolean }> {
    try {
      await this.request<{ success: boolean }>('/api/auth/logout', { method: 'POST' });
    } catch {
      // Continue client cleanup even if network fails
    }
    this.setToken(null);
    return { success: true };
  }

  // --------------------------------------------------------------------------
  // AI TRIAGE
  // --------------------------------------------------------------------------

  public async analyzeComplaint(payload: AnalyzeComplaintRequest): Promise<AnalyzeComplaintResponse> {
    return this.request<AnalyzeComplaintResponse>('/api/complaints/analyze', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  // --------------------------------------------------------------------------
  // TICKETS
  // --------------------------------------------------------------------------

  public async submitComplaint(payload: SubmitComplaintRequest): Promise<SubmitComplaintResponse> {
    return this.request<SubmitComplaintResponse>('/api/complaints/submit', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getTickets(params?: {
    category?: string;
    status?: string;
    query?: string;
    building?: string;
    department?: string;
    priority?: string;
    from?: string;
    to?: string;
    sort?: string;
  }): Promise<TicketListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.category && params.category !== 'ALL') searchParams.set('category', params.category);
    if (params?.status && params.status !== 'ALL') searchParams.set('status', params.status);
    if (params?.department && params.department !== 'ALL') searchParams.set('department', params.department);
    if (params?.building && params.building !== 'ALL') searchParams.set('building', params.building);
    if (params?.query) searchParams.set('query', params.query);
    if (params?.priority && params.priority !== 'ALL') searchParams.set('priority', params.priority);
    if (params?.from) searchParams.set('from', params.from);
    if (params?.to) searchParams.set('to', params.to);
    if (params?.sort && params.sort !== 'newest') searchParams.set('sort', params.sort);

    const qs = searchParams.toString();
    return this.request<TicketListResponse>(`/api/tickets${qs ? `?${qs}` : ''}`);
  }

  public async getTicketById(id: string): Promise<TicketDetailResponse> {
    return this.request<TicketDetailResponse>(`/api/tickets/${encodeURIComponent(id)}`);
  }

  public async assignTicket(id: string, payload: AssignTicketRequest): Promise<{ success: boolean; ticket: Ticket; message: string }> {
    return this.request(`/api/tickets/${encodeURIComponent(id)}/assign`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateStatus(id: string, payload: UpdateTicketStatusRequest): Promise<{ success: boolean; ticket: Ticket; message: string }> {
    return this.request(`/api/tickets/${encodeURIComponent(id)}/status`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async addInternalNote(id: string, content: string): Promise<{ success: boolean; note: any; message: string }> {
    return this.request(`/api/tickets/${encodeURIComponent(id)}/notes`, {
      method: 'POST',
      body: JSON.stringify({ content })
    });
  }

  public async reviewDuplicate(id: string, payload: ReviewDuplicateRequest): Promise<{ success: boolean; ticket: Ticket; message: string }> {
    return this.request(`/api/tickets/${encodeURIComponent(id)}/duplicate-review`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async getTicketHistory(id: string): Promise<TicketHistoryResponse> {
    return this.request<TicketHistoryResponse>(`/api/tickets/${encodeURIComponent(id)}/history`);
  }

  // --------------------------------------------------------------------------
  // ADMINISTRATOR
  // --------------------------------------------------------------------------

  public async getAdminStaff(): Promise<{ success: boolean; staff: User[] }> {
    return this.request<{ success: boolean; staff: User[] }>('/api/admin/staff');
  }

  public async createStaffMember(payload: AdminCreateStaffRequest): Promise<{ success: boolean; staff: User }> {
    return this.request<{ success: boolean; staff: User }>('/api/admin/staff', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
  }

  public async updateStaffMember(id: string, payload: AdminUpdateStaffRequest): Promise<{ success: boolean; staff: User }> {
    return this.request<{ success: boolean; staff: User }>(`/api/admin/staff/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
  }

  public async getAdminMetrics(): Promise<{ success: boolean; metrics: any }> {
    return this.request<{ success: boolean; metrics: any }>('/api/admin/metrics');
  }

  public async checkHealth(): Promise<any> {
    return this.request('/api/health');
  }

  private post<T = any>(endpoint: string, body?: unknown, method = 'POST'): Promise<T> {
    return this.request<T>(endpoint, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  }

  /** Fetches a protected file (evidence photo) and returns an object URL. */
  public async fetchBlobUrl(endpoint: string): Promise<string> {
    const res = await fetch(endpoint, { headers: this.token ? { Authorization: `Bearer ${this.token}` } : {} });
    if (!res.ok) throw new Error(`Could not load file (status ${res.status})`);
    return URL.createObjectURL(await res.blob());
  }

  // --------------------------------------------------------------------------
  // PROFILE
  // --------------------------------------------------------------------------

  public getProfile(): Promise<ProfileResponse> {
    return this.request<ProfileResponse>('/api/profile');
  }

  /** Throws ApiError with fieldErrors on validation failure. */
  public async saveProfile(profile: Partial<StudentProfile>): Promise<ProfileResponse> {
    const res = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify(profile)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(json.error || `Save failed (status ${res.status})`) as Error & { fieldErrors?: Record<string, string> };
      err.fieldErrors = json.fieldErrors;
      throw err;
    }
    return json;
  }

  // --------------------------------------------------------------------------
  // EMERGENCIES & RESPONDERS
  // --------------------------------------------------------------------------

  public reportEmergency(body: { clientRequestId: string; type: EmergencyType; location: EmergencyLocation; confirmNew?: boolean }) {
    return this.post<{ success: boolean; created: boolean; possibleDuplicate: boolean; incident: StudentEmergencyView }>('/api/emergencies', body);
  }

  public getMyEmergencies() {
    return this.request<{ success: boolean; incidents: StudentEmergencyView[] }>('/api/emergencies/mine');
  }

  public getResponderIncidents() {
    return this.request<{ success: boolean; incidents: ResponderIncident[] }>('/api/responder/emergencies');
  }

  public responderAction(id: string, action: 'acknowledge' | 'responding' | 'updates' | 'close' | 'escalate', body?: Record<string, string>) {
    return this.post<{ success: boolean; incident: ResponderIncident }>(`/api/responder/emergencies/${encodeURIComponent(id)}/${action}`, body ?? {});
  }

  // --------------------------------------------------------------------------
  // TICKET OPERATIONS
  // --------------------------------------------------------------------------

  private ticketOp<T = { success: boolean; ticket: Ticket }>(id: string, op: string, body?: unknown) {
    return this.post<T>(`/api/tickets/${encodeURIComponent(id)}/${op}`, body ?? {});
  }

  public getAssignableStaff(department?: string) {
    return this.request<{ success: boolean; staff: { id: string; name: string; department?: string }[] }>(
      `/api/staff/assignable${department ? `?department=${encodeURIComponent(department)}` : ''}`
    );
  }
  public setImpact(id: string, impact: Partial<ImpactInputs>) { return this.ticketOp(id, 'impact', { impact }); }
  public overridePriority(id: string, level: PriorityLevel | null, reason: string) { return this.ticketOp(id, 'priority-override', { level, reason }); }
  public uploadResolutionProof(id: string, summary: string, imageBase64: string, mimeType: string) {
    return this.ticketOp(id, 'resolution-proof', { summary, imageBase64, mimeType });
  }
  public requestReopen(id: string, reason: string) { return this.ticketOp<{ success: boolean; ticket: StudentTicketView }>(id, 'reopen-request', { reason }); }
  public addBlocker(id: string, description: string) { return this.ticketOp(id, 'blockers', { description }); }
  public resolveBlocker(id: string, blockerId: string) { return this.ticketOp(id, `blockers/${encodeURIComponent(blockerId)}/resolve`); }
  public setEta(id: string, body: { earliest: string; latest: string; note?: string; changeReason?: string }) { return this.ticketOp(id, 'eta', body); }
  public setTicketAsset(id: string, assetId: string | null) { return this.ticketOp(id, 'asset', { assetId }); }
  public setWasteReview(id: string, status: 'confirmed' | 'rejected', note?: string) { return this.ticketOp(id, 'waste-review', { status, note }); }
  public getTiming(id: string) { return this.request<any>(`/api/tickets/${encodeURIComponent(id)}/timing`); }
  public getWorkarounds(id: string) { return this.request<any>(`/api/tickets/${encodeURIComponent(id)}/workarounds`); }
  public evidenceUrl(ticketId: string, proofId: string) {
    return `/api/tickets/${encodeURIComponent(ticketId)}/evidence/${encodeURIComponent(proofId)}`;
  }

  // --------------------------------------------------------------------------
  // INCIDENTS, INSIGHTS, CAMPUS DATA
  // --------------------------------------------------------------------------

  public getIncidents() { return this.request<{ success: boolean; incidents: Incident[] }>('/api/incidents'); }
  public createIncident(title: string, ticketIds: string[]) { return this.post<{ success: boolean; incident: Incident }>('/api/incidents', { title, ticketIds }); }
  public linkIncident(id: string, ticketId: string) { return this.post(`/api/incidents/${encodeURIComponent(id)}/link`, { ticketId }); }
  public unlinkIncident(id: string, ticketId: string, note: string) { return this.post(`/api/incidents/${encodeURIComponent(id)}/unlink`, { ticketId, note }); }
  public setIncidentStatus(id: string, status: 'reviewed' | 'dismissed' | 'resolved', note: string) {
    return this.post(`/api/incidents/${encodeURIComponent(id)}/status`, { status, note });
  }
  public getInsight(kind: 'repeat-offenders' | 'waste' | 'hotspots' | 'pulse-signals' | 'readiness') { return this.request<any>(`/api/insights/${kind}`); }
  public recordRoomCheck(roomId: string, body: { assetId?: string; result: 'working' | 'issue'; note?: string }) {
    return this.post(`/api/rooms/${encodeURIComponent(roomId)}/checks`, body);
  }
  public verifyFacility(id: string, status: 'available' | 'unavailable' | 'unknown') { return this.post(`/api/facilities/${encodeURIComponent(id)}/verify`, { status }); }
  public getCampus() {
    return this.request<{ success: boolean; buildings: { id: string; name: string; campus: string }[]; assets: { id: string; name: string; type: string; building: string; floor?: string }[]; rooms: CampusRoom[]; facilities: CampusFacility[] }>('/api/campus');
  }

  // --------------------------------------------------------------------------
  // CAMPUS PULSE
  // --------------------------------------------------------------------------

  /** Sent without the session token so the submission is not tied to the account. */
  public async submitPulse(body: { topic: string; building: string; message?: string; website?: string }) {
    const res = await fetch('/api/pulse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `Submission failed (status ${res.status})`);
    return json;
  }
  public async getPulseBuildings(): Promise<string[]> {
    const res = await fetch('/api/pulse/buildings');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || 'Could not load buildings');
    return json.buildings;
  }
  public getPulseSummary() { return this.request<{ success: boolean; summary: PulseSummary }>('/api/pulse/summary'); }

  // --------------------------------------------------------------------------
  // ADMIN CONFIGURATION
  // --------------------------------------------------------------------------

  public getAdminConfig() { return this.request<{ success: boolean; config: AppConfig; notificationProvider: NotificationProviderStatus }>('/api/admin/config'); }
  public updateConfigSection(section: ConfigSection, value: unknown) {
    return this.post<{ success: boolean; config: AppConfig }>(`/api/admin/config/${section}`, { value }, 'PUT');
  }
  public getAuditLog(limit = 200) { return this.request<{ success: boolean; entries: AuditEntry[] }>(`/api/admin/audit?limit=${limit}`); }
}

export type ResponderIncident = EmergencyIncident & {
  alertState: string;
  alertDetail: string;
  notifications: NotificationAttempt[];
};

export const apiClient = new ApiClient();
