/**
 * Shell IPC (JOBDET-001).
 *
 * Exposes a single `shell:openExternal` channel that opens an http/https URL
 * in the user's OS default browser via Electron's `shell.openExternal`. The
 * handler validates the URL scheme — only http/https are forwarded; any other
 * scheme (file:, javascript:, mailto:, etc.) is rejected and not opened.
 *
 * Distinct from the existing `view:open` channel (extraction.ts), which
 * navigates the embedded Discover browser. `view:open` stays unchanged.
 */
import type { IpcMain } from 'electron';

export type OpenExternalResult = { ok: true } | { ok: false; error: string };

export interface ShellRuntimeDeps {
  /** Opens a URL in the OS default browser. Production wires Electron's shell.openExternal. */
  openExternal: (url: string) => Promise<void>;
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function registerShellIpc(ipcMain: IpcMain, deps: ShellRuntimeDeps): void {
  ipcMain.handle('shell:openExternal', async (_event, url: unknown): Promise<OpenExternalResult> => {
    if (typeof url !== 'string' || !url) {
      return { ok: false, error: 'shell:openExternal expects a non-empty URL string' };
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, error: `Malformed URL: ${url}` };
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      return {
        ok: false,
        error: `Refusing to open URL with disallowed scheme: ${parsed.protocol}`,
      };
    }
    await deps.openExternal(url);
    return { ok: true };
  });
}
