/**
 * Unit tests for the tailored-docs persistence module (TAILOR-003).
 *
 * Covers acceptance criteria:
 *  - AC1: tailored_docs table is created on star.db, keyed by (sourceId, kind),
 *         persisting the §7 TailoredDoc shape: content, suggestions, atsReport,
 *         keywords, intensity, baseCvId, modelSlug, generatedAt, stale.
 *  - AC2: the table has NO `score` column — any rating stays in Epic 5's
 *         match_scores (NFR-002).
 *  - AC3: get / upsert / markStale operations exist, mirroring sites.ts.
 *         Re-opening a job restores its draft (FR-016).
 *  - AC4: drafts record the base-CV version (baseCvId), modelSlug, and a
 *         timestamp (generatedAt) for provenance (FR-016, PRD FR-CV-006).
 *  - AC5: markStale flags a draft (without deleting it) when the base CV /
 *         profile changes or the job is re-extracted.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

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

class FakeDatabase {
  rows: TailoredDocRow[] = [];
  execCalls: string[] = [];
  exec(sql: string) {
    this.execCalls.push(sql);
  }
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+OR\s+REPLACE\s+INTO\s+tailored_docs/i.test(text)) {
      return {
        run: (params: TailoredDocRow) => {
          const idx = this.rows.findIndex(
            (r) => r.source_id === params.source_id && r.kind === params.kind,
          );
          if (idx >= 0) this.rows.splice(idx, 1);
          this.rows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^UPDATE\s+tailored_docs\s+SET\s+stale\s*=\s*1\s+WHERE\s+source_id\s*=\s*\?\s+AND\s+kind\s*=\s*\?/i.test(text)) {
      return {
        run: (sourceId: string, kind: string) => {
          const row = this.rows.find(
            (r) => r.source_id === sourceId && r.kind === kind,
          );
          if (!row) return { changes: 0 };
          row.stale = 1;
          return { changes: 1 };
        },
      };
    }
    if (/^UPDATE\s+tailored_docs\s+SET\s+stale\s*=\s*1\s+WHERE\s+source_id\s*=\s*\?$/i.test(text)) {
      return {
        run: (sourceId: string) => {
          let n = 0;
          for (const row of this.rows) {
            if (row.source_id === sourceId) {
              row.stale = 1;
              n++;
            }
          }
          return { changes: n };
        },
      };
    }
    if (/^SELECT[\s\S]+FROM\s+tailored_docs\s+WHERE\s+source_id\s*=\s*\?\s+AND\s+kind\s*=\s*\?/i.test(text)) {
      return {
        all: (sourceId: string, kind: string) =>
          this.rows.filter((r) => r.source_id === sourceId && r.kind === kind),
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

async function importModule() {
  return await import('../tailoredDocs');
}

afterEach(() => {
  vi.resetModules();
});

function makeDoc(
  overrides: Partial<{
    sourceId: string;
    kind: 'cv' | 'cover-letter';
    content: string;
    suggestions: Array<{ id: string; type: string; gain: number; text: string }>;
    atsReport: { score: number; missingKeywords: string[]; notes: string };
    keywords: string[];
    intensity: 'light' | 'aggressive';
    baseCvId: string;
    modelSlug: string;
    generatedAt: number;
    stale: boolean;
  }> = {},
) {
  return {
    sourceId: 'job-1',
    kind: 'cv' as 'cv' | 'cover-letter',
    content: '# Tailored CV\nBody text...',
    suggestions: [
      { id: 's1', type: 'Keyword', gain: 5, text: 'Add "kubernetes"' },
    ],
    atsReport: { score: 82, missingKeywords: ['terraform'], notes: 'good' },
    keywords: ['typescript', 'node'],
    intensity: 'light' as 'light' | 'aggressive',
    baseCvId: 'cv-v3',
    modelSlug: 'openai/gpt-4o-mini',
    generatedAt: 1_700_000_000_000,
    stale: false,
    ...overrides,
  };
}

// --- AC1 / AC2: schema ----------------------------------------------------

describe('tailored_docs schema (AC1, AC2)', () => {
  it('creates a tailored_docs table on the shared star.db', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    createTailoredDocsStore(db as never);
    const ddl = db.execCalls.find((s) => /tailored_docs/i.test(s));
    expect(ddl).toBeDefined();
    expect(ddl!).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+tailored_docs/i);
  });

  it('declares a composite primary key (source_id, kind) and the §7 TailoredDoc columns', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    createTailoredDocsStore(db as never);
    const ddl = db.execCalls.find((s) => /tailored_docs/i.test(s))!;
    expect(ddl).toMatch(/source_id/i);
    expect(ddl).toMatch(/kind/i);
    expect(ddl).toMatch(/content/i);
    expect(ddl).toMatch(/suggestions/i);
    expect(ddl).toMatch(/ats_report/i);
    expect(ddl).toMatch(/keywords/i);
    expect(ddl).toMatch(/intensity/i);
    expect(ddl).toMatch(/base_cv_id/i);
    expect(ddl).toMatch(/model_slug/i);
    expect(ddl).toMatch(/generated_at/i);
    expect(ddl).toMatch(/stale/i);
    // Composite primary key — order doesn't matter, but both fields must be in it.
    expect(ddl).toMatch(/PRIMARY\s+KEY\s*\(\s*source_id\s*,\s*kind\s*\)/i);
  });

  it('does NOT include a score column — ratings stay in Epic 5 match_scores (NFR-002)', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    createTailoredDocsStore(db as never);
    const ddl = db.execCalls.find((s) => /tailored_docs/i.test(s))!;
    // No bare "score" column (we still permit "ats_report" which contains the substring).
    expect(ddl).not.toMatch(/\bscore\s+(REAL|INTEGER|TEXT|NUMERIC)/i);
  });
});

// --- AC3 / AC4: get / upsert / provenance --------------------------------

describe('get / upsert + provenance round-trip (AC3, AC4)', () => {
  it('upsert persists a TailoredDoc and get(sourceId, kind) returns it', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);

    const doc = makeDoc();
    store.upsert(doc);

    const got = store.get('job-1', 'cv');
    expect(got).toBeDefined();
    expect(got!.sourceId).toBe('job-1');
    expect(got!.kind).toBe('cv');
    expect(got!.content).toBe(doc.content);
    expect(got!.intensity).toBe('light');
    expect(got!.stale).toBe(false);
  });

  it('get returns undefined for an unknown (sourceId, kind)', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);
    expect(store.get('missing', 'cv')).toBeUndefined();
  });

  it('records baseCvId, modelSlug and generatedAt for provenance (FR-CV-006)', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);

    store.upsert(
      makeDoc({
        baseCvId: 'cv-version-7',
        modelSlug: 'anthropic/claude-opus-4-7',
        generatedAt: 1_725_000_000_000,
      }),
    );

    const got = store.get('job-1', 'cv')!;
    expect(got.baseCvId).toBe('cv-version-7');
    expect(got.modelSlug).toBe('anthropic/claude-opus-4-7');
    expect(got.generatedAt).toBe(1_725_000_000_000);
  });

  it('round-trips suggestions[], atsReport, and keywords[] through the JSON columns', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);

    const doc = makeDoc({
      suggestions: [
        { id: 's1', type: 'Keyword', gain: 5, text: 'Add "kubernetes"' },
        { id: 's2', type: 'Reword', gain: 3, text: 'Clarify ownership' },
      ],
      atsReport: { score: 73, missingKeywords: ['kafka', 'snowflake'], notes: 'ok' },
      keywords: ['typescript', 'aws', 'terraform'],
    });
    store.upsert(doc);

    const got = store.get('job-1', 'cv')!;
    expect(got.suggestions).toEqual(doc.suggestions);
    expect(got.atsReport).toEqual(doc.atsReport);
    expect(got.keywords).toEqual(doc.keywords);
  });

  it('cv and cover-letter for the same job coexist (composite key)', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);

    store.upsert(makeDoc({ kind: 'cv', content: 'CV body' }));
    store.upsert(makeDoc({ kind: 'cover-letter', content: 'Cover letter body' }));

    expect(store.get('job-1', 'cv')!.content).toBe('CV body');
    expect(store.get('job-1', 'cover-letter')!.content).toBe('Cover letter body');
  });

  it('upsert on existing (sourceId, kind) replaces the row — no duplicates', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);

    store.upsert(makeDoc({ content: 'first' }));
    store.upsert(makeDoc({ content: 'second' }));

    expect(store.get('job-1', 'cv')!.content).toBe('second');
  });

  it('reopening the job restores the persisted draft (FR-016)', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();

    const store1 = createTailoredDocsStore(db as never);
    store1.upsert(
      makeDoc({ sourceId: 'persisted-job', content: 'Restore me' }),
    );

    // Fresh store on the same backing DB simulates an app restart.
    const store2 = createTailoredDocsStore(db as never);
    const got = store2.get('persisted-job', 'cv');
    expect(got).toBeDefined();
    expect(got!.content).toBe('Restore me');
  });
});

// --- AC5: markStale -------------------------------------------------------

describe('markStale (AC5)', () => {
  it('markStale(sourceId, kind) flips stale=true without deleting the row', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);

    store.upsert(makeDoc({ content: 'still here' }));
    store.markStale('job-1', 'cv');

    const got = store.get('job-1', 'cv');
    expect(got).toBeDefined();
    expect(got!.stale).toBe(true);
    expect(got!.content).toBe('still here');
  });

  it('markStale(sourceId) without a kind stales every draft for that job (re-extraction case)', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);

    store.upsert(makeDoc({ kind: 'cv' }));
    store.upsert(makeDoc({ kind: 'cover-letter' }));

    store.markStale('job-1');

    expect(store.get('job-1', 'cv')!.stale).toBe(true);
    expect(store.get('job-1', 'cover-letter')!.stale).toBe(true);
  });

  it('markStale is a no-op for unknown ids (does not throw)', async () => {
    const { createTailoredDocsStore } = await importModule();
    const db = new FakeDatabase();
    const store = createTailoredDocsStore(db as never);
    expect(() => store.markStale('nope', 'cv')).not.toThrow();
    expect(() => store.markStale('nope')).not.toThrow();
  });
});
