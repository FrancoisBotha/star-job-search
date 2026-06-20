/**
 * UEXP-006 — Epic 12 evaluation ticket.
 *
 * Re-verifies the holistic Epic 12 acceptance criteria against the actual
 * implementation rather than per-ticket test phases. Each `it` maps to one
 * criterion from the ticket description's checklist:
 *   - single Export menu on both tabs
 *   - Markdown via Epic 7
 *   - PDF via Epic 8
 *   - ATS-safe selectable .docx
 *   - content fidelity
 *   - provenance + per-format states
 *   - disable-with-reason
 *   - offline Word
 *   - no submission
 *
 * This is a static-source scan (matches the pattern used by every other
 * TailorPage epic test) plus a probe of `wordExport.ts` for the offline /
 * ATS-safe contract.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAILOR = readFileSync(path.join(__dirname, 'TailorPage.vue'), 'utf8');
const WORD_EXPORT = readFileSync(
  path.resolve(__dirname, '..', '..', 'src-electron', 'wordExport.ts'),
  'utf8',
);

describe('UEXP-006 AC2 — single Export menu on BOTH tabs', () => {
  it('the Export dropdown lives in the shared top bar (rendered for cv + cover-letter tabs alike)', () => {
    // The dropdown is in `.bar__right`, which is outside the tab-switched
    // `.tailor__body` — so it renders regardless of `store.tailorTab`.
    const barRightStart = TAILOR.indexOf('class="bar__right"');
    const bodyStart = TAILOR.indexOf('class="tailor__body"');
    expect(barRightStart).toBeGreaterThan(-1);
    expect(bodyStart).toBeGreaterThan(barRightStart);
    const barRightBlock = TAILOR.slice(barRightStart, bodyStart);
    expect(barRightBlock).toMatch(/data-test="export-menu"/);
  });

  it('exposes exactly one Export entry point (no second top-level Export button anywhere)', () => {
    const matches = TAILOR.match(/data-test="export-menu"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});

describe('UEXP-006 AC2 — Markdown via Epic 7', () => {
  it('the Markdown item dispatches to the Epic 7 store action — no inline rewrite', () => {
    expect(TAILOR).toMatch(
      /data-test="export-markdown"[\s\S]{0,400}@click="onExportMarkdown"/,
    );
    expect(TAILOR).toMatch(/store\.exportTailoredDoc\(/);
  });
});

describe('UEXP-006 AC2 — PDF via Epic 8', () => {
  it('the PDF item dispatches to the Epic 8 store action via the starPdf bridge', () => {
    expect(TAILOR).toMatch(
      /data-test="export-pdf"[\s\S]{0,400}@click="onExportPdf"/,
    );
    expect(TAILOR).toMatch(/store\.exportPdf\(/);
    expect(TAILOR).toMatch(/window\.starPdf|starPdf/);
  });
});

describe('UEXP-006 AC2 — ATS-safe selectable .docx', () => {
  it('wordExport.ts targets a single-column ATS-safe document with a standard font', () => {
    expect(WORD_EXPORT).toMatch(/ATS-safe/i);
    expect(WORD_EXPORT).toMatch(/Calibri/);
    // Real selectable UTF-8 text — no images, no text boxes (the contract
    // is asserted as a docstring + by the absence of those constructs).
    expect(WORD_EXPORT).not.toMatch(/ImageRun\b/);
    expect(WORD_EXPORT).not.toMatch(/TextBox\b/);
  });
});

describe('UEXP-006 AC2 — content fidelity', () => {
  it('the cover-letter editor is the single source of truth — Markdown export reads the same content', () => {
    expect(TAILOR).toMatch(/data-test="letter-editor"/);
    expect(TAILOR).toMatch(/v-model="letterContent"/);
    // Letter edits flow back into the cached doc which exportTailoredDoc
    // reads — the writable computed wires this up.
    expect(TAILOR).toMatch(/letterContent[\s\S]{0,200}set\(/);
  });
});

describe('UEXP-006 AC2 — provenance + per-format states', () => {
  it('renders an exported-from provenance banner after a PDF export', () => {
    expect(TAILOR).toMatch(/data-test="pdf-export-provenance"/);
    expect(TAILOR).toMatch(/exported from CV v/);
  });

  it('shows per-format in-flight banners for Markdown, Word and PDF', () => {
    expect(TAILOR).toMatch(/data-test="markdown-exporting"/);
    expect(TAILOR).toMatch(/data-test="word-exporting"/);
    expect(TAILOR).toMatch(/data-test="pdf-exporting"/);
  });

  it('shows per-format error banners for Word and PDF with code-driven copy', () => {
    expect(TAILOR).toMatch(/data-test="word-export-error"/);
    expect(TAILOR).toMatch(/data-test="pdf-export-error"/);
  });
});

describe('UEXP-006 AC2 — disable-with-reason', () => {
  it('disables the Export button until a tailored doc exists', () => {
    expect(TAILOR).toMatch(
      /data-test="export-menu"[\s\S]{0,400}:disable="!doc"/,
    );
  });

  it('disables the Word item with a tooltip when window.starWord is absent', () => {
    expect(TAILOR).toMatch(
      /data-test="export-word"[\s\S]{0,500}:disable="!wordAvailable"/,
    );
    expect(TAILOR).toMatch(/Word export not available/);
    expect(TAILOR).toMatch(/wordAvailable[\s\S]{0,200}window\.starWord/);
  });

  it('disables the PDF item with a tooltip when window.starPdf is absent', () => {
    expect(TAILOR).toMatch(
      /data-test="export-pdf"[\s\S]{0,500}:disable="!pdfAvailable"/,
    );
    expect(TAILOR).toMatch(/PDF toolchain not available/);
    expect(TAILOR).toMatch(/pdfAvailable[\s\S]{0,300}window\.starPdf/);
  });
});

describe('UEXP-006 AC2 — offline Word', () => {
  it('wordExport.ts has no network imports (fetch / http / https / net)', () => {
    expect(WORD_EXPORT).not.toMatch(/from\s+['"]node:https?['"]/);
    expect(WORD_EXPORT).not.toMatch(/from\s+['"]node:net['"]/);
    expect(WORD_EXPORT).not.toMatch(/\bfetch\(/);
    // The module docstring states the offline-by-construction contract.
    expect(WORD_EXPORT).toMatch(/[Oo]ffline/);
  });
});

describe('UEXP-006 AC2 — no submission', () => {
  it('the Export menu only exports — no submit / apply / send wiring on any item', () => {
    // Extract the dropdown subtree.
    const dropdownStart = TAILOR.indexOf('data-test="export-menu"');
    expect(dropdownStart).toBeGreaterThan(-1);
    const dropdownEnd = TAILOR.indexOf('</q-btn-dropdown>', dropdownStart);
    expect(dropdownEnd).toBeGreaterThan(dropdownStart);
    const block = TAILOR.slice(dropdownStart, dropdownEnd);
    // Only the three export handlers are wired — no submit/send/apply.
    const clickHandlers = Array.from(block.matchAll(/@click="(\w+)"/g)).map(
      (m) => m[1],
    );
    expect(clickHandlers.sort()).toEqual(
      ['onExportMarkdown', 'onExportPdf', 'onExportWord'].sort(),
    );
  });
});

describe('UEXP-006 AC2 — feedback states: other menu items remain usable while one export is running', () => {
  // Epic 12 §10 explicitly: "Other menu items remain usable while one
  // export is running." Quasar's `:loading` prop on q-btn-dropdown blocks
  // the button while truthy, which would prevent re-opening the menu to
  // start a second export. The in-flight state is carried by the per-format
  // banners (markdown-exporting / word-exporting / pdf-exporting) instead.
  it('the Export dropdown is not gated by a global `loading` binding', () => {
    expect(TAILOR).not.toMatch(
      /data-test="export-menu"[\s\S]{0,400}:loading=/,
    );
  });
});
