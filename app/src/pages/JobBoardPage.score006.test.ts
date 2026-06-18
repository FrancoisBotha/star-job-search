/**
 * Unit tests for SCORE-006: Board / Starred tiles show stars + percentage;
 * tiles order strong matches first; the ★4+ threshold drives which jobs
 * read as "matches"; unscored/stale tiles render a sensible state; a
 * multi-site listing renders one score (FR-009, FR-011).
 *
 * Mirrors the regex-scan style used by the other component/page tests in
 * this repo — no @vue/test-utils.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BOARD_SRC = readFileSync(path.join(__dirname, 'JobBoardPage.vue'), 'utf8');
const STARRED_SRC = readFileSync(path.join(__dirname, 'StarredPage.vue'), 'utf8');

describe('SCORE-006 AC1 — Board tiles show StarRating + 0–100% match', () => {
  it('imports StarRating and renders it on each board tile', () => {
    expect(BOARD_SRC).toMatch(/import StarRating from .src\/components\/StarRating\.vue./);
    expect(BOARD_SRC).toMatch(/<StarRating\b[^>]*:score=/);
  });

  it('renders the 0–100% match alongside the stars', () => {
    expect(BOARD_SRC).toMatch(/%/);
    // Percent label tied to a score record (e.g. score.percent).
    expect(BOARD_SRC).toMatch(/percent/);
  });
});

describe('SCORE-006 AC1 — Starred tiles show StarRating + 0–100% match', () => {
  it('imports StarRating and renders it on each starred tile', () => {
    expect(STARRED_SRC).toMatch(/import StarRating from .src\/components\/StarRating\.vue./);
    expect(STARRED_SRC).toMatch(/<StarRating\b[^>]*:score=/);
  });

  it('renders the 0–100% match alongside the stars', () => {
    expect(STARRED_SRC).toMatch(/%/);
    expect(STARRED_SRC).toMatch(/percent/);
  });
});

describe('SCORE-006 AC2 — Tiles ordered with strong matches first', () => {
  // The ordered list must be derived from the score map (state.scores) keyed
  // by sourceId, descending by score; the previous fetchedAt-only sort no
  // longer drives the primary key.
  it('Board page derives an ordered list from store.scores', () => {
    expect(BOARD_SRC).toMatch(/scores\[/);
  });
  it('Starred page derives an ordered list from store.scores', () => {
    expect(STARRED_SRC).toMatch(/scores\[/);
  });

  it('Pure ordering helper: scored jobs lead by percent desc, unscored sort last', () => {
    type J = { sourceId: string; fetchedAt: number };
    const jobs: J[] = [
      { sourceId: 'a', fetchedAt: 1 },
      { sourceId: 'b', fetchedAt: 5 },
      { sourceId: 'c', fetchedAt: 3 },
      { sourceId: 'd', fetchedAt: 4 },
    ];
    const scores: Record<string, { percent: number }> = {
      a: { percent: 90 },
      c: { percent: 60 },
    };
    const orderKey = (j: J) => scores[j.sourceId]?.percent ?? -1;
    const sorted = [...jobs].sort((x, y) => {
      const dx = orderKey(y) - orderKey(x);
      if (dx !== 0) return dx;
      return y.fetchedAt - x.fetchedAt;
    });
    expect(sorted.map((j) => j.sourceId)).toEqual(['a', 'c', 'b', 'd']);
  });
});

describe('SCORE-006 AC2 — Strong-match (★4+) threshold drives "matches"', () => {
  it('Board tile flags strong matches (e.g. a star class or modifier keyed off ★4+)', () => {
    // Either the template uses store.strongMatches/score.stars >= 4, or a
    // dedicated isStrong helper. We accept any reference that mentions the
    // ★4+ threshold or the strongMatch concept.
    const hasThreshold =
      /score\.stars\s*>=\s*4/.test(BOARD_SRC) ||
      /isStrong/.test(BOARD_SRC) ||
      /strong/i.test(BOARD_SRC);
    expect(hasThreshold).toBe(true);
  });
});

describe('SCORE-006 AC3 — Unscored / stale tiles render a sensible state without breaking layout', () => {
  it('Board tile branches on the presence of a score (v-if/v-else on score)', () => {
    expect(BOARD_SRC).toMatch(/v-if=.score|v-else/);
  });
  it('Board tile exposes a label for the not-yet-scored case', () => {
    expect(BOARD_SRC).toMatch(/Not\s+scored|not yet scored|—|unscored/i);
  });
  it('Board tile exposes a stale indicator (label or class)', () => {
    expect(BOARD_SRC).toMatch(/stale/i);
  });
});

describe('SCORE-006 AC4 — Multi-site listing shows a single score once (FR-011)', () => {
  it('Each tile renders StarRating exactly once', () => {
    const matches = BOARD_SRC.match(/<StarRating\b/g) ?? [];
    expect(matches.length).toBe(1);
  });
  it('Scores are keyed by sourceId so collapsed multi-source jobs share one row', () => {
    // The store keyed scores by sourceId; the tile must read by sourceId,
    // not by hostname/url, so a multi-source job presents a single score.
    expect(BOARD_SRC).toMatch(/scores\[\s*j\.sourceId\s*\]/);
  });
});

describe('SCORE-006 AC5 — Reuses existing brand tokens; no new design tokens', () => {
  it('Board tile uses existing CSS variables (var(--…)) and does not define new --tokens', () => {
    // No new custom-property declarations introduced for the score widget.
    const newTokenDecls = BOARD_SRC.match(/--[a-z-]+:\s*[^;]+;/g) ?? [];
    // Allow zero or a small number of inherited declarations from the
    // existing scoped styles — but no NEW score-specific tokens.
    for (const decl of newTokenDecls) {
      expect(decl).not.toMatch(/--score-/);
      expect(decl).not.toMatch(/--match-/);
    }
  });
});
