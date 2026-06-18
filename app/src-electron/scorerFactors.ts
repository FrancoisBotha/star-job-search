/**
 * The four factor evaluators (SCORE-002 / Epic 5 §3, §10).
 *
 * Each evaluator is a PURE function of `(listing, profile)` — no DB, IPC,
 * network, clock, or randomness (NFR-001). The deterministic scorer core in
 * `scorer.ts` composes these via the `FactorEvaluator` contract.
 *
 * Conservative parsing rule (FR-003, Risk §10): when years or salary cannot
 * be confidently parsed, or the Profile lacks the relevant target, the
 * factor returns `included: false` rather than guessing. The scorer drops
 * excluded factors from the weighted average and labels them in the UI.
 *
 * Each evaluator returns a short, deterministic `rationale` suitable for
 * display in the Job-detail breakdown (FR-004).
 */
import type {
  FactorEvaluation,
  FactorEvaluator,
  FactorKey,
  ScoringListing,
  ScoringProfile,
} from './scorer';

// --- Shared helpers -------------------------------------------------------

function listingText(listing: ScoringListing): string {
  return `${listing.title ?? ''}\n${listing.description ?? ''}`;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `needle` appears in `text` as a whole word/token. Word chars
 *  for matching include letters, digits, `+`, `#` (so "c++", "c#" match
 *  cleanly). The `.` inside a needle like "node.js" is escaped and matched
 *  literally; `.` is treated as a TOKEN BOUNDARY so trailing punctuation
 *  ("PostgreSQL.") doesn't block a match. */
function containsToken(text: string, needle: string): boolean {
  if (!needle) return false;
  const esc = escapeRegex(needle.toLowerCase());
  const re = new RegExp(`(^|[^a-z0-9+#])${esc}([^a-z0-9+#]|$)`, 'i');
  return re.test(text);
}

// --- Skills ---------------------------------------------------------------

/** Small bounded alias/synonym map. Keys are canonical names; values are
 *  alternative spellings/abbreviations. Matching is symmetric: a profile
 *  skill matches if the listing contains the canonical OR any alias, and
 *  vice versa. Kept small and transparent by design (Risk §10). */
const SKILL_ALIASES: Record<string, readonly string[]> = {
  kubernetes: ['k8s'],
  javascript: ['js'],
  typescript: ['ts'],
  python: ['py'],
  'node.js': ['node', 'nodejs'],
  'react.js': ['react', 'reactjs'],
  'vue.js': ['vue', 'vuejs'],
  postgresql: ['postgres', 'psql'],
  golang: ['go'],
  'c#': ['csharp', 'c-sharp'],
  'c++': ['cpp'],
  aws: ['amazon web services'],
  gcp: ['google cloud', 'google cloud platform'],
  azure: ['microsoft azure'],
  ci: ['continuous integration'],
  cd: ['continuous deployment', 'continuous delivery'],
  ml: ['machine learning'],
  ai: ['artificial intelligence'],
  'ci/cd': ['cicd'],
};

/** Return all variants (canonical + aliases) for a skill: if the input
 *  matches a canonical key, return [canonical, ...aliases]; if it matches
 *  an alias, return [canonical, ...aliases]; otherwise return [input]. */
function skillVariants(skill: string): string[] {
  const lower = skill.toLowerCase().trim();
  if (!lower) return [];
  if (SKILL_ALIASES[lower]) return [lower, ...SKILL_ALIASES[lower]];
  for (const [canonical, aliases] of Object.entries(SKILL_ALIASES)) {
    if (aliases.includes(lower)) return [canonical, ...aliases];
  }
  return [lower];
}

export function evaluateSkills(
  listing: ScoringListing,
  profile: ScoringProfile,
): FactorEvaluation {
  const profileSkills = (profile.skills ?? [])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (profileSkills.length === 0) {
    return { included: false, score: 0, rationale: 'Profile lists no skills.' };
  }
  const text = listingText(listing).trim();
  if (!text) {
    return {
      included: false,
      score: 0,
      rationale: 'Listing has no title or description to match against.',
    };
  }
  const lowerText = text.toLowerCase();
  const matched: string[] = [];
  const gap: string[] = [];
  for (const skill of profileSkills) {
    const variants = skillVariants(skill);
    const hit = variants.some((v) => containsToken(lowerText, v));
    if (hit) matched.push(skill);
    else gap.push(skill);
  }
  const score = (matched.length / profileSkills.length) * 100;
  const matchedPart =
    matched.length > 0
      ? `Matched ${matched.length}/${profileSkills.length}: ${matched.join(', ')}`
      : `Matched 0/${profileSkills.length}`;
  const gapPart = gap.length > 0 ? `; gap: ${gap.join(', ')}` : '';
  return { included: true, score, rationale: `${matchedPart}${gapPart}.` };
}

// --- Experience -----------------------------------------------------------

/** Conservative years-required parser. Returns the lower bound of the
 *  stated requirement, or null when nothing confident matches. Patterns
 *  must explicitly tie the number to "years/yrs (of) experience" or to a
 *  range with the word "years" to avoid mis-reading "5 days", "100 years
 *  of history", etc. */
function parseYearsRequired(text: string): number | null {
  const t = text.toLowerCase();
  // "3-5 years" / "3 to 5 years" / "3–5 yrs"
  const range = /(\d{1,2})\s*(?:-|–|to)\s*(\d{1,2})\+?\s*(?:years?|yrs?)/i.exec(t);
  if (range) return parseInt(range[1]!, 10);
  // "at least 5 years" / "minimum 5 years" / "min 5 yrs"
  const min = /(?:at least|minimum(?:\s+of)?|min\.?)\s*(\d{1,2})\+?\s*(?:years?|yrs?)/i.exec(t);
  if (min) return parseInt(min[1]!, 10);
  // "5+ years (of) experience" / "5 years of experience" / "5 yrs experience"
  const exp = /(\d{1,2})\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp|professional|industry|working|hands[- ]?on)/i.exec(t);
  if (exp) return parseInt(exp[1]!, 10);
  // "5+ years" preceded by "requires/required/need(s)/looking for/seeking"
  const reqd = /(?:requires?|required|needs?|looking for|seeking)\s+(?:at least\s+|a minimum of\s+|min(?:imum)?\s+of\s+)?(\d{1,2})\+?\s*(?:years?|yrs?)/i.exec(t);
  if (reqd) return parseInt(reqd[1]!, 10);
  return null;
}

/** Seniority -> approximate years. The order matters: check more-specific
 *  / higher-seniority words first so "Senior" doesn't get caught by a
 *  vaguer pattern. */
const SENIORITY_LADDER: ReadonlyArray<readonly [RegExp, number, string]> = [
  [/\b(principal|staff|distinguished)\b/i, 10, 'principal/staff'],
  [/\b(senior|sr\.?|lead)\b/i, 5, 'senior'],
  [/\b(mid[- ]?level|intermediate)\b/i, 3, 'mid-level'],
  [/\b(junior|jr\.?|entry[- ]?level|graduate|intern)\b/i, 0, 'junior/entry'],
];

function detectSeniority(text: string): { years: number; label: string } | null {
  for (const [re, years, label] of SENIORITY_LADDER) {
    if (re.test(text)) return { years, label };
  }
  return null;
}

export function evaluateExperience(
  listing: ScoringListing,
  profile: ScoringProfile,
): FactorEvaluation {
  if (profile.yearsExperience == null) {
    return {
      included: false,
      score: 0,
      rationale: 'Profile yearsExperience not set.',
    };
  }
  const text = listingText(listing);
  const yearsParsed = parseYearsRequired(text);
  let required: number;
  let source: string;
  if (yearsParsed != null) {
    required = yearsParsed;
    source = 'years stated';
  } else {
    const seniority = detectSeniority(text);
    if (!seniority) {
      return {
        included: false,
        score: 0,
        rationale: 'Could not parse required years or seniority from listing.',
      };
    }
    required = seniority.years;
    source = `seniority "${seniority.label}"`;
  }
  const profYears = profile.yearsExperience;
  let score: number;
  if (profYears >= required) {
    score = 100;
  } else {
    const gap = required - profYears;
    // -20 points per year short, floored at 0.
    score = Math.max(0, 100 - gap * 20);
  }
  return {
    included: true,
    score,
    rationale: `Profile ${profYears}y vs listing ${required}y (${source}).`,
  };
}

// --- Location -------------------------------------------------------------

type WorkMode = ScoringProfile['workMode'];

function detectWorkMode(text: string): WorkMode | null {
  const t = text.toLowerCase();
  // Hybrid first (most specific), then On-site (so "no remote" in an on-site
  // description doesn't get mis-detected as Remote), then Remote.
  if (/\bhybrid\b/.test(t)) return 'Hybrid';
  if (/\b(on[- ]?site|onsite|in[- ]?office|in[- ]person)\b/.test(t)) return 'On-site';
  if (/\b(remote|wfh|work[- ]from[- ]home|fully[- ]remote)\b/.test(t)) return 'Remote';
  return null;
}

function locationOverlap(profileLoc: string, listingLoc: string): boolean {
  const p = profileLoc.toLowerCase().trim();
  const l = listingLoc.toLowerCase().trim();
  if (!p || !l) return false;
  if (l.includes(p) || p.includes(l)) return true;
  // Token-level overlap: share at least one alphanumeric token of length >= 3.
  const pt = new Set(p.split(/[^a-z0-9]+/).filter((t) => t.length >= 3));
  const lt = l.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  return lt.some((t) => pt.has(t));
}

function modeFitScore(profileMode: WorkMode, listingMode: WorkMode): number {
  if (profileMode === listingMode) return 100;
  // Hybrid is the flexible middle ground.
  if (profileMode === 'Hybrid') return 60;
  if (profileMode === 'Remote' && listingMode === 'Hybrid') return 50;
  if (profileMode === 'On-site' && listingMode === 'Hybrid') return 60;
  // Remote profile + On-site, or On-site profile + Remote.
  return 10;
}

export function evaluateLocation(
  listing: ScoringListing,
  profile: ScoringProfile,
): FactorEvaluation {
  const profileLoc = (profile.location ?? '').trim();
  const listingLoc = (listing.location ?? '').trim();
  const text = `${listingText(listing)}\n${listingLoc}`;
  const detectedMode = detectWorkMode(text);

  if (!listingLoc && !detectedMode) {
    return {
      included: false,
      score: 0,
      rationale: 'Listing states no location and no workplace type.',
    };
  }

  const profileMode = profile.workMode;
  const modeScore = detectedMode ? modeFitScore(profileMode, detectedMode) : 50;
  const modeNote = detectedMode
    ? profileMode === detectedMode
      ? `${profileMode} matches`
      : `prefers ${profileMode}, listing ${detectedMode}`
    : 'workplace type not detected';

  let locScore: number;
  let locNote: string;
  if (detectedMode === 'Remote') {
    locScore = 100;
    locNote = 'remote — location not constraining';
  } else if (profileLoc && listingLoc) {
    if (locationOverlap(profileLoc, listingLoc)) {
      locScore = 100;
      locNote = `${profileLoc} ≈ ${listingLoc}`;
    } else {
      locScore = 0;
      locNote = `${profileLoc} ≠ ${listingLoc}`;
    }
  } else if (!profileLoc) {
    locScore = 60;
    locNote = 'profile location unset';
  } else {
    locScore = 60;
    locNote = 'listing location unset';
  }

  const score = (modeScore + locScore) / 2;
  return {
    included: true,
    score,
    rationale: `${modeNote}; ${locNote}.`,
  };
}

// --- Salary ---------------------------------------------------------------

const CURRENCY_SYMBOL: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  R: 'ZAR',
  '₹': 'INR',
};

function currencyFromSymbol(sym?: string): string | undefined {
  if (!sym) return undefined;
  return CURRENCY_SYMBOL[sym];
}

interface ParsedSalary {
  min: number;
  max: number;
  currency?: string;
}

/** Conservative salary range parser. Recognises:
 *    "$100k-$150k", "R500k - R700k"
 *    "$100,000 - $150,000"
 *    "USD 100000 to 150000"
 *  Returns null whenever it cannot extract a confident numeric range — any
 *  ambiguous mention (e.g. "competitive") leaves the factor excluded. */
function parseSalaryRange(text: string): ParsedSalary | null {
  // Pattern 1: k-suffix range — $100k-$150k, R500k-R700k.
  const kRange = /([$£€R₹])?\s*(\d{1,4})\s*[kK]\s*(?:-|–|to)\s*([$£€R₹])?\s*(\d{1,4})\s*[kK]/.exec(text);
  if (kRange) {
    const sym = kRange[1] ?? kRange[3];
    return {
      min: parseInt(kRange[2]!, 10) * 1000,
      max: parseInt(kRange[4]!, 10) * 1000,
      currency: currencyFromSymbol(sym),
    };
  }
  // Pattern 2: full-number range — $100,000 - $150,000 / 100000-150000.
  const numRange =
    /([$£€R₹])?\s*(\d{1,3}(?:[,.]\d{3}){1,3}|\d{4,7})\s*(?:-|–|to)\s*([$£€R₹])?\s*(\d{1,3}(?:[,.]\d{3}){1,3}|\d{4,7})/.exec(
      text,
    );
  if (numRange) {
    const sym = numRange[1] ?? numRange[3];
    const min = parseInt(numRange[2]!.replace(/[,.]/g, ''), 10);
    const max = parseInt(numRange[4]!.replace(/[,.]/g, ''), 10);
    if (min > 0 && max >= min) {
      return { min, max, currency: currencyFromSymbol(sym) };
    }
  }
  // Pattern 3: single value with currency symbol — $100k+ / $120,000.
  const kSingle = /([$£€R₹])\s*(\d{1,4})\s*[kK]\b/.exec(text);
  if (kSingle) {
    const v = parseInt(kSingle[2]!, 10) * 1000;
    return { min: v, max: v, currency: currencyFromSymbol(kSingle[1]!) };
  }
  return null;
}

export function evaluateSalary(
  listing: ScoringListing,
  profile: ScoringProfile,
): FactorEvaluation {
  if (profile.salaryMin == null || profile.salaryMin <= 0) {
    return {
      included: false,
      score: 0,
      rationale: 'Profile salaryMin not set.',
    };
  }
  const text = listingText(listing);
  const range = parseSalaryRange(text);
  if (!range) {
    return {
      included: false,
      score: 0,
      rationale: 'Listing salary not stated.',
    };
  }
  const target = profile.salaryMin;
  let score: number;
  if (range.min >= target) {
    score = 100;
  } else if (range.max >= target) {
    const span = range.max - range.min;
    score = span > 0 ? 50 + 50 * ((range.max - target) / span) : 75;
  } else {
    const shortfall = target - range.max;
    // Steeper penalty when the listing's TOP is below the floor: a 40% gap
    // should not still read as a passable 60% match.
    score = Math.max(0, 100 - (shortfall / target) * 200);
  }
  const ccy = range.currency ?? profile.salaryCurrency ?? '';
  const sep = ccy ? ` ${ccy}` : '';
  return {
    included: true,
    score,
    rationale: `Listing ${range.min}-${range.max}${sep} vs profile min ${target} ${profile.salaryCurrency}.`,
  };
}

// --- Default evaluator map ------------------------------------------------

/** The Epic 5 default factor evaluators, indexed by `FactorKey` so they
 *  drop into `score()` (the next ticket wires this into the IPC path). */
export const defaultFactorEvaluators: Record<FactorKey, FactorEvaluator> = {
  skills: evaluateSkills,
  experience: evaluateExperience,
  location: evaluateLocation,
  salary: evaluateSalary,
};
