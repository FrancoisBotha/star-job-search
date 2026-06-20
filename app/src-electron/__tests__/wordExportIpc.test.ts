/**
 * Unit tests for the Word (.docx) export IPC layer (UEXP-003 / Epic 12).
 *
 * Acceptance criteria coverage:
 *  - AC1: `registerWordExportIpc` registers `word:export` and `word:reveal`;
 *         word:export pulls the tailored doc, renders via wordExport.ts, and
 *         persists the saved .docx — returns a tagged-union result
 *         (FR-003 / FR-006).
 *  - AC2: a preload bridge exposes the call to the renderer, with matching
 *         TypeScript types in src/env.d.ts (epic §8 / §13.3).
 *  - AC3: a native save dialog is opened with a default filename derived
 *         from role/company; reveal-in-folder is offered on success.
 *  - AC4: provenance is recorded — tailored-doc version + timestamp + saved
 *         path + the optional `format: 'word'` + `filePath` extension
 *         (epic §7, additive/optional).
 *  - AC5: no submission / upload occurs — the handler only writes a local
 *         file (epic §9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobRecord } from '../jobs';
import type { TailoredDoc, TailoredDocsStore } from '../tailoredDocs';
import type {
  WordExportRecord,
  WordExportRecordsStore,
} from '../wordExportIpc';

vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Fake IPC -------------------------------------------------------------

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

// --- Fixtures -------------------------------------------------------------

function makeJob(over: Partial<JobRecord> = {}): JobRecord {
  return {
    sourceId: 'job-1',
    hostname: 'jobs.example.com',
    url: 'https://jobs.example.com/1',
    title: 'Senior Platform Engineer',
    company: 'Acme Corp',
    location: 'Remote',
    description: 'JD',
    postedAt: null,
    fetchedAt: 1,
    status: 'new',
    ...over,
  };
}

function makeDoc(over: Partial<TailoredDoc> = {}): TailoredDoc {
  return {
    sourceId: 'job-1',
    kind: 'cv',
    content: '# Tailored CV\n\n## Summary\nHello world.',
    suggestions: [],
    atsReport: { score: 100, missingKeywords: [] },
    keywords: ['kubernetes'],
    intensity: 'light',
    baseCvId: 'cv-7',
    modelSlug: 'openrouter/test',
    generatedAt: 42,
    stale: false,
    ...over,
  };
}

function makeDocsStore(docs: TailoredDoc[] = []) {
  return {
    get: (sourceId: string, kind: 'cv' | 'cover-letter') =>
      docs.find((d) => d.sourceId === sourceId && d.kind === kind),
    upsert: vi.fn(),
    markStale: vi.fn(),
  } satisfies TailoredDocsStore;
}

function makeJobsStore(jobs: JobRecord[] = [makeJob()]) {
  return {
    knownSourceIds: () => new Set(jobs.map((j) => j.sourceId)),
    upsertJobs: () => 0,
    listJobs: () => jobs,
    setStatus: vi.fn(),
    deleteAll: () => 0,
    getSiteProfile: () => undefined,
    saveSiteProfile: vi.fn(),
  };
}

function makeRecordsStore(): WordExportRecordsStore & {
  rows: WordExportRecord[];
} {
  const rows: WordExportRecord[] = [];
  return {
    rows,
    upsert: (rec: WordExportRecord) => {
      rows.push(rec);
    },
    list: (tailoredDocId?: string) =>
      tailoredDocId
        ? rows.filter((r) => r.tailoredDocId === tailoredDocId)
        : [...rows],
  };
}

function fakeDialog(filePath: string | undefined, canceled = false) {
  const calls: unknown[] = [];
  return {
    calls,
    showSaveDialog: vi.fn(
      async (opts: unknown): Promise<{ canceled: boolean; filePath?: string }> => {
        calls.push(opts);
        if (canceled) return { canceled: true };
        return filePath !== undefined
          ? { canceled: false, filePath }
          : { canceled: false };
      },
    ),
  };
}

function fakeShell() {
  return {
    showItemInFolder: vi.fn(),
  };
}

function fakeRender(buffer: Buffer = Buffer.from('PKfake-docx')) {
  const calls: unknown[] = [];
  return {
    calls,
    render: vi.fn(async (input: unknown): Promise<Buffer> => {
      calls.push(input);
      return buffer;
    }),
  };
}

function fakeWriteFile() {
  const calls: Array<{ filePath: string; bytes: number }> = [];
  return {
    calls,
    writeFile: vi.fn(async (filePath: string, buf: Buffer) => {
      calls.push({ filePath, bytes: buf.length });
    }),
  };
}

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../wordExportIpc');
}

// --- AC1: channel registration --------------------------------------------

describe('registerWordExportIpc — channel registration (AC1)', () => {
  it('registers word:export and word:reveal', async () => {
    const { registerWordExportIpc } = await importModule();
    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      render: fakeRender().render,
      dialog: fakeDialog('/out/cv.docx'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    expect(ipcHandlers.has('word:export')).toBe(true);
    expect(ipcHandlers.has('word:reveal')).toBe(true);
  });
});

// --- AC1 + AC3 + AC4 + AC5: happy path ------------------------------------

describe('word:export happy path (AC1 / AC3 / AC4 / AC5)', () => {
  it('renders the tailored doc, opens a save dialog with role/company filename, writes the .docx, and records provenance', async () => {
    const { registerWordExportIpc } = await importModule();
    const docs = makeDocsStore([
      makeDoc({ generatedAt: 99, modelSlug: 'openrouter/foo' }),
    ]);
    const jobs = makeJobsStore([
      makeJob({ title: 'Senior Platform Engineer', company: 'Acme Corp' }),
    ]);
    const records = makeRecordsStore();
    const render = fakeRender();
    const dialog = fakeDialog('C:/Users/me/Documents/cv.docx');
    const shell = fakeShell();
    const writes = fakeWriteFile();

    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: docs,
      jobsStore: jobs as never,
      recordsStore: records,
      render: render.render,
      dialog,
      shell,
      writeFile: writes.writeFile,
      now: () => 12345,
    });

    const result = (await ipcHandlers.get('word:export')!(
      {},
      { tailoredDocId: 'job-1', opts: { locale: 'en-US' } },
    )) as { ok: true; record: WordExportRecord } | { ok: false; code: string };

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // AC3: dialog was opened with a default filename derived from role/company.
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1);
    const opts = dialog.calls[0] as { defaultPath?: string };
    expect(opts.defaultPath).toMatch(/Senior[_-]?Platform[_-]?Engineer/i);
    expect(opts.defaultPath).toMatch(/Acme[_-]?Corp/i);
    expect(opts.defaultPath).toMatch(/\.docx$/);

    // Render was invoked (no LLM / no network) with the CV slice.
    expect(render.render).toHaveBeenCalledTimes(1);
    expect(writes.writeFile).toHaveBeenCalledWith(
      'C:/Users/me/Documents/cv.docx',
      expect.any(Buffer),
    );

    // AC4: provenance record persisted with format='word' + filePath.
    expect(records.rows).toHaveLength(1);
    const rec = records.rows[0]!;
    expect(rec.tailoredDocId).toBe('job-1');
    expect(rec.tailoredDocVersion).toBe(99);
    expect(rec.modelSlug).toBe('openrouter/foo');
    expect(rec.exportedAt).toBe(12345);
    expect(rec.savedPath).toBe('C:/Users/me/Documents/cv.docx');
    expect(rec.format).toBe('word');
    expect(rec.filePath).toBe('C:/Users/me/Documents/cv.docx');

    // The handler's returned record matches the persisted one.
    expect(result.record.savedPath).toBe('C:/Users/me/Documents/cv.docx');
  });
});

// --- AC1: stable error codes ----------------------------------------------

describe('word:export stable error codes (AC1)', () => {
  it('returns NO_DOC when the tailored draft does not exist', async () => {
    const { registerWordExportIpc } = await importModule();
    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      render: fakeRender().render,
      dialog: fakeDialog('/out/cv.docx'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    const result = (await ipcHandlers.get('word:export')!(
      {},
      { tailoredDocId: 'no-such-job' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_DOC');
  });

  it('returns RENDER_ERROR when the .docx renderer throws', async () => {
    const { registerWordExportIpc } = await importModule();
    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      render: vi.fn(async () => {
        throw new Error('docx serialiser failed');
      }),
      dialog: fakeDialog('/out/cv.docx'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    const result = (await ipcHandlers.get('word:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('RENDER_ERROR');
  });

  it('returns IO_ERROR when writing the .docx to disk fails', async () => {
    const { registerWordExportIpc } = await importModule();
    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      render: fakeRender().render,
      dialog: fakeDialog('/out/cv.docx'),
      shell: fakeShell(),
      writeFile: vi.fn(async () => {
        throw new Error('EACCES: permission denied');
      }),
    });
    const result = (await ipcHandlers.get('word:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.code).toBe('IO_ERROR');
  });

  it('never throws — a thrown error in render resolves to a tagged-union failure', async () => {
    const { registerWordExportIpc } = await importModule();
    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      render: vi.fn(async () => {
        throw new Error('boom');
      }),
      dialog: fakeDialog('/out/cv.docx'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    const result = (await ipcHandlers.get('word:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

// --- AC3: reveal-in-folder ------------------------------------------------

describe('word:reveal (AC3)', () => {
  it('calls shell.showItemInFolder on the supplied path', async () => {
    const { registerWordExportIpc } = await importModule();
    const shell = fakeShell();
    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      render: fakeRender().render,
      dialog: fakeDialog('/out/cv.docx'),
      shell,
      writeFile: fakeWriteFile().writeFile,
    });
    await ipcHandlers.get('word:reveal')!({}, '/some/path/cv.docx');
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/some/path/cv.docx');
  });
});

// --- AC3: save dialog cancellation ----------------------------------------

describe('word:export user cancellation (AC3)', () => {
  it('returns ok:false without writing or recording when the user cancels the dialog', async () => {
    const { registerWordExportIpc } = await importModule();
    const records = makeRecordsStore();
    const writes = fakeWriteFile();
    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: records,
      render: fakeRender().render,
      dialog: fakeDialog(undefined, true),
      shell: fakeShell(),
      writeFile: writes.writeFile,
    });
    const result = (await ipcHandlers.get('word:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(writes.writeFile).not.toHaveBeenCalled();
    expect(records.rows).toHaveLength(0);
  });
});

// --- AC5: no submission / no network --------------------------------------

describe('word:export performs no submission / network call (AC5)', () => {
  it('only calls the injected render + writeFile + dialog + records — no other side effects', async () => {
    const { registerWordExportIpc } = await importModule();
    const render = fakeRender();
    const writes = fakeWriteFile();
    registerWordExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      render: render.render,
      dialog: fakeDialog('/out/cv.docx'),
      shell: fakeShell(),
      writeFile: writes.writeFile,
    });
    await ipcHandlers.get('word:export')!({}, { tailoredDocId: 'job-1' });
    expect(render.render).toHaveBeenCalledTimes(1);
    expect(writes.writeFile).toHaveBeenCalledTimes(1);
  });
});

// --- Preload / env.d.ts surface (AC2 type contract) -----------------------

describe('preload bridge surface (AC2)', () => {
  it('declares window.starWord in env.d.ts and exposes it in the preload', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const envDts = readFileSync(
      path.resolve(here, '..', '..', 'src', 'env.d.ts'),
      'utf8',
    );
    expect(envDts).toMatch(/starWord\?:\s*StarWordApi/);
    expect(envDts).toMatch(/StarWordErrorCode/);
    expect(envDts).toMatch(/'NO_DOC'/);
    expect(envDts).toMatch(/'RENDER_ERROR'/);
    expect(envDts).toMatch(/'IO_ERROR'/);
    // AC4: optional format provenance surfaced through the typed bridge.
    expect(envDts).toMatch(/format:\s*'word'/);

    const preload = readFileSync(
      path.resolve(here, '..', 'electron-preload.ts'),
      'utf8',
    );
    expect(preload).toMatch(/exposeInMainWorld\(['"]starWord['"]/);
    expect(preload).toMatch(/word:export/);
    expect(preload).toMatch(/word:reveal/);
  });
});
