/**
 * Unit tests for the CV persistence module (CVPROF-003).
 *
 * Covers the ticket acceptance criteria:
 *  - AC1: creates the CV table with the epic §7 columns
 *  - AC2: accepts PDF/DOCX, rejects other types and >10MB files
 *  - AC3: binary written under the storage root; metadata + parsed text in DB;
 *         extraction is performed via an injected extractor (CVPROF-002)
 *  - AC4: re-upload ("Replace") creates a NEW versioned row (version++) and
 *         retains prior versions
 *  - AC5: cv:upload / cv:list / cv:get IPC handlers are registered
 *  - AC7: the persisted storagePath is portable (relative, forward-slash)
 *         so it does not embed an OS-specific absolute prefix
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock 'better-sqlite3' so tests do not require the native binding.
vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Fake in-memory database mimicking the small better-sqlite3 surface ---

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
  exec(_sql: string) {
    /* CREATE TABLE — nothing to do for the fake */
  }
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
    if (/^SELECT.*MAX\(version\)/i.test(text)) {
      return {
        all: (profileId: string) => {
          const versions = this.rows
            .filter((r) => r.profile_id === profileId)
            .map((r) => r.version);
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

// --- IPC mock --------------------------------------------------------------

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
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'cvprof-003-'));
  sourceDir = mkdtempSync(path.join(tmpdir(), 'cvprof-003-src-'));
});

afterEach(() => {
  vi.resetModules();
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(sourceDir, { recursive: true, force: true });
});

async function importModule() {
  return await import('../cv');
}

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

// --- Tests -----------------------------------------------------------------

describe('createCvStore — table + persistence (AC1, AC3)', () => {
  it('AC1: CREATE TABLE statement defines the epic §7 columns', async () => {
    const { createCvStore } = await importModule();
    const execSpy = vi.fn();
    const db = new FakeDatabase();
    const wrapped = {
      exec: (sql: string) => {
        execSpy(sql);
        db.exec(sql);
      },
      prepare: db.prepare.bind(db),
    };
    createCvStore(wrapped as never, { storageRoot: tmpRoot, extractor: fakeExtractor() });
    const ddl = execSpy.mock.calls.map((c) => c[0]).join('\n');
    for (const col of [
      'id',
      'profile_id',
      'file_name',
      'mime',
      'storage_path',
      'parsed_text',
      'parsed_fields',
      'version',
      'confidence',
      'uploaded_at',
    ]) {
      expect(ddl).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });

  it('AC3: upload writes the binary under storageRoot and stores parsedText in DB', async () => {
    const { createCvStore } = await importModule();
    const db = new FakeDatabase();
    const extractor = fakeExtractor('hello cv');
    const store = createCvStore(db as never, { storageRoot: tmpRoot, extractor });

    const src = writeSourceFile('alex.pdf', Buffer.from('%PDF-1.4 fake'));
    const rec = await store.upload({ filePath: src, fileName: 'alex.pdf', mime: 'pdf' });

    expect(extractor).toHaveBeenCalledOnce();
    expect(rec.parsedText).toBe('hello cv');
    expect(rec.mime).toBe('pdf');
    expect(rec.fileName).toBe('alex.pdf');
    expect(rec.version).toBe(1);

    const abs = path.resolve(tmpRoot, rec.storagePath);
    expect(abs.startsWith(path.resolve(tmpRoot))).toBe(true);
    expect(readFileSync(abs).toString()).toBe('%PDF-1.4 fake');

    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.parsed_text).toBe('hello cv');
  });
});

describe('upload — validation (AC2)', () => {
  it('AC2: rejects unsupported mime with a clear message', async () => {
    const { createCvStore } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor(),
    });
    const src = writeSourceFile('notes.txt', 'plain text');
    await expect(
      store.upload({ filePath: src, fileName: 'notes.txt', mime: 'txt' as never }),
    ).rejects.toThrow(/PDF|DOCX/i);
  });

  it('AC2: rejects files larger than 10MB', async () => {
    const { createCvStore } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor(),
    });
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    const src = writeSourceFile('big.pdf', big);
    await expect(
      store.upload({ filePath: src, fileName: 'big.pdf', mime: 'pdf' }),
    ).rejects.toThrow(/10\s*MB|too large/i);
  });

  it('AC2: accepts a DOCX upload', async () => {
    const { createCvStore } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor('docx text'),
    });
    const src = writeSourceFile('cv.docx', Buffer.from('PK fake docx'));
    const rec = await store.upload({ filePath: src, fileName: 'cv.docx', mime: 'docx' });
    expect(rec.mime).toBe('docx');
    expect(rec.parsedText).toBe('docx text');
  });
});

describe('upload — versioning (AC4)', () => {
  it('AC4: replacing creates a new versioned row and retains prior versions', async () => {
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

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v1.id).not.toBe(v2.id);
    expect(v1.storagePath).not.toBe(v2.storagePath);

    const list = store.list();
    expect(list).toHaveLength(2);
    // newest first
    expect(list[0]!.version).toBe(2);
    expect(list[1]!.version).toBe(1);
  });
});

describe('AC7: portable storagePath', () => {
  it('persists storagePath as a relative, forward-slash path', async () => {
    const { createCvStore } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor(),
    });
    const src = writeSourceFile('cv.pdf', Buffer.from('x'));
    const rec = await store.upload({ filePath: src, fileName: 'cv.pdf', mime: 'pdf' });

    // No absolute prefix.
    expect(path.isAbsolute(rec.storagePath)).toBe(false);
    // No backslashes — forward-slash separators only, even on Windows.
    expect(rec.storagePath).not.toMatch(/\\/);
    expect(rec.storagePath.startsWith('cv/')).toBe(true);
  });
});

describe('registerCvIpc — IPC channels (AC5)', () => {
  it('AC5: registers cv:upload, cv:list, cv:get handlers', async () => {
    const { createCvStore, registerCvIpc } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor(),
    });
    registerCvIpc(fakeIpcMain as never, store);
    expect(ipcHandlers.has('cv:upload')).toBe(true);
    expect(ipcHandlers.has('cv:list')).toBe(true);
    expect(ipcHandlers.has('cv:get')).toBe(true);
  });

  it('AC5: cv:upload returns the new CV record', async () => {
    const { createCvStore, registerCvIpc } = await importModule();
    const db = new FakeDatabase();
    const store = createCvStore(db as never, {
      storageRoot: tmpRoot,
      extractor: fakeExtractor('hi'),
    });
    registerCvIpc(fakeIpcMain as never, store);

    const src = writeSourceFile('cv.pdf', Buffer.from('x'));
    const rec = (await (ipcHandlers.get('cv:upload') as (...a: unknown[]) => Promise<unknown>)(
      {},
      { filePath: src, fileName: 'cv.pdf', mime: 'pdf' },
    )) as { parsedText: string; version: number };
    expect(rec.parsedText).toBe('hi');
    expect(rec.version).toBe(1);
  });
});

describe('AC5: createWindow wiring registers cv:* handlers', () => {
  it('electron-main.ts registers cv:upload/list/get via registerCvIpc', () => {
    const mainSrc = readFileSync(
      path.resolve(__dirname, '..', 'electron-main.ts'),
      'utf8',
    );
    expect(mainSrc).toMatch(/registerCvIpc/);
    expect(mainSrc).toMatch(/from\s+['"]\.\/cv['"]/);
  });
});

describe('AC6: preload bridge + env.d.ts type', () => {
  it('exposes window.starCv with upload/list/get', () => {
    const preloadSrc = readFileSync(
      path.resolve(__dirname, '..', 'electron-preload.ts'),
      'utf8',
    );
    expect(preloadSrc).toMatch(/exposeInMainWorld\(['"]starCv['"]/);
    expect(preloadSrc).toMatch(/cv:upload/);
    expect(preloadSrc).toMatch(/cv:list/);
    expect(preloadSrc).toMatch(/cv:get/);
  });

  it('env.d.ts declares StarCvApi on Window', () => {
    const envSrc = readFileSync(
      path.resolve(__dirname, '..', '..', 'src', 'env.d.ts'),
      'utf8',
    );
    expect(envSrc).toMatch(/starCv\??:\s*StarCvApi/);
    expect(envSrc).toMatch(/interface\s+StarCvApi/);
  });
});
