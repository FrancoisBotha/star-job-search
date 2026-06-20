/**
 * Eval-reports persistence module (EVAL-002 / Epic 14 — Job Evaluation Report).
 *
 * Owns the on-disk store of LLM-generated qualitative `EvalReport` rows so
 * the multi-block evaluation narrative for a job (with researched sources +
 * a legitimacy verdict) survives an app restart and can be re-rendered
 * without re-spending tokens. Mirrors the module shape of `matchReviews.ts`
 * (database-like seam → store factory) so callers — get / upsert / markStale —
 * line up across the two stores.
 *
 * One table:
 *  - `eval_reports` keyed by `source_id` — one row per evaluated job.
 *    Narrative blocks A / C / D / G / H are persisted as TEXT columns; the
 *    researched sources list is persisted as a JSON column. Provenance
 *    columns (`model_slug`, `generated_at`) and the `stale` flag round out
 *    the row.
 *
 * BLOCK B (Match-with-CV) IS NOT STORED HERE — it lives in `match_reviews`
 * (Epic 6) and is referenced by `sourceId`. We deliberately do NOT duplicate
 * the Block B requirement/gap/strength/keyword/summary columns into this
 * table; a single source of truth keeps the two narratives' lifecycles
 * (regenerate, mark-stale) independently manageable and avoids drift.
 *
 * HARD BOUNDARY (Epic 6 NFR-001 / "narrative only, no number"):
 *  - This table has NO score / percent / stars / rating column by
 *    construction; the evaluation path can never accidentally surface a
 *    number, and the only rating on screen remains the deterministic
 *    Epic 5 stars stored in `match_scores`.
 *  - This module never reads or writes `match_scores` — the two stores are
 *    strictly separate.
 *
 * Store contract (the three-op pattern mirroring matchReviews.ts):
 *  - get(sourceId)        — fetch one
 *  - upsert(EvalReport)   — insert or replace by sourceId (a fresh upsert
 *                           clears the stale flag — that's "regenerate")
 *  - markStale(sourceId)  — flip `stale=true` WITHOUT deleting the cached
 *                           narrative, so the prior report stays viewable
 *                           alongside a "regenerate" affordance. Triggered
 *                           on CV/Profile change or job re-extract (AC3).
 */
import Database from 'better-sqlite3';

// Minimal slice of the better-sqlite3 surface we actually use — same seam
// pattern as matchReviews.ts so the store is unit-testable without the
// native binding.
export interface EvalReportsDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

/** A single researched source the evaluator consulted (career-site About
 *  page, Glassdoor profile, news article, …). Persisted as JSON. */
export interface EvalSource {
  title: string;
  url: string;
  /** Optional short excerpt or note explaining what the source contributed. */
  snippet?: string;
}

/** Legitimacy verdict — kept as a free-form string so the evaluator can
 *  return values like 'legitimate' / 'suspicious' / 'unknown' without this
 *  store needing to know the closed set up-front. */
export type LegitimacyVerdict = string;

/**
 * The persisted EvalReport shape. NO score / number / percent / star /
 * rating field anywhere by construction (Epic 6 hard boundary). Block B
 * (Match-with-CV) is intentionally absent — read it from `match_reviews`
 * for the same `sourceId`.
 */
export interface EvalReport {
  sourceId: string;
  blockA: string;
  blockC: string;
  blockD: string;
  blockG: string;
  blockH: string;
  sources: EvalSource[];
  legitimacyVerdict: LegitimacyVerdict;
  verificationNote: string;
  modelSlug?: string;
  generatedAt: number;
}

export interface PersistedEvalReport extends EvalReport {
  stale: boolean;
}

export interface EvalReportsStore {
  get(sourceId: string): PersistedEvalReport | undefined;
  upsert(report: EvalReport | PersistedEvalReport): void;
  /** Mark the cached report for a sourceId as stale WITHOUT deleting the
   *  narrative blob. A regenerate later replaces the row via `upsert`,
   *  which also clears the stale flag. Triggered on CV/Profile change or
   *  job re-extract (AC3). */
  markStale(sourceId: string): void;
  /** Wipe every row — cascaded from a "delete all imported jobs" action so
   *  no orphaned per-job eval reports remain. */
  deleteAll(): void;
  /** Remove the eval report for a single sourceId — cascaded from a per-row
   *  job delete so no orphaned reports remain. */
  delete(sourceId: string): void;
}

// No score / percent / stars / rating column by construction (Epic 6 hard
// boundary). The CREATE TABLE statement itself is the structural guarantee
// that the evaluation path cannot accidentally surface a number. Block B
// columns are intentionally NOT here — Block B is referenced from
// `match_reviews`, never duplicated.
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS eval_reports (
    source_id           TEXT PRIMARY KEY,
    block_a             TEXT NOT NULL,
    block_c             TEXT NOT NULL,
    block_d             TEXT NOT NULL,
    block_g             TEXT NOT NULL,
    block_h             TEXT NOT NULL,
    sources             TEXT NOT NULL,
    legitimacy_verdict  TEXT NOT NULL,
    verification_note   TEXT NOT NULL,
    model_slug          TEXT,
    generated_at        INTEGER NOT NULL,
    stale               INTEGER NOT NULL DEFAULT 0
  )
`;

interface EvalReportRow {
  source_id: string;
  block_a: string;
  block_c: string;
  block_d: string;
  block_g: string;
  block_h: string;
  sources: string;
  legitimacy_verdict: string;
  verification_note: string;
  model_slug: string | null;
  generated_at: number;
  stale: number;
}

function parseSources(raw: string | null | undefined): EvalSource[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as EvalSource[]) : [];
  } catch {
    return [];
  }
}

/**
 * Canonical row → EvalReport deserialiser. Exported so the IPC layer and
 * any debug/test code share the same decoder and the persisted shape always
 * round-trips identically to the renderer contract.
 *
 * A corrupt sources JSON blob falls back to an empty array rather than
 * throwing — the store is best-effort durable, never crashes the main
 * process on a single bad row.
 */
export function rowToEvalReport(row: EvalReportRow): PersistedEvalReport {
  const report: PersistedEvalReport = {
    sourceId: row.source_id,
    blockA: row.block_a,
    blockC: row.block_c,
    blockD: row.block_d,
    blockG: row.block_g,
    blockH: row.block_h,
    sources: parseSources(row.sources),
    legitimacyVerdict: row.legitimacy_verdict,
    verificationNote: row.verification_note,
    generatedAt: row.generated_at,
    stale: row.stale !== 0,
  };
  if (row.model_slug) report.modelSlug = row.model_slug;
  return report;
}

export function createEvalReportsStore(
  db: EvalReportsDatabaseLike,
): EvalReportsStore {
  db.exec(CREATE_TABLE_SQL);

  const getStmt = db.prepare(
    'SELECT source_id, block_a, block_c, block_d, block_g, block_h, sources, legitimacy_verdict, verification_note, model_slug, generated_at, stale FROM eval_reports WHERE source_id = ?',
  );
  const upsertStmt = db.prepare(
    'INSERT OR REPLACE INTO eval_reports (source_id, block_a, block_c, block_d, block_g, block_h, sources, legitimacy_verdict, verification_note, model_slug, generated_at, stale) VALUES (@source_id, @block_a, @block_c, @block_d, @block_g, @block_h, @sources, @legitimacy_verdict, @verification_note, @model_slug, @generated_at, @stale)',
  );
  const markStaleStmt = db.prepare(
    'UPDATE eval_reports SET stale = 1 WHERE source_id = ?',
  );

  return {
    get(sourceId: string): PersistedEvalReport | undefined {
      const rows = (getStmt.all?.(sourceId) ?? []) as EvalReportRow[];
      const row = rows[0];
      return row ? rowToEvalReport(row) : undefined;
    },
    upsert(report: EvalReport | PersistedEvalReport): void {
      upsertStmt.run({
        source_id: report.sourceId,
        block_a: report.blockA,
        block_c: report.blockC,
        block_d: report.blockD,
        block_g: report.blockG,
        block_h: report.blockH,
        sources: JSON.stringify(report.sources ?? []),
        legitimacy_verdict: report.legitimacyVerdict,
        verification_note: report.verificationNote,
        model_slug: report.modelSlug ?? null,
        generated_at: report.generatedAt ?? Date.now(),
        // A fresh upsert is the "regenerate" path — clear the stale flag
        // unless the caller explicitly set it on the inbound record.
        stale: 'stale' in report && report.stale ? 1 : 0,
      });
    },
    markStale(sourceId: string): void {
      markStaleStmt.run(sourceId);
    },
    deleteAll(): void {
      // Lazy-prepared so existing test fakes that don't model DELETE keep
      // working when they never call deleteAll.
      db.prepare('DELETE FROM eval_reports').run();
    },
    delete(sourceId: string): void {
      // Lazy-prepared — same pattern as deleteAll so existing test fakes
      // that don't model per-row DELETE keep working.
      db.prepare('DELETE FROM eval_reports WHERE source_id = ?').run(sourceId);
    },
  };
}

/**
 * Open a SQLite database file backing the eval-reports store. Wraps
 * `better-sqlite3` so callers don't have to import it directly. The same
 * `star.db` file is shared across the sites, jobs, match-scores,
 * match-reviews, and eval-reports stores — but each store owns its own
 * table; eval-reports and match-scores are strictly separate and never
 * joined into a single rating (Epic 6 NFR-001).
 */
export function openEvalReportsDatabase(filepath: string): EvalReportsDatabaseLike {
  return new Database(filepath) as unknown as EvalReportsDatabaseLike;
}
