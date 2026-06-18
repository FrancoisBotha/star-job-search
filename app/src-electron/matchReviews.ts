/**
 * Match-reviews persistence module (AIREV-002 / Epic 6 FR-004).
 *
 * Owns the on-disk store of LLM-generated qualitative `MatchReview` rows so
 * the narrative review for a job survives an app restart and can be re-
 * rendered without re-spending tokens. Mirrors the module shape of
 * `sites.ts` / `matchScores.ts` (database-like seam → store factory).
 *
 * One table:
 *  - `match_reviews` keyed by `source_id` — one row per reviewed job.
 *    Narrative arrays (requirements / gaps / strengths / keywords) are
 *    persisted as JSON columns to keep the schema tight and the contract
 *    flexible. Provenance columns (`model_slug`, `generated_at`) and the
 *    `stale` flag round out the row.
 *
 * HARD BOUNDARY (Epic 6 NFR-001 / "narrative only, no number"):
 *  - This table has NO score / percent / stars / rating column by
 *    construction; the renderer can never accidentally surface a number
 *    from the review path, and the renderer's only rating remains the
 *    deterministic Epic 5 stars stored in `match_scores`.
 *  - This module never reads or writes the `match_scores` table — the two
 *    stores are strictly separate and never joined into a single rating.
 *
 * The store contract is the three-op pattern called out in the ticket:
 *  - get(sourceId)       — fetch one
 *  - upsert(MatchReview) — insert or replace by sourceId (a fresh upsert
 *                          clears the stale flag — that's "regenerate")
 *  - markStale(sourceId) — flip `stale=true` WITHOUT deleting the cached
 *                          narrative, so the prior review stays viewable
 *                          alongside a "regenerate" affordance.
 */
import Database from 'better-sqlite3';

import type {
  MatchReview,
  ReviewGap,
  ReviewRequirement,
} from './matchReview';

// Minimal slice of the better-sqlite3 surface we actually use — same seam
// pattern as sites.ts / matchScores.ts so the store is unit-testable
// without the native binding.
export interface MatchReviewsDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

/**
 * The persisted shape adds the `stale` flag on top of the AIREV-001
 * narrative + provenance contract. We do NOT add `stale` to the source
 * `MatchReview` type (that lives in another ticket) — instead callers of
 * this store consume the union below, which is also what `get` returns.
 *
 * NOTE: there is still no number / score / percent / stars / rating field
 * anywhere in this shape (Epic 6 hard boundary).
 */
export interface PersistedMatchReview extends MatchReview {
  stale: boolean;
}

export interface MatchReviewsStore {
  get(sourceId: string): PersistedMatchReview | undefined;
  upsert(review: MatchReview | PersistedMatchReview): void;
  /** Mark the cached review for a sourceId as stale WITHOUT deleting the
   *  narrative blob (AC4). A regenerate later replaces the row via `upsert`,
   *  which also clears the stale flag. */
  markStale(sourceId: string): void;
}

// No score / percent / stars / rating column by construction (Epic 6 hard
// boundary). The CREATE TABLE statement itself is the structural guarantee
// that the narrative review path cannot accidentally surface a number.
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS match_reviews (
    source_id      TEXT PRIMARY KEY,
    archetype      TEXT,
    requirements   TEXT NOT NULL,
    gaps           TEXT NOT NULL,
    strengths      TEXT NOT NULL,
    keywords       TEXT NOT NULL,
    summary        TEXT NOT NULL,
    model_slug     TEXT,
    generated_at   INTEGER NOT NULL,
    stale          INTEGER NOT NULL DEFAULT 0
  )
`;

interface MatchReviewRow {
  source_id: string;
  archetype: string | null;
  requirements: string;
  gaps: string;
  strengths: string;
  keywords: string;
  summary: string;
  model_slug: string | null;
  generated_at: number;
  stale: number;
}

function parseJsonArray<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Canonical row → MatchReview deserialiser. Exported so the IPC layer and
 * any debug/test code share the same decoder and the persisted shape always
 * round-trips identically to the renderer/store contract.
 *
 * A corrupt JSON blob falls back to an empty array rather than throwing —
 * the store is best-effort durable, never crashes the main process on a
 * single bad row.
 */
export function rowToMatchReview(row: MatchReviewRow): PersistedMatchReview {
  const review: PersistedMatchReview = {
    sourceId: row.source_id,
    requirements: parseJsonArray<ReviewRequirement>(row.requirements),
    gaps: parseJsonArray<ReviewGap>(row.gaps),
    strengths: parseJsonArray<string>(row.strengths),
    keywords: parseJsonArray<string>(row.keywords),
    summary: row.summary,
    generatedAt: row.generated_at,
    stale: row.stale !== 0,
  };
  if (row.archetype) review.archetype = row.archetype;
  if (row.model_slug) review.modelSlug = row.model_slug;
  return review;
}

export function createMatchReviewsStore(
  db: MatchReviewsDatabaseLike,
): MatchReviewsStore {
  db.exec(CREATE_TABLE_SQL);

  const getStmt = db.prepare(
    'SELECT source_id, archetype, requirements, gaps, strengths, keywords, summary, model_slug, generated_at, stale FROM match_reviews WHERE source_id = ?',
  );
  const upsertStmt = db.prepare(
    'INSERT OR REPLACE INTO match_reviews (source_id, archetype, requirements, gaps, strengths, keywords, summary, model_slug, generated_at, stale) VALUES (@source_id, @archetype, @requirements, @gaps, @strengths, @keywords, @summary, @model_slug, @generated_at, @stale)',
  );
  const markStaleStmt = db.prepare(
    'UPDATE match_reviews SET stale = 1 WHERE source_id = ?',
  );

  return {
    get(sourceId: string): PersistedMatchReview | undefined {
      const rows = (getStmt.all?.(sourceId) ?? []) as MatchReviewRow[];
      const row = rows[0];
      return row ? rowToMatchReview(row) : undefined;
    },
    upsert(review: MatchReview | PersistedMatchReview): void {
      upsertStmt.run({
        source_id: review.sourceId,
        archetype: review.archetype ?? null,
        requirements: JSON.stringify(review.requirements ?? []),
        gaps: JSON.stringify(review.gaps ?? []),
        strengths: JSON.stringify(review.strengths ?? []),
        keywords: JSON.stringify(review.keywords ?? []),
        summary: review.summary,
        model_slug: review.modelSlug ?? null,
        generated_at: review.generatedAt ?? Date.now(),
        // A fresh upsert is the "regenerate" path — clear the stale flag
        // unless the caller explicitly set it on the inbound record.
        stale: 'stale' in review && review.stale ? 1 : 0,
      });
    },
    markStale(sourceId: string): void {
      markStaleStmt.run(sourceId);
    },
  };
}

/**
 * Open a SQLite database file backing the match-reviews store. Wraps
 * `better-sqlite3` so callers don't have to import it directly. The same
 * `star.db` file is shared across the sites, preferred-models, jobs,
 * match-scores, and match-reviews stores — but the latter two are strictly
 * separate tables, never joined into a single rating (Epic 6 NFR-001).
 */
export function openMatchReviewsDatabase(filepath: string): MatchReviewsDatabaseLike {
  return new Database(filepath) as unknown as MatchReviewsDatabaseLike;
}
