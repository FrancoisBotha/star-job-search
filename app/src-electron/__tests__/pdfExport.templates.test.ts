/**
 * Unit tests for PDFEX-003 — ATS-safe LaTeX template(s) + build validation.
 *
 * Six describe blocks, one per PDFEX-003 acceptance criterion:
 *   AC1  Single-column ATS-safe template exists for each doc type
 *        (CV + cover letter), sharing template primitives.
 *   AC2  Standard section titles in reverse-chronological recruiter-scan
 *        order (FR-004).
 *   AC3  Output LaTeX carries `\pdfgentounicode=1` so PDF text is
 *        selectable UTF-8, never a rasterised image (FR-003, NFR-001).
 *   AC4  Fonts are embedded and self-hosted (FR-004).
 *   AC5  Page size by locale: US/Canada -> Letter, else A4, with
 *        consistent margins.
 *   AC6  Build validation: required sections/commands present, no
 *        unresolved {{PLACEHOLDER}} tokens; failure yields a clear
 *        error (FR-006).
 */
import { describe, expect, it } from 'vitest';

import {
  COVER_LETTER_TEMPLATE,
  CV_TEMPLATE,
  PdfExportValidationError,
  renderCoverLetterLatex,
  renderCvLatex,
  selectPaperSize,
  validateLatexBuild,
} from '../pdfExport/templates';

// --- AC1 — single-column ATS-safe templates for CV + cover letter ----------

describe('PDFEX-003 AC1 — single-column ATS-safe templates exist for CV and cover letter', () => {
  it('CV template is a non-empty LaTeX document', () => {
    expect(typeof CV_TEMPLATE).toBe('string');
    expect(CV_TEMPLATE.length).toBeGreaterThan(0);
    expect(CV_TEMPLATE).toMatch(/\\documentclass/);
    expect(CV_TEMPLATE).toMatch(/\\begin\{document\}/);
    expect(CV_TEMPLATE).toMatch(/\\end\{document\}/);
  });

  it('cover-letter template is a non-empty LaTeX document', () => {
    expect(typeof COVER_LETTER_TEMPLATE).toBe('string');
    expect(COVER_LETTER_TEMPLATE.length).toBeGreaterThan(0);
    expect(COVER_LETTER_TEMPLATE).toMatch(/\\documentclass/);
    expect(COVER_LETTER_TEMPLATE).toMatch(/\\begin\{document\}/);
    expect(COVER_LETTER_TEMPLATE).toMatch(/\\end\{document\}/);
  });

  it('both templates are single-column (no \\twocolumn / multicol)', () => {
    for (const tpl of [CV_TEMPLATE, COVER_LETTER_TEMPLATE]) {
      expect(tpl).not.toMatch(/\\twocolumn\b/);
      expect(tpl).not.toMatch(/multicols?\b/);
    }
  });

  it('both templates share core ATS-safe preamble primitives', () => {
    for (const tpl of [CV_TEMPLATE, COVER_LETTER_TEMPLATE]) {
      expect(tpl).toMatch(/\\usepackage\[T1\]\{fontenc\}/);
      expect(tpl).toMatch(/\\usepackage\[utf8\]\{inputenc\}/);
      expect(tpl).toMatch(/\\usepackage(\[[^\]]*\])?\{geometry\}/);
      expect(tpl).toMatch(/\\usepackage\{hyperref\}/);
    }
  });
});

// --- AC2 — recruiter-scan section order ------------------------------------

describe('PDFEX-003 AC2 — standard section titles in reverse-chronological recruiter-scan order', () => {
  it('CV section order is Summary -> Competencies -> Achievements -> Keywords', () => {
    const titles = ['Summary', 'Competencies', 'Achievements', 'Keywords'];
    const indices = titles.map((t) => CV_TEMPLATE.indexOf(`\\section*{${t}}`));
    for (const i of indices) expect(i).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1] as number);
    }
  });

  it('rendered CV preserves recruiter-scan section order', () => {
    const tex = renderCvLatex({
      contact: { name: 'Alex' },
      summary: 'S',
      competencies: ['C1'],
      achievements: ['A1'],
      keywords: ['K1'],
      locale: 'en-US',
    });
    const idxSummary = tex.indexOf('\\section*{Summary}');
    const idxComp = tex.indexOf('\\section*{Competencies}');
    const idxAch = tex.indexOf('\\section*{Achievements}');
    const idxKw = tex.indexOf('\\section*{Keywords}');
    expect(idxSummary).toBeGreaterThan(0);
    expect(idxComp).toBeGreaterThan(idxSummary);
    expect(idxAch).toBeGreaterThan(idxComp);
    expect(idxKw).toBeGreaterThan(idxAch);
  });

  it('cover letter template names its section as Cover Letter', () => {
    expect(COVER_LETTER_TEMPLATE).toMatch(/\\section\*\{Cover Letter\}/);
  });
});

// --- AC3 — selectable UTF-8 text via \pdfgentounicode=1 --------------------

describe('PDFEX-003 AC3 — \\pdfgentounicode=1 is present so PDF text is selectable, not rasterised', () => {
  it('CV template enables \\pdfgentounicode=1', () => {
    expect(CV_TEMPLATE).toMatch(/\\pdfgentounicode=1/);
  });

  it('cover-letter template enables \\pdfgentounicode=1', () => {
    expect(COVER_LETTER_TEMPLATE).toMatch(/\\pdfgentounicode=1/);
  });

  it('rendered CV output contains \\pdfgentounicode=1', () => {
    const tex = renderCvLatex({
      contact: {},
      summary: 's',
      competencies: [],
      achievements: [],
      keywords: [],
      locale: 'en-GB',
    });
    expect(tex).toMatch(/\\pdfgentounicode=1/);
  });

  it('rendered cover letter contains \\pdfgentounicode=1', () => {
    const tex = renderCoverLetterLatex({
      contact: {},
      opening: 'Dear Hiring Manager,',
      body: ['Para.'],
      closing: 'Sincerely',
      locale: 'en-US',
    });
    expect(tex).toMatch(/\\pdfgentounicode=1/);
  });
});

// --- AC4 — embedded, self-hosted fonts -------------------------------------

describe('PDFEX-003 AC4 — fonts are embedded and self-hosted', () => {
  it('templates load lmodern (Latin Modern) so Type 1 fonts get embedded', () => {
    for (const tpl of [CV_TEMPLATE, COVER_LETTER_TEMPLATE]) {
      expect(tpl).toMatch(/\\usepackage\{lmodern\}/);
    }
  });

  it('templates use T1 fontenc so 8-bit encoded fonts are embedded', () => {
    for (const tpl of [CV_TEMPLATE, COVER_LETTER_TEMPLATE]) {
      expect(tpl).toMatch(/\\usepackage\[T1\]\{fontenc\}/);
    }
  });

  it('templates do NOT request system fonts (\\setmainfont, fontspec)', () => {
    for (const tpl of [CV_TEMPLATE, COVER_LETTER_TEMPLATE]) {
      expect(tpl).not.toMatch(/\\usepackage\{fontspec\}/);
      expect(tpl).not.toMatch(/\\setmainfont/);
    }
  });
});

// --- AC5 — page size by locale, consistent margins -------------------------

describe('PDFEX-003 AC5 — page size chosen by locale; margins consistent', () => {
  it('US locale -> letterpaper', () => {
    expect(selectPaperSize('en-US')).toBe('letterpaper');
    expect(selectPaperSize('EN-US')).toBe('letterpaper');
    expect(selectPaperSize('en_US')).toBe('letterpaper');
  });

  it('Canadian locale -> letterpaper (en-CA and fr-CA)', () => {
    expect(selectPaperSize('en-CA')).toBe('letterpaper');
    expect(selectPaperSize('fr-CA')).toBe('letterpaper');
  });

  it('other locales -> a4paper', () => {
    expect(selectPaperSize('en-GB')).toBe('a4paper');
    expect(selectPaperSize('de-DE')).toBe('a4paper');
    expect(selectPaperSize('fr-FR')).toBe('a4paper');
    expect(selectPaperSize('')).toBe('a4paper');
    expect(selectPaperSize(undefined)).toBe('a4paper');
  });

  it('rendered CV reflects the locale-chosen paper size', () => {
    const us = renderCvLatex({
      contact: {}, summary: 's', competencies: [], achievements: [], keywords: [],
      locale: 'en-US',
    });
    const eu = renderCvLatex({
      contact: {}, summary: 's', competencies: [], achievements: [], keywords: [],
      locale: 'en-GB',
    });
    expect(us).toMatch(/letterpaper/);
    expect(us).not.toMatch(/a4paper/);
    expect(eu).toMatch(/a4paper/);
    expect(eu).not.toMatch(/letterpaper/);
  });

  it('rendered cover letter reflects the locale-chosen paper size', () => {
    const ca = renderCoverLetterLatex({
      contact: {}, opening: 'Dear', body: ['x'], closing: 'best',
      locale: 'fr-CA',
    });
    expect(ca).toMatch(/letterpaper/);
  });

  it('both templates declare a consistent geometry margin', () => {
    for (const tpl of [CV_TEMPLATE, COVER_LETTER_TEMPLATE]) {
      expect(tpl).toMatch(/\\usepackage\[[^\]]*margin=[^\]]+\]\{geometry\}/);
    }
    const cvMargin = (/\\usepackage\[([^\]]*margin=[^,\]]+)[^\]]*\]\{geometry\}/.exec(
      CV_TEMPLATE,
    ) ?? [])[1];
    const clMargin = (/\\usepackage\[([^\]]*margin=[^,\]]+)[^\]]*\]\{geometry\}/.exec(
      COVER_LETTER_TEMPLATE,
    ) ?? [])[1];
    expect(cvMargin).toBeDefined();
    expect(cvMargin).toBe(clMargin);
  });
});

// --- AC6 — build validation -------------------------------------------------

describe('PDFEX-003 AC6 — build validation: required commands + no unresolved placeholders', () => {
  it('passes for a fully-rendered CV', () => {
    const tex = renderCvLatex({
      contact: { name: 'A', email: 'a@b.com' },
      summary: 'S',
      competencies: ['C'],
      achievements: ['A'],
      keywords: ['K'],
      locale: 'en-US',
    });
    expect(() => validateLatexBuild(tex)).not.toThrow();
  });

  it('passes for a fully-rendered cover letter', () => {
    const tex = renderCoverLetterLatex({
      contact: { name: 'A' },
      opening: 'Dear',
      body: ['Para 1.', 'Para 2.'],
      closing: 'Sincerely',
      locale: 'en-GB',
    });
    expect(() => validateLatexBuild(tex)).not.toThrow();
  });

  it('throws PdfExportValidationError when the raw template still has {{PLACEHOLDER}} tokens', () => {
    expect(() => validateLatexBuild(CV_TEMPLATE)).toThrow(PdfExportValidationError);
    expect(() => validateLatexBuild(COVER_LETTER_TEMPLATE)).toThrow(PdfExportValidationError);
  });

  it('error message clearly names the unresolved placeholder(s)', () => {
    try {
      validateLatexBuild(CV_TEMPLATE);
      expect.fail('expected validation to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PdfExportValidationError);
      expect((err as Error).message).toMatch(/unresolved/i);
      expect((err as Error).message).toMatch(/\{\{/);
    }
  });

  it('throws when required structural commands are missing', () => {
    const bare = '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n';
    expect(() => validateLatexBuild(bare)).toThrow(PdfExportValidationError);
  });

  it('error message clearly names a missing required command (e.g. \\pdfgentounicode)', () => {
    const bare = '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n';
    try {
      validateLatexBuild(bare);
      expect.fail('expected validation to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PdfExportValidationError);
      expect((err as Error).message).toMatch(/pdfgentounicode|fontenc|geometry|hyperref|lmodern/);
    }
  });

  it('rendering does NOT leak unresolved {{TOKENS}} into output', () => {
    const tex = renderCvLatex({
      contact: { name: 'Alex' },
      summary: 'S',
      competencies: ['C'],
      achievements: ['A'],
      keywords: ['K'],
      locale: 'en-US',
    });
    expect(tex).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
