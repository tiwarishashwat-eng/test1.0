/**
 * Outbound notifications for emergency alerts and SLA escalations.
 *
 * Provider: a signed HTTPS webhook (NOTIFY_WEBHOOK_URL). Point it at an SMS/voice/
 * paging relay you operate (e.g. a Twilio Function, n8n, or your campus paging API).
 *
 * Truthfulness rules:
 *  - "accepted" means the provider returned 2xx; it is NOT proof of delivery.
 *  - "delivered" is set only by a signed delivery receipt (POST /api/notifications/receipt).
 *  - Without a configured provider, attempts are recorded as "not_configured" and nothing
 *    is claimed to have been sent.
 *  - Each attempt has an idempotency key; creating the same key twice returns the existing
 *    record, so scheduler retries never send duplicates.
 */
import crypto from 'crypto';
import { NotificationAttempt, NotificationProviderStatus, User } from '../shared/types.js';
import { dataPath, newId, readJsonFile, writeJsonFileAtomic } from './jsonFile.js';

export interface OutboundMessage {
  idempotencyKey: string;
  purpose: NotificationAttempt['purpose'];
  subjectId: string;
  recipient: Pick<User, 'id' | 'name' | 'email' | 'phone' | 'role'>;
  subject: string;
  body: string;
}

export interface ProviderResult {
  status: 'accepted' | 'failed';
  providerMessageId?: string;
  error?: string;
  retryable?: boolean;
}

export interface NotificationProvider {
  name: 'webhook';
  send(message: OutboundMessage): Promise<ProviderResult>;
}

const MAX_ATTEMPTS = 3;
const WEBHOOK_TIMEOUT_MS = 10000;

function webhookProviderFromEnv(): NotificationProvider | null {
  const url = process.env.NOTIFY_WEBHOOK_URL?.trim();
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error('[Notifications] NOTIFY_WEBHOOK_URL is not a valid URL; notifications disabled.');
    return null;
  }
  if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    console.error('[Notifications] NOTIFY_WEBHOOK_URL must use https; notifications disabled.');
    return null;
  }
  const secret = process.env.NOTIFY_WEBHOOK_SECRET || '';
  return {
    name: 'webhook',
    async send(message) {
      const body = JSON.stringify({
        idempotencyKey: message.idempotencyKey,
        purpose: message.purpose,
        subjectId: message.subjectId,
        recipient: {
          id: message.recipient.id,
          name: message.recipient.name,
          phone: message.recipient.phone,
          email: message.recipient.email,
          role: message.recipient.role
        },
        subject: message.subject,
        body: message.body
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);
      try {
        const res = await fetch(parsed, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': message.idempotencyKey,
            ...(secret ? { 'X-CampusConnect-Signature': crypto.createHmac('sha256', secret).update(body).digest('hex') } : {})
          },
          body,
          signal: controller.signal
        });
        if (!res.ok) {
          return { status: 'failed', error: `Provider responded ${res.status}`, retryable: res.status >= 500 || res.status === 429 };
        }
        let providerMessageId: string | undefined;
        try {
          const json: any = await res.json();
          providerMessageId = typeof json?.id === 'string' ? json.id : undefined;
        } catch {
          /* body is optional */
        }
        return { status: 'accepted', providerMessageId };
      } catch (err: any) {
        return { status: 'failed', error: err?.name === 'AbortError' ? 'Provider timed out' : 'Network error contacting provider', retryable: true };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

let providerOverride: NotificationProvider | null | undefined = undefined;

/** Test hook: inject a mock provider, `null` for "not configured", `undefined` to reset. */
export function setNotificationProviderForTesting(provider: NotificationProvider | null | undefined) {
  providerOverride = provider;
}

function getProvider(): NotificationProvider | null {
  return providerOverride !== undefined ? providerOverride : webhookProviderFromEnv();
}

export function getNotificationProviderStatus(): NotificationProviderStatus {
  const provider = getProvider();
  let endpointHost: string | undefined;
  try {
    endpointHost = process.env.NOTIFY_WEBHOOK_URL ? new URL(process.env.NOTIFY_WEBHOOK_URL).host : undefined;
  } catch {
    endpointHost = undefined;
  }
  return {
    provider: provider ? 'webhook' : 'none',
    configured: Boolean(provider),
    endpointHost: provider ? endpointHost : undefined,
    receiptsEnabled: Boolean(process.env.NOTIFY_RECEIPT_SECRET)
  };
}

export class NotificationStore {
  private readonly file = dataPath('notifications.json');
  private attempts = new Map<string, NotificationAttempt>();
  private byKey = new Map<string, string>();
  private inFlight = new Set<Promise<void>>();
  private retryPayloads = new Map<string, OutboundMessage>();

  constructor() {
    const stored = readJsonFile<{ attempts: NotificationAttempt[] }>(this.file);
    for (const a of stored?.attempts ?? []) {
      // A process restart mid-send leaves "sending"; we cannot know the outcome
      if (a.status === 'sending') {
        a.status = 'failed';
        a.error = 'Server restarted before the provider responded; outcome unknown';
      }
      this.attempts.set(a.id, a);
      this.byKey.set(a.idempotencyKey, a.id);
    }
  }

  private persist() {
    writeJsonFileAtomic(this.file, { attempts: [...this.attempts.values()] });
  }

  get(id: string) {
    return this.attempts.get(id);
  }

  listFor(subjectId: string): NotificationAttempt[] {
    return [...this.attempts.values()].filter((a) => a.subjectId === subjectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /**
   * Creates (or returns the existing) attempt for this idempotency key and starts
   * sending it in the background. Never awaits the provider.
   */
  enqueue(message: OutboundMessage): NotificationAttempt {
    const existingId = this.byKey.get(message.idempotencyKey);
    if (existingId) return this.attempts.get(existingId)!;

    const provider = getProvider();
    const now = new Date().toISOString();
    const hasContact = Boolean(message.recipient.phone || message.recipient.email);
    const attempt: NotificationAttempt = {
      id: newId('ntf'),
      idempotencyKey: message.idempotencyKey,
      purpose: message.purpose,
      subjectId: message.subjectId,
      recipientId: message.recipient.id,
      recipientName: message.recipient.name,
      channel: provider ? 'webhook' : 'none',
      status: !provider ? 'not_configured' : !hasContact ? 'no_contact' : 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now
    };
    this.attempts.set(attempt.id, attempt);
    this.byKey.set(attempt.idempotencyKey, attempt.id);
    this.persist();

    if (provider && hasContact) {
      this.retryPayloads.set(attempt.id, message);
      this.track(this.dispatch(attempt.id, provider));
    }
    return attempt;
  }

  private track(p: Promise<void>) {
    this.inFlight.add(p);
    p.finally(() => this.inFlight.delete(p));
  }

  private async dispatch(attemptId: string, provider: NotificationProvider) {
    const attempt = this.attempts.get(attemptId);
    const message = this.retryPayloads.get(attemptId);
    if (!attempt || !message) return;
    attempt.status = 'sending';
    attempt.attempts += 1;
    attempt.updatedAt = new Date().toISOString();
    this.persist();

    let result: ProviderResult;
    try {
      result = await provider.send(message);
    } catch (err: any) {
      result = { status: 'failed', error: 'Provider threw an error', retryable: true };
    }
    // A delivery receipt may already have arrived; never downgrade it
    if (attempt.status === 'sending') {
      attempt.status = result.status;
    }
    attempt.providerMessageId = result.providerMessageId ?? attempt.providerMessageId;
    attempt.error = result.status === 'failed' ? result.error : undefined;
    attempt.updatedAt = new Date().toISOString();
    if (result.status === 'accepted' || !result.retryable || attempt.attempts >= MAX_ATTEMPTS) {
      this.retryPayloads.delete(attemptId);
    }
    this.persist();
  }

  /** Retries failed, retryable attempts (called by the scheduler). Same idempotency key. */
  retryFailed() {
    const provider = getProvider();
    if (!provider) return;
    for (const [id] of this.retryPayloads) {
      const a = this.attempts.get(id);
      if (a && a.status === 'failed' && a.attempts < MAX_ATTEMPTS) {
        this.track(this.dispatch(id, provider));
      }
    }
  }

  /** Applies a provider delivery receipt. */
  applyReceipt(ref: { notificationId?: string; idempotencyKey?: string }, status: 'delivered' | 'failed', error?: string): NotificationAttempt | null {
    const id = ref.notificationId ?? (ref.idempotencyKey ? this.byKey.get(ref.idempotencyKey) : undefined);
    const attempt = id ? this.attempts.get(id) : undefined;
    if (!attempt) return null;
    attempt.status = status;
    attempt.error = status === 'failed' ? error || 'Provider reported delivery failure' : undefined;
    attempt.updatedAt = new Date().toISOString();
    this.retryPayloads.delete(attempt.id);
    this.persist();
    return attempt;
  }

  /** Test helper: resolves when all background sends have finished. */
  async settle() {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight]);
    }
  }
}

export const notificationStore = new NotificationStore();

/** Verifies the HMAC signature on a delivery receipt body. */
export function verifyReceiptSignature(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env.NOTIFY_RECEIPT_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
