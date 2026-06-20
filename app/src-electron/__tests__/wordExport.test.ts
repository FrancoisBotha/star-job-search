/**
 * Unit tests for UEXP-002 — wordExport.ts (Epic 12 Unified Export).
 *
 * Each describe block targets one acceptance criterion.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import {
  renderTailoredDocToDocx,
  type WordExportInput,
} from '../wordExport';
import type { CoverLetter, TailoredCv } from '../tailor';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_SRC = readFileSync(
  path.resolve(__dirname, '..', 'wordExport.ts'),
  'utf8',
);

function makeCv(overrides: Partial<TailoredCv> = {}): TailoredCv {
  return {
    summary: 'Senior engineer with 10 years of experience.',
    competencies: ['TypeScript', 'Node.js', 'Distributed systems'],
    achievementBullets: [
      'Shipped a payments rewrite that cut latency 40%.',
      'Mentored five engineers to senior.',
    ],
    keywords: ['typescript', 'aws', 'react'],
    suggestions: [],
    gaps: [],
    ...overrides,
  };
}

function makeLetter(overrides: Partial<CoverLetter> = {}): CoverLetter {
  return {
    opening: 'Dear hiring team,',
    body: [
      'I am applying for the Senior Engineer role.',
      'My background fits the requirements you listed.',
    ],
    closing: 'Sincerely, Jane Doe',
    keywords: ['typescript'],
    ...overrides,
  };
}

async function extractDocumentXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml missing from docx zip');
  return entry.async('string');
}

// --- AC1 — maps approved tailored content to a .docx ----------------------

describe('UEXP-002 AC1 — maps tailored CV + cover letter to a .docx', () => {
  it('produces a valid ZIP buffer with a Word document part', async () => {
    const buf = await renderTailoredDocToDocx({
      cv: makeCv(),
      coverLetter: makeLetter(),
    });
    expect(buf.length).toBeGreaterThan(0);
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('Summary');
    expect(xml).toContain('Senior engineer with 10 years of experience.');
    expect(xml).toContain('Cover Letter');
    expect(xml).toContain('Dear hiring team,');
  });

  it('renders CV-only when no cover letter is supplied', async () => {
    const buf = await renderTailoredDocToDocx({ cv: makeCv() });
    const xml = await extractDocumentXml(buf);
    expect(xml).toContain('Summary');
    expect(xml).not.toContain('Cover Letter');
  });
});

// --- AC2 — single-column, selectable text, no tables for body -------------

describe('UEXP-002 AC2 — single-column structure, selectable UTF-8 text, no body tables', () => {
  it('section properties declare a single text column', async () => {
    const buf = await renderTailoredDocToDocx({ cv: makeCv() });
    const xml = await extractDocumentXml(buf);
    // Either an explicit single-column declaration or no <w:cols> at all
    // (Word defaults to one column). Multi-column would set w:num >= 2.
    const colsMatch = xml.match(/<w:cols\b[^/]*\/>/);
    if (colsMatch) {
      expect(colsMatch[0]).toMatch(/w:num="1"/);
    }
    // Negative: no multi-column declaration anywhere.
    expect(xml).not.toMatch(/w:num="[2-9]/);
  });

  it('body contains no table elements (FR-005 / NFR-002)', async () => {
    const buf = await renderTailoredDocToDocx({
      cv: makeCv(),
      coverLetter: makeLetter(),
    });
    const xml = await extractDocumentXml(buf);
    expect(xml).not.toMatch(/<w:tbl[\s>]/);
    expect(xml).not.toMatch(/<w:tblPr\b/);
  });

  it('text is real selectable UTF-8 — not text boxes or images', async () => {
    const buf = await renderTailoredDocToDocx({
      cv: makeCv({ summary: 'Distinctive_phrase_for_search_42.' }),
    });
    const xml = await extractDocumentXml(buf);
    // Body text must live in a <w:t> run (selectable). Absence of textboxes
    // and image references confirms no embedded shapes.
    expect(xml).toContain('Distinctive_phrase_for_search_42.');
    expect(xml).toMatch(/<w:t[\s>]/);
    expect(xml).not.toMatch(/<w:drawing\b/);
    expect(xml).not.toMatch(/<w:pict\b/);
    expect(xml).not.toMatch(/<v:textbox\b/);
  });
});

// --- AC3 — embedded/standard font + locale-appropriate page size ---------

describe('UEXP-002 AC3 — standard font + locale-appropriate page size', () => {
  it('uses a standard ATS-safe font (Calibri / Arial / Times New Roman)', async () => {
    const buf = await renderTailoredDocToDocx({ cv: makeCv() });
    const xml = await extractDocumentXml(buf);
    expect(xml).toMatch(/w:(rFonts|ascii|hAnsi)="?(Calibri|Arial|Times New Roman)"?|w:ascii="(Calibri|Arial|Times New Roman)"/);
  });

  it('US locale yields Letter page size (12240 x 15840 twips)', async () => {
    const buf = await renderTailoredDocToDocx({ cv: makeCv(), locale: 'en-US' });
    const xml = await extractDocumentXml(buf);
    expect(xml).toMatch(/w:pgSz[^/]*w:w="12240"[^/]*w:h="15840"/);
  });

  it('non-US locale yields A4 page size (11906 x 16838 twips)', async () => {
    const buf = await renderTailoredDocToDocx({ cv: makeCv(), locale: 'en-GB' });
    const xml = await extractDocumentXml(buf);
    expect(xml).toMatch(/w:pgSz[^/]*w:w="11906"[^/]*w:h="16838"/);
  });
});

// --- AC4 — normalisation + XML-injection escape --------------------------

describe('UEXP-002 AC4 — ASCII normalisation and safe XML escaping', () => {
  it('normalises smart punctuation to ASCII before writing', async () => {
    const buf = await renderTailoredDocToDocx({
      cv: makeCv({
        summary: 'Shipped “payments” — saved 40… fast.',
      }),
    });
    const xml = await extractDocumentXml(buf);
    // Em-dash, smart quotes, ellipsis all replaced by ASCII equivalents.
    expect(xml).not.toMatch(/[‘’“”—–…]/);
    // The docx serialiser escapes `"` as `&quot;` inside <w:t> — both
    // forms confirm the ASCII normaliser ran (em-dash → '-', ellipsis →
    // '...', smart quotes → '"').
    expect(xml).toMatch(/Shipped (?:"|&quot;)payments(?:"|&quot;) - saved 40\.\.\. fast\./);
  });

  it('escapes XML metacharacters in untrusted CV text', async () => {
    const buf = await renderTailoredDocToDocx({
      cv: makeCv({
        summary: 'Wrote <script>alert("x")</script> & more & co.',
      }),
    });
    const xml = await extractDocumentXml(buf);
    // The literal angle brackets must not appear as raw markup inside a <w:t>
    // run — they must be encoded as &lt; / &gt; / &amp; so the user content
    // cannot inject elements into the OOXML stream.
    expect(xml).not.toContain('<script>alert');
    expect(xml).toMatch(/&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt; &amp; more &amp; co\.|&lt;script&gt;alert\("x"\)&lt;\/script&gt; &amp; more &amp; co\./);
  });
});

// --- AC5 — deterministic, content-faithful ------------------------------

describe('UEXP-002 AC5 — deterministic and content-faithful', () => {
  it('same input yields identical document.xml across runs', async () => {
    const input: WordExportInput = {
      cv: makeCv(),
      coverLetter: makeLetter(),
      locale: 'en-US',
    };
    const a = await extractDocumentXml(await renderTailoredDocToDocx(input));
    const b = await extractDocumentXml(await renderTailoredDocToDocx(input));
    expect(a).toBe(b);
  });

  it('does not emit suggestions, gaps, or fields the input did not supply', async () => {
    const buf = await renderTailoredDocToDocx({
      cv: makeCv({
        suggestions: [
          { area: 'tone', suggestion: 'INTERNAL_SUGGESTION_TEXT', rationale: 'r' },
        ],
        gaps: [
          { keyword: 'INTERNAL_GAP_KEYWORD', severity: 'nice_to_have', adjacentExperience: null },
        ],
      }),
    });
    const xml = await extractDocumentXml(buf);
    expect(xml).not.toContain('INTERNAL_SUGGESTION_TEXT');
    expect(xml).not.toContain('INTERNAL_GAP_KEYWORD');
  });
});

// --- AC6 — offline, no LLM / network egress ------------------------------

describe('UEXP-002 AC6 — offline by construction', () => {
  it('module source imports no network primitives', () => {
    expect(MODULE_SRC).not.toMatch(/\bfetch\s*\(/);
    expect(MODULE_SRC).not.toMatch(/from ['"]node:https?['"]/);
    expect(MODULE_SRC).not.toMatch(/from ['"]node:net['"]/);
    expect(MODULE_SRC).not.toMatch(/from ['"]node:dgram['"]/);
    expect(MODULE_SRC).not.toMatch(/from ['"]openai['"]/);
    expect(MODULE_SRC).not.toMatch(/from ['"]@langchain/);
    expect(MODULE_SRC).not.toMatch(/\bXMLHttpRequest\b/);
  });
});
