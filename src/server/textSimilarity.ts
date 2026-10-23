/**
 * Deterministic text-matching helpers (no AI). Used by duplicate detection and by
 * recurring-issue clustering. Handles English plus common romanised Hindi terms.
 *
 * Limitation: this is keyword/synonym matching, not semantic understanding. Two
 * reports describing the same fault with no shared vocabulary will not match.
 */

/** Concept -> words (English and common Hinglish) that indicate it. */
export const DOMAIN_SYNONYMS: Record<string, string[]> = {
  leak: ['leak', 'leaking', 'leakage', 'drip', 'dripping', 'flood', 'flooding', 'wet', 'spill', 'pipe', 'puddle', 'tapakna', 'tapak', 'rissa', 'risaav'],
  water: ['water', 'paani', 'pani', 'jal', 'supply'],
  faucet: ['faucet', 'tap', 'sink', 'washbasin', 'basin', 'valve', 'nal', 'nalka'],
  drain: ['drain', 'clog', 'clogged', 'blocked', 'overflow', 'sewage', 'toilet', 'gutter', 'nali', 'jam', 'band'],
  spark: ['spark', 'sparking', 'smoke', 'burnt', 'burning', 'ozone', 'pop', 'popping', 'shock', 'chingari', 'karant', 'current'],
  outlet: ['outlet', 'socket', 'plug', 'strip', 'receptacle', 'switchboard', 'board'],
  power: ['power', 'electricity', 'bijli', 'light', 'lights', 'blackout', 'outage', 'powercut', 'gayi', 'gai'],
  breaker: ['breaker', 'trip', 'tripped', 'fuse', 'mcb'],
  fan: ['fan', 'pankha', 'ceiling'],
  wifi: ['wifi', 'internet', 'network', 'eduroam', 'signal', 'disconnect', 'disconnecting', 'offline', 'drops', 'slow', 'net', 'connection', 'router'],
  trash: ['trash', 'garbage', 'bin', 'litter', 'waste', 'dustbin', 'kachra', 'kooda', 'kuda', 'overflowing'],
  dirty: ['dirty', 'stain', 'smell', 'odor', 'odour', 'gandagi', 'ganda', 'gandi', 'badbu', 'safai', 'unclean'],
  restroom: ['restroom', 'washroom', 'bathroom', 'toilet', 'lavatory', 'shauchalay'],
  projector: ['projector', 'screen', 'hdmi', 'display'],
  lift: ['lift', 'elevator'],
  purifier: ['purifier', 'cooler', 'ro', 'drinking']
};

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'there', 'from', 'near', 'not', 'are', 'was', 'has', 'have',
  'hai', 'nahi', 'raha', 'rahi', 'rahe', 'kar', 'mein', 'main', 'par', 'bhi', 'aur', 'kya', 'ho', 'hua', 'gaya'
]);

export function extractCanonicalTokens(str: string): Set<string> {
  const words = str
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  const tokens = new Set<string>();
  for (const w of words) {
    if (w.length > 2) tokens.add(w);
    for (const [canonical, syns] of Object.entries(DOMAIN_SYNONYMS)) {
      if (syns.includes(w)) tokens.add(`__concept_${canonical}`);
    }
  }
  return tokens;
}

export function conceptsOf(tokens: Set<string>): string[] {
  return [...tokens].filter((t) => t.startsWith('__concept_')).map((t) => t.slice('__concept_'.length)).sort();
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Room or area numbers such as "204", "101A". */
export function extractRoomNumbers(str: string): string[] {
  const matches = str.match(/\b\d{2,4}[a-z]?\b/gi) || [];
  return matches.map((m) => m.toLowerCase());
}

/** Normalises building names for matching across case, punctuation, and spacing. */
export function normalizeBuildingName(bldg?: string): string {
  if (!bldg) return '';
  return bldg.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function sameBuilding(a?: string, b?: string): boolean {
  const na = normalizeBuildingName(a);
  const nb = normalizeBuildingName(b);
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)));
}
