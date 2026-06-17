/**
 * Off-thread CV text extractor (CVPROF-002).
 *
 * Turns a local PDF or DOCX file into plain text WITHOUT blocking the
 * Electron main / UI thread. The bytes are read locally and parsed inside
 * a `node:worker_threads` Worker — the file is never uploaded to do the
 * extraction (NFR-001/002).
 *
 * Public surface:
 *   extractCvText({ filePath, mime, signal?, onProgress? }, deps?) → { text, mime, chars }
 *   class CvExtractionError extends Error  (code + retryable fields)
 *
 * The runtime is dependency-injected so the orchestration can be unit
 * tested without dragging the actual `pdfjs-dist` / `mammoth` packages
 * into the test environment, and so a later ticket can swap in a custom
 * runner (e.g. Electron utilityProcess) without changing the call sites.
 *
 * The default off-thread runner spawns a Worker that lazily imports
 * `pdfjs-dist/legacy/build/pdf.mjs` (Node-friendly build) or `mammoth`
 * inside the worker — keeping these heavy parsers off the main thread
 * and out of the cold-start path until the user actually uploads a CV.
 */
import { readFile as fsReadFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';

export type CvMime = 'pdf' | 'docx';

export type CvExtractErrorCode =
  | 'UNSUPPORTED_MIME'
  | 'FILE_NOT_FOUND'
  | 'READ_FAILED'
  | 'PARSE_FAILED'
  | 'ABORTED';

export class CvExtractionError extends Error {
  public readonly code: CvExtractErrorCode;
  public readonly retryable: boolean;
  constructor(
    code: CvExtractErrorCode,
    message: string,
    opts: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'CvExtractionError';
    this.code = code;
    this.retryable = opts.retryable ?? false;
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

export interface CvExtractProgress {
  phase: 'start' | 'read' | 'parse' | 'done';
  mime: CvMime;
  /** 0..1 for in-progress parsing phases; absent otherwise. */
  percent?: number;
  /** Final character count, present on `done`. */
  chars?: number;
}

export interface ExtractCvTextInput {
  filePath: string;
  mime: CvMime;
  signal?: AbortSignal;
  onProgress?: (e: CvExtractProgress) => void;
}

export interface ExtractCvTextResult {
  text: string;
  mime: CvMime;
  chars: number;
}

export interface ParseTask {
  mime: CvMime;
  data: Buffer;
}

export interface CvExtractorDeps {
  /** File read. Defaults to fs/promises.readFile. */
  readFile?: (filePath: string) => Promise<Buffer>;
  /**
   * Off-thread parser. Receives the raw bytes + mime and resolves with
   * extracted plain text. Defaults to a worker_threads-backed runner.
   */
  parseOffThread?: (task: ParseTask) => Promise<string>;
}

const SUPPORTED: ReadonlyArray<CvMime> = ['pdf', 'docx'];

function isSupportedMime(value: unknown): value is CvMime {
  return typeof value === 'string' && (SUPPORTED as readonly string[]).includes(value);
}

export async function extractCvText(
  input: ExtractCvTextInput,
  deps: CvExtractorDeps = {},
): Promise<ExtractCvTextResult> {
  if (!isSupportedMime(input.mime)) {
    throw new CvExtractionError(
      'UNSUPPORTED_MIME',
      `Unsupported file type "${String(input.mime)}". Only PDF and DOCX are supported.`,
      { retryable: false },
    );
  }
  const mime: CvMime = input.mime;
  const onProgress = input.onProgress;

  onProgress?.({ phase: 'start', mime });
  throwIfAborted(input.signal);

  let buf: Buffer;
  try {
    buf = await (deps.readFile ?? fsReadFile)(input.filePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    const errCode: CvExtractErrorCode = code === 'ENOENT' ? 'FILE_NOT_FOUND' : 'READ_FAILED';
    throw new CvExtractionError(
      errCode,
      `Failed to read CV file at ${input.filePath}: ${(err as Error).message}`,
      { retryable: errCode === 'READ_FAILED', cause: err },
    );
  }

  onProgress?.({ phase: 'read', mime });
  throwIfAborted(input.signal);

  const runner = deps.parseOffThread ?? defaultOffThreadRunner;
  let text: string;
  try {
    onProgress?.({ phase: 'parse', mime });
    text = await runner({ mime, data: buf });
  } catch (err) {
    throw new CvExtractionError(
      'PARSE_FAILED',
      `Failed to parse ${mime.toUpperCase()}: ${(err as Error).message}`,
      { retryable: true, cause: err },
    );
  }

  onProgress?.({ phase: 'done', mime, chars: text.length });
  return { text, mime, chars: text.length };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CvExtractionError('ABORTED', 'Extraction aborted by caller', {
      retryable: true,
    });
  }
}

/**
 * Worker source — executed inside a node:worker_threads Worker via
 * `{ eval: true }` so this module stays a single file at bundle time
 * (Electron / Vite friendly). The worker lazily imports the parser
 * matching the task's mime, so neither parser is loaded on the main
 * thread.
 */
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
if (!parentPort) process.exit(1);

async function parsePdf(buf) {
  // pdfjs-dist exposes a legacy Node-friendly build under
  // 'pdfjs-dist/legacy/build/pdf.mjs'. We import it dynamically so the
  // dependency is only resolved when a PDF is actually parsed.
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const getDocument = pdfjs.getDocument || (pdfjs.default && pdfjs.default.getDocument);
  if (!getDocument) throw new Error('pdfjs-dist getDocument unavailable');
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const doc = await getDocument({ data, disableFontFace: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it) => (typeof it.str === 'string' ? it.str : '')).join(' ');
    pages.push(text);
  }
  try { await doc.cleanup(); } catch (_) {}
  return pages.join('\\n\\n').trim();
}

async function parseDocx(buf) {
  const mammoth = await import('mammoth');
  const fn = (mammoth.extractRawText || (mammoth.default && mammoth.default.extractRawText));
  if (!fn) throw new Error('mammoth.extractRawText unavailable');
  const out = await fn({ buffer: buf });
  return String(out && out.value ? out.value : '').trim();
}

parentPort.on('message', async (task) => {
  try {
    const buf = Buffer.isBuffer(task.data)
      ? task.data
      : Buffer.from(task.data.buffer || task.data);
    const text = task.mime === 'pdf' ? await parsePdf(buf) : await parseDocx(buf);
    parentPort.postMessage({ ok: true, text: text });
  } catch (err) {
    parentPort.postMessage({ ok: false, message: (err && err.message) ? err.message : String(err) });
  }
});
`;

/**
 * Default off-thread runner. Each call spawns a single-use Worker, posts
 * the task, awaits the response, then terminates the worker. The Worker
 * is single-use to keep the lifecycle trivial and avoid worker-pool
 * complexity for what is, in practice, a once-per-upload operation.
 */
export async function defaultOffThreadRunner(task: ParseTask): Promise<string> {
  const worker = new Worker(WORKER_SOURCE, { eval: true });
  try {
    return await new Promise<string>((resolve, reject) => {
      worker.on('message', (msg: { ok: boolean; text?: string; message?: string }) => {
        if (msg && msg.ok) resolve(String(msg.text ?? ''));
        else reject(new Error(msg?.message ?? 'Unknown worker error'));
      });
      worker.on('error', (err) => reject(err));
      worker.on('exit', (code) => {
        if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
      });
      worker.postMessage(task);
    });
  } finally {
    try {
      await worker.terminate();
    } catch {
      /* best-effort */
    }
  }
}
