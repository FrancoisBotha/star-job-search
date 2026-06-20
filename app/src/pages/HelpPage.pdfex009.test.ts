/**
 * Unit tests for the Help page (PDFEX-009).
 *
 * The Help page must gain user-facing guidance covering the features
 * delivered by Epic 8 (PDF Export):
 *  - What PDF export is, render-only and fully offline.
 *  - ATS guarantees: single-column, selectable text, embedded fonts,
 *    locale page size.
 *  - The Export-PDF control on both the Tailored CV and Cover-letter
 *    tabs, the Letter / A4 page-size choice.
 *  - Save dialog + Reveal-in-folder follow-up.
 *  - The error states by code (compile error / bundled LaTeX engine
 *    missing).
 *  - The licence / attribution (Tectonic, Latin Modern, career-ops
 *    structural inspiration) covered in NOTICE.
 *
 * Mirrors the regex-scan precedent of HelpPage.tailor010.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — Epic 8 (PDF Export) guidance (PDFEX-009)', () => {
  it('introduces a dedicated PDF export section', () => {
    expect(HELP).toMatch(/PDF/);
    expect(HELP).toMatch(/[Ee]xport(ing)?\s+(to\s+)?PDF|PDF\s+[Ee]xport/);
  });

  it('describes PDF export as render-only and fully offline', () => {
    expect(HELP).toMatch(/render(\s|-)only|render the (current )?draft|no.*edit/i);
    expect(HELP).toMatch(/offline/i);
    expect(HELP).toMatch(/no.*network|no.*internet|never.*network|never.*OpenRouter/i);
  });

  it('lists the ATS guarantees (single-column, selectable text, embedded fonts, locale page size)', () => {
    expect(HELP).toMatch(/single(\s|-)column/i);
    expect(HELP).toMatch(/selectable text|selectable/i);
    expect(HELP).toMatch(/embedded font|fonts? (are )?embedded/i);
    expect(HELP).toMatch(/locale|page size/i);
  });

  it('describes the Export-PDF control on the Tailored CV and Cover-letter tabs', () => {
    expect(HELP).toMatch(/Export PDF/);
    expect(HELP).toMatch(/Tailored CV/);
    expect(HELP).toMatch(/[Cc]over(\s|-)letter/);
    expect(HELP).toMatch(/tab/i);
  });

  it('describes the Letter / A4 page-size choice and the locale default', () => {
    expect(HELP).toMatch(/Letter/);
    expect(HELP).toMatch(/A4/);
    expect(HELP).toMatch(/locale|default/i);
  });

  it('describes the save dialog and the Reveal-in-folder follow-up', () => {
    expect(HELP).toMatch(/save (dialog|location)|choose where/i);
    expect(HELP).toMatch(/[Rr]eveal in folder|reveal in (Finder|Explorer)/);
  });

  it('documents the error states — compile error and toolchain missing', () => {
    expect(HELP).toMatch(/compile (error|fail)/i);
    expect(HELP).toMatch(/toolchain|bundled LaTeX engine|engine.*missing|engine.*not found/i);
  });

  it('mentions the licence / attribution for the bundled engine and fonts', () => {
    expect(HELP).toMatch(/Tectonic/);
    expect(HELP).toMatch(/Latin Modern|font/i);
    expect(HELP).toMatch(/MIT|licence|license|attribution|NOTICE/);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});
