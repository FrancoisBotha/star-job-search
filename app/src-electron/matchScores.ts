/**
 * Match-scores persistence module (SCORE-003 / Epic 5 FR-005).
 *
 * Owns the on-disk store of computed `MatchScore` rows so a job's stars +
 * factor breakdown survive an app restart, can be re-rendered without
 * recomputing, and can be audited later by their recorded `weightsVersion`.
 *
 * Backed by SQLite via `better-sqlite3` on the same shared `star.db` the
 * sites / jobs / preferred-models / profile / CV stores write to. Mirrors
 * the module shape of `sites.ts` (database-like seam → store factory →
 * IPC registration in a sibling ticket).
 *
 * One table:
 *  - `match_scores` keyed by `source_id` — one row per scored job. Factors
 *    are persisted as a JSON column to keep the schema tight (no child
 *    table to migrate as the factor framework evolves; Epic 5 §7 leaves
 *    JSON-column-or-child explicitly open).
 *
 * The store contract is the four-op pattern called out in the ticket:
 *  - get(sourceId)     — fetch one
 *  - list()            — fetch all
 *  - upsert(MatchScore) — insert or replace by sourceId
 *  - markStale(ids)    — flip `stale=true` without deleting the prior score
 *                        (so re-render keeps working while a re-score runs)
 *
 * `rowToMatchScore` is the canonical row→MatchScore deserialiser. The IPC
 * layer (SCORE-004) and any test/debug code share it so the persisted shape
 * always round-trips identically to the renderer/store contract (AC6).
 */
import Database from 'better-sqlite3';

import type { MatchFactor, MatchScore } from './scorer';

// Minimal slice of the better-sqlite3 surface we actually use — same seam
// pattern as sites.ts so the store is unit-testable without the native
// binding.
export interface MatchScoresDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

export interface MatchScoresStore {
  get(sourceId: string): MatchScore | undefined;
  list(): MatchScore[];
  upsert(score: MatchScore): void;
  /** Mark one or more sourceIds as stale WITHOUT deleting the stored score
   *  (FR-005 / AC5). A re-score later replaces the row via `upsert`. */
  markStale(sourceIds: string | string[]): void;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS match_scores (
    source_id        TEXT PRIMARY KEY,
    stars            REAL NOT NULL,
    percent          REAL NOT NULL,
    factors          TEXT NOT NULL,
    weights_version  TEXT NOT NULL,
    stale            INTEGER NOT NULL DEFAULT 0,
    scored_at        INTEGER NOT NULL
  )
`;

interface MatchScoreRow {
  source_id: string;
  stars: number;
  percent: number;
  factors: string;
  weights_version: string;
  stale: number;
  scored_at: number;
}

/**
 * Canonical row → MatchScore deserialiser. Exported so the IPC layer and the
 * renderer/store contract decode the persisted shape identically (AC6).
 *
 * Parses the `factors` JSON column back into a typed `MatchFactor[]`. A
 * corrupt JSON blob falls back to an empty array rather than throwing —
 * the store is best-effort durable, never crashes the main process on a
 * single bad row.
 */
export function rowToMatchScore(row: MatchScoreRow): MatchScore {
  let factors: MatchFactor[] = [];
  if (row.factors) {
    try {
      const parsed = JSON.parse(row.factors) as unknown;
      if (Array.isArray(parsed)) factors = parsed as MatchFactor[];
    } catch {
      factors = [];
    }
  }
  return {
    sourceId: row.source_id,
    stars: row.stars,
    percent: row.percent,
    factors,
    weightsVersion: row.weights_version,
    stale: row.stale !== 0,
    scoredAt: row.scored_at,
  };
}

export function createMatchScoresStore(
  db: MatchScoresDatabaseLike,
): MatchScoresStore {
  db.exec(CREATE_TABLE_SQL);

  const getStmt = db.prepare(
    'SELECT source_id, stars, percent, factors, weights_version, stale, scored_at FROM match_scores WHERE source_id = ?',
  );
  const listStmt = db.prepare(
    'SELECT source_id, stars, percent, factors, weights_version, stale, scored_at FROM match_scores ORDER BY source_id ASC',
  );
  const upsertStmt = db.prepare(
    'INSERT OR REPLACE INTO match_scores (source_id, stars, percent, factors, weights_version, stale, scored_at) VALUES (@source_id, @stars, @percent, @factors, @weights_version, @stale, @scored_at)',
  );
  const markStaleStmt = db.prepare(
    'UPDATE match_scores SET stale = 1 WHERE source_id = ?',
  );

  return {
    get(sourceId: string): MatchScore | undefined {
      const rows = (getStmt.all?.(sourceId) ?? []) as MatchScoreRow[];
      const row = rows[0];
      return row ? rowToMatchScore(row) : undefined;
    },
    list(): MatchScore[] {
      const rows = (listStmt.all?.() ?? []) as MatchScoreRow[];
      return rows.map(rowToMatchScore);
    },
    upsert(score: MatchScore): void {
      upsertStmt.run({
        source_id: score.sourceId,
        stars: score.stars,
        percent: score.percent,
        factors: JSON.stringify(score.factors ?? []),
        weights_version: score.weightsVersion,
        stale: score.stale ? 1 : 0,
        scored_at: score.scoredAt,
      });
    },
    markStale(sourceIds: string | string[]): void {
      const ids = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
      for (const id of ids) markStaleStmt.run(id);
    },
  };
}

/**
 * Open a SQLite database file backing the match-scores store. Wraps
 * `better-sqlite3` so callers don't have to import it directly. The same
 * `star.db` file is shared across the sites, preferred-models, jobs, and
 * match-scores stores.
 */
export function openMatchScoresDatabase(filepath: string): MatchScoresDatabaseLike {
  return new Database(filepath) as unknown as MatchScoresDatabaseLike;
}
