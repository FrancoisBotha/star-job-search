/**
 * Unit tests for the Help page (UEXP-008).
 *
 * The Help page must gain user-facing guidance covering the features
 * delivered by Epic 12 (Unified Export menu) and the related Word
 * (.docx) export:
 *  - A single Export menu on the Tailor view offering Markdown, Word
 *    and PDF as menu items.
 *  - The new Word (.docx) export and its ATS-safe output.
 *  - Save-to-file + Reveal in folder follow-up.
 *  - Disable-with-reason for unavailable formats (Word / PDF bridges
 *    absent, or no tailored draft yet).
 *  - Star never submits — exported files are saved locally only.
 *
 * Mirrors the regex-scan precedent of HelpPage.pdfex009.test.ts and
 * HelpPage.tailor010.test.ts.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELP = readFileSync(path.join(__dirname, 'HelpPage.vue'), 'utf8');

describe('HelpPage — Epic 12 (Unified Export) guidance (UEXP-008)', () => {
  it('introduces a dedicated unified-Export section on the Tailor view', () => {
    expect(HELP).toMatch(/Export/);
    expect(HELP).toMatch(/Tailor/);
    expect(HELP).toMatch(/unified|single|one\b/i);
  });

  it('lists all three formats — Markdown, Word and PDF — as menu items', () => {
    expect(HELP).toMatch(/Markdown/);
    expect(HELP).toMatch(/Word/);
    expect(HELP).toMatch(/PDF/);
    expect(HELP).toMatch(/menu|dropdown/i);
  });

  it('describes the new Word (.docx) export and its ATS-safe output', () => {
    expect(HELP).toMatch(/\.docx|Word.*\(.docx\)|docx/i);
    expect(HELP).toMatch(/ATS/);
  });

  it('describes choosing a format from the Export menu', () => {
    expect(HELP).toMatch(/choose|pick|select/i);
    expect(HELP).toMatch(/format/i);
  });

  it('describes the save-to-file flow and the Reveal-in-folder follow-up', () => {
    expect(HELP).toMatch(/save (dialog|location|to)|choose where|saved/i);
    expect(HELP).toMatch(/[Rr]eveal in folder|reveal in (Finder|Explorer)/);
  });

  it('describes disable-with-reason for unavailable formats', () => {
    expect(HELP).toMatch(/disabled?|unavailable|not available/i);
    expect(HELP).toMatch(/tooltip|reason|hover|hint|explain/i);
  });

  it('makes clear Star never submits — exported files stay local', () => {
    expect(HELP).toMatch(/never submit|does not submit|do(es)? not submit|never sends? (the )?application/i);
    expect(HELP).toMatch(/local(ly)?|on this device|saved (locally|to (your )?disk)/i);
  });

  it('keeps the existing file structure (steps + FAQs + support card)', () => {
    expect(HELP).toMatch(/Getting started/);
    expect(HELP).toMatch(/Frequently asked/);
    expect(HELP).toMatch(/Support/);
    expect(HELP).toMatch(/const steps =/);
    expect(HELP).toMatch(/const faqs =/);
  });
});
