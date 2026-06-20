/**
 * UEXP-005 — Epic 7 / Epic 8 §6 references must point at the unified Export
 * menu defined in Epic 12 (§10 + §13.5). Documentation-only ticket — this is
 * a static text scan of the three epic files.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsEpics = path.resolve(__dirname, '..', '..', '..', 'docs', 'Epics');

const epic07Path = path.join(docsEpics, 'epic_07_TAILORING.md');
const epic08Path = path.join(docsEpics, 'epic_08_PDF_EXPORT.md');
const epic12Path = path.join(docsEpics, 'epic_12_UNIFIED_EXPORT.md');

const read = (p: string) => readFileSync(p, 'utf8');

describe('UEXP-005 — Epic 12 (Unified Export) document exists with §10 + §13.5 anchors (AC1, AC2)', () => {
  it('epic_12_UNIFIED_EXPORT.md exists', () => {
    expect(existsSync(epic12Path)).toBe(true);
  });

  it('declares a §10 UI section for the single Export menu', () => {
    const md = read(epic12Path);
    expect(md).toMatch(/§10[^\n]*Export menu/i);
    expect(md).toMatch(/data-test="export-menu"/);
  });

  it('declares a §13.5 dispatch / implementation note', () => {
    const md = read(epic12Path);
    expect(md).toMatch(/§13\.5/);
  });
});

describe('UEXP-005 AC1 — Epic 7 §6 delegates the standalone Copy / Export-text button to Epic 12', () => {
  it('epic_07_TAILORING.md exists', () => {
    expect(existsSync(epic07Path)).toBe(true);
  });

  it('§6 carries an additive delegation note pointing at Epic 12 §10 and §13.5', () => {
    const md = read(epic07Path);
    expect(md).toMatch(/##\s+§6/);
    expect(md).toMatch(/Delegation note[^\n]*Epic 7\s*[→-]+\s*Epic 12/i);
    expect(md).toMatch(/epic_12_UNIFIED_EXPORT\.md/);
    expect(md).toMatch(/§10/);
    expect(md).toMatch(/§13\.5/);
    expect(md).toMatch(/unified Export menu/i);
  });
});

describe('UEXP-005 AC2 — Epic 8 §6 delegates the standalone Export-PDF button to Epic 12', () => {
  it('epic_08_PDF_EXPORT.md exists', () => {
    expect(existsSync(epic08Path)).toBe(true);
  });

  it('§6 carries an additive delegation note pointing at Epic 12 §10 and §13.5', () => {
    const md = read(epic08Path);
    expect(md).toMatch(/##\s+§6/);
    expect(md).toMatch(/Delegation note[^\n]*Epic 8\s*[→-]+\s*Epic 12/i);
    expect(md).toMatch(/epic_12_UNIFIED_EXPORT\.md/);
    expect(md).toMatch(/§10/);
    expect(md).toMatch(/§13\.5/);
    expect(md).toMatch(/unified Export menu/i);
  });
});

describe('UEXP-005 AC3 — amendments are small additive delegation notes, not rewrites', () => {
  it('Epic 8 keeps its original §1/§2/§3/§10/§11 structure (PDF rendering still owned here)', () => {
    const md = read(epic08Path);
    expect(md).toMatch(/##\s+§1\s+Goal/);
    expect(md).toMatch(/##\s+§2\s+Why LaTeX/);
    expect(md).toMatch(/##\s+§3\s+Non-goals/);
    expect(md).toMatch(/##\s+§10\s+Engine options considered/);
    expect(md).toMatch(/##\s+§11\s+Acceptance/);
  });

  it('Epic 7 explicitly states Markdown rendering still lives in Epic 7 (only the entry point moved)', () => {
    const md = read(epic07Path);
    expect(md).toMatch(/Epic 7 still owns/i);
    expect(md).toMatch(/Markdown/);
  });

  it('Epic 8 explicitly states the PDF pipeline still lives in Epic 8 (only the entry point moved)', () => {
    const md = read(epic08Path);
    expect(md).toMatch(/Epic 8 still owns/i);
  });
});

describe('UEXP-005 AC4 — no functional/code change; only the three epic docs are touched', () => {
  it('the unified Export menu data-test hooks are not duplicated outside the Epic 12 doc', () => {
    // Epic 7/8 reference the menu by name, not by re-declaring data-test ids.
    expect(read(epic07Path)).not.toMatch(/data-test="export-menu"/);
    expect(read(epic08Path)).not.toMatch(/data-test="export-menu"/);
    expect(read(epic12Path)).toMatch(/data-test="export-menu"/);
  });
});
