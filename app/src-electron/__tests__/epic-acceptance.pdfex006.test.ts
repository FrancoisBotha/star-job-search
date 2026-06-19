/**
 * Epic-level acceptance verification (PDFEX-006 / Epic 8).
 *
 * Each describe block is anchored to one of the six PDFEX-006
 * acceptance criteria:
 *
 *   AC1 NOTICE / THIRD-PARTY-LICENSES reproduces career-ops MIT
 *       notice verbatim (© 2026 Santiago Fernández de Valderrama).
 *   AC2 Files that incorporate career-ops code/templates carry an
 *       MIT-attribution header recording the borrowed scope.
 *   AC3 Each bundled font's licence is reproduced and redistribution
 *       rights are verified (fonts are not MIT).
 *   AC4 The LaTeX engine bundled in PDFEX-001 has its licence honoured
 *       and reproduced.
 *   AC5 README links to the NOTICE / THIRD-PARTY-LICENSES file.
 *   AC6 Provenance for each reused career-ops artefact is recorded
 *       (which file, which scope) per this ticket.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..', '..');

function read(rel: string): string {
  return readFileSync(path.join(REPO_DIR, rel), 'utf8');
}

describe('PDFEX-006 / AC1 — NOTICE reproduces career-ops MIT notice verbatim', () => {
  it('NOTICE.md exists at the project root', () => {
    expect(existsSync(path.join(REPO_DIR, 'NOTICE.md'))).toBe(true);
  });

  it('reproduces the career-ops MIT copyright line verbatim', () => {
    const notice = read('NOTICE.md');
    expect(notice).toContain('Copyright (c) 2026 Santiago Fernández de Valderrama');
  });

  it('reproduces the MIT permission notice text verbatim', () => {
    const notice = read('NOTICE.md');
    expect(notice).toContain(
      'Permission is hereby granted, free of charge, to any person obtaining a copy',
    );
    expect(notice).toContain(
      'The above copyright notice and this permission notice shall be included in all',
    );
    expect(notice).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });
});

describe('PDFEX-006 / AC2 — borrowed-scope MIT headers on files drawing from career-ops', () => {
  const FILES = [
    'app/src-electron/pdfExport.ts',
    'app/src-electron/pdfExport/templates.ts',
  ];

  for (const rel of FILES) {
    it(`${rel} records the career-ops MIT attribution and borrowed scope`, () => {
      const src = read(rel);
      expect(src).toMatch(/career-ops/i);
      expect(src).toContain('© 2026 Santiago Fernández de Valderrama');
      expect(src).toMatch(/MIT/);
      // Borrowed scope — the file says WHICH career-ops artefact it
      // draws on, not just "we used career-ops somewhere".
      expect(src).toMatch(/build-cv-latex\.mjs|generate-pdf\.mjs|generate-latex\.mjs|cv-template\.tex/);
    });
  }
});

describe('PDFEX-006 / AC3 — bundled-font licences reproduced + redistribution verified', () => {
  it('NOTICE.md names the bundled Latin Modern font family', () => {
    const notice = read('NOTICE.md');
    expect(notice).toMatch(/Latin Modern/);
  });

  it('reproduces the GUST Font Licence header for Latin Modern', () => {
    const notice = read('NOTICE.md');
    expect(notice).toContain('GUST Font License');
    expect(notice).toMatch(/LPPL|LaTeX Project Public License/);
  });

  it('records that redistribution rights have been verified for the bundled fonts', () => {
    const notice = read('NOTICE.md');
    expect(notice.toLowerCase()).toMatch(/redistribut/);
  });
});

describe('PDFEX-006 / AC4 — bundled LaTeX engine licence honoured + reproduced', () => {
  it('NOTICE.md names the Tectonic engine bundled by PDFEX-001', () => {
    const notice = read('NOTICE.md');
    expect(notice).toMatch(/Tectonic/);
  });

  it('reproduces the Tectonic MIT licence text', () => {
    const notice = read('NOTICE.md');
    // Tectonic is MIT — the permission-notice clause must appear in
    // the Tectonic section, not only in the career-ops section.
    const tectonicIdx = notice.indexOf('Tectonic');
    expect(tectonicIdx).toBeGreaterThan(-1);
    const tectonicTail = notice.slice(tectonicIdx);
    expect(tectonicTail).toContain('MIT');
    expect(tectonicTail).toMatch(/Permission is hereby granted/);
  });
});

describe('PDFEX-006 / AC5 — README links to NOTICE', () => {
  it('README.md contains a link to NOTICE.md', () => {
    const readme = read('README.md');
    expect(readme).toMatch(/\[[^\]]*\]\(\.?\/?NOTICE\.md\)/);
  });
});

describe('PDFEX-006 / AC6 — provenance recorded per reused career-ops artefact', () => {
  it('NOTICE.md lists each borrowed career-ops file and the scope drawn from it', () => {
    const notice = read('NOTICE.md');
    // Provenance table / list — at minimum the LaTeX-export sources
    // PDFEX took conceptual inspiration from.
    expect(notice).toMatch(/build-cv-latex\.mjs/);
    expect(notice).toMatch(/generate-pdf\.mjs/);
    // Scope wording must accompany each artefact (concept vs verbatim).
    expect(notice).toMatch(/conceptual|verbatim|substantial/i);
  });
});
