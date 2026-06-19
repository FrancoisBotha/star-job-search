/**
 * Unit tests for the PDF-export IPC layer (PDFEX-004).
 *
 * Acceptance criteria coverage:
 *  - AC1: registerPdfExportIpc registers `pdf:export` and `pdf:reveal`;
 *         pdf:export pulls the tailored doc, compiles via pdfExport.ts,
 *         and persists the saved PDF.
 *  - AC2: handlers return a tagged-union result with stable error codes —
 *         NO_DOC / COMPILE_ERROR / TOOLCHAIN_MISSING / IO_ERROR — and never
 *         throw raw errors across the IPC boundary.
 *  - AC3: a native save dialog is opened with a default filename derived
 *         from role/company (FR-007).
 *  - AC4: reveal-in-folder uses shell.showItemInFolder on the saved path.
 *  - AC5: provenance (tailored-doc version + model + timestamp, saved path
 *         + page size) is recorded per PdfExportRecord (FR-007 / §7).
 *  - AC6: Star makes no LLM / network call — only writes the local PDF
 *         file (FR-008, epic §9).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobRecord } from '../jobs';
import type { TailoredDoc, TailoredDocsStore } from '../tailoredDocs';
import type { CompileResult, PdfExportInput } from '../pdfExport';
import type {
  PdfExportRecord,
  PdfExportRecordsStore,
} from '../pdfExportIpc';

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

function makeRecordsStore(): PdfExportRecordsStore & { rows: PdfExportRecord[] } {
  const rows: PdfExportRecord[] = [];
  return {
    rows,
    upsert: (rec: PdfExportRecord) => {
      rows.push(rec);
    },
    list: (tailoredDocId?: string) =>
      tailoredDocId ? rows.filter((r) => r.tailoredDocId === tailoredDocId) : [...rows],
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

function fakeCompile(
  result: CompileResult = { pdf: Buffer.from('%PDF-1.4\n'), durationMs: 1 },
) {
  const calls: PdfExportInput[] = [];
  return {
    calls,
    compile: vi.fn(async (input: PdfExportInput): Promise<CompileResult> => {
      calls.push(input);
      return result;
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
  return await import('../pdfExportIpc');
}

// --- AC1: channel registration --------------------------------------------

describe('registerPdfExportIpc — channel registration (AC1)', () => {
  it('registers pdf:export and pdf:reveal', async () => {
    const { registerPdfExportIpc } = await importModule();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      compile: fakeCompile().compile,
      dialog: fakeDialog('/out/cv.pdf'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    expect(ipcHandlers.has('pdf:export')).toBe(true);
    expect(ipcHandlers.has('pdf:reveal')).toBe(true);
  });
});

// --- AC1 + AC3 + AC5 + AC6: happy path ------------------------------------

describe('pdf:export happy path (AC1 / AC3 / AC5 / AC6)', () => {
  it('compiles the tailored doc, opens a save dialog with role/company filename, writes the PDF, and records provenance', async () => {
    const { registerPdfExportIpc } = await importModule();
    const docs = makeDocsStore([
      makeDoc({ generatedAt: 99, modelSlug: 'openrouter/foo' }),
    ]);
    const jobs = makeJobsStore([
      makeJob({ title: 'Senior Platform Engineer', company: 'Acme Corp' }),
    ]);
    const records = makeRecordsStore();
    const compile = fakeCompile();
    const dialog = fakeDialog('C:/Users/me/Documents/cv.pdf');
    const shell = fakeShell();
    const writes = fakeWriteFile();

    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: docs,
      jobsStore: jobs as never,
      recordsStore: records,
      compile: compile.compile,
      dialog,
      shell,
      writeFile: writes.writeFile,
      now: () => 12345,
    });

    const result = (await ipcHandlers.get('pdf:export')!(
      {},
      { tailoredDocId: 'job-1', opts: { pageSize: 'letter' } },
    )) as { ok: true; record: PdfExportRecord } | { ok: false; code: string };

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // AC3: dialog was opened with a default filename derived from role/company.
    expect(dialog.showSaveDialog).toHaveBeenCalledTimes(1);
    const opts = dialog.calls[0] as { defaultPath?: string };
    expect(opts.defaultPath).toMatch(/Senior[_-]?Platform[_-]?Engineer/i);
    expect(opts.defaultPath).toMatch(/Acme[_-]?Corp/i);
    expect(opts.defaultPath).toMatch(/\.pdf$/);

    // Compile was invoked (no LLM / no network).
    expect(compile.compile).toHaveBeenCalledTimes(1);
    expect(writes.writeFile).toHaveBeenCalledWith(
      'C:/Users/me/Documents/cv.pdf',
      expect.any(Buffer),
    );

    // AC5: provenance record persisted.
    expect(records.rows).toHaveLength(1);
    const rec = records.rows[0]!;
    expect(rec.tailoredDocId).toBe('job-1');
    expect(rec.tailoredDocVersion).toBe(99);
    expect(rec.modelSlug).toBe('openrouter/foo');
    expect(rec.exportedAt).toBe(12345);
    expect(rec.savedPath).toBe('C:/Users/me/Documents/cv.pdf');
    expect(rec.pageSize).toBe('letter');

    // The handler's returned record matches the persisted one.
    expect(result.record.savedPath).toBe('C:/Users/me/Documents/cv.pdf');
  });
});

// --- AC2: stable error codes ----------------------------------------------

describe('pdf:export stable error codes (AC2)', () => {
  it('returns NO_DOC when the tailored draft does not exist', async () => {
    const { registerPdfExportIpc } = await importModule();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      compile: fakeCompile().compile,
      dialog: fakeDialog('/out/cv.pdf'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    const result = (await ipcHandlers.get('pdf:export')!(
      {},
      { tailoredDocId: 'no-such-job' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_DOC');
  });

  it('returns TOOLCHAIN_MISSING when the bundled LaTeX engine is missing', async () => {
    const { registerPdfExportIpc } = await importModule();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      compile: vi.fn(async () => {
        throw new Error('Bundled LaTeX engine not found at /tmp/x');
      }),
      dialog: fakeDialog('/out/cv.pdf'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    const result = (await ipcHandlers.get('pdf:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('TOOLCHAIN_MISSING');
  });

  it('returns COMPILE_ERROR when the engine itself fails', async () => {
    const { registerPdfExportIpc } = await importModule();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      compile: vi.fn(async () => {
        throw new Error('LaTeX engine exited with code 1.');
      }),
      dialog: fakeDialog('/out/cv.pdf'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    const result = (await ipcHandlers.get('pdf:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.code).toBe('COMPILE_ERROR');
  });

  it('returns IO_ERROR when writing the PDF to disk fails', async () => {
    const { registerPdfExportIpc } = await importModule();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      compile: fakeCompile().compile,
      dialog: fakeDialog('/out/cv.pdf'),
      shell: fakeShell(),
      writeFile: vi.fn(async () => {
        throw new Error('EACCES: permission denied');
      }),
    });
    const result = (await ipcHandlers.get('pdf:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.code).toBe('IO_ERROR');
  });

  it('never throws — a thrown error in compile resolves to a tagged-union failure', async () => {
    const { registerPdfExportIpc } = await importModule();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      compile: vi.fn(async () => {
        throw new Error('boom');
      }),
      dialog: fakeDialog('/out/cv.pdf'),
      shell: fakeShell(),
      writeFile: fakeWriteFile().writeFile,
    });
    const result = (await ipcHandlers.get('pdf:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false };
    expect(result.ok).toBe(false);
  });
});

// --- AC4: reveal-in-folder ------------------------------------------------

describe('pdf:reveal (AC4)', () => {
  it('calls shell.showItemInFolder on the supplied path', async () => {
    const { registerPdfExportIpc } = await importModule();
    const shell = fakeShell();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      compile: fakeCompile().compile,
      dialog: fakeDialog('/out/cv.pdf'),
      shell,
      writeFile: fakeWriteFile().writeFile,
    });
    await ipcHandlers.get('pdf:reveal')!({}, '/some/path/cv.pdf');
    expect(shell.showItemInFolder).toHaveBeenCalledWith('/some/path/cv.pdf');
  });
});

// --- AC3: save dialog cancellation ----------------------------------------

describe('pdf:export user cancellation (AC3)', () => {
  it('returns ok:false without writing or recording when the user cancels the dialog', async () => {
    const { registerPdfExportIpc } = await importModule();
    const records = makeRecordsStore();
    const writes = fakeWriteFile();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: records,
      compile: fakeCompile().compile,
      dialog: fakeDialog(undefined, true),
      shell: fakeShell(),
      writeFile: writes.writeFile,
    });
    const result = (await ipcHandlers.get('pdf:export')!(
      {},
      { tailoredDocId: 'job-1' },
    )) as { ok: false; code: string };
    expect(result.ok).toBe(false);
    expect(writes.writeFile).not.toHaveBeenCalled();
    expect(records.rows).toHaveLength(0);
  });
});

// --- AC6: no network call -------------------------------------------------

describe('pdf:export performs no submission / network call (AC6)', () => {
  it('only calls the injected compile + writeFile + dialog + records — no other side effects', async () => {
    const { registerPdfExportIpc } = await importModule();
    const compile = fakeCompile();
    const writes = fakeWriteFile();
    registerPdfExportIpc(fakeIpcMain as never, {
      docsStore: makeDocsStore([makeDoc()]),
      jobsStore: makeJobsStore() as never,
      recordsStore: makeRecordsStore(),
      compile: compile.compile,
      dialog: fakeDialog('/out/cv.pdf'),
      shell: fakeShell(),
      writeFile: writes.writeFile,
    });
    await ipcHandlers.get('pdf:export')!({}, { tailoredDocId: 'job-1' });
    expect(compile.compile).toHaveBeenCalledTimes(1);
    expect(writes.writeFile).toHaveBeenCalledTimes(1);
  });
});

// --- Preload / env.d.ts surface (AC2 type contract) -----------------------

describe('preload bridge surface (AC2)', () => {
  it('declares window.starPdf in env.d.ts and exposes it in the preload', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const envDts = readFileSync(
      path.resolve(here, '..', '..', 'src', 'env.d.ts'),
      'utf8',
    );
    expect(envDts).toMatch(/starPdf\?:\s*StarPdfApi/);
    expect(envDts).toMatch(/StarPdfErrorCode/);
    expect(envDts).toMatch(/'NO_DOC'/);
    expect(envDts).toMatch(/'COMPILE_ERROR'/);
    expect(envDts).toMatch(/'TOOLCHAIN_MISSING'/);
    expect(envDts).toMatch(/'IO_ERROR'/);

    const preload = readFileSync(
      path.resolve(here, '..', 'electron-preload.ts'),
      'utf8',
    );
    expect(preload).toMatch(/exposeInMainWorld\(['"]starPdf['"]/);
    expect(preload).toMatch(/pdf:export/);
    expect(preload).toMatch(/pdf:reveal/);
  });
});
