/**
 * Campus Pulse: anonymous, building-level feedback about recurring friction.
 *
 * What is stored: topic, building (from the configured list only), optional message,
 * and the time rounded down to the hour. What is NOT stored: account, name, IP address,
 * user agent. Spam limiting uses an in-memory keyed hash of the IP that rotates every
 * day and is never written to disk. A message can still identify someone if they write
 * identifying details, so messages are visible only to administrators and never appear
 * in aggregates.
 */
import crypto from 'crypto';
import { PulseAggregateGroup, PulseSummary, PulseTopic, PULSE_TOPICS, TicketCategory } from '../shared/types.js';
import { configStore } from './configStore.js';
import { dataPath, newId, readJsonFile, writeJsonFileAtomic } from './jsonFile.js';
import { sameBuilding } from './textSimilarity.js';
import { ticketRepository } from './ticketStore.js';

interface PulseEntry {
  id: string;
  topic: PulseTopic;
  building: string;
  message?: string;
  createdHour: string; // ISO time rounded down to the hour
}

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 3600 * 1000;
const WINDOW_DAYS = 14;

const TOPIC_TO_CATEGORY: Partial<Record<PulseTopic, TicketCategory>> = {
  Water: 'Plumbing',
  'Power & Lighting': 'Electricity',
  Cleanliness: 'Cleanliness',
  'Wi-Fi': 'Internet Connectivity'
};

export class PulseStore {
  private readonly file = dataPath('pulse.json');
  private entries: PulseEntry[] = readJsonFile<{ entries: PulseEntry[] }>(this.file)?.entries ?? [];
  private salt = crypto.randomBytes(32);
  private saltDay = new Date().toISOString().slice(0, 10);
  private hits = new Map<string, number[]>();

  private rateKey(ip: string): string {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.saltDay) {
      this.salt = crypto.randomBytes(32);
      this.saltDay = today;
      this.hits.clear();
    }
    return crypto.createHmac('sha256', this.salt).update(ip).digest('hex');
  }

  submit(input: { topic: unknown; building: unknown; message: unknown; website?: unknown }, ip: string): { ok: true } | { ok: false; error: string; status: number } {
    // Honeypot field: real users never fill it in
    if (typeof input.website === 'string' && input.website.trim()) return { ok: true };
    if (!PULSE_TOPICS.includes(input.topic as PulseTopic)) return { ok: false, error: 'Choose a topic', status: 400 };
    const building = configStore.get().buildings.find((b) => typeof input.building === 'string' && b.name === input.building);
    if (!building) return { ok: false, error: 'Choose a building from the list', status: 400 };
    if (input.message !== undefined && input.message !== '' && (typeof input.message !== 'string' || input.message.length > 500)) {
      return { ok: false, error: 'Message must be at most 500 characters', status: 400 };
    }

    const key = this.rateKey(ip || 'unknown');
    const now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) return { ok: false, error: 'Too many submissions. Please try again later.', status: 429 };
    this.hits.set(key, [...recent, now]);

    const hour = new Date(now);
    hour.setUTCMinutes(0, 0, 0);
    this.entries.push({
      id: newId('pulse'),
      topic: input.topic as PulseTopic,
      building: building.name,
      message: typeof input.message === 'string' && input.message.trim() ? input.message.trim() : undefined,
      createdHour: hour.toISOString()
    });
    writeJsonFileAtomic(this.file, { entries: this.entries });
    return { ok: true };
  }

  /** Aggregates with a minimum group size; smaller groups are only counted in total. */
  summary(now = new Date()): PulseSummary {
    const k = configStore.get().pulseMinGroupSize;
    const since = now.getTime() - WINDOW_DAYS * 24 * 3600 * 1000;
    const recent = this.entries.filter((e) => Date.parse(e.createdHour) >= since);
    const counts = new Map<string, PulseAggregateGroup>();
    for (const e of recent) {
      const key = `${e.building}|${e.topic}`;
      const g = counts.get(key) ?? { building: e.building, topic: e.topic, count: 0 };
      g.count++;
      counts.set(key, g);
    }
    const groups = [...counts.values()].filter((g) => g.count >= k).sort((a, b) => b.count - a.count);
    const shown = groups.reduce((n, g) => n + g.count, 0);
    const suppressed = recent.length - shown;
    return {
      windowDays: WINDOW_DAYS,
      minGroupSize: k,
      groups,
      // Hide even the suppressed total when it is itself small enough to single someone out
      suppressedCount: suppressed >= k ? suppressed : 0,
      totalReports: recent.length >= k ? recent.length : 0
    };
  }

  /** Staff view: aggregate signals compared with formal tickets. */
  investigationSuggestions(now = new Date()) {
    const summary = this.summary(now);
    const openTickets = ticketRepository.getAllTicketsForSystem().filter((t) => t.status !== 'Resolved');
    return summary.groups.map((g) => {
      const category = TOPIC_TO_CATEGORY[g.topic];
      const matching = openTickets.filter((t) => sameBuilding(t.building, g.building) && (!category || t.category === category));
      return {
        ...g,
        confirmedBy: matching.map((t) => t.id),
        assessment: matching.length > 0
          ? `Corroborated: ${matching.length} open ticket(s) in ${g.building} match this topic.`
          : `Unverified signal: ${g.count} anonymous reports about ${g.topic} in ${g.building} with no matching open ticket. Consider an inspection.`
      };
    });
  }

  /** Administrators only. */
  rawEntries(): PulseEntry[] {
    return [...this.entries].reverse();
  }
}

export const pulseStore = new PulseStore();
