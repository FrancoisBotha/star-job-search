/**
 * Tailored-docs persistence module (TAILOR-003 / Epic 7 FR-016).
 *
 * Owns the on-disk store of per-job `TailoredDoc` drafts (CV + cover letter)
 * so a draft survives an app restart and re-opening a job restores it (FR-016).
 *
 * Backed by SQLite via `better-sqlite3` on the shared `star.db` that sites /
 * jobs / preferred-models / profile / CV / match-scores all write to. The
 * module shape mirrors `sites.ts` and `matchScores.ts` — a database-like seam
 * for unit-testability, a `createTailoredDocsStore` factory, and a small
 * four-op contract (get / upsert / markStale).
 *
 * One table:
 *  - `tailored_docs` keyed by `(source_id, kind)` — one row per (job, kind),
 *    so a job's CV and cover-letter drafts coexist. JSON columns hold the
 *    array/object fields (`suggestions`, `ats_report`, `keywords`) so the
 *    schema stays tight as the inner shapes evolve.
 *
 * Provenance: each row records the base-CV version it was built from
 * (`base_cv_id`), the model used (`model_slug`), and the generation time
 * (`generated_at`) so a draft remains auditable after the user re-uploads
 * a CV (PRD FR-CV-006).
 *
 * NO `score` column: any rating/match number stays in Epic 5's `match_scores`
 * table (NFR-002 / scope boundary).
 *
 * `markStale` flags a draft without deleting it, so the renderer can still
 * surface the prior draft while flagging it as out-of-date. Callers stale a
 * single (sourceId, kind) when one draft was regenerated, or every kind for
 * a sourceId when the underlying CV/Profile changed or the job was
 * re-extracted.
 */
import Database from 'better-sqlite3';

export type TailoredDocKind = 'cv' | 'cover-letter';

export type TailoredIntensity = 'light' | 'aggressive';

/** A discrete suggestion the LLM emits alongside the tailored content
 *  (PRD FR-LLM-003). Persisted as JSON — shape stays open for the
 *  generation layer to extend without a schema migration. */
export interface TailoredSuggestion {
  id: string;
  type: string;
  gain: number;
  text: string;
  [k: string]: unknown;
}

/** ATS-readiness summary persisted alongside the draft. JSON-encoded. */
export interface AtsReport {
  score: number;
  missingKeywords: string[];
  notes?: string;
  [k: string]: unknown;
}

export interface TailoredDoc {
  sourceId: string;
  kind: TailoredDocKind;
  content: string;
  suggestions: TailoredSuggestion[];
  atsReport: AtsReport;
  keywords: string[];
  intensity: TailoredIntensity;
  /** Version id of the base CV this draft was built from — preserved
   *  across CV re-uploads for provenance (PRD FR-CV-006). */
  baseCvId: string;
  /** OpenRouter model slug used to generate the draft. */
  modelSlug: string;
  /** Generation timestamp (epoch ms). */
  generatedAt: number;
  /** True when the underlying CV/Profile changed or the job was re-extracted
   *  after generation. The prior content is preserved. */
  stale: boolean;
}

// Minimal slice of the better-sqlite3 surface we actually use — same seam
// pattern as sites.ts / matchScores.ts so this module is unit-testable
// without the native binding.
export interface TailoredDocsDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

export interface TailoredDocsStore {
  get(sourceId: string, kind: TailoredDocKind): TailoredDoc | undefined;
  upsert(doc: TailoredDoc): void;
  /** Flag a draft as stale WITHOUT deleting it. When `kind` is omitted, every
   *  draft for the sourceId is staled — used when the job is re-extracted or
   *  the base CV / Profile changes (AC5). */
  markStale(sourceId: string, kind?: TailoredDocKind): void;
}

// Composite primary key (source_id, kind) — one CV + one cover letter per job.
// NO `score` column: any numeric rating stays in match_scores (NFR-002).
const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tailored_docs (
    source_id    TEXT NOT NULL,
    kind         TEXT NOT NULL,
    content      TEXT NOT NULL,
    suggestions  TEXT NOT NULL,
    ats_report   TEXT NOT NULL,
    keywords     TEXT NOT NULL,
    intensity    TEXT NOT NULL,
    base_cv_id   TEXT NOT NULL,
    model_slug   TEXT NOT NULL,
    generated_at INTEGER NOT NULL,
    stale        INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (source_id, kind)
  )
`;

interface TailoredDocRow {
  source_id: string;
  kind: string;
  content: string;
  suggestions: string;
  ats_report: string;
  keywords: string;
  intensity: string;
  base_cv_id: string;
  model_slug: string;
  generated_at: number;
  stale: number;
}

function parseJsonOr<T>(raw: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Canonical row → TailoredDoc deserialiser. Exported so any IPC layer and
 * test/debug code decode the persisted shape identically.
 */
export function rowToTailoredDoc(row: TailoredDocRow): TailoredDoc {
  return {
    sourceId: row.source_id,
    kind: row.kind as TailoredDocKind,
    content: row.content,
    suggestions: parseJsonOr<TailoredSuggestion[]>(row.suggestions, []),
    atsReport: parseJsonOr<AtsReport>(row.ats_report, {
      score: 0,
      missingKeywords: [],
    }),
    keywords: parseJsonOr<string[]>(row.keywords, []),
    intensity: row.intensity as TailoredIntensity,
    baseCvId: row.base_cv_id,
    modelSlug: row.model_slug,
    generatedAt: row.generated_at,
    stale: row.stale !== 0,
  };
}

export function createTailoredDocsStore(
  db: TailoredDocsDatabaseLike,
): TailoredDocsStore {
  db.exec(CREATE_TABLE_SQL);

  const getStmt = db.prepare(
    'SELECT source_id, kind, content, suggestions, ats_report, keywords, intensity, base_cv_id, model_slug, generated_at, stale FROM tailored_docs WHERE source_id = ? AND kind = ?',
  );
  const upsertStmt = db.prepare(
    'INSERT OR REPLACE INTO tailored_docs (source_id, kind, content, suggestions, ats_report, keywords, intensity, base_cv_id, model_slug, generated_at, stale) VALUES (@source_id, @kind, @content, @suggestions, @ats_report, @keywords, @intensity, @base_cv_id, @model_slug, @generated_at, @stale)',
  );
  const markStaleOneStmt = db.prepare(
    'UPDATE tailored_docs SET stale = 1 WHERE source_id = ? AND kind = ?',
  );
  const markStaleAllForJobStmt = db.prepare(
    'UPDATE tailored_docs SET stale = 1 WHERE source_id = ?',
  );

  return {
    get(sourceId: string, kind: TailoredDocKind): TailoredDoc | undefined {
      const rows = (getStmt.all?.(sourceId, kind) ?? []) as TailoredDocRow[];
      const row = rows[0];
      return row ? rowToTailoredDoc(row) : undefined;
    },
    upsert(doc: TailoredDoc): void {
      upsertStmt.run({
        source_id: doc.sourceId,
        kind: doc.kind,
        content: doc.content,
        suggestions: JSON.stringify(doc.suggestions ?? []),
        ats_report: JSON.stringify(doc.atsReport ?? { score: 0, missingKeywords: [] }),
        keywords: JSON.stringify(doc.keywords ?? []),
        intensity: doc.intensity,
        base_cv_id: doc.baseCvId,
        model_slug: doc.modelSlug,
        generated_at: doc.generatedAt,
        stale: doc.stale ? 1 : 0,
      });
    },
    markStale(sourceId: string, kind?: TailoredDocKind): void {
      if (kind) markStaleOneStmt.run(sourceId, kind);
      else markStaleAllForJobStmt.run(sourceId);
    },
  };
}

/**
 * Open a SQLite database file backing the tailored-docs store. Wraps
 * `better-sqlite3` so callers don't have to import it directly — the same
 * `star.db` file is shared across all main-process stores.
 */
export function openTailoredDocsDatabase(filepath: string): TailoredDocsDatabaseLike {
  return new Database(filepath) as unknown as TailoredDocsDatabaseLike;
}
