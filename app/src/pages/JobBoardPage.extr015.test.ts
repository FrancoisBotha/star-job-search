/**
 * Unit tests for EXTR-015 — show salary on Job Board tiles.
 *
 * Mirrors the regex-scan style used by the other page tests in this repo.
 *
 * Acceptance criteria:
 *  1. Each tile renders the job's salary (a salary line in the tile meta),
 *     reading from the extracted `salary` field (EXTR-013).
 *  2. When the posting states no salary the tile reads 'Salary not stated' —
 *     never blank, zero, or 'undefined'.
 *  3. The tile and the job-detail modal share the same formatter so the same
 *     job reads the same in both places.
 *  4. The salary line reuses existing CSS tokens (var(--…)) — no new design
 *     tokens are introduced.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOARD_SRC = readFileSync(path.join(__dirname, 'JobBoardPage.vue'), 'utf8');
const DIALOG_SRC = readFileSync(
  path.join(__dirname, '..', 'components', 'JobDetailDialog.vue'),
  'utf8',
);
const FORMATTER_SRC = readFileSync(
  path.join(__dirname, '..', 'utils', 'salary.ts'),
  'utf8',
);

describe('JobBoardPage — salary on tiles (AC1)', () => {
  it('renders a salary line in each tile, reading from the extracted salary field', () => {
    // A dedicated tile element for salary so it lives in the tile meta and
    // can be styled without disturbing head/score/actions.
    expect(BOARD_SRC).toMatch(/class="tile__salary"/);
    // The line is derived from j.salary (the EXTR-013 extracted field).
    expect(BOARD_SRC).toMatch(/j\.salary|tileSalary/);
  });
});

describe('JobBoardPage — fallback when not stated (AC2)', () => {
  it("shows 'Salary not stated' when the posting states no salary — never blank or 0", () => {
    expect(BOARD_SRC).toMatch(/Salary not stated/);
  });
});

describe('JobBoardPage / JobDetailDialog — shared salary formatter (AC3)', () => {
  it('the board imports the shared formatSalary from src/utils/salary', () => {
    expect(BOARD_SRC).toMatch(/formatSalary/);
    expect(BOARD_SRC).toMatch(/from ['"][^'"]*utils\/salary['"]/);
  });

  it('the dialog imports the shared formatSalary from src/utils/salary', () => {
    expect(DIALOG_SRC).toMatch(/formatSalary/);
    expect(DIALOG_SRC).toMatch(/from ['"][^'"]*utils\/salary['"]/);
  });

  it('the formatter exports a formatSalary function', () => {
    expect(FORMATTER_SRC).toMatch(/export\s+function\s+formatSalary/);
  });
});

describe('JobBoardPage — salary line reuses existing tokens (AC4)', () => {
  it('the .tile__salary rule references a CSS variable (existing token), not a hardcoded colour', () => {
    // Pull just the .tile__salary block out of the <style> section.
    const block = BOARD_SRC.match(/&__salary\s*\{[^}]*\}/);
    expect(block, '.tile__salary CSS block missing').not.toBeNull();
    // Must reference at least one CSS var — i.e. an existing token.
    expect(block![0]).toMatch(/var\(--[a-z0-9-]+\)/);
  });
});
