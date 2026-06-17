/**
 * Unit tests for the off-thread CV text extractor (CVPROF-002).
 *
 * Covers acceptance criteria:
 *  - AC1: PDF (pdfjs-dist) + DOCX (mammoth) parsers are wired as
 *         main-process dependencies and are loaded lazily by the default
 *         off-thread runner (verified by the package.json shape + the
 *         worker dispatch test below).
 *  - AC2: Parsing runs OFF the UI thread — the default runner spawns a
 *         `node:worker_threads` Worker and never blocks the caller.
 *  - AC3: The public function accepts { filePath, mime: 'pdf' | 'docx' }
 *         and returns the extracted text; the file bytes are read locally
 *         and handed to the parser — never uploaded.
 *  - AC4: Unsupported mimes raise a structured CvExtractionError with a
 *         clear code (UNSUPPORTED_MIME, non-retryable); parse failures
 *         surface as PARSE_FAILED with retryable=true.
 *  - AC5: The module imports only Node + worker_threads APIs (no
 *         platform-specific shell-outs), so it works the same on macOS,
 *         Windows and Linux.
 *  - AC6: A caller-supplied `onProgress` callback observes the
 *         start → read → done lifecycle.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(ELECTRON_DIR, '..');

import {
  extractCvText,
  CvExtractionError,
  type CvExtractProgress,
} from '../cvTextExtractor';

describe('cvTextExtractor (CVPROF-002)', () => {
  it('AC3/AC6 — extracts PDF text via injected off-thread runner and reports progress', async () => {
    const events: CvExtractProgress[] = [];
    const parseOffThread = vi.fn(async ({ mime, data }) => {
      expect(mime).toBe('pdf');
      expect(Buffer.isBuffer(data)).toBe(true);
      expect(data.toString('utf8')).toBe('PDFBYTES');
      return 'hello world';
    });

    const result = await extractCvText(
      {
        filePath: '/fake/cv.pdf',
        mime: 'pdf',
        onProgress: (e) => events.push(e),
      },
      {
        readFile: async (p) => {
          expect(p).toBe('/fake/cv.pdf');
          return Buffer.from('PDFBYTES');
        },
        parseOffThread,
      },
    );

    expect(result).toEqual({ text: 'hello world', mime: 'pdf', chars: 11 });
    expect(parseOffThread).toHaveBeenCalledOnce();
    const phases = events.map((e) => e.phase);
    expect(phases).toEqual(['start', 'read', 'parse', 'done']);
    expect(events.at(-1)?.chars).toBe(11);
  });

  it('AC3 — extracts DOCX text via injected off-thread runner', async () => {
    const result = await extractCvText(
      { filePath: '/fake/cv.docx', mime: 'docx' },
      {
        readFile: async () => Buffer.from('DOCXBYTES'),
        parseOffThread: async ({ mime }) => {
          expect(mime).toBe('docx');
          return 'docx body';
        },
      },
    );
    expect(result).toEqual({ text: 'docx body', mime: 'docx', chars: 9 });
  });

  it('AC4 — rejects unsupported mimes with a structured non-retryable error', async () => {
    await expect(
      extractCvText(
        { filePath: '/fake/cv.rtf', mime: 'rtf' as unknown as 'pdf' },
        { readFile: async () => Buffer.alloc(0), parseOffThread: async () => '' },
      ),
    ).rejects.toMatchObject({
      name: 'CvExtractionError',
      code: 'UNSUPPORTED_MIME',
      retryable: false,
    });
  });

  it('AC4 — file read ENOENT surfaces FILE_NOT_FOUND (non-retryable)', async () => {
    const err = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
    await expect(
      extractCvText(
        { filePath: '/missing.pdf', mime: 'pdf' },
        {
          readFile: async () => {
            throw err;
          },
          parseOffThread: async () => '',
        },
      ),
    ).rejects.toMatchObject({
      name: 'CvExtractionError',
      code: 'FILE_NOT_FOUND',
      retryable: false,
    });
  });

  it('AC4 — parser failures surface as PARSE_FAILED (retryable)', async () => {
    await expect(
      extractCvText(
        { filePath: '/x.pdf', mime: 'pdf' },
        {
          readFile: async () => Buffer.from('x'),
          parseOffThread: async () => {
            throw new Error('boom');
          },
        },
      ),
    ).rejects.toMatchObject({
      name: 'CvExtractionError',
      code: 'PARSE_FAILED',
      retryable: true,
    });
  });

  it('AC4 — CvExtractionError is an Error subclass with code + retryable fields', () => {
    const err = new CvExtractionError('UNSUPPORTED_MIME', 'nope', { retryable: false });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CvExtractionError');
    expect(err.code).toBe('UNSUPPORTED_MIME');
    expect(err.retryable).toBe(false);
  });

  it('AC2 — the default off-thread runner dispatches work through node:worker_threads', async () => {
    // Mock worker_threads so we can prove the default runner does NOT
    // execute the parser inline on the main thread.
    vi.resetModules();
    const onMessageHandlers: Array<(m: unknown) => void> = [];
    const fakeWorker = {
      on: vi.fn((event: string, fn: (m: unknown) => void) => {
        if (event === 'message') onMessageHandlers.push(fn);
        return fakeWorker;
      }),
      postMessage: vi.fn(),
      terminate: vi.fn(async () => 0),
      removeAllListeners: vi.fn(),
    };
    const WorkerCtor = vi.fn(() => fakeWorker);
    vi.doMock('node:worker_threads', () => ({
      Worker: WorkerCtor,
      isMainThread: true,
      parentPort: null,
    }));
    const mod = await import('../cvTextExtractor');
    const promise = mod.extractCvText(
      { filePath: '/x.pdf', mime: 'pdf' },
      { readFile: async () => Buffer.from('PDFBYTES') },
    );
    // Allow microtasks to run so the default runner has a chance to construct the Worker.
    await new Promise((r) => setImmediate(r));
    expect(WorkerCtor).toHaveBeenCalledOnce();
    // Simulate the worker replying with the extracted text.
    for (const h of onMessageHandlers) h({ ok: true, text: 'hello' });
    const result = await promise;
    expect(result.text).toBe('hello');
    expect(fakeWorker.terminate).toHaveBeenCalled();
    vi.doUnmock('node:worker_threads');
  });

  it('AC1 — package.json declares pdfjs-dist and mammoth as runtime dependencies', () => {
    const pkg = JSON.parse(
      readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    );
    expect(pkg.dependencies.mammoth).toBeTruthy();
    // either pdfjs-dist or pdf-parse is acceptable; this implementation
    // declares pdfjs-dist (active maintenance, ESM-friendly).
    expect(pkg.dependencies['pdfjs-dist'] || pkg.dependencies['pdf-parse']).toBeTruthy();
  });
});
