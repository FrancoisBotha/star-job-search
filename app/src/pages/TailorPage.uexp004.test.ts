/**
 * Unit tests for UEXP-004 — Unified Export menu on the Tailor view (Epic 12).
 *
 * Static-source scan (same pattern as TailorPage.pdfex005.test.ts). Verifies
 * the .vue template/script collapses the prior Copy / Export-text / Export-
 * Markdown / Export-PDF buttons into a single Quasar dropdown that dispatches
 * to the existing Markdown / Word / PDF code paths, with disable-with-reason
 * behaviour when a prerequisite is missing, progress + success-toast +
 * per-format error states, and a wiring assertion that each menu item points
 * at the right action.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAILOR = readFileSync(path.join(__dirname, 'TailorPage.vue'), 'utf8');

describe('TailorPage — single Export control with dropdown menu (AC1)', () => {
  it('renders one Export button + Quasar dropdown menu (no separate Copy / Export-text / Export-Markdown / Export-PDF top-level buttons)', () => {
    // Single control.
    expect(TAILOR).toMatch(/data-test="export-menu"/);
    expect(TAILOR).toMatch(/q-btn-dropdown|QBtnDropdown/);
    // The old separate top-level buttons must be gone.
    expect(TAILOR).not.toMatch(/label="Copy"/);
    expect(TAILOR).not.toMatch(/label="Export text"/);
    expect(TAILOR).not.toMatch(/label="Export Markdown"/);
    expect(TAILOR).not.toMatch(/label="Export PDF"/);
  });

  it('lists Markdown, Word and PDF as menu items', () => {
    expect(TAILOR).toMatch(/data-test="export-markdown"/);
    expect(TAILOR).toMatch(/data-test="export-word"/);
    expect(TAILOR).toMatch(/data-test="export-pdf"/);
  });
});

describe('TailorPage — disable-with-reason (AC2)', () => {
  it('disables the Export button until a tailored doc exists', () => {
    expect(TAILOR).toMatch(
      /data-test="export-menu"[\s\S]{0,400}:disable="!doc"/,
    );
  });

  it('greys the PDF item with a tooltip when the toolchain is not available', () => {
    // Disabled binding for the PDF item.
    expect(TAILOR).toMatch(/data-test="export-pdf"[\s\S]{0,400}:disable=/);
    // Tooltip reason copy.
    expect(TAILOR).toMatch(/PDF toolchain not available/);
    // Availability flag wired from window.starPdf presence.
    expect(TAILOR).toMatch(/pdfAvailable|isPdfAvailable|starPdf/);
  });

  it('greys the Word item when the word:export bridge is absent', () => {
    expect(TAILOR).toMatch(/data-test="export-word"[\s\S]{0,400}:disable=/);
    expect(TAILOR).toMatch(/wordAvailable|isWordAvailable|starWord/);
  });
});

describe('TailorPage — dispatch wiring (AC3 / AC4 / AC5 / AC7)', () => {
  it('Markdown menu item dispatches to the Epic 7 text/Markdown export action', () => {
    expect(TAILOR).toMatch(
      /data-test="export-markdown"[\s\S]{0,400}@click="onExportMarkdown"/,
    );
    // The handler routes through the existing store.exportTailoredDoc action.
    expect(TAILOR).toMatch(/store\.exportTailoredDoc\(/);
  });

  it('Word menu item dispatches to the word:export bridge for the current tab', () => {
    expect(TAILOR).toMatch(
      /data-test="export-word"[\s\S]{0,400}@click="onExportWord"/,
    );
    expect(TAILOR).toMatch(/starWord(?:\?\.|\.)export\(|window\.starWord/);
  });

  it('PDF menu item dispatches to Epic 8 pdf:export for the current tab', () => {
    expect(TAILOR).toMatch(
      /data-test="export-pdf"[\s\S]{0,400}@click="onExportPdf"/,
    );
    expect(TAILOR).toMatch(/store\.exportPdf\(/);
  });
});

describe('TailorPage — progress + success toast + per-format errors (AC6)', () => {
  it('shows in-flight progress for each format', () => {
    expect(TAILOR).toMatch(/data-test="markdown-exporting"/);
    expect(TAILOR).toMatch(/data-test="word-exporting"/);
    expect(TAILOR).toMatch(/data-test="pdf-exporting"/);
  });

  it('raises a success toast with a Reveal in folder action for Word + PDF', () => {
    // Notify is the project's toast surface.
    expect(TAILOR).toMatch(/\$q\.notify\(/);
    expect(TAILOR).toMatch(/Reveal in folder/);
    // Word reveal wiring.
    expect(TAILOR).toMatch(/starWord(?:\?\.|\.)reveal\(|revealWordExport/);
    // PDF reveal wiring (carried over from PDFEX-005).
    expect(TAILOR).toMatch(/revealPdfExport\(/);
  });

  it('surfaces per-format error states with code-driven copy', () => {
    expect(TAILOR).toMatch(/data-test="word-export-error"/);
    expect(TAILOR).toMatch(/data-test="pdf-export-error"/);
    // Word stable codes (mirrors src-electron/wordExportIpc.ts).
    expect(TAILOR).toMatch(/NO_DOC/);
    expect(TAILOR).toMatch(/RENDER_ERROR/);
    expect(TAILOR).toMatch(/IO_ERROR/);
    // PDF stable codes already exercised by PDFEX-005.
    expect(TAILOR).toMatch(/TOOLCHAIN_MISSING/);
    expect(TAILOR).toMatch(/COMPILE_ERROR/);
  });

  it('reuses the Studio visual system — no new --export- design tokens', () => {
    expect(TAILOR).not.toMatch(/--export-/);
  });
});
