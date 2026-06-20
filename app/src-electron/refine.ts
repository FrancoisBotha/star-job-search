/**
 * Refinement helpers (TDE-003 — Epic 9: Tailoring Diff Engine).
 *
 * Pure, deterministic, no-LLM utilities consumed by the tailoring pipeline:
 *
 *   AC2 — analyzeGaps: split missing JD keywords into INJECTABLE (also present
 *         in the master CV) vs flagged NON-INJECTABLE (absent from the master
 *         CV — must never be injected).
 *   AC3 — removeAiPhrases: replace blacklisted filler ("leveraged",
 *         "synergies", "robust", …) with plainer wording, BUT never touch a
 *         term that appears verbatim in the JD (those are required keywords).
 *   AC4 — checkMasterAlignment: reject proposed skill / cert / employer that
 *         is absent from both the master CV and the JD; items absent from the
 *         CV but present in the JD pass at 'info' level with a note.
 *   AC5 — inventedMetricsWarnings + wordCountBlowupWarnings: surface numbers
 *         introduced into proposed text that were not in the original, plus
 *         excessive expansion in word count.
 */

// ---------------------------------------------------------------------------
// Small text helpers
// ---------------------------------------------------------------------------

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wordBoundaryRe(term: string, flags = 'i'): RegExp {
  return new RegExp(
    `(?:^|[^A-Za-z0-9_+#])${escapeRegExp(term)}(?:[^A-Za-z0-9_+#]|$)`,
    flags,
  );
}

function containsTerm(haystack: string, term: string): boolean {
  if (!term.trim()) return false;
  return wordBoundaryRe(term).test(haystack);
}

function countWords(s: string): number {
  return (s.trim().match(/\S+/g) ?? []).length;
}

// ---------------------------------------------------------------------------
// AC2 — Injectable vs non-injectable gap analysis
// ---------------------------------------------------------------------------

/** A small built-in stopword list keeps gap analysis pure (no external dep). */
const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','by','for','from','has','have','in','is',
  'it','its','of','on','or','that','the','to','was','were','will','with','you',
  'your','our','we','they','this','these','those','their','there','also',
  'need','needs','bonus','experience','plus','must','should','prior',
]);

/** Extract JD "keywords" as cased single-word tokens + simple multi-word
 *  proper-noun phrases. Conservative on purpose — JD-keyword sources upstream
 *  may pass an explicit list; this is the fallback. */
function extractJdKeywords(jdText: string): string[] {
  if (!jdText) return [];
  const raw = jdText.match(/[A-Za-z][A-Za-z0-9+#./-]{1,}/g) ?? [];
  const tokens = raw.map((t) => t.replace(/[./-]+$/, ''));
  const out = new Set<string>();
  for (const t of tokens) {
    if (STOPWORDS.has(t.toLowerCase())) continue;
    if (t.length < 2) continue;
    // Keep tokens that look like skills / proper nouns: contain an uppercase
    // letter, a digit, '+', '#', '.', or '/'. Drops sentence words like
    // "looking", "experience" while keeping "Kubernetes", "C++", "Node.js".
    if (/[A-Z+#./]/.test(t) || /\d/.test(t)) out.add(t);
  }
  return [...out];
}

export interface GapAnalysis {
  /** JD keywords missing from current text but present in the master CV. */
  injectable: string[];
  /** JD keywords missing from current text AND from the master CV. */
  nonInjectable: string[];
}

export function analyzeGaps(
  jdText: string,
  masterCvText: string,
  currentText: string,
  jdKeywords?: string[],
): GapAnalysis {
  const keywords = jdKeywords && jdKeywords.length > 0
    ? jdKeywords
    : extractJdKeywords(jdText);

  const injectable: string[] = [];
  const nonInjectable: string[] = [];
  const seen = new Set<string>();

  for (const kw of keywords) {
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (containsTerm(currentText, kw)) continue;
    if (containsTerm(masterCvText, kw)) {
      injectable.push(kw);
    } else {
      nonInjectable.push(kw);
    }
  }
  return { injectable, nonInjectable };
}

// ---------------------------------------------------------------------------
// AC3 — AI-phrase remover (local, no LLM)
// ---------------------------------------------------------------------------

/** Filler / AI-tell phrases mapped to plainer replacements. Lowercase keys. */
const AI_PHRASE_BLACKLIST: Array<{ pattern: RegExp; replacement: string; term: string }> = [
  { term: 'leveraged',        pattern: /\bleveraged\b/gi,        replacement: 'used' },
  { term: 'leverage',         pattern: /\bleverage\b/gi,         replacement: 'use' },
  { term: 'leveraging',       pattern: /\bleveraging\b/gi,       replacement: 'using' },
  { term: 'synergies',        pattern: /\bsynergies\b/gi,        replacement: 'overlap' },
  { term: 'synergy',          pattern: /\bsynergy\b/gi,          replacement: 'overlap' },
  { term: 'robust',           pattern: /\brobust\b/gi,           replacement: 'reliable' },
  { term: 'cutting-edge',     pattern: /\bcutting[- ]edge\b/gi,  replacement: 'modern' },
  { term: 'state-of-the-art', pattern: /\bstate[- ]of[- ]the[- ]art\b/gi, replacement: 'modern' },
  { term: 'best-in-class',    pattern: /\bbest[- ]in[- ]class\b/gi, replacement: 'leading' },
  { term: 'world-class',      pattern: /\bworld[- ]class\b/gi,   replacement: 'top' },
  { term: 'seamlessly',       pattern: /\bseamlessly\b/gi,       replacement: 'cleanly' },
  { term: 'utilize',          pattern: /\butili[sz]e\b/gi,       replacement: 'use' },
  { term: 'utilized',         pattern: /\butili[sz]ed\b/gi,      replacement: 'used' },
  { term: 'spearheaded',      pattern: /\bspearheaded\b/gi,      replacement: 'led' },
  { term: 'orchestrated',     pattern: /\borchestrated\b/gi,     replacement: 'ran' },
  { term: 'paradigm',         pattern: /\bparadigm\b/gi,         replacement: 'approach' },
  { term: 'holistic',         pattern: /\bholistic\b/gi,         replacement: 'overall' },
  { term: 'delve',            pattern: /\bdelve\b/gi,            replacement: 'dig' },
  { term: 'tapestry',         pattern: /\btapestry\b/gi,         replacement: 'mix' },
];

/** True when `jdText` contains the phrase (or, for word-stem terms like
 *  "leverage", any form sharing the same stem prefix). Stems guard against
 *  trivial differences like "leverage" in JD vs "leveraged" in CV. */
function jdProtectsTerm(jdText: string, term: string): boolean {
  if (!jdText) return false;
  const lower = jdText.toLowerCase();
  if (lower.includes(term.toLowerCase())) return true;
  // stem-ish: take first 5+ chars and see if the JD contains them as a word
  // prefix. Keeps "leverage" ↔ "leveraged" ↔ "leveraging" linked.
  const stem = term.replace(/[^A-Za-z]/g, '').slice(0, Math.max(5, Math.floor(term.length * 0.7)));
  if (stem.length < 4) return false;
  const re = new RegExp(`\\b${escapeRegExp(stem)}`, 'i');
  return re.test(jdText);
}

export function removeAiPhrases(text: string, jdText: string): string {
  let out = text;
  for (const entry of AI_PHRASE_BLACKLIST) {
    if (jdProtectsTerm(jdText, entry.term)) continue;
    out = out.replace(entry.pattern, entry.replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// AC4 — Master-alignment check
// ---------------------------------------------------------------------------

export type AlignmentKind = 'skill' | 'cert' | 'employer';

export interface MasterAlignmentInput {
  skills: string[];
  certs?: string[];
  employers?: string[];
  /** Full base-CV text — used as a fallback for prose-only mentions. */
  text: string;
}

export interface AlignmentResult {
  ok: boolean;
  level: 'pass' | 'info' | 'critical';
  note: string;
}

function listContains(list: string[] | undefined, value: string): boolean {
  if (!list) return false;
  const v = value.trim().toLowerCase();
  return list.some((x) => x.trim().toLowerCase() === v);
}

export function checkMasterAlignment(
  item: string,
  kind: AlignmentKind,
  master: MasterAlignmentInput,
  jdText: string,
): AlignmentResult {
  const inList =
    (kind === 'skill' && listContains(master.skills, item)) ||
    (kind === 'cert' && listContains(master.certs, item)) ||
    (kind === 'employer' && listContains(master.employers, item));

  if (inList || containsTerm(master.text, item)) {
    return { ok: true, level: 'pass', note: `${kind} found in master CV` };
  }

  if (containsTerm(jdText, item)) {
    return {
      ok: true,
      level: 'info',
      note: `${kind} "${item}" is in the JD but not in the master CV — flag for user review`,
    };
  }

  return {
    ok: false,
    level: 'critical',
    note: `${kind} "${item}" is absent from both the master CV and the JD — rejected`,
  };
}

// ---------------------------------------------------------------------------
// AC5 — Invented-metric and word-count warnings
// ---------------------------------------------------------------------------

export type RefineWarningKind = 'invented_metric' | 'word_count_blowup';

export interface RefineWarning {
  kind: RefineWarningKind;
  message: string;
  value: string;
}

/** Capture numeric tokens including %, decimals, and unit suffixes (k, M, B). */
const NUMBER_RE = /\b\d[\d,]*(?:\.\d+)?(?:[kKmMbB]|%)?\b/g;

export function inventedMetricsWarnings(
  original: string,
  proposed: string,
): RefineWarning[] {
  const origNums = new Set((original.match(NUMBER_RE) ?? []).map((n) => n.toLowerCase()));
  const propNums = proposed.match(NUMBER_RE) ?? [];
  const warnings: RefineWarning[] = [];
  const flagged = new Set<string>();
  for (const n of propNums) {
    const key = n.toLowerCase();
    if (origNums.has(key)) continue;
    if (flagged.has(key)) continue;
    flagged.add(key);
    warnings.push({
      kind: 'invented_metric',
      message: `Number "${n}" appears in proposed text but not in the original`,
      value: n,
    });
  }
  return warnings;
}

/** Threshold: 1.6× word count is treated as a blow-up. */
const BLOWUP_RATIO = 1.6;

export function wordCountBlowupWarnings(
  original: string,
  proposed: string,
): RefineWarning[] {
  const o = countWords(original);
  const p = countWords(proposed);
  if (o === 0) return [];
  const ratio = p / o;
  if (ratio < BLOWUP_RATIO) return [];
  return [
    {
      kind: 'word_count_blowup',
      message: `Proposed text is ${ratio.toFixed(2)}× the original word count (${o} → ${p})`,
      value: `${o}→${p}`,
    },
  ];
}
