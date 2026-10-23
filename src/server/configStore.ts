/**
 * Administrator-managed configuration: routing, campus buildings and zones,
 * responder shifts, SLA targets, assets, rooms, and facilities.
 *
 * Campus data starts EMPTY in production: nothing here is invented. Features that
 * depend on it (responder alerts, readiness, workarounds, maps) report that the
 * data is not configured until an administrator enters it.
 */
import {
  AppConfig,
  ASSET_TYPES,
  CATEGORY_DEPARTMENT_ROUTING,
  ConfigSection,
  CONFIG_SECTIONS,
  DEPARTMENTS,
  Department,
  FACILITY_TYPES,
  PRIORITY_LEVELS,
  PriorityLevel,
  TICKET_CATEGORIES,
  TicketCategory,
  User
} from '../shared/types.js';
import { dataPath, readJsonFile, writeJsonFileAtomic } from './jsonFile.js';
import { isDemoSeedEnabled } from './userStore.js';

export const DEFAULT_SLA_HOURS: Record<PriorityLevel, number> = {
  Critical: 4,
  High: 24,
  Medium: 72,
  Low: 168
};

function defaultConfig(): AppConfig {
  return {
    timezone: 'Asia/Kolkata',
    routing: { ...CATEGORY_DEPARTMENT_ROUTING },
    buildings: [],
    zones: [],
    shifts: [],
    emergencyAckTimeoutSeconds: 120,
    emergencyDuplicateWindowSeconds: 60,
    sla: { default: { ...DEFAULT_SLA_HOURS }, byCategory: {} },
    slaEscalationEnabled: true,
    assets: [],
    rooms: [],
    facilities: [],
    verificationFreshnessHours: 24,
    repeatOffenderWindowDays: 90,
    repeatOffenderThreshold: 3,
    pulseMinGroupSize: 5
  };
}

/** Building names used by the demo tickets, so demo mode has a usable campus list. */
function demoBuildings() {
  return [
    'Science & Engineering Complex',
    'Main Academic Quad',
    'Student Union Center',
    'University Memorial Library'
  ].map((name, i) => ({ id: `demo-bldg-${i + 1}`, name, campus: 'Demo Campus' }));
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

class ConfigValidationError extends Error {}

function fail(message: string): never {
  throw new ConfigValidationError(message);
}

function str(value: unknown, field: string, { required = true, max = 120 } = {}): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) fail(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') fail(`${field} must be text`);
  const v = value.trim();
  if (required && !v) fail(`${field} is required`);
  if (v.length > max) fail(`${field} must be at most ${max} characters`);
  return v || undefined;
}

function id(value: unknown, field: string): string {
  const v = str(value, field, { max: 64 })!;
  if (!ID_PATTERN.test(v)) fail(`${field} may contain only letters, digits, dot, dash, and underscore`);
  return v;
}

function int(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    fail(`${field} must be a whole number between ${min} and ${max}`);
  }
  return value;
}

function arr(value: unknown, field: string, maxItems = 2000): unknown[] {
  if (!Array.isArray(value)) fail(`${field} must be a list`);
  if (value.length > maxItems) fail(`${field} may contain at most ${maxItems} items`);
  return value;
}

function uniqueIds<T extends { id: string }>(items: T[], field: string): T[] {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) fail(`${field} contains duplicate id "${item.id}"`);
    seen.add(item.id);
  }
  return items;
}

function optionalNumber(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${field} must be a number between ${min} and ${max}`);
  }
  return value;
}

/**
 * Validates and normalises one configuration section. `userExists` checks responder
 * shift assignments against real accounts.
 */
export function validateSection(
  section: ConfigSection,
  value: unknown,
  current: AppConfig,
  isResponder: (userId: string) => boolean
): AppConfig[ConfigSection] {
  switch (section) {
    case 'timezone': {
      const tz = str(value, 'Timezone', { max: 64 })!;
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
      } catch {
        fail(`Unknown timezone "${tz}"`);
      }
      return tz;
    }
    case 'routing': {
      if (!value || typeof value !== 'object') fail('Routing must map each category to a department');
      const routing = {} as Record<TicketCategory, Department>;
      for (const cat of TICKET_CATEGORIES) {
        const dept = (value as Record<string, unknown>)[cat];
        if (!DEPARTMENTS.includes(dept as Department)) fail(`Routing for "${cat}" must be a known department`);
        routing[cat] = dept as Department;
      }
      return routing;
    }
    case 'zones':
      return uniqueIds(
        arr(value, 'Zones').map((z: any, i) => ({ id: id(z?.id, `Zone ${i + 1} id`), name: str(z?.name, `Zone ${i + 1} name`)! })),
        'Zones'
      );
    case 'buildings': {
      const zoneIds = new Set(current.zones.map((z) => z.id));
      return uniqueIds(
        arr(value, 'Buildings').map((b: any, i) => {
          const zoneId = str(b?.zoneId, `Building ${i + 1} zone`, { required: false, max: 64 });
          if (zoneId && !zoneIds.has(zoneId)) fail(`Building ${i + 1} refers to unknown zone "${zoneId}" (save zones first)`);
          return {
            id: id(b?.id, `Building ${i + 1} id`),
            name: str(b?.name, `Building ${i + 1} name`)!,
            campus: str(b?.campus, `Building ${i + 1} campus`)!,
            zoneId,
            latitude: optionalNumber(b?.latitude, `Building ${i + 1} latitude`, -90, 90),
            longitude: optionalNumber(b?.longitude, `Building ${i + 1} longitude`, -180, 180)
          };
        }),
        'Buildings'
      );
    }
    case 'shifts': {
      const zoneIds = new Set(current.zones.map((z) => z.id));
      return uniqueIds(
        arr(value, 'Shifts').map((s: any, i) => {
          const userId = str(s?.userId, `Shift ${i + 1} responder`, { max: 80 })!;
          if (!isResponder(userId)) fail(`Shift ${i + 1}: "${userId}" is not an active responder account`);
          const zones = arr(s?.zoneIds ?? [], `Shift ${i + 1} zones`, 100).map((z) => {
            if (typeof z !== 'string' || !zoneIds.has(z)) fail(`Shift ${i + 1} refers to an unknown zone`);
            return z;
          });
          const days = arr(s?.days, `Shift ${i + 1} days`, 7).map((d) => int(d, `Shift ${i + 1} day`, 0, 6));
          if (days.length === 0) fail(`Shift ${i + 1} must include at least one day`);
          const start = str(s?.start, `Shift ${i + 1} start`, { max: 5 })!;
          const end = str(s?.end, `Shift ${i + 1} end`, { max: 5 })!;
          if (!TIME_PATTERN.test(start) || !TIME_PATTERN.test(end)) fail(`Shift ${i + 1} times must be HH:MM (24-hour)`);
          if (start === end) fail(`Shift ${i + 1} start and end must differ`);
          return { id: id(s?.id, `Shift ${i + 1} id`), userId, zoneIds: zones, days: [...new Set(days)].sort(), start, end, isBackup: s?.isBackup === true };
        }),
        'Shifts'
      );
    }
    case 'emergencyAckTimeoutSeconds':
      return int(value, 'Acknowledgement timeout (seconds)', 30, 3600);
    case 'emergencyDuplicateWindowSeconds':
      return int(value, 'Duplicate window (seconds)', 5, 600);
    case 'sla': {
      const v = value as any;
      if (!v || typeof v !== 'object') fail('SLA targets are required');
      const def = {} as Record<PriorityLevel, number>;
      for (const p of PRIORITY_LEVELS) def[p] = int(v.default?.[p], `SLA hours for ${p}`, 1, 24 * 90);
      const byCategory: AppConfig['sla']['byCategory'] = {};
      for (const [cat, overrides] of Object.entries(v.byCategory ?? {})) {
        if (!TICKET_CATEGORIES.includes(cat as TicketCategory)) fail(`Unknown SLA category "${cat}"`);
        const o: Partial<Record<PriorityLevel, number>> = {};
        for (const [p, hours] of Object.entries(overrides as object)) {
          if (!PRIORITY_LEVELS.includes(p as PriorityLevel)) fail(`Unknown priority "${p}"`);
          o[p as PriorityLevel] = int(hours, `SLA hours for ${cat} ${p}`, 1, 24 * 90);
        }
        byCategory[cat as TicketCategory] = o;
      }
      return { default: def, byCategory };
    }
    case 'slaEscalationEnabled':
      if (typeof value !== 'boolean') fail('SLA escalation setting must be true or false');
      return value;
    case 'assets': {
      const roomIds = new Set(current.rooms.map((r) => r.id));
      return uniqueIds(
        arr(value, 'Assets').map((a: any, i) => {
          if (!ASSET_TYPES.includes(a?.type)) fail(`Asset ${i + 1} type must be one of ${ASSET_TYPES.join(', ')}`);
          const roomId = str(a?.roomId, `Asset ${i + 1} room`, { required: false, max: 64 });
          if (roomId && !roomIds.has(roomId)) fail(`Asset ${i + 1} refers to unknown room "${roomId}"`);
          return {
            id: id(a?.id, `Asset ${i + 1} tag`),
            name: str(a?.name, `Asset ${i + 1} name`)!,
            type: a.type,
            building: str(a?.building, `Asset ${i + 1} building`)!,
            floor: str(a?.floor, `Asset ${i + 1} floor`, { required: false, max: 20 }),
            roomId
          };
        }),
        'Assets'
      );
    }
    case 'rooms': {
      const assetIds = new Set(current.assets.map((a) => a.id));
      return uniqueIds(
        arr(value, 'Rooms').map((r: any, i) => ({
          id: id(r?.id, `Room ${i + 1} id`),
          name: str(r?.name, `Room ${i + 1} name`)!,
          building: str(r?.building, `Room ${i + 1} building`)!,
          floor: str(r?.floor, `Room ${i + 1} floor`, { required: false, max: 20 }),
          assetIds: arr(r?.assetIds ?? [], `Room ${i + 1} assets`, 200).map((a) => {
            if (typeof a !== 'string' || !assetIds.has(a)) fail(`Room ${i + 1} refers to an unknown asset`);
            return a;
          })
        })),
        'Rooms'
      );
    }
    case 'facilities':
      return uniqueIds(
        arr(value, 'Facilities').map((f: any, i) => {
          if (!FACILITY_TYPES.includes(f?.type)) fail(`Facility ${i + 1} type must be one of ${FACILITY_TYPES.join(', ')}`);
          if (!['available', 'unavailable', 'unknown'].includes(f?.status)) fail(`Facility ${i + 1} status is invalid`);
          // Keep existing verification metadata; status changes go through the verify endpoint
          const previous = current.facilities.find((p) => p.id === f.id);
          return {
            id: id(f?.id, `Facility ${i + 1} id`),
            name: str(f?.name, `Facility ${i + 1} name`)!,
            type: f.type,
            building: str(f?.building, `Facility ${i + 1} building`)!,
            floor: str(f?.floor, `Facility ${i + 1} floor`, { required: false, max: 20 }),
            accessible: typeof f?.accessible === 'boolean' ? f.accessible : undefined,
            status: previous && previous.status === f.status ? previous.status : 'unknown',
            verifiedAt: previous && previous.status === f.status ? previous.verifiedAt : undefined,
            verifiedBy: previous && previous.status === f.status ? previous.verifiedBy : undefined
          };
        }),
        'Facilities'
      );
    case 'verificationFreshnessHours':
      return int(value, 'Verification freshness (hours)', 1, 24 * 30);
    case 'repeatOffenderWindowDays':
      return int(value, 'Repeat-offender window (days)', 1, 730);
    case 'repeatOffenderThreshold':
      return int(value, 'Repeat-offender threshold', 2, 100);
    case 'pulseMinGroupSize':
      return int(value, 'Campus Pulse minimum group size', 3, 100);
  }
}

export class ConfigStore {
  private readonly file = dataPath('config.json');
  private config: AppConfig;

  constructor() {
    const stored = readJsonFile<Partial<AppConfig>>(this.file);
    const base = defaultConfig();
    // Merge so new settings get defaults without losing stored values
    this.config = { ...base, ...(stored ?? {}), routing: { ...base.routing, ...(stored?.routing ?? {}) } };
    if (!stored) {
      if (isDemoSeedEnabled()) this.config.buildings = demoBuildings();
      writeJsonFileAtomic(this.file, this.config);
    }
  }

  get(): AppConfig {
    return this.config;
  }

  updateSection(section: ConfigSection, value: unknown, actor: User, isResponder: (userId: string) => boolean): { ok: true } | { ok: false; error: string } {
    if (!CONFIG_SECTIONS.includes(section)) return { ok: false, error: 'Unknown configuration section' };
    try {
      const normalised = validateSection(section, value, this.config, isResponder);
      this.config = { ...this.config, [section]: normalised, updatedAt: new Date().toISOString(), updatedBy: actor.name };
      writeJsonFileAtomic(this.file, this.config);
      return { ok: true };
    } catch (err) {
      if (err instanceof ConfigValidationError) return { ok: false, error: err.message };
      throw err;
    }
  }

  /** Records a staff verification of a facility's availability. */
  verifyFacility(facilityId: string, status: 'available' | 'unavailable' | 'unknown', actor: User) {
    const facility = this.config.facilities.find((f) => f.id === facilityId);
    if (!facility) return null;
    facility.status = status;
    facility.verifiedAt = new Date().toISOString();
    facility.verifiedBy = actor.name;
    writeJsonFileAtomic(this.file, this.config);
    return facility;
  }

  routeFor(category: TicketCategory): Department {
    return this.config.routing[category] ?? CATEGORY_DEPARTMENT_ROUTING[category];
  }

  slaHoursFor(category: TicketCategory, level: PriorityLevel): number {
    return this.config.sla.byCategory[category]?.[level] ?? this.config.sla.default[level] ?? DEFAULT_SLA_HOURS[level];
  }

  findBuilding(name?: string) {
    if (!name) return undefined;
    const n = name.trim().toLowerCase();
    return this.config.buildings.find((b) => b.name.toLowerCase() === n || b.id.toLowerCase() === n);
  }
}

export const configStore = new ConfigStore();
