/**
 * Unit tests for PDFEX-005 — app-store `exportPdf` action and per-(sourceId)
 * PDF-export state mapping for the tagged-union `window.starPdf.export`
 * result.
 *
 * Covers:
 *  - AC6 (store): exportPdf drives window.starPdf.export, maps the
 *    tagged-union result onto idle / loading / success / error UI states.
 *  - AC4: error code is preserved verbatim from the bridge so the UI can
 *    render the matching error copy + offer a retry.
 *  - AC5: on success the most-recent PdfExportRecord is cached so the
 *    provenance label can read "exported from CV v{n} · {date}".
 *  - revealPdfExport delegates to window.starPdf.reveal.
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

type PdfBridge = {
  export?: (
    tailoredDocId: string,
    opts?: StarPdfExportOpts,
  ) => Promise<StarPdfExportResult>;
  reveal?: (fullPath: string) => Promise<void>;
};

function installBridges(opts: { pdf?: PdfBridge } = {}) {
  const w: Record<string, unknown> = {};
  if (opts.pdf) w.starPdf = opts.pdf;
  (globalThis as { window?: unknown }).window = w;
  return w;
}

function makeRecord(
  overrides: Partial<StarPdfExportRecord> = {},
): StarPdfExportRecord {
  return {
    id: 'pdfx-job-1-1700000000000',
    tailoredDocId: 'job-1',
    tailoredDocVersion: 1_700_000_000_000,
    modelSlug: 'openai/gpt-4o-mini',
    exportedAt: 1_700_000_000_000,
    savedPath: 'C:/Users/me/Documents/tailored.pdf',
    pageSize: 'letter',
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store — exportPdf action (AC6)', () => {
  it('initial pdfExportStateFor any sourceId is idle and there is no cached record', () => {
    installBridges({});
    const store = useAppStore();
    const s = store.pdfExportStateFor('job-1');
    expect(s.status).toBe('idle');
    expect(s.code).toBeNull();
    expect(store.pdfExportRecordFor('job-1')).toBeNull();
  });

  it('exportPdf sets loading then success, caches the record, and forwards the page-size opt to the bridge', async () => {
    let resolveCall: (v: StarPdfExportResult) => void = () => {};
    const exportFn = vi.fn(
      (_id: string, _opts?: StarPdfExportOpts) =>
        new Promise<StarPdfExportResult>((r) => {
          resolveCall = r;
        }),
    );
    installBridges({ pdf: { export: exportFn } });
    const store = useAppStore();

    const promise = store.exportPdf({ sourceId: 'job-1', pageSize: 'letter' });
    expect(store.pdfExportStateFor('job-1').status).toBe('loading');
    expect(exportFn).toHaveBeenCalledWith('job-1', { pageSize: 'letter' });

    const record = makeRecord();
    resolveCall({ ok: true, record });
    const result = await promise;

    expect(result?.ok).toBe(true);
    expect(store.pdfExportStateFor('job-1').status).toBe('success');
    expect(store.pdfExportRecordFor('job-1')?.savedPath).toBe(record.savedPath);
  });

  it('maps an error result onto error state and preserves the bridge error code (AC4)', async () => {
    const exportFn = vi.fn(
      async (): Promise<StarPdfExportResult> => ({
        ok: false,
        code: 'TOOLCHAIN_MISSING',
        error: 'bundled latex engine not found',
      }),
    );
    installBridges({ pdf: { export: exportFn } });
    const store = useAppStore();

    await store.exportPdf({ sourceId: 'job-1', pageSize: 'a4' });
    const s = store.pdfExportStateFor('job-1');
    expect(s.status).toBe('error');
    expect(s.code).toBe('TOOLCHAIN_MISSING');
    expect(store.pdfExportRecordFor('job-1')).toBeNull();
  });

  it('returns undefined and stays idle when the bridge is absent', async () => {
    installBridges({});
    const store = useAppStore();
    const r = await store.exportPdf({ sourceId: 'job-1', pageSize: 'a4' });
    expect(r).toBeUndefined();
    expect(store.pdfExportStateFor('job-1').status).toBe('idle');
  });
});

describe('app-store — revealPdfExport action', () => {
  it('forwards the absolute path to window.starPdf.reveal', async () => {
    const reveal = vi.fn(async (_p: string) => {});
    installBridges({ pdf: { reveal } });
    const store = useAppStore();
    await store.revealPdfExport('C:/Users/me/Documents/tailored.pdf');
    expect(reveal).toHaveBeenCalledWith('C:/Users/me/Documents/tailored.pdf');
  });

  it('is a no-op when the bridge is absent', async () => {
    installBridges({});
    const store = useAppStore();
    await expect(
      store.revealPdfExport('C:/Users/me/Documents/tailored.pdf'),
    ).resolves.toBeUndefined();
  });
});
