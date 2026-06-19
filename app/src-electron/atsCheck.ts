/**
 * ATS-check + punctuation-normaliser module (TAILOR-002 / Epic 7 §4, §7).
 *
 * Pure, deterministic rule validators for tailoring outputs. The module has
 * no DB / IPC / network / LLM / clock / randomness dependence: for a given
 * `(doc, jdKeywords)` input the same output is always returned.
 *
 * It exposes:
 *  - `normalisePunctuation(text)` — converts smart punctuation to ASCII and
 *    strips zero-width / non-breaking control characters (FR-008 auto-fix).
 *  - `checkAts(doc, jdKeywords)` — runs the §4 ATS ruleset over `doc` after
 *    applying normalisation to every text field, and returns an `AtsReport`:
 *      { checks: AtsCheck[], normalisedDoc, normalisedText }
 *    Each `AtsCheck` matches the §7 contract `{ rule, passed, detail? }`.
 *    Punctuation issues are NORMALISED into `normalisedDoc` rather than only
 *    being flagged (FR-009).
 *
 * The module is intentionally side-effect-free so it can be exercised by
 * pure unit tests (`atsCheck.test.ts`) without an Electron / DB harness.
 */

// --- §7 shapes -------------------------------------------------------------

/** A single rule outcome in the ATS report (Epic 7 §7). */
export interface AtsCheck {
  /** Stable machine-readable rule id (e.g. `layout-single-column`). */
  rule: string;
  /** Whether the document satisfies this rule. */
  passed: boolean;
  /** Optional human-readable explanation (failure reason, listed items). */
  detail?: string;
}

/** Structured tailoring output the checker validates. The shape is the
 *  minimal slice needed by the §4 ruleset; upstream producers populate the
 *  optional flags they know about (e.g. `hasTables` from a DOCX parser). */
export interface CvDocument {
  /** Full document text — the source of truth for "selectable UTF-8 text"
   *  and section-title detection. */
  text: string;
  /** Number of layout columns. Defaults to 1 when omitted. */
  columns?: number;
  /** True if the rendered document contains a table. Default false. */
  hasTables?: boolean;
  /** True if the rendered document embeds an image (incl. text-in-graphics).
   *  Default false. */
  hasImages?: boolean;
  /** Optional structured summary block. */
  summary?: string;
  /** Optional ordered experience entries (most recent first is the rule). */
  experience?: ExperienceEntry[];
  /** Optional flat skills list. */
  skills?: string[];
}

export interface ExperienceEntry {
  role: string;
  company?: string;
  /** Inclusive start date — accepts `YYYY`, `YYYY-MM`, or `YYYY-MM-DD`. */
  startDate: string;
  /** Inclusive end date in the same format, or `null`/`'present'` /`'now'`
   *  for the current role. */
  endDate?: string | null;
  bullets: string[];
}

export interface AtsReport {
  checks: AtsCheck[];
  /** The input document with punctuation normalisation applied to every
   *  text field. Auto-fixes per FR-009. */
  normalisedDoc: CvDocument;
  /** Convenience alias for `normalisedDoc.text`. */
  normalisedText: string;
}

// --- AC2: punctuation normaliser ------------------------------------------

/** Character-level translations applied by `normalisePunctuation`. Kept as
 *  a flat map so the table is easy to audit and extend. Multi-char outputs
 *  (e.g. `…` -> `...`) are supported. */
const PUNCT_MAP: Record<string, string> = {
  // dashes
  '—': '-', // em-dash
  '–': '-', // en-dash
  '−': '-', // minus sign
  '―': '-', // horizontal bar
  '‐': '-', // hyphen
  '‑': '-', // non-breaking hyphen
  // quotes
  '‘': "'", // left single quote
  '’': "'", // right single quote
  '‚': "'", // single low-9 quote
  '‛': "'", // single high-reversed-9 quote
  '′': "'", // prime
  '“': '"', // left double quote
  '”': '"', // right double quote
  '„': '"', // double low-9 quote
  '‟': '"', // double high-reversed-9 quote
  '″': '"', // double prime
  // ellipsis
  '…': '...',
  // arrows
  '→': '->',
  '←': '<-',
  '↑': '^',
  '↓': 'v',
  '↔': '<->',
  '⇒': '=>',
  '⇐': '<=',
  '⇔': '<=>',
  // bullets / middots
  '·': '*', // middle dot
  '•': '*', // bullet
  '‣': '*', // triangular bullet
  '◦': '*', // white bullet
  // non-breaking / narrow / thin spaces -> regular space
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
};

/** Characters stripped entirely (zero-width / BOM). */
const STRIP_CHARS = new Set(['​', '‌', '‍', '⁠', '﻿']);

/**
 * AC2 — Convert smart punctuation to ASCII and strip zero-width / BOM
 * characters. Pure: same input always yields the same output; never throws;
 * preserves all other characters (including the U+FFFD replacement, which
 * the `selectable-utf8-text` rule uses to detect unparseable text).
 */
export function normalisePunctuation(text: string): string {
  let out = '';
  for (const ch of text) {
    if (STRIP_CHARS.has(ch)) continue;
    out += PUNCT_MAP[ch] ?? ch;
  }
  return out;
}

// --- §4 ATS ruleset --------------------------------------------------------

/** Recognised standard CV section titles. Match is case-insensitive and
 *  whitespace-insensitive. Extend conservatively — every new entry weakens
 *  the rule. */
const RECOGNISED_SECTIONS = new Set([
  'summary',
  'profile',
  'objective',
  'about',
  'about me',
  'experience',
  'work experience',
  'professional experience',
  'employment',
  'employment history',
  'work history',
  'career history',
  'education',
  'academic background',
  'qualifications',
  'skills',
  'technical skills',
  'core skills',
  'core competencies',
  'competencies',
  'projects',
  'selected projects',
  'certifications',
  'certificates',
  'awards',
  'publications',
  'languages',
  'interests',
  'references',
  'contact',
  'contact details',
  'personal details',
]);

/** A line is considered a section heading if it is short, non-empty, and
 *  consists entirely of letters/spaces/`&`/`-` with no sentence punctuation —
 *  i.e. the typical ALL-CAPS or Title-Case heading style. */
function detectSectionTitles(text: string): string[] {
  const titles: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length > 40) continue;
    if (!/^[A-Za-z][A-Za-z &-]+$/.test(line)) continue;
    // Reject lines that look like sentences or list items.
    if (/[.,:;!?()[\]{}<>]/.test(line)) continue;
    titles.push(line);
  }
  return titles;
}

/** Parse the loose date forms accepted in `ExperienceEntry` into a sortable
 *  numeric key. `null` / `'present'` / `'now'` (case-insensitive) -> +Inf so
 *  current roles always sort first. Unparseable strings -> NaN. */
function dateKey(value: string | null | undefined): number {
  if (value == null) return Number.POSITIVE_INFINITY;
  const v = value.trim().toLowerCase();
  if (v === '' || v === 'present' || v === 'now' || v === 'current') {
    return Number.POSITIVE_INFINITY;
  }
  const m = /^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/.exec(v);
  if (!m) return Number.NaN;
  const y = Number(m[1]);
  const mo = m[2] ? Number(m[2]) : 1;
  const d = m[3] ? Number(m[3]) : 1;
  return y * 10000 + mo * 100 + d;
}

/** True when `keywords` (case-insensitive) appear at least once in `haystack`. */
function hasAnyKeyword(haystack: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = haystack.toLowerCase();
  return keywords.some((k) => k.trim() !== '' && hay.includes(k.toLowerCase()));
}

/** Apply `normalisePunctuation` to every text field of `doc` without
 *  mutating the input (AC4 purity). */
function normaliseDoc(doc: CvDocument): CvDocument {
  return {
    text: normalisePunctuation(doc.text),
    columns: doc.columns,
    hasTables: doc.hasTables,
    hasImages: doc.hasImages,
    summary: doc.summary == null ? undefined : normalisePunctuation(doc.summary),
    experience: doc.experience?.map((e) => ({
      role: normalisePunctuation(e.role),
      company: e.company == null ? undefined : normalisePunctuation(e.company),
      startDate: e.startDate,
      endDate: e.endDate ?? null,
      bullets: e.bullets.map(normalisePunctuation),
    })),
    skills: doc.skills?.map(normalisePunctuation),
  };
}

/**
 * AC1 + AC3 — Run the §4 ATS ruleset over `doc` and return a per-rule
 * report. The document is first passed through `normalisePunctuation` (so
 * smart punctuation auto-fixes are applied, not just flagged), and every
 * rule evaluates the NORMALISED form. The original input is never mutated.
 */
export function checkAts(doc: CvDocument, jdKeywords: string[]): AtsReport {
  const normalisedDoc = normaliseDoc(doc);
  const checks: AtsCheck[] = [];

  // --- Layout: single column, no tables/images/text-in-graphics ----------
  const columns = normalisedDoc.columns ?? 1;
  checks.push({
    rule: 'layout-single-column',
    passed: columns === 1,
    detail: columns === 1 ? undefined : `document uses ${columns} columns`,
  });

  const layoutFlags: string[] = [];
  if (normalisedDoc.hasTables) layoutFlags.push('tables');
  if (normalisedDoc.hasImages) layoutFlags.push('images/text-in-graphics');
  checks.push({
    rule: 'no-tables-or-graphics',
    passed: layoutFlags.length === 0,
    detail: layoutFlags.length === 0 ? undefined : `contains ${layoutFlags.join(', ')}`,
  });

  // --- Section titles: standard + recognised -----------------------------
  const titles = detectSectionTitles(normalisedDoc.text);
  const unrecognised = titles.filter(
    (t) => !RECOGNISED_SECTIONS.has(t.toLowerCase()),
  );
  checks.push({
    rule: 'section-titles-recognised',
    passed: unrecognised.length === 0,
    detail:
      unrecognised.length === 0
        ? undefined
        : `unrecognised: ${unrecognised.join(', ')}`,
  });

  // --- Reverse-chronological experience ----------------------------------
  const exp = normalisedDoc.experience ?? [];
  let chronoOk = true;
  let chronoDetail: string | undefined;
  const entryKey = (e: ExperienceEntry): number =>
    e.endDate === undefined ? dateKey(e.startDate) : dateKey(e.endDate);
  for (let i = 1; i < exp.length; i++) {
    const prev = exp[i - 1]!;
    const cur = exp[i]!;
    const prevKey = entryKey(prev);
    const curKey = entryKey(cur);
    if (Number.isNaN(prevKey) || Number.isNaN(curKey)) {
      chronoOk = false;
      chronoDetail = `unparseable date around "${prev.role}" / "${cur.role}"`;
      break;
    }
    if (prevKey < curKey) {
      chronoOk = false;
      chronoDetail = `"${prev.role}" precedes more recent "${cur.role}"`;
      break;
    }
  }
  checks.push({
    rule: 'experience-reverse-chronological',
    passed: chronoOk,
    detail: chronoDetail,
  });

  // --- Selectable UTF-8 text --------------------------------------------
  // The replacement character (U+FFFD) is the canonical sign of a non-UTF-8
  // byte sequence that has been lossily decoded — text containing it is no
  // longer reliably "selectable" by an ATS.
  const hasReplacement = normalisedDoc.text.includes('�');
  const hasAnyText = normalisedDoc.text.trim().length > 0;
  checks.push({
    rule: 'selectable-utf8-text',
    passed: hasAnyText && !hasReplacement,
    detail: !hasAnyText
      ? 'document text is empty'
      : hasReplacement
        ? 'text contains the U+FFFD replacement character'
        : undefined,
  });

  // --- JD-keyword coverage / placement ----------------------------------
  const missingFrom = (haystack: string): string[] => {
    const hay = haystack.toLowerCase();
    return jdKeywords.filter(
      (k) => k.trim() !== '' && !hay.includes(k.toLowerCase()),
    );
  };

  const summaryText = normalisedDoc.summary ?? '';
  checks.push({
    rule: 'keywords-in-summary',
    passed: hasAnyKeyword(summaryText, jdKeywords),
    detail: hasAnyKeyword(summaryText, jdKeywords)
      ? undefined
      : `no JD keyword found in summary (missing: ${missingFrom(summaryText).join(', ')})`,
  });

  const bulletsText = exp.flatMap((e) => e.bullets).join('\n');
  checks.push({
    rule: 'keywords-in-role-bullets',
    passed: hasAnyKeyword(bulletsText, jdKeywords),
    detail: hasAnyKeyword(bulletsText, jdKeywords)
      ? undefined
      : 'no JD keyword found in any role bullet',
  });

  const skillsText = (normalisedDoc.skills ?? []).join(', ');
  checks.push({
    rule: 'keywords-in-skills',
    passed: hasAnyKeyword(skillsText, jdKeywords),
    detail: hasAnyKeyword(skillsText, jdKeywords)
      ? undefined
      : 'no JD keyword found in skills list',
  });

  return {
    checks,
    normalisedDoc,
    normalisedText: normalisedDoc.text,
  };
}
