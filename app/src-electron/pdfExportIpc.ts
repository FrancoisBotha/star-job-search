/**
 * PDF-export IPC runtime (PDFEX-004 / Epic 8).
 *
 * Wires the PDFEX-002 LaTeX renderer + Tectonic compile into the renderer via
 * two IPC channels:
 *
 *   pdf:export({ tailoredDocId, opts? }) — looks up the cached TailoredDoc,
 *     compiles it via `compileTailoredDocToPdf`, opens a native
 *     `dialog.showSaveDialog` with a default filename derived from the job's
 *     role/company (FR-007), writes the PDF buffer to the chosen path, and
 *     records provenance (tailored-doc version + model + timestamp + saved
 *     path + page size — FR-007 / epic §7).
 *
 *   pdf:reveal(absolutePath) — `shell.showItemInFolder` on the saved PDF.
 *
 * Both handlers return a TAGGED-UNION result. Stable error codes:
 *
 *   NO_DOC             — no TailoredDoc for tailoredDocId
 *   COMPILE_ERROR      — engine ran but failed (bad LaTeX, exit != 0, timeout)
 *   TOOLCHAIN_MISSING  — bundled Tectonic engine not found / not bundled
 *   IO_ERROR           — writing the PDF to disk failed
 *
 * Hard boundary (AC6 / FR-008): this module opens NO egress. It never imports
 * an LLM, never reaches the network, and never submits the document anywhere.
 * Star writes one local file and stops.
 */
import type { IpcMain } from 'electron';

import type { JobsStore, JobRecord } from './jobs';
import type {
  CompileOpts,
  CompileResult,
  ContactBlock,
  PdfExportInput,
} from './pdfExport';
import type { TailoredDoc, TailoredDocsStore } from './tailoredDocs';

export type PdfExportPageSize = 'letter' | 'a4';

export type PdfExportErrorCode =
  | 'NO_DOC'
  | 'COMPILE_ERROR'
  | 'TOOLCHAIN_MISSING'
  | 'IO_ERROR';

export interface PdfExportOpts {
  pageSize?: PdfExportPageSize;
}

export interface PdfExportInputMsg {
  /** Sourceid of the tailored draft to export. The CV draft is the primary
   *  payload; the cover letter is bundled when present. */
  tailoredDocId: string;
  opts?: PdfExportOpts;
}

/** Persisted provenance record for one successful PDF export (epic §7). */
export interface PdfExportRecord {
  id: string;
  tailoredDocId: string;
  /** `generatedAt` of the source TailoredDoc — pins this export to the exact
   *  draft version that produced it (PRD FR-CV-006 / FR-007). */
  tailoredDocVersion: number;
  /** OpenRouter model slug that generated the tailored draft. */
  modelSlug: string;
  /** Epoch ms when the PDF was written to disk. */
  exportedAt: number;
  /** Absolute on-disk path of the saved PDF. */
  savedPath: string;
  /** Page size requested for this export. */
  pageSize: PdfExportPageSize;
}

export type PdfExportResult =
  | { ok: true; record: PdfExportRecord }
  | { ok: false; code: PdfExportErrorCode; error: string };

/** A small persistence seam so this module is unit-testable without SQLite. */
export interface PdfExportRecordsStore {
  upsert(record: PdfExportRecord): void;
  list(tailoredDocId?: string): PdfExportRecord[];
}

/** Minimal slice of Electron's `dialog` used here — declared as a structural
 *  type so tests can inject a fake. */
export interface PdfExportDialog {
  showSaveDialog(opts: {
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePath?: string }>;
}

/** Minimal slice of Electron's `shell` used here. */
export interface PdfExportShell {
  showItemInFolder(fullPath: string): void;
}

export interface PdfExportIpcDeps {
  docsStore: TailoredDocsStore;
  jobsStore: JobsStore;
  recordsStore: PdfExportRecordsStore;
  /** Injected compile function — bound to `compileTailoredDocToPdf` in
   *  electron-main.ts so tests can drive the IPC without invoking Tectonic. */
  compile: (input: PdfExportInput, opts?: CompileOpts) => Promise<CompileResult>;
  dialog: PdfExportDialog;
  shell: PdfExportShell;
  writeFile: (filePath: string, data: Buffer) => Promise<void>;
  /** Injectable for deterministic timestamps in tests. */
  now?: () => number;
}

// --- Helpers --------------------------------------------------------------

const FILENAME_UNSAFE = /[^A-Za-z0-9._-]+/g;

/** Build a default filename like `Senior_Platform_Engineer-Acme_Corp.pdf`.
 *  Falls back to the sourceId when the job has no role/company on file. */
export function buildDefaultFilename(job: JobRecord | undefined): string {
  const role = (job?.title ?? '').trim();
  const company = (job?.company ?? '').trim();
  const parts = [role, company].filter(Boolean);
  const stem = parts.length
    ? parts.map((p) => p.replace(FILENAME_UNSAFE, '_').replace(/^_+|_+$/g, '')).join('-')
    : `tailored-${job?.sourceId ?? 'cv'}`;
  return `${stem || 'tailored-cv'}.pdf`;
}

/** Pull every line under `## Summary` (until the next H2 / EOF). The Markdown
 *  produced by TAILOR-004 is the source of truth — this is a render-only
 *  parse, no rewording (FR-002). Falls back to the entire content. */
function extractMarkdownSection(content: string, heading: string): string {
  const re = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s+|\\Z)`, 'im');
  const match = re.exec(content);
  return (match?.[1] ?? '').trim();
}

function extractListItems(block: string): string[] {
  return block
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('- '))
    .map((l) => l.slice(2).trim())
    .filter(Boolean);
}

/**
 * Convert a persisted TailoredDoc (CV-kind, Markdown content) back into the
 * structured shape the PDFEX-002 renderer expects. Render-only: no claims are
 * invented — fields not present in the Markdown stay empty.
 */
export function tailoredCvFromDoc(doc: TailoredDoc): PdfExportInput['cv'] {
  const summarySection = extractMarkdownSection(doc.content, 'Summary');
  const competenciesSection = extractMarkdownSection(doc.content, 'Core competencies');
  const achievementsSection = extractMarkdownSection(doc.content, 'Achievements');
  return {
    summary: summarySection || doc.content,
    competencies: extractListItems(competenciesSection),
    achievementBullets: extractListItems(achievementsSection),
    keywords: doc.keywords ?? [],
    suggestions: [],
    gaps: [],
  };
}

function coverLetterFromDoc(
  doc: TailoredDoc,
): NonNullable<PdfExportInput['coverLetter']> {
  const lines = doc.content.split(/\r?\n/);
  // Drop the leading "# Cover letter" heading + leading blank lines.
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

const TOOLCHAIN_HINTS = /(bundled latex engine|not bundled|engine not found|tectonic)/i;
const COMPILE_HINTS = /(latex|compile|exited with code|timed out|engine output|tex)/i;
const IO_HINTS = /(EACCES|EPERM|ENOSPC|EROFS|ENOENT.*open|write.*file)/i;

function classifyExportError(err: unknown): {
  code: PdfExportErrorCode;
  error: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  if (TOOLCHAIN_HINTS.test(message)) {
    return { code: 'TOOLCHAIN_MISSING', error: message };
  }
  if (IO_HINTS.test(message)) {
    return { code: 'IO_ERROR', error: message };
  }
  if (COMPILE_HINTS.test(message)) {
    return { code: 'COMPILE_ERROR', error: message };
  }
  return { code: 'COMPILE_ERROR', error: message };
}

// --- Registration ---------------------------------------------------------

export function registerPdfExportIpc(
  ipcMain: IpcMain,
  deps: PdfExportIpcDeps,
): void {
  const now = deps.now ?? (() => Date.now());

  ipcMain.handle(
    'pdf:export',
    async (_event, input: PdfExportInputMsg): Promise<PdfExportResult> => {
      try {
        if (!input || typeof input.tailoredDocId !== 'string' || !input.tailoredDocId) {
          return {
            ok: false,
            code: 'NO_DOC',
            error: 'pdf:export requires a non-empty tailoredDocId.',
          };
        }
        const pageSize: PdfExportPageSize =
          input.opts?.pageSize === 'letter' ? 'letter' : 'a4';

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

        const pdfInput: PdfExportInput = {
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
          locale: pageSize === 'letter' ? 'en-US' : 'en-GB',
        };
        if (coverDoc) {
          pdfInput.coverLetter = coverLetterFromDoc(coverDoc);
        }
        const contact = contactFromJob(job);
        if (contact) pdfInput.contact = contact;

        let compiled: CompileResult;
        try {
          compiled = await deps.compile(pdfInput);
        } catch (err) {
          return { ok: false, ...classifyExportError(err) };
        }

        const defaultName = buildDefaultFilename(job);
        const dialogResult = await deps.dialog.showSaveDialog({
          title: 'Export tailored CV as PDF',
          defaultPath: defaultName,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (dialogResult.canceled || !dialogResult.filePath) {
          return {
            ok: false,
            code: 'IO_ERROR',
            error: 'Export cancelled by user.',
          };
        }

        try {
          await deps.writeFile(dialogResult.filePath, compiled.pdf);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { ok: false, code: 'IO_ERROR', error: message };
        }

        const exportedAt = now();
        const record: PdfExportRecord = {
          id: `pdfx-${input.tailoredDocId}-${exportedAt}`,
          tailoredDocId: input.tailoredDocId,
          tailoredDocVersion: sourceDoc.generatedAt,
          modelSlug: sourceDoc.modelSlug,
          exportedAt,
          savedPath: dialogResult.filePath,
          pageSize,
        };
        deps.recordsStore.upsert(record);
        return { ok: true, record };
      } catch (err) {
        return { ok: false, ...classifyExportError(err) };
      }
    },
  );

  ipcMain.handle('pdf:reveal', async (_event, fullPath: string): Promise<void> => {
    if (typeof fullPath === 'string' && fullPath) {
      deps.shell.showItemInFolder(fullPath);
    }
  });
}

// --- In-memory provenance store (default) ---------------------------------

/** Default in-memory `PdfExportRecordsStore` — fine for the MVP. Provenance
 *  is also implicitly recorded by the saved PDF's filesystem mtime; a future
 *  ticket can promote this to a SQLite table without changing the IPC. */
export function createInMemoryPdfExportRecordsStore(): PdfExportRecordsStore {
  const rows: PdfExportRecord[] = [];
  return {
    upsert(record: PdfExportRecord): void {
      rows.push(record);
    },
    list(tailoredDocId?: string): PdfExportRecord[] {
      return tailoredDocId
        ? rows.filter((r) => r.tailoredDocId === tailoredDocId)
        : [...rows];
    },
  };
}
