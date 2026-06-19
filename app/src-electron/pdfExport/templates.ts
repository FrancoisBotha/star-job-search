/**
 * PDFEX-003 — ATS-safe LaTeX template(s) for CV + cover letter, plus
 * build validation that runs BEFORE the engine is invoked.
 *
 * What this module owns:
 *   - A single-column, recruiter-grade preamble shared by both doc types
 *     (FR-004): T1 fontenc + lmodern so Latin Modern Type 1 fonts are
 *     embedded and self-hosted; geometry for consistent margins;
 *     hyperref for selectable links; `\pdfgentounicode=1` so the
 *     compiled PDF carries a ToUnicode CMap and text is selectable as
 *     UTF-8, never a rasterised image (FR-003, NFR-001).
 *   - Two templates with explicit {{PLACEHOLDER}} tokens:
 *       CV_TEMPLATE          — Summary / Competencies / Achievements /
 *                              Keywords, in recruiter-scan order
 *                              (FR-004).
 *       COVER_LETTER_TEMPLATE — single Cover Letter section.
 *   - Locale-driven page size: en/fr-CA and en-US → `letterpaper`;
 *     anything else → `a4paper` (FR-004). Margins stay consistent
 *     across paper sizes and doc types.
 *   - `validateLatexBuild(tex)` — pre-compile validation: required
 *     structural commands present AND no unresolved `{{...}}`
 *     placeholders. Throws {@link PdfExportValidationError} with a
 *     clear, specific message when either check fails (FR-006).
 *
 * Render helpers are PURE: same input → byte-identical output, no
 * Date.now() / Math.random() / I/O. The escaper and URL sanitiser used
 * here live in the parent pdfExport module so this file does not
 * duplicate them; callers pass already-safe strings.
 */

/** Paper sizes supported by the ATS-safe templates. */
export type PaperSize = 'letterpaper' | 'a4paper';

/** Consistent geometry margin used by BOTH templates regardless of
 *  paper size — keeps the visual feel identical on Letter vs A4. */
const GEOMETRY_MARGIN = '2cm';

/** Single-column, ATS-safe preamble shared by both templates. The
 *  `{{PAPER_SIZE}}` token is substituted with `letterpaper` or
 *  `a4paper` per locale; everything else is fixed.
 *
 *  Why each line:
 *   - inputenc utf8 / fontenc T1: 8-bit Type 1 font path, embeds glyphs.
 *   - lmodern: Latin Modern — self-hosted, embedded in the PDF; ATS
 *     parsers handle it cleanly.
 *   - geometry: consistent 2cm margins on Letter and A4.
 *   - hyperref: selectable URLs without changing layout.
 *   - enumitem with `nosep,leftmargin=*`: tight, single-column bullets.
 *   - pagestyle empty: no header/footer noise for ATS extraction.
 *   - `\pdfgentounicode=1`: PDF carries ToUnicode CMaps so the text is
 *     copy-pasteable as UTF-8 — never a rasterised image of text. */
const SHARED_PREAMBLE = [
  '\\documentclass[11pt,{{PAPER_SIZE}}]{article}',
  '\\usepackage[utf8]{inputenc}',
  '\\usepackage[T1]{fontenc}',
  '\\usepackage{lmodern}',
  `\\usepackage[margin=${GEOMETRY_MARGIN}]{geometry}`,
  '\\usepackage{enumitem}',
  '\\usepackage{hyperref}',
  '\\setlist{nosep,leftmargin=*}',
  '\\pagestyle{empty}',
  '\\pdfgentounicode=1',
].join('\n');

/** CV template. Section order is reverse-chronological recruiter-scan
 *  (Summary → Competencies → Achievements → Keywords) per FR-004. */
export const CV_TEMPLATE = [
  SHARED_PREAMBLE,
  '\\begin{document}',
  '{{CONTACT}}',
  '\\section*{Summary}',
  '{{SUMMARY}}',
  '\\section*{Competencies}',
  '{{COMPETENCIES}}',
  '\\section*{Achievements}',
  '{{ACHIEVEMENTS}}',
  '\\section*{Keywords}',
  '{{KEYWORDS}}',
  '\\end{document}',
  '',
].join('\n');

/** Cover-letter template — same preamble primitives, single
 *  recruiter-scan section. */
export const COVER_LETTER_TEMPLATE = [
  SHARED_PREAMBLE,
  '\\begin{document}',
  '{{CONTACT}}',
  '\\section*{Cover Letter}',
  '{{OPENING}}',
  '',
  '{{BODY}}',
  '',
  '{{CLOSING}}',
  '\\end{document}',
  '',
].join('\n');

// --- Locale → paper size ----------------------------------------------------

/** Locales served Letter rather than A4 — North-American convention
 *  (US + both official Canadian language tags). Everything else is A4. */
const LETTER_LOCALES = new Set(['en-US', 'en-CA', 'fr-CA']);

/** Canonicalise a locale tag so `en_US`, `EN-US`, `en-us` all match the
 *  same entry in {@link LETTER_LOCALES}. */
function normaliseLocale(locale: string | undefined): string {
  if (!locale) return '';
  return locale.trim().replace(/_/g, '-').toLowerCase().replace(/^([a-z]+)-([a-z]+)$/, (_m, lang, region) => `${lang}-${region.toUpperCase()}`);
}

/**
 * Map a BCP-47 locale tag to the ATS-safe paper size.
 *
 *   US / Canada (any official language) → `letterpaper`
 *   everything else (including unknown / empty) → `a4paper`
 *
 * Pure: same input → same output.
 */
export function selectPaperSize(locale: string | undefined): PaperSize {
  const norm = normaliseLocale(locale);
  return LETTER_LOCALES.has(norm) ? 'letterpaper' : 'a4paper';
}

// --- Render -----------------------------------------------------------------

export interface ContactFields {
  name?: string;
  email?: string;
  phone?: string;
  url?: string;
  location?: string;
}

export interface CvRenderInput {
  contact: ContactFields;
  /** Already LaTeX-escaped summary. Caller is responsible for escaping
   *  and punctuation-normalising upstream. */
  summary: string;
  /** Already LaTeX-escaped competencies. */
  competencies: readonly string[];
  /** Already LaTeX-escaped achievement bullets. */
  achievements: readonly string[];
  /** Already LaTeX-escaped keywords. */
  keywords: readonly string[];
  /** BCP-47 locale tag; drives page size. */
  locale: string | undefined;
}

export interface CoverLetterRenderInput {
  contact: ContactFields;
  /** Already-escaped opening line. */
  opening: string;
  /** Already-escaped body paragraphs, in order. */
  body: readonly string[];
  /** Already-escaped closing line. */
  closing: string;
  locale: string | undefined;
}

/** Render the LaTeX contact block — purely from supplied fields, no
 *  fabrication. Returns '' when no contact data is supplied so the
 *  template emits an empty line where the block would have lived. */
export function renderContactBlock(contact: ContactFields): string {
  const lines: string[] = [];
  if (contact.name) lines.push(`{\\Large\\bfseries ${contact.name}}\\\\`);
  const detail: string[] = [];
  if (contact.email) detail.push(contact.email);
  if (contact.phone) detail.push(contact.phone);
  if (contact.location) detail.push(contact.location);
  if (contact.url) detail.push(`\\href{${contact.url}}{${contact.url}}`);
  if (detail.length) lines.push(detail.join(' \\quad '));
  if (!lines.length) return '';
  return `\\begin{center}\n${lines.join('\n')}\n\\end{center}`;
}

function renderItemList(items: readonly string[]): string {
  if (!items.length) return '';
  const rows = items.map((it) => `  \\item ${it}`).join('\n');
  return `\\begin{itemize}\n${rows}\n\\end{itemize}`;
}

function substitute(template: string, replacements: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(replacements)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

/** Render a tailored CV into a complete ATS-safe LaTeX document. */
export function renderCvLatex(input: CvRenderInput): string {
  const paper = selectPaperSize(input.locale);
  return substitute(CV_TEMPLATE, {
    PAPER_SIZE: paper,
    CONTACT: renderContactBlock(input.contact),
    SUMMARY: input.summary,
    COMPETENCIES: renderItemList(input.competencies),
    ACHIEVEMENTS: renderItemList(input.achievements),
    KEYWORDS: input.keywords.join(', '),
  });
}

/** Render a cover letter into a complete ATS-safe LaTeX document. */
export function renderCoverLetterLatex(input: CoverLetterRenderInput): string {
  const paper = selectPaperSize(input.locale);
  const body = input.body.filter((p) => p.length > 0).join('\n\n');
  return substitute(COVER_LETTER_TEMPLATE, {
    PAPER_SIZE: paper,
    CONTACT: renderContactBlock(input.contact),
    OPENING: input.opening,
    BODY: body,
    CLOSING: input.closing,
  });
}

// --- Build validation -------------------------------------------------------

/** Validation-specific error so callers can distinguish "we never even
 *  invoked the engine because the document was malformed" from a
 *  downstream engine failure. Extends Error directly (no project-side
 *  base class) so this module is self-contained; the parent module
 *  re-throws it wrapped in `PdfExportError` for the public API. */
export class PdfExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfExportValidationError';
  }
}

/** Required structural commands every rendered template must carry —
 *  these are what make the document ATS-safe and self-contained. If a
 *  substitution accidentally stripped one, we want to know BEFORE
 *  spending engine time. */
const REQUIRED_COMMANDS: ReadonlyArray<{ name: string; matcher: RegExp }> = [
  { name: '\\documentclass', matcher: /\\documentclass\b/ },
  { name: '\\begin{document}', matcher: /\\begin\{document\}/ },
  { name: '\\end{document}', matcher: /\\end\{document\}/ },
  { name: '\\pdfgentounicode=1', matcher: /\\pdfgentounicode\s*=\s*1\b/ },
  { name: '\\usepackage[T1]{fontenc}', matcher: /\\usepackage\[T1\]\{fontenc\}/ },
  { name: '\\usepackage{lmodern}', matcher: /\\usepackage\{lmodern\}/ },
  { name: '\\usepackage{geometry}', matcher: /\\usepackage(\[[^\]]*\])?\{geometry\}/ },
  { name: '\\usepackage{hyperref}', matcher: /\\usepackage\{hyperref\}/ },
];

const UNRESOLVED_PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

/**
 * Pre-compile validation. Throws {@link PdfExportValidationError} with
 * a clear, specific message naming the offending command or
 * placeholder. A throw guarantees the caller will NOT invoke the
 * engine — so no partial PDF can ever appear on disk (FR-006).
 */
export function validateLatexBuild(tex: string): void {
  const unresolved = new Set<string>();
  for (const match of tex.matchAll(UNRESOLVED_PLACEHOLDER)) {
    unresolved.add(match[0]);
  }
  if (unresolved.size > 0) {
    const list = [...unresolved].sort().join(', ');
    throw new PdfExportValidationError(
      `Unresolved template placeholder(s) in LaTeX source: ${list}. Refusing to compile.`,
    );
  }
  const missing = REQUIRED_COMMANDS.filter((c) => !c.matcher.test(tex)).map((c) => c.name);
  if (missing.length > 0) {
    throw new PdfExportValidationError(
      `LaTeX source is missing required command(s): ${missing.join(', ')}. Refusing to compile.`,
    );
  }
}
