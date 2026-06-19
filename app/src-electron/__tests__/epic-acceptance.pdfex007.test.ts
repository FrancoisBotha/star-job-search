/**
 * Epic-level acceptance verification (PDFEX-007 / Epic 8 PDF Export).
 *
 * Holistically verifies that the §9-style epic-level requirements are met
 * by the actual implementation produced by PDFEX-001..006 — not just by
 * the per-ticket test phases. The PDFEX-007 ticket spells these out as:
 *
 *   AC1 ATS-safe selectable-text PDF — selectable UTF-8 text (not raster),
 *       embedded fonts, single-column recruiter-scan template.
 *   AC2 Content fidelity — render-only: no fabricated fields, no reworded
 *       text, suggestions/gaps not emitted into the printed document.
 *   AC3 Escaping / normalisation — every user/JD-derived string flows
 *       through the Epic 7 punctuation normaliser BEFORE the LaTeX-special
 *       escaper, and URLs go through a scheme allow-list.
 *   AC4 Offline / no-egress — the engine is invoked with --only-cached,
 *       pinned to the pre-seeded cache via TECTONIC_CACHE_DIR, with
 *       TECTONIC_NO_DEFAULT_BUNDLE=1; no http/https/fetch primitives in
 *       the export path.
 *   AC5 Provenance — every successful export records the tailored-doc
 *       version + model + timestamp + saved path + page size.
 *   AC6 No submission — the IPC layer writes one local file and stops;
 *       it never uploads, never posts, never opens egress.
 *   AC7 Licence compliance — NOTICE.md reproduces the career-ops MIT
 *       notice + the Tectonic MIT notice + the bundled-font licence, the
 *       borrowed-from source files carry attribution headers, and README
 *       links to NOTICE.md.
 *
 * Behavioural checks drive the real modules through their public surface.
 * Structural checks are asserted against on-disk source so a later quiet
 * regression (e.g. someone deleting `\pdfgentounicode=1`, or adding a
 * `fetch()` to the IPC layer) fails fast here.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  buildLatexCompileArgs,
  escapeLatex,
  renderTailoredDocToLatex,
  sanitiseUrl,
} from '../pdfExport';
import {
  buildTectonicArgs,
  buildTectonicEnv,
} from '../pdfExport/latexEngine';
import {
  PdfExportValidationError,
  selectPaperSize,
  validateLatexBuild,
} from '../pdfExport/templates';
import type { PdfExportInput } from '../pdfExport';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(REPO_DIR, '..');
const ELECTRON_DIR = path.join(REPO_DIR, 'src-electron');

function read(rel: string): string {
  return readFileSync(path.join(PROJECT_ROOT, rel), 'utf8');
}

/** Strip /* … *\/ block comments and // line comments so the "no egress"
 *  assertions don't trip on prose like "this module never calls fetch()". */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const PDF_EXPORT_SRC = readFileSync(path.join(ELECTRON_DIR, 'pdfExport.ts'), 'utf8');
const TEMPLATES_SRC = readFileSync(path.join(ELECTRON_DIR, 'pdfExport', 'templates.ts'), 'utf8');
const ENGINE_SRC = readFileSync(path.join(ELECTRON_DIR, 'pdfExport', 'latexEngine.ts'), 'utf8');
const IPC_SRC = readFileSync(path.join(ELECTRON_DIR, 'pdfExportIpc.ts'), 'utf8');
const PDF_EXPORT_CODE = stripComments(PDF_EXPORT_SRC);
const ENGINE_CODE = stripComments(ENGINE_SRC);
const IPC_CODE = stripComments(IPC_SRC);
const NOTICE = read('NOTICE.md');
const README = read('README.md');

// --- AC1 — ATS-safe selectable-text PDF ----------------------------------

describe('PDFEX-007 / AC1 — ATS-safe selectable-text PDF', () => {
  const tex = renderTailoredDocToLatex({
    cv: {
      summary: 'Engineer.',
      competencies: ['TypeScript'],
      achievementBullets: ['Shipped X.'],
      keywords: ['ts'],
      suggestions: [],
      gaps: [],
    },
  });

  it('renders \\pdfgentounicode=1 so PDF text is selectable UTF-8, not a raster', () => {
    expect(tex).toMatch(/\\pdfgentounicode\s*=\s*1\b/);
  });

  it('embeds Latin Modern via lmodern + T1 fontenc so glyphs ship with the PDF', () => {
    expect(tex).toMatch(/\\usepackage\{lmodern\}/);
    expect(tex).toMatch(/\\usepackage\[T1\]\{fontenc\}/);
  });

  it('uses a single-column article class — recruiter-scan friendly', () => {
    expect(tex).toMatch(/\\documentclass\[[^\]]*\]\{article\}/);
    expect(tex).not.toMatch(/multicol/);
    expect(tex).not.toMatch(/twocolumn/);
  });

  it('selectPaperSize honours BCP-47 locale: US/CA → letter, else A4', () => {
    expect(selectPaperSize('en-US')).toBe('letterpaper');
    expect(selectPaperSize('en-CA')).toBe('letterpaper');
    expect(selectPaperSize('fr-CA')).toBe('letterpaper');
    expect(selectPaperSize('en-GB')).toBe('a4paper');
    expect(selectPaperSize(undefined)).toBe('a4paper');
  });

  it('validateLatexBuild enforces the ATS-safe preamble pre-compile', () => {
    expect(() => validateLatexBuild(tex)).not.toThrow();
    // Removing the ToUnicode CMap directive trips the validator — proving
    // the ATS contract is gated, not merely conventional.
    const stripped = tex.replace(/\\pdfgentounicode\s*=\s*1/, '');
    expect(() => validateLatexBuild(stripped)).toThrow(PdfExportValidationError);
  });
});

// --- AC2 — Content fidelity ----------------------------------------------

describe('PDFEX-007 / AC2 — render-only content fidelity (no fabrication)', () => {
  it('omits sections the caller did not supply — never invents content', () => {
    const tex = renderTailoredDocToLatex({
      cv: {
        summary: '',
        competencies: [],
        achievementBullets: [],
        keywords: [],
        suggestions: [],
        gaps: [],
      },
    });
    expect(tex).not.toMatch(/\\section\*\{Summary\}/);
    expect(tex).not.toMatch(/\\section\*\{Competencies\}/);
    expect(tex).not.toMatch(/\\section\*\{Achievements\}/);
    expect(tex).not.toMatch(/\\section\*\{Keywords\}/);
  });

  it('never emits Epic 7 suggestions or gaps into the printed document', () => {
    const tex = renderTailoredDocToLatex({
      cv: {
        summary: 'Sum.',
        competencies: [],
        achievementBullets: [],
        keywords: [],
        suggestions: [
          {
            area: 'DO-NOT-PRINT-area-XYZ',
            suggestion: 'DO-NOT-PRINT-suggestion-XYZ',
            rationale: 'DO-NOT-PRINT-rationale-XYZ',
          },
        ],
        gaps: [
          {
            keyword: 'DO-NOT-PRINT-gap-XYZ',
            severity: 'nice_to_have',
            adjacentExperience: null,
          },
        ],
      },
    });
    expect(tex).not.toMatch(/DO-NOT-PRINT/);
    expect(tex).not.toMatch(/suggestion/i);
    expect(tex).not.toMatch(/\\section\*\{Gaps\}/);
  });

  it('renderTailoredDocToLatex is pure — same input ⇒ byte-identical output', () => {
    const input: PdfExportInput = {
      cv: {
        summary: 'Alpha.',
        competencies: ['A', 'B'],
        achievementBullets: ['x', 'y'],
        keywords: ['k'],
        suggestions: [],
        gaps: [],
      },
    };
    expect(renderTailoredDocToLatex(input)).toBe(renderTailoredDocToLatex(input));
  });

  it('renderer source contains no Date.now / Math.random / network primitive', () => {
    expect(PDF_EXPORT_CODE).not.toMatch(/Date\.now\(/);
    expect(PDF_EXPORT_CODE).not.toMatch(/Math\.random\(/);
    expect(PDF_EXPORT_CODE).not.toMatch(/from\s+['"]node:https?['"]/);
    expect(PDF_EXPORT_CODE).not.toMatch(/\bfetch\(/);
  });
});

// --- AC3 — Escaping / normalisation --------------------------------------

describe('PDFEX-007 / AC3 — LaTeX escaping + Epic-7 punctuation normalisation', () => {
  it('escapeLatex disarms every LaTeX-special character', () => {
    const probe = String.raw`\ { } $ & % # _ ^ ~`;
    const escaped = escapeLatex(probe);
    expect(escaped).toContain('\\textbackslash{}');
    expect(escaped).toContain('\\{');
    expect(escaped).toContain('\\}');
    expect(escaped).toContain('\\$');
    expect(escaped).toContain('\\&');
    expect(escaped).toContain('\\%');
    expect(escaped).toContain('\\#');
    expect(escaped).toContain('\\_');
    expect(escaped).toContain('\\^{}');
    expect(escaped).toContain('\\~{}');
  });

  it('renderer normalises smart punctuation to ASCII BEFORE escaping', () => {
    const tex = renderTailoredDocToLatex({
      cv: {
        summary: '“smart” — dash…',
        competencies: [],
        achievementBullets: [],
        keywords: [],
        suggestions: [],
        gaps: [],
      },
    });
    // smart quotes / em-dash / ellipsis should not survive — they get
    // mapped to ASCII by Epic 7's normalisePunctuation before escaping.
    expect(tex).not.toMatch(/[“”—…]/);
  });

  it('sanitiseUrl rejects unsafe schemes — returns "" rather than a literal', () => {
    expect(sanitiseUrl('javascript:alert(1)')).toBe('');
    expect(sanitiseUrl('file:///etc/passwd')).toBe('');
    expect(sanitiseUrl('data:text/html,x')).toBe('');
  });

  it('sanitiseUrl admits http/https/mailto and escapes LaTeX specials in the body', () => {
    expect(sanitiseUrl('https://example.com/a%20b')).toContain('example.com');
    expect(sanitiseUrl('mailto:me@example.com')).toBe('mailto:me@example.com');
    expect(sanitiseUrl('https://example.com/a%b#c')).toMatch(/\\%/);
    expect(sanitiseUrl('https://example.com/a%b#c')).toMatch(/\\#/);
  });

  it('renderer source proves normalisation runs BEFORE escaping (defence in depth)', () => {
    // Both are imported, and the safe() helper composes them in the right
    // order. This static check pins the wiring against accidental reversal.
    expect(PDF_EXPORT_SRC).toMatch(/normalisePunctuation/);
    expect(PDF_EXPORT_SRC).toMatch(/escapeLatex\s*\(\s*normalisePunctuation/);
  });
});

// --- AC4 — Offline / no-egress -------------------------------------------

describe('PDFEX-007 / AC4 — offline engine, no runtime TeX-package fetch', () => {
  it('argv defaults to --only-cached', () => {
    const args = buildLatexCompileArgs({ inputPath: '/tmp/x/doc.tex', outDir: '/tmp/x' });
    expect(args).toContain('--only-cached');
    expect(args).not.toContain('-shell-escape');
    expect(args).not.toContain('--shell-escape');
  });

  it('engine env pins TECTONIC_CACHE_DIR and TECTONIC_NO_DEFAULT_BUNDLE=1', () => {
    const env = buildTectonicEnv({
      platform: 'linux',
      arch: 'x64',
      resourcesPath: '/app/resources',
    });
    expect(env.TECTONIC_CACHE_DIR).toBe(path.join('/app/resources', 'tectonic-cache'));
    expect(env.TECTONIC_NO_DEFAULT_BUNDLE).toBe('1');
  });

  it('buildTectonicArgs honours offline default true', () => {
    const args = buildTectonicArgs({ inputPath: '/x/d.tex', outDir: '/x', offline: true });
    expect(args).toContain('--only-cached');
  });

  it('engine module imports no network primitive', () => {
    expect(ENGINE_CODE).not.toMatch(/from\s+['"]node:https?['"]/);
    expect(ENGINE_CODE).not.toMatch(/\bfetch\(/);
    expect(ENGINE_CODE).not.toMatch(/XMLHttpRequest/);
  });
});

// --- AC5 — Provenance recorded per export --------------------------------

describe('PDFEX-007 / AC5 — provenance recorded per successful export', () => {
  it('IPC module defines a PdfExportRecord with the §7 provenance fields', () => {
    expect(IPC_SRC).toMatch(/interface\s+PdfExportRecord\b/);
    for (const field of [
      'tailoredDocId',
      'tailoredDocVersion',
      'modelSlug',
      'exportedAt',
      'savedPath',
      'pageSize',
    ]) {
      expect(IPC_SRC).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('IPC pins tailoredDocVersion to the source doc’s generatedAt', () => {
    expect(IPC_SRC).toMatch(/tailoredDocVersion:\s*sourceDoc\.generatedAt/);
  });

  it('IPC writes the provenance record via recordsStore.upsert on success', () => {
    expect(IPC_SRC).toMatch(/deps\.recordsStore\.upsert\(record\)/);
  });
});

// --- AC6 — No submission (one local file, no egress) ---------------------

describe('PDFEX-007 / AC6 — IPC writes one local file and stops; no submission', () => {
  it('IPC module imports no http/https/fetch primitive', () => {
    expect(IPC_CODE).not.toMatch(/from\s+['"]node:https?['"]/);
    expect(IPC_CODE).not.toMatch(/\bfetch\(/);
    expect(IPC_CODE).not.toMatch(/XMLHttpRequest/);
  });

  it('IPC module imports no LLM / OpenRouter / LangChain surface', () => {
    expect(IPC_CODE).not.toMatch(/from\s+['"][^'"]*(openai|openrouter|langchain|anthropic)[^'"]*['"]/i);
  });

  it('IPC writes through an injected writeFile seam — never auto-uploads', () => {
    expect(IPC_SRC).toMatch(/deps\.writeFile\(/);
    expect(IPC_SRC).toMatch(/dialog\.showSaveDialog/);
    // The only post-write side effect is shell.showItemInFolder, never a
    // network call.
    expect(IPC_SRC).toMatch(/showItemInFolder/);
  });
});

// --- AC7 — Licence compliance -------------------------------------------

describe('PDFEX-007 / AC7 — licence compliance (career-ops MIT + Tectonic + fonts)', () => {
  it('NOTICE.md reproduces the career-ops MIT notice verbatim', () => {
    expect(NOTICE).toContain('Copyright (c) 2026 Santiago Fernández de Valderrama');
    expect(NOTICE).toContain('Permission is hereby granted, free of charge, to any person obtaining a copy');
    expect(NOTICE).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  it('NOTICE.md reproduces the Tectonic MIT licence after naming Tectonic', () => {
    const idx = NOTICE.indexOf('Tectonic');
    expect(idx).toBeGreaterThan(-1);
    expect(NOTICE.slice(idx)).toMatch(/Permission is hereby granted/);
  });

  it('NOTICE.md reproduces the bundled-font licence (GUST / LPPL)', () => {
    expect(NOTICE).toMatch(/Latin Modern/);
    expect(NOTICE).toContain('GUST Font License');
    expect(NOTICE).toMatch(/LPPL|LaTeX Project Public License/);
    expect(NOTICE.toLowerCase()).toMatch(/redistribut/);
  });

  it('borrowed-from source files carry the career-ops MIT attribution header', () => {
    for (const src of [PDF_EXPORT_SRC, TEMPLATES_SRC]) {
      expect(src).toMatch(/career-ops/i);
      expect(src).toContain('© 2026 Santiago Fernández de Valderrama');
      expect(src).toMatch(/MIT/);
    }
  });

  it('README.md links to NOTICE.md', () => {
    expect(README).toMatch(/\[[^\]]*\]\(\.?\/?NOTICE\.md\)/);
  });
});

// --- Holistic per-ticket re-verification --------------------------------

describe('PDFEX-007 / preceding-ticket evaluation summary', () => {
  it('PDFEX-001 acceptance test fixture still exists (engine spike)', () => {
    expect(() =>
      readFileSync(path.join(ELECTRON_DIR, '__tests__', 'epic-acceptance.pdfex001.test.ts'), 'utf8'),
    ).not.toThrow();
  });

  it('PDFEX-006 acceptance test fixture still exists (licence/attribution)', () => {
    expect(() =>
      readFileSync(path.join(ELECTRON_DIR, '__tests__', 'epic-acceptance.pdfex006.test.ts'), 'utf8'),
    ).not.toThrow();
  });

  it('PDFEX-002 core renderer + compiler module is in place', () => {
    expect(() => readFileSync(path.join(ELECTRON_DIR, 'pdfExport.ts'), 'utf8')).not.toThrow();
  });

  it('PDFEX-003 ATS-safe template module is in place', () => {
    expect(() => readFileSync(path.join(ELECTRON_DIR, 'pdfExport', 'templates.ts'), 'utf8')).not.toThrow();
  });

  it('PDFEX-004 IPC module is in place', () => {
    expect(() => readFileSync(path.join(ELECTRON_DIR, 'pdfExportIpc.ts'), 'utf8')).not.toThrow();
  });

  it('PDFEX-005 tailor-page export action test fixture is in place', () => {
    expect(() =>
      readFileSync(path.join(REPO_DIR, 'src', 'pages', 'TailorPage.pdfex005.test.ts'), 'utf8'),
    ).not.toThrow();
  });
});
