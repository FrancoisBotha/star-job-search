/**
 * Epic 12 (Unified Export) behavioural regression suite — UEXP-007.
 *
 * Per-ticket tests cover each layer in isolation (`wordExport.test.ts`,
 * `wordExportIpc.test.ts`, `TailorPage.uexp004.test.ts`, etc.). This file
 * complements them by exercising the EPIC's key user-facing behaviours
 * through the REAL modules — the real `renderTailoredDocToDocx`, the real
 * `normalisePunctuation` — driven by realistic fixtures including odd
 * Unicode that has historically caused export regressions.
 *
 * The goal is to guard against future regressions of the holistic epic
 * contract:
 *   §1 Word .docx generation — single column, selectable UTF-8 text,
 *      ATS-safe font, locale-appropriate page size, no images / text
 *      boxes, content-faithful (no suggestions / gaps leak).
 *   §2 ASCII normalisation — smart punctuation, em/en dashes, ellipses,
 *      non-breaking/narrow spaces, zero-width marks all become ASCII in
 *      the rendered `word/document.xml`, AND user-supplied markup cannot
 *      inject OOXML (XML escaping is intact).
 *   §3 Export-menu dispatch (UI contract) — the Tailor view exposes
 *      exactly one Export entry point that routes Markdown → Epic 7,
 *      Word → UEXP-002/003, PDF → Epic 8. Disable-with-reason wiring
 *      survives.
 *   §4 Provenance — the Word IPC's per-export record carries the
 *      additive `format: 'word'` + `filePath` fields described in
 *      epic §7 (type-level guard against accidental shape regressions).
 *
 * Following the project convention for `epic-regression.*.test.ts`: real
 * implementations everywhere they exist (no mocks), JSZip for OOXML
 * round-tripping, and static-source scans of `TailorPage.vue` for the
 * UI dispatch contract (mirrors UEXP-004 / UEXP-006).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { renderTailoredDocToDocx } from '../wordExport';
import { normalisePunctuation } from '../atsCheck';
import type { CoverLetter, TailoredCv } from '../tailor';
import type { WordExportRecord } from '../wordExportIpc';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAILOR_VUE = readFileSync(
  path.resolve(__dirname, '..', '..', 'src', 'pages', 'TailorPage.vue'),
  'utf8',
);

/** Realistic CV fixture mirroring an APPROVED tailored draft — special
 *  characters, smart quotes, em/en-dashes, ellipses, non-breaking spaces,
 *  zero-width marks, mathematical minus, narrow no-break space, and a
 *  literal `<script>` tag to assert XML escaping. */
function fixtureCv(): TailoredCv {
  return {
    summary:
      'Senior engineer — shipped “payments” rewrite… saved 40 % latency.',
    competencies: [
      'TypeScript → Node.js',
      'Distributed systems — multi-region',
      '​Leadership​', // zero-width spaces around the word
    ],
    achievementBullets: [
      'Cut p99 from 1 200ms to 480ms (−60%).', // narrow no-break + math minus
      'Wrote <script>alert("x")</script> & co. — see appendix.',
      'Mentored 5 engineers – 4 promoted to senior.',
    ],
    keywords: ['typescript', 'aws', 'react'],
    suggestions: [
      {
        area: 'tone',
        suggestion: 'INTERNAL_SUGGESTION_SHOULD_NOT_LEAK',
        rationale: 'r',
      },
    ],
    gaps: [
      {
        keyword: 'INTERNAL_GAP_SHOULD_NOT_LEAK',
        severity: 'nice_to_have',
        adjacentExperience: null,
      },
    ],
  };
}

function fixtureLetter(): CoverLetter {
  return {
    opening: 'Dear hiring team—',
    body: [
      'I’m applying for the role you posted “remote‑first”.',
      'My background covers the listed stack … happy to elaborate.',
    ],
    closing: 'Sincerely, Jane Doe',
    keywords: ['typescript'],
  };
}

async function extractDocumentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml missing from docx zip');
  return entry.async('string');
}

// --- AC1 — Word .docx generation: structural contract --------------------

describe('UEXP-007 §1 — Word .docx generation is single-column, selectable, ATS-safe', () => {
  it('produces a valid OOXML package (ZIP magic + word/document.xml present)', async () => {
    const buf = await renderTailoredDocToDocx({
      cv: fixtureCv(),
      coverLetter: fixtureLetter(),
    });
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('word/document.xml')).toBeTruthy();
  });

  it('declares a single-column body (no multi-column sectPr)', async () => {
    const xml = await extractDocumentXml(
      await renderTailoredDocToDocx({ cv: fixtureCv() }),
    );
    const colsMatch = xml.match(/<w:cols\b[^/]*\/>/);
    if (colsMatch) expect(colsMatch[0]).toMatch(/w:num="1"/);
    expect(xml).not.toMatch(/w:num="[2-9]/);
  });

  it('renders body content as real selectable text (no images, drawings, or text boxes)', async () => {
    const xml = await extractDocumentXml(
      await renderTailoredDocToDocx({
        cv: fixtureCv(),
        coverLetter: fixtureLetter(),
      }),
    );
    expect(xml).toMatch(/<w:t[\s>]/);
    expect(xml).not.toMatch(/<w:drawing\b/);
    expect(xml).not.toMatch(/<w:pict\b/);
    expect(xml).not.toMatch(/<v:textbox\b/);
    expect(xml).not.toMatch(/<w:tbl[\s>]/);
  });

  it('declares a standard ATS-safe font (Calibri / Arial / Times New Roman)', async () => {
    const xml = await extractDocumentXml(
      await renderTailoredDocToDocx({ cv: fixtureCv() }),
    );
    expect(xml).toMatch(
      /w:(rFonts|ascii|hAnsi)="?(Calibri|Arial|Times New Roman)"?/,
    );
  });

  it('selects locale-appropriate page size (en-US → Letter, en-GB → A4)', async () => {
    const us = await extractDocumentXml(
      await renderTailoredDocToDocx({ cv: fixtureCv(), locale: 'en-US' }),
    );
    expect(us).toMatch(/w:pgSz[^/]*w:w="12240"[^/]*w:h="15840"/);
    const gb = await extractDocumentXml(
      await renderTailoredDocToDocx({ cv: fixtureCv(), locale: 'en-GB' }),
    );
    expect(gb).toMatch(/w:pgSz[^/]*w:w="11906"[^/]*w:h="16838"/);
  });
});

// --- AC2 — ASCII normalisation + XML-escape -----------------------------

describe('UEXP-007 §2 — normalisation + XML-escape applied to realistic odd-Unicode fixtures', () => {
  it('strips smart quotes, em/en-dashes, ellipses, and non-breaking / narrow spaces from output XML', async () => {
    const xml = await extractDocumentXml(
      await renderTailoredDocToDocx({
        cv: fixtureCv(),
        coverLetter: fixtureLetter(),
      }),
    );
    // None of these characters should reach the rendered document.
    expect(xml).not.toMatch(/[‘’“”]/);
    expect(xml).not.toMatch(/[–—−]/);
    expect(xml).not.toMatch(/…/);
    expect(xml).not.toMatch(/[\u00A0\u2009\u202F\u200B]/);
  });

  it('renders fixture content faithfully after normalisation (em-dash → "-", ellipsis → "...", smart quotes → ASCII)', async () => {
    const xml = await extractDocumentXml(
      await renderTailoredDocToDocx({ cv: fixtureCv() }),
    );
    // Summary survives intact under the normaliser's mapping.
    // Smart quotes inside <w:t> are XML-escaped by the docx serialiser as
    // &quot;; em-dash → '-', ellipsis -> '...', NBSP -> ' '.
    expect(xml).toMatch(
      /Senior engineer - shipped (?:"|&quot;)payments(?:"|&quot;) rewrite\.\.\. saved 40 % latency\./,
    );
    // Narrow no-break space and minus sign also normalise.
    expect(xml).toMatch(/Cut p99 from 1 200ms to 480ms \(-60%\)\./);
  });

  it('escapes XML metacharacters in untrusted user content (no OOXML injection)', async () => {
    const xml = await extractDocumentXml(
      await renderTailoredDocToDocx({ cv: fixtureCv() }),
    );
    // Literal markup must not leak as real OOXML elements.
    expect(xml).not.toContain('<script>alert');
    expect(xml).toMatch(/&lt;script&gt;alert\(/);
    expect(xml).toContain('&amp;');
  });

  it('the normaliser used by the renderer is the SAME function exported from atsCheck (consistency with Epic 7/9)', () => {
    // This is the contract `wordExport.ts` documents — a regression here
    // would mean two different normalisation tables across the codebase.
    expect(normalisePunctuation('a—b…c')).toBe('a-b...c');
    expect(normalisePunctuation('“Hi”')).toBe('"Hi"');
    expect(normalisePunctuation('one two three')).toBe(
      'one two three',
    );
    expect(normalisePunctuation('zero​width')).toBe('zerowidth');
  });
});

// --- AC3 — content fidelity (no internal-only fields leak) --------------

describe('UEXP-007 §3 — content-faithful: only approved fields reach the .docx', () => {
  it('does NOT emit suggestions or gaps into the rendered document', async () => {
    const xml = await extractDocumentXml(
      await renderTailoredDocToDocx({ cv: fixtureCv() }),
    );
    expect(xml).not.toContain('INTERNAL_SUGGESTION_SHOULD_NOT_LEAK');
    expect(xml).not.toContain('INTERNAL_GAP_SHOULD_NOT_LEAK');
  });

  it('omits the cover-letter section when not supplied (no fabricated content)', async () => {
    const xml = await extractDocumentXml(
      await renderTailoredDocToDocx({ cv: fixtureCv() }),
    );
    expect(xml).not.toContain('Cover Letter');
  });

  it('renders identical document.xml across runs for the same input (deterministic)', async () => {
    const input = { cv: fixtureCv(), coverLetter: fixtureLetter(), locale: 'en-US' };
    const a = await extractDocumentXml(await renderTailoredDocToDocx(input));
    const b = await extractDocumentXml(await renderTailoredDocToDocx(input));
    expect(a).toBe(b);
  });
});

// --- AC4 — Export-menu dispatch (UI contract) ---------------------------

describe('UEXP-007 §4 — Tailor view exposes one Export menu that dispatches to each format', () => {
  it('there is exactly one Export entry point on the Tailor view', () => {
    const matches = TAILOR_VUE.match(/data-test="export-menu"/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('the menu lists Markdown, Word, and PDF items in that order', () => {
    const md = TAILOR_VUE.indexOf('data-test="export-markdown"');
    const wd = TAILOR_VUE.indexOf('data-test="export-word"');
    const pd = TAILOR_VUE.indexOf('data-test="export-pdf"');
    expect(md).toBeGreaterThan(-1);
    expect(wd).toBeGreaterThan(md);
    expect(pd).toBeGreaterThan(wd);
  });

  it('each menu item is wired to its format-owning action', () => {
    // Markdown → Epic 7 (store.exportTailoredDoc).
    expect(TAILOR_VUE).toMatch(
      /data-test="export-markdown"[\s\S]{0,400}@click="onExportMarkdown"/,
    );
    expect(TAILOR_VUE).toMatch(/store\.exportTailoredDoc\(/);
    // Word → UEXP-002/003 (window.starWord).
    expect(TAILOR_VUE).toMatch(
      /data-test="export-word"[\s\S]{0,400}@click="onExportWord"/,
    );
    expect(TAILOR_VUE).toMatch(/window\.starWord/);
    // PDF → Epic 8 (store.exportPdf via window.starPdf).
    expect(TAILOR_VUE).toMatch(
      /data-test="export-pdf"[\s\S]{0,400}@click="onExportPdf"/,
    );
    expect(TAILOR_VUE).toMatch(/store\.exportPdf\(/);
  });

  it('the prior standalone Copy / Export-text / Export-Markdown / Export-PDF top-level buttons are gone', () => {
    expect(TAILOR_VUE).not.toMatch(/label="Copy"/);
    expect(TAILOR_VUE).not.toMatch(/label="Export text"/);
    expect(TAILOR_VUE).not.toMatch(/label="Export Markdown"/);
    expect(TAILOR_VUE).not.toMatch(/label="Export PDF"/);
  });
});

// --- AC5 — disable-with-reason ------------------------------------------

describe('UEXP-007 §5 — disable-with-reason: each affordance carries a reason when unavailable', () => {
  it('disables the Export button until a tailored doc exists', () => {
    expect(TAILOR_VUE).toMatch(
      /data-test="export-menu"[\s\S]{0,400}:disable="!doc"/,
    );
  });

  it('disables the Word item with a tooltip when window.starWord is absent', () => {
    expect(TAILOR_VUE).toMatch(
      /data-test="export-word"[\s\S]{0,500}:disable="!wordAvailable"/,
    );
    expect(TAILOR_VUE).toMatch(/Word export not available/);
    expect(TAILOR_VUE).toMatch(/wordAvailable[\s\S]{0,200}window\.starWord/);
  });

  it('disables the PDF item with a tooltip when window.starPdf is absent', () => {
    expect(TAILOR_VUE).toMatch(
      /data-test="export-pdf"[\s\S]{0,500}:disable="!pdfAvailable"/,
    );
    expect(TAILOR_VUE).toMatch(/PDF toolchain not available/);
    expect(TAILOR_VUE).toMatch(/pdfAvailable[\s\S]{0,300}window\.starPdf/);
  });
});

// --- AC6 — provenance (epic §7) -----------------------------------------

describe('UEXP-007 §6 — provenance: Word export record carries epic §7 additive fields', () => {
  it('WordExportRecord exposes a `format: "word"` field and a `filePath` field at the type level', () => {
    // Construct a record from the public type to assert the shape. Any
    // future regression that drops `format` or `filePath` will fail to
    // compile this test file.
    const record: WordExportRecord = {
      id: 'wordx-job-1-100',
      tailoredDocId: 'job-1',
      tailoredDocVersion: 42,
      modelSlug: 'openrouter/test',
      exportedAt: 100,
      savedPath: 'C:\\out\\cv.docx',
      format: 'word',
      filePath: 'C:\\out\\cv.docx',
    };
    expect(record.format).toBe('word');
    expect(record.filePath).toBe(record.savedPath);
  });

  it('the Tailor view renders an exported-from provenance banner after PDF export (regression guard for §7 UI)', () => {
    expect(TAILOR_VUE).toMatch(/data-test="pdf-export-provenance"/);
    expect(TAILOR_VUE).toMatch(/exported from CV v/);
  });
});
