/**
 * Word (.docx) export IPC runtime (UEXP-003 / Epic 12 Unified Export).
 *
 * Wires the UEXP-002 `.docx` renderer (`wordExport.ts`) into the renderer
 * through two IPC channels:
 *
 *   word:export({ tailoredDocId, opts? }) — looks up the cached TailoredDoc
 *     (CV + optional cover letter) for the current tab, renders it via the
 *     injected `render` function, opens a native `dialog.showSaveDialog`
 *     with a default filename derived from the job's role/company
 *     (epic §6 / FR-006), writes the `.docx` buffer to the chosen path,
 *     and records provenance — tailored-doc version + model + timestamp +
 *     saved path + the additive `format: 'word'` / `filePath` fields
 *     described in epic §7.
 *
 *   word:reveal(absolutePath) — `shell.showItemInFolder` on the saved
 *     `.docx`, so the renderer can offer a "Show in folder" affordance.
 *
 * Both handlers return a TAGGED-UNION result. Stable error codes:
 *
 *   NO_DOC         — no TailoredDoc for tailoredDocId
 *   RENDER_ERROR   — the `.docx` renderer threw (input mismatch, serialiser
 *                    bug)
 *   IO_ERROR       — writing the file (or the user-cancellation pseudo-error)
 *
 * Hard boundary (AC5 / epic §9): this module opens NO egress. It never
 * imports an LLM, never reaches the network, and never submits the document
 * anywhere. Star writes one local file and stops.
 *
 * Design note: mirrors `pdfExportIpc.ts` so the renderer can call both
 * surfaces through identical-shaped bridges.
 */
import type { IpcMain } from 'electron';

import type { JobsStore, JobRecord } from './jobs';
import type { TailoredDoc, TailoredDocsStore } from './tailoredDocs';
import type { ContactBlock, WordExportInput } from './wordExport';
import { tailoredCvFromDoc } from './pdfExportIpc';

export type WordExportErrorCode = 'NO_DOC' | 'RENDER_ERROR' | 'IO_ERROR';

/** The export format mirror — epic §7 additive provenance. Today the IPC
 *  only writes `.docx`; the union shape lets the future markdown / pdf
 *  unification land without breaking the record. */
export type WordExportFormat = 'markdown' | 'word' | 'pdf';

export interface WordExportOpts {
  /** BCP-47 locale tag. US/CA → US Letter, anything else → A4. Defaults to
   *  A4 when omitted. */
  locale?: string;
}

export interface WordExportInputMsg {
  /** Source-id of the tailored draft to export. The CV draft is the
   *  primary payload; the cover letter is bundled when present. */
  tailoredDocId: string;
  opts?: WordExportOpts;
}

/** Persisted provenance record for one successful Word export (epic §7). */
export interface WordExportRecord {
  id: string;
  tailoredDocId: string;
  /** `generatedAt` of the source TailoredDoc — pins this export to the
   *  exact draft version that produced it. */
  tailoredDocVersion: number;
  /** OpenRouter model slug that generated the tailored draft. */
  modelSlug: string;
  /** Epoch ms when the file was written to disk. */
  exportedAt: number;
  /** Absolute on-disk path of the saved file (mirrors PdfExportRecord). */
  savedPath: string;
  /** Optional / additive (epic §7): the export format. Always `'word'`
   *  from this IPC; declared as the open union so a future ticket can
   *  fold markdown / pdf provenance into the same record without a
   *  shape change. */
  format: WordExportFormat;
  /** Optional / additive (epic §7): explicit `filePath` mirror of
   *  `savedPath`, named to match the epic §7 record description. */
  filePath: string;
}

export type WordExportResult =
  | { ok: true; record: WordExportRecord }
  | { ok: false; code: WordExportErrorCode; error: string };

/** Persistence seam so this module is unit-testable without SQLite. */
export interface WordExportRecordsStore {
  upsert(record: WordExportRecord): void;
  list(tailoredDocId?: string): WordExportRecord[];
}

/** Minimal slice of Electron's `dialog` used here — declared structurally
 *  so tests can inject a fake. */
export interface WordExportDialog {
  showSaveDialog(opts: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

/** Minimal slice of Electron's `shell` used here. */
export interface WordExportShell {
  showItemInFolder(fullPath: string): void;
}

export interface WordExportIpcDeps {
  docsStore: TailoredDocsStore;
  jobsStore: JobsStore;
  recordsStore: WordExportRecordsStore;
  /** Injected renderer — bound to `renderTailoredDocToDocx` in
   *  electron-main.ts so tests can drive the IPC without invoking the
   *  `docx` library. */
  render: (input: WordExportInput) => Promise<Buffer>;
  dialog: WordExportDialog;
  shell: WordExportShell;
  writeFile: (filePath: string, data: Buffer) => Promise<void>;
  /** Injectable for deterministic timestamps in tests. */
  now?: () => number;
}

// --- Helpers --------------------------------------------------------------

const FILENAME_UNSAFE = /[^A-Za-z0-9._-]+/g;

/** Build a default filename like `Senior_Platform_Engineer-Acme_Corp.docx`.
 *  Falls back to the sourceId when the job has no role/company on file. */
export function buildDefaultWordFilename(job: JobRecord | undefined): string {
  const role = (job?.title ?? '').trim();
  const company = (job?.company ?? '').trim();
  const parts = [role, company].filter(Boolean);
  const stem = parts.length
    ? parts.map((p) => p.replace(FILENAME_UNSAFE, '_').replace(/^_+|_+$/g, '')).join('-')
    : `tailored-${job?.sourceId ?? 'cv'}`;
  return `${stem || 'tailored-cv'}.docx`;
}

/** Markdown → structured CoverLetter, mirroring `pdfExportIpc`. */
function coverLetterFromDoc(
  doc: TailoredDoc,
): NonNullable<WordExportInput['coverLetter']> {
  const lines = doc.content.split(/\r?\n/);
  const trimmedFront = lines.findIndex(
    (l) => l.trim() && !l.trim().startsWith('#'),
  );
  const body = (trimmedFront === -1 ? lines : lines.slice(trimmedFront))
    .join('\n')
    .trim();
  const paragraphs = body.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  const opening = paragraphs[0] ?? '';
  const closing = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1]! : '';
  const middle = paragraphs.length > 2 ? paragraphs.slice(1, -1) : [];
  return {
    opening,
    body: middle,
    closing,
    keywords: doc.keywords ?? [],
  };
}

function contactFromJob(job: JobRecord | undefined): ContactBlock | undefined {
  if (!job) return undefined;
  const out: ContactBlock = {};
  if (job.location) out.location = job.location;
  return Object.keys(out).length ? out : undefined;
}

const IO_HINTS = /(EACCES|EPERM|ENOSPC|EROFS|ENOENT|write.*file)/i;

function classifyRenderOrIoError(err: unknown): {
  code: WordExportErrorCode;
  error: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  if (IO_HINTS.test(message)) {
    return { code: 'IO_ERROR', error: message };
  }
  return { code: 'RENDER_ERROR', error: message };
}

// --- Registration ---------------------------------------------------------

export function registerWordExportIpc(
  ipcMain: IpcMain,
  deps: WordExportIpcDeps,
): void {
  const now = deps.now ?? (() => Date.now());

  ipcMain.handle(
    'word:export',
    async (_event, input: WordExportInputMsg): Promise<WordExportResult> => {
      try {
        if (!input || typeof input.tailoredDocId !== 'string' || !input.tailoredDocId) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: 'word:export requires a non-empty tailoredDocId.',
          };
        }

        const cvDoc = deps.docsStore.get(input.tailoredDocId, 'cv');
        const coverDoc = deps.docsStore.get(input.tailoredDocId, 'cover-letter');
        const sourceDoc = cvDoc ?? coverDoc;
        if (!sourceDoc) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: `No tailored draft found for "${input.tailoredDocId}".`,
          };
        }

        const job = deps.jobsStore
          .listJobs()
          .find((j) => j.sourceId === input.tailoredDocId);

        const wordInput: WordExportInput = {
          cv: cvDoc
            ? tailoredCvFromDoc(cvDoc)
            : {
                summary: sourceDoc.content,
                competencies: [],
                achievementBullets: [],
                keywords: sourceDoc.keywords ?? [],
                suggestions: [],
                gaps: [],
              },
        };
        if (input.opts?.locale) wordInput.locale = input.opts.locale;
        if (coverDoc) wordInput.coverLetter = coverLetterFromDoc(coverDoc);
        const contact = contactFromJob(job);
        if (contact) wordInput.contact = contact;

        let buffer: Buffer;
        try {
          buffer = await deps.render(wordInput);
        } catch (err) {
          return { ok: false, ...classifyRenderOrIoError(err) };
        }

        const defaultName = buildDefaultWordFilename(job);
        const dialogResult = await deps.dialog.showSaveDialog({
          title: 'Export tailored CV as Word document',
          defaultPath: defaultName,
          filters: [{ name: 'Word Document', extensions: ['docx'] }],
        });
        if (dialogResult.canceled || !dialogResult.filePath) {
          return {
            ok: false,
            code: 'IO_ERROR',
            error: 'Export cancelled by user.',
          };
        }

        try {
          await deps.writeFile(dialogResult.filePath, buffer);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, code: 'IO_ERROR', error: message };
        }

        const exportedAt = now();
        const record: WordExportRecord = {
          id: `wordx-${input.tailoredDocId}-${exportedAt}`,
          tailoredDocId: input.tailoredDocId,
          tailoredDocVersion: sourceDoc.generatedAt,
          modelSlug: sourceDoc.modelSlug,
          exportedAt,
          savedPath: dialogResult.filePath,
          format: 'word',
          filePath: dialogResult.filePath,
        };
        deps.recordsStore.upsert(record);
        return { ok: true, record };
      } catch (err) {
        return { ok: false, ...classifyRenderOrIoError(err) };
      }
    },
  );

  ipcMain.handle('word:reveal', async (_event, fullPath: string): Promise<void> => {
    if (typeof fullPath === 'string' && fullPath) {
      deps.shell.showItemInFolder(fullPath);
    }
  });
}

// --- In-memory provenance store (default) ---------------------------------

/** Default in-memory `WordExportRecordsStore` — fine for the MVP. A future
 *  ticket can promote this to a SQLite table without changing the IPC. */
export function createInMemoryWordExportRecordsStore(): WordExportRecordsStore {
  const rows: WordExportRecord[] = [];
  return {
    upsert(record: WordExportRecord): void {
      rows.push(record);
    },
    list(tailoredDocId?: string): WordExportRecord[] {
      return tailoredDocId
        ? rows.filter((r) => r.tailoredDocId === tailoredDocId)
        : [...rows];
    },
  };
}
