/**
 * Unit tests for JOBDET-003: replace the board's single 'Open' button with
 * 'Detail' + 'Score' actions, wire Detail to the JobDetailDialog modal.
 *
 * Mirrors the regex-scan style used by the other component/page tests in
 * this repo — no @vue/test-utils.
 *
 * Acceptance criteria:
 *  1. The 'Open' button is replaced by two actions labelled 'Detail' and 'Score'.
 *  2. 'Detail' opens JobDetailDialog (mounted in the page) for the selected job;
 *     the board stays mounted so scroll/selection state is preserved.
 *  3. 'Score' is present but disabled with a tooltip affordance and wires no
 *     score data.
 *  4. Star and 'Not interested' actions remain; the previous openJob/view:open
 *     behaviour is no longer triggered from this row's primary button.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, 'JobBoardPage.vue'), 'utf8');

describe('JobBoardPage — Detail replaces Open (AC1)', () => {
  it("renders a 'Detail' action button", () => {
    expect(SRC).toMatch(/label="Detail"/);
  });

  it("does NOT render the previous 'Open' button", () => {
    expect(SRC).not.toMatch(/label="Open"/);
  });

  // The JOBDET-003 placeholder 'Score' button is replaced in SCORE-006 by
  // a live StarRating + percentage widget on the tile. The placeholder is
  // intentionally gone — see JobBoardPage.score006.test.ts for the new
  // assertions on the live score widget.
});

describe('JobBoardPage — Detail opens the modal in-place (AC2)', () => {
  it('mounts JobDetailDialog inside the page so the board stays mounted', () => {
    expect(SRC).toMatch(/JobDetailDialog/);
    expect(SRC).toMatch(/<job-detail-dialog\b|<JobDetailDialog\b/);
  });

  it("uses v-model to control the dialog (board remains mounted while it's open)", () => {
    expect(SRC).toMatch(/<(job-detail-dialog|JobDetailDialog)\b[^>]*v-model/);
  });

  it("clicking 'Detail' opens the dialog for the selected job (does not call store.openJob)", () => {
    // The Detail button's @click handler should open the dialog with the
    // current tile's job — not invoke store.openJob.
    const detailBtn = SRC.match(/<q-btn[^>]*label="Detail"[^>]*\/?>/);
    expect(detailBtn).not.toBeNull();
    expect(detailBtn![0]).toMatch(/@click="[^"]+"/);
    expect(detailBtn![0]).not.toMatch(/store\.openJob/);
  });
});

describe('JobBoardPage — Score placeholder is replaced by live score widget (AC3, superseded by SCORE-006)', () => {
  it("no longer renders a disabled 'Score' button placeholder", () => {
    expect(SRC).not.toMatch(/<q-btn[^>]*label="Score"\b/);
  });
});

describe('JobBoardPage — Star and Not interested unchanged; openJob no longer wired (AC4)', () => {
  it('still renders the star toggle button', () => {
    expect(SRC).toMatch(/class="star"/);
    expect(SRC).toMatch(/toggleStar\(/);
  });

  it("still renders the 'Not interested' button calling setJobStatus", () => {
    expect(SRC).toMatch(/label="Not interested"/);
    expect(SRC).toMatch(/setJobStatus\(\{\s*sourceId:[^}]*status:\s*'not_interested'/);
  });

  it('no row action calls store.openJob anymore', () => {
    expect(SRC).not.toMatch(/store\.openJob\(/);
  });
});
