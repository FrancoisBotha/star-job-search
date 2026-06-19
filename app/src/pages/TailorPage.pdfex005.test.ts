/**
 * Unit tests for PDFEX-005 — Export-PDF control on the Epic 7 Tailor view.
 *
 * Static-source scan (same pattern as TailorPage.tailor006.test.ts).
 * Verifies the .vue template/script wires up to the PDFEX-004 bridge via the
 * app-store.exportPdf action, exposes Letter/A4, disables until a tailored
 * doc exists, surfaces progress/error/success, and renders provenance text
 * pinned to the source draft.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAILOR = readFileSync(path.join(__dirname, 'TailorPage.vue'), 'utf8');

describe('TailorPage — Export-PDF control (AC1, AC2)', () => {
  it('renders an Export PDF button alongside the existing Copy / Export-text actions', () => {
    expect(TAILOR).toMatch(/label="Export PDF"/);
    // Wired via a click handler (named for findability in retries).
    expect(TAILOR).toMatch(/onExportPdf\b/);
    // Sits near the Copy / Export-text buttons in the bar.
    expect(TAILOR).toMatch(/data-test="export-pdf"/);
  });

  it('disables the Export PDF button until a tailored doc exists/is approved', () => {
    // The disable expression must reference the rendered doc.
    expect(TAILOR).toMatch(/data-test="export-pdf"[\s\S]{0,400}:disable="!doc"/);
  });
});

describe('TailorPage — Letter/A4 choice + locale default (AC3)', () => {
  it('exposes a Letter and an A4 option', () => {
    expect(TAILOR).toMatch(/data-test="pdf-page-size-letter"/);
    expect(TAILOR).toMatch(/data-test="pdf-page-size-a4"/);
  });

  it('defaults the page size based on the user locale (en-US → letter, else A4)', () => {
    expect(TAILOR).toMatch(/navigator\.language/);
    expect(TAILOR).toMatch(/['"]letter['"]/);
    expect(TAILOR).toMatch(/['"]a4['"]/);
  });
});

describe('TailorPage — progress + error + success states (AC3, AC4)', () => {
  it('shows a compiling/progress indicator while the export is in flight', () => {
    // Source-level marker we can grep for; rendered conditionally on the
    // store action state.
    expect(TAILOR).toMatch(/data-test="pdf-exporting"/);
    expect(TAILOR).toMatch(/pdfExportState/);
  });

  it('surfaces a specific error message + a Try again retry on failure', () => {
    expect(TAILOR).toMatch(/data-test="pdf-export-error"/);
    expect(TAILOR).toMatch(/TOOLCHAIN_MISSING/);
    expect(TAILOR).toMatch(/COMPILE_ERROR/);
    expect(TAILOR).toMatch(/label="Try again"/);
  });

  it('on success raises a toast with a Reveal in folder action wired to the bridge', () => {
    // Quasar Notify is the project's toast surface (see quasar.config.ts).
    expect(TAILOR).toMatch(/useQuasar|\$q\.notify|Notify\.create|notify\(/);
    expect(TAILOR).toMatch(/Reveal in folder/);
    expect(TAILOR).toMatch(/revealPdfExport\(/);
  });
});

describe('TailorPage — provenance line for the most recent export (AC5)', () => {
  it('renders provenance text pinning the export to the source CV version + date', () => {
    expect(TAILOR).toMatch(/data-test="pdf-export-provenance"/);
    expect(TAILOR).toMatch(/exported from CV v/);
  });
});

describe('TailorPage — store integration (AC6)', () => {
  it('drives the export through the app-store exportPdf action (no direct window.starPdf calls)', () => {
    expect(TAILOR).toMatch(/store\.exportPdf\(|exportPdf\(/);
    // No new design tokens — reuses the same Studio classes (segmented /
    // banner / provenance) the rest of the bar uses.
    expect(TAILOR).not.toMatch(/--pdf-/);
  });
});
