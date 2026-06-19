/**
 * Unit tests for AIREV-009 — an "AI" button on Job Board tiles that opens the
 * job-detail dialog focused on the AI Match Review section.
 *
 * Mirrors the regex-scan precedent used by the other JobBoardPage tests in
 * this repo (no @vue/test-utils).
 *
 * Acceptance criteria:
 *  1. Each tile's actions footer renders an "AI" button next to the existing
 *     "Detail" button.
 *  2. Clicking AI opens the JobDetailDialog with a "focus the AI section"
 *     flag (a prop) so the dialog scrolls the AI Match Review into view.
 *  3. Clicking AI does not disturb the existing Detail / star /
 *     Not-interested actions — those handlers and labels stay intact.
 *  4. AI handler differs from the Detail handler (passes the focus flag).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, 'JobBoardPage.vue'), 'utf8');

describe('JobBoardPage — AI button on tile actions (AIREV-009 AC1)', () => {
  it('renders an "AI" labelled button in the tile actions footer', () => {
    expect(SRC).toMatch(/label="AI"/);
  });

  it('AI button sits inside the tile__actions footer (next to Detail)', () => {
    const actions = SRC.match(/<footer class="tile__actions"[\s\S]*?<\/footer>/);
    expect(actions).not.toBeNull();
    expect(actions![0]).toMatch(/label="Detail"/);
    expect(actions![0]).toMatch(/label="AI"/);
  });
});

describe('JobBoardPage — AI opens dialog focused on review section (AIREV-009 AC2)', () => {
  it('AI button has a @click handler', () => {
    const aiBtn = SRC.match(/<q-btn[^>]*label="AI"[^>]*\/?>/);
    expect(aiBtn).not.toBeNull();
    expect(aiBtn![0]).toMatch(/@click="[^"]+"/);
  });

  it('JobDetailDialog is bound to a focus-the-review flag (focus-review / focusReview prop)', () => {
    // The dialog must receive a prop signalling that the AI section should
    // be scrolled into view on open. Either kebab-case (:focus-review) or
    // camelCase (:focusReview / :focus-review) binding is acceptable.
    expect(SRC).toMatch(/<JobDetailDialog\b[^>]*:focus-review|:focusReview/);
  });
});

describe('JobBoardPage — AI does not disturb existing tile actions (AIREV-009 AC3)', () => {
  it('Detail button remains, with its original openDetail click handler', () => {
    expect(SRC).toMatch(/label="Detail"/);
    expect(SRC).toMatch(/@click="openDetail/);
  });

  it('star toggle and Not interested actions remain intact', () => {
    expect(SRC).toMatch(/class="star"/);
    expect(SRC).toMatch(/toggleStar\(/);
    expect(SRC).toMatch(/label="Not interested"/);
  });
});

describe('JobBoardPage — AI handler is distinct from Detail (AIREV-009 AC4)', () => {
  it('AI button click handler is NOT the bare openDetail call', () => {
    const aiBtn = SRC.match(/<q-btn[^>]*label="AI"[^>]*\/?>/);
    expect(aiBtn).not.toBeNull();
    // It may call a helper like openReview(j) — but must not be the exact same
    // handler as Detail's @click="openDetail(j)" (otherwise the focus flag
    // would never be set).
    expect(aiBtn![0]).not.toMatch(/@click="openDetail\(j\)"/);
  });
});
