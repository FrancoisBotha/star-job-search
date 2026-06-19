/**
 * Unit tests for CVPROF-014: Clear CV (delete current CV) end-to-end.
 *
 * Acceptance criteria:
 *  1. Profile CV card shows a 'Clear' affordance alongside 'Replace' when a
 *     CV exists.
 *  2. Clearing deletes every CV row for the profile AND unlinks the on-disk
 *     binaries (no orphan rows or files).
 *  3. Store resets `currentCv` to null and `cvParseStatus` / `cvParseError`
 *     to idle.
 *  4. (Persistence) Backed by SQLite — the cleared state survives because
 *     the rows are physically removed (covered by AC2's row-delete check).
 *  5. Clearing marks dependent AI match-reviews stale (the same
 *     markAllReviewsStale hook that the upload path uses).
 *  6. The destructive action is guarded by a confirm step.
 *  7. Regression: row + file removed, state reset.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- Fake DB mirrors the cv.test.ts fixture but adds DELETE support --------

interface CvRow {
  id: string;
  profile_id: string;
  file_name: string;
  mime: string;
  storage_path: string;
  parsed_text: string | null;
  parsed_fields: string | null;
  version: number;
  confidence: number | null;
  uploaded_at: number;
}

class FakeDatabase {
  rows: CvRow[] = [];
  exec(_sql: string) {}
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+INTO\s+cv/i.test(text)) {
      return {
        run: (params: CvRow) => {
          this.rows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^DELETE\s+FROM\s+cv\s+WHERE\s+profile_id/i.test(text)) {
      return {
        run: (profileId: string) => {
          const before = this.rows.length;
          this.rows = this.rows.filter((r) => r.profile_id !== profileId);
          return { changes: before - this.rows.length };
        },
      };
    }
    if (/^SELECT.*MAX\(version\)/i.test(text)) {
      return {
        all: (profileId: string) => {
          const versions = this.rows.filter((r) => r.profile_id === profileId).map((r) => r.version);
          return [{ max_version: versions.length ? Math.max(...versions) : null }];
        },
        run: () => ({ changes: 0 }),
      };
    }
    if (/^SELECT.*FROM\s+cv\s+WHERE\s+id\s*=/i.test(text)) {
      return {
        all: (id: string) => this.rows.filter((r) => r.id === id),
        run: () => ({ changes: 0 }),
      };
    }
    if (/^SELECT.*FROM\s+cv.*WHERE\s+profile_id/i.test(text)) {
      return {
        all: (profileId: string) =>
          [...this.rows]
            .filter((r) => r.profile_id === profileId)
            .sort((a, b) => b.version - a.version),
        run: () => ({ changes: 0 }),
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

let tmpRoot: string;
let sourceDir: string;

beforeEach(() => {
  ipcHandlers.clear();
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'cvprof-014-'));
  sourceDir = mkdtempSync(path.join(tmpdir(), 'cvprof-014-src-'));
});

afterEach(() => {
  vi.resetModules();
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(sourceDir, { recursive: true, force: true });
});

function writeSourceFile(name: string, contents: Buffer | string): string {
  const p = path.join(sourceDir, name);
  writeFileSync(p, contents);
  return p;
}

function fakeExtractor(text = 'parsed cv text') {
  return vi.fn(async (input: { filePath: string; mime: 'pdf' | 'docx' }) => ({
    text,
    mime: input.mime,
    chars: text.length,
  }));
}

async function importModule() {
  return await import('../cv');
}

// --- AC2 / AC7: store.clear removes rows AND files -------------------------

describe('createCvStore.clear — removes rows AND files (AC2/AC7)', () => {
  it('deletes every CV row for the profile and unlinks the on-disk binaries', async () => {
    const { createCvStore } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor(),
    });

    const src1 = writeSourceFile('one.pdf', Buffer.from('one'));
    const src2 = writeSourceFile('two.pdf', Buffer.from('two'));
    const v1 = await store.upload({ filePath: src1, fileName: 'one.pdf', mime: 'pdf' });
    const v2 = await store.upload({ filePath: src2, fileName: 'two.pdf', mime: 'pdf' });

    const abs1 = path.resolve(tmpRoot, v1.storagePath);
    const abs2 = path.resolve(tmpRoot, v2.storagePath);
    expect(existsSync(abs1)).toBe(true);
    expect(existsSync(abs2)).toBe(true);

    const result = await store.clear();
    expect(result.removedRows).toBe(2);
    expect(result.removedFiles).toBe(2);

    expect(db.rows).toHaveLength(0);
    expect(existsSync(abs1)).toBe(false);
    expect(existsSync(abs2)).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('is a no-op when there is no CV for the profile', async () => {
    const { createCvStore } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor(),
    });
    const result = await store.clear();
    expect(result.removedRows).toBe(0);
    expect(result.removedFiles).toBe(0);
  });
});

// --- AC2: cv:clear IPC handler is registered -------------------------------

describe('registerCvIpc — cv:clear handler (AC2)', () => {
  it('registers cv:clear handler that invokes store.clear', async () => {
    const { createCvStore, registerCvIpc } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor(),
    });
    registerCvIpc(fakeIpcMain as never, store);
    expect(ipcHandlers.has('cv:clear')).toBe(true);

    const src = writeSourceFile('cv.pdf', Buffer.from('x'));
    await store.upload({ filePath: src, fileName: 'cv.pdf', mime: 'pdf' });
    const result = (await (ipcHandlers.get('cv:clear') as (...a: unknown[]) => Promise<unknown>)(
      {},
      undefined,
    )) as { removedRows: number; removedFiles: number };
    expect(result.removedRows).toBe(1);
    expect(result.removedFiles).toBe(1);
    expect(db.rows).toHaveLength(0);
  });
});

// --- AC5: main wires clear with markAllReviewsStale ------------------------

describe('electron-main wires clear → markAllReviewsStale (AC5)', () => {
  it('the cv store wrapper calls markAllReviewsStale on clear', () => {
    const mainSrc = readFileSync(
      path.resolve(__dirname, '..', 'electron-main.ts'),
      'utf8',
    );
    // The cv-store wrapper that hooks the review-stale call must override
    // `clear` as well as `upload` (AC5).
    expect(mainSrc).toMatch(/clear\s*:\s*async/);
    // The wrapper block names markAllReviewsStale within sight of the clear
    // method — same hook the upload path uses.
    const clearBlock = mainSrc.match(/clear\s*:\s*async[\s\S]{0,400}/);
    expect(clearBlock).not.toBeNull();
    expect(clearBlock![0]).toMatch(/markAllReviewsStale/);
  });
});

// --- AC1 / AC6: Profile page shows Clear with a confirm guard --------------

describe('ProfilePage — Clear affordance + confirm guard (AC1, AC6)', () => {
  const SRC = readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'pages', 'ProfilePage.vue'),
    'utf8',
  );

  it('renders a "Clear" button alongside "Replace" when a CV exists', () => {
    expect(SRC).toMatch(/label="Clear"/);
    expect(SRC).toMatch(/label="Replace"/);
  });

  it('routes the click through a confirm guard (q-dialog or window.confirm)', () => {
    // Accept either a q-dialog v-model toggle or a native confirm call —
    // both satisfy the "destructive action is guarded" requirement.
    expect(SRC).toMatch(/q-dialog|window\.confirm|confirm\(/);
  });

  it('invokes store.clearCv on confirmation', () => {
    expect(SRC).toMatch(/store\.clearCv\(/);
  });
});

// --- AC1: preload + env.d.ts expose `clear` on starCv ----------------------

describe('Preload + env.d.ts surface for cv:clear', () => {
  it('preload bridge exposes starCv.clear', () => {
    const preloadSrc = readFileSync(
      path.resolve(__dirname, '..', 'electron-preload.ts'),
      'utf8',
    );
    expect(preloadSrc).toMatch(/cv:clear/);
  });

  it('env.d.ts declares clear on StarCvApi', () => {
    const envSrc = readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'env.d.ts'),
      'utf8',
    );
    expect(envSrc).toMatch(/clear\s*:\s*\(/);
  });
});

// --- AC3 / AC4: app-store wires a clearCv action that resets CV state ------

describe('app-store.clearCv action (AC3/AC4)', () => {
  const STORE_SRC = readFileSync(
    path.resolve(__dirname, '..', '..', 'src', 'stores', 'app-store.ts'),
    'utf8',
  );

  it('declares a clearCv action on the store', () => {
    expect(STORE_SRC).toMatch(/clearCv\s*\(/);
  });

  it('calls window.starCv.clear in the action body', () => {
    const block = STORE_SRC.match(/clearCv[\s\S]{0,800}/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/starCv|bridge\.clear|\.clear\(\)/);
  });

  it('resets currentCv, cvs, cvParseStatus and cvParseError', () => {
    const block = STORE_SRC.match(/clearCv[\s\S]{0,800}/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/currentCv\s*=\s*null/);
    expect(block![0]).toMatch(/cvs\s*=\s*\[\]/);
    expect(block![0]).toMatch(/cvParseStatus\s*=\s*['"]idle['"]/);
    expect(block![0]).toMatch(/cvParseError\s*=\s*null/);
  });
});
