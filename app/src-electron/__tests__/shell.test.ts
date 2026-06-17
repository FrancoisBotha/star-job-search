/**
 * Unit tests for the shell:openExternal IPC handler and preload bridge
 * (JOBDET-001).
 *
 * Covers acceptance criteria:
 *  - AC1: shell:openExternal opens the URL via the injected openExternal
 *         function (Electron's shell.openExternal in production).
 *  - AC2: the handler validates the URL scheme — http/https are opened,
 *         file: / other schemes are rejected and NOT opened.
 *  - AC3: preload exposes window.starShell.openExternal using the vetted-
 *         channel pattern and env.d.ts declares the matching Window type.
 *  - AC5: this is distinct from view:open — registerShellIpc registers
 *         shell:openExternal only, never view:open.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ELECTRON_DIR, '..', 'src');

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../shell');
}

describe('registerShellIpc — channel registration (AC1)', () => {
  it('registers shell:openExternal', async () => {
    const { registerShellIpc } = await importModule();
    registerShellIpc(fakeIpcMain as never, { openExternal: vi.fn(async () => {}) });
    expect(ipcHandlers.has('shell:openExternal')).toBe(true);
  });

  it('does NOT register view:open (which is the embedded-browser navigate channel)', async () => {
    const { registerShellIpc } = await importModule();
    registerShellIpc(fakeIpcMain as never, { openExternal: vi.fn(async () => {}) });
    expect(ipcHandlers.has('view:open')).toBe(false);
  });
});

describe('shell:openExternal — happy path (AC1)', () => {
  it('opens an http URL via the injected openExternal function', async () => {
    const { registerShellIpc } = await importModule();
    const openExternal = vi.fn(async () => {});
    registerShellIpc(fakeIpcMain as never, { openExternal });
    const result = (await ipcHandlers.get('shell:openExternal')!({}, 'http://example.com/jobs/1')) as {
      ok: boolean;
    };
    expect(openExternal).toHaveBeenCalledWith('http://example.com/jobs/1');
    expect(result.ok).toBe(true);
  });

  it('opens an https URL via the injected openExternal function', async () => {
    const { registerShellIpc } = await importModule();
    const openExternal = vi.fn(async () => {});
    registerShellIpc(fakeIpcMain as never, { openExternal });
    const result = (await ipcHandlers.get('shell:openExternal')!({}, 'https://example.com/jobs/1')) as {
      ok: boolean;
    };
    expect(openExternal).toHaveBeenCalledWith('https://example.com/jobs/1');
    expect(result.ok).toBe(true);
  });
});

describe('shell:openExternal — scheme validation (AC2)', () => {
  it('rejects file:// URLs and does NOT call openExternal', async () => {
    const { registerShellIpc } = await importModule();
    const openExternal = vi.fn(async () => {});
    registerShellIpc(fakeIpcMain as never, { openExternal });
    const result = (await ipcHandlers.get('shell:openExternal')!({}, 'file:///etc/passwd')) as {
      ok: boolean;
      error?: string;
    };
    expect(openExternal).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it('rejects javascript: URLs and does NOT call openExternal', async () => {
    const { registerShellIpc } = await importModule();
    const openExternal = vi.fn(async () => {});
    registerShellIpc(fakeIpcMain as never, { openExternal });
    const result = (await ipcHandlers.get('shell:openExternal')!({}, 'javascript:alert(1)')) as {
      ok: boolean;
    };
    expect(openExternal).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it('rejects non-string / empty input and does NOT call openExternal', async () => {
    const { registerShellIpc } = await importModule();
    const openExternal = vi.fn(async () => {});
    registerShellIpc(fakeIpcMain as never, { openExternal });
    const a = (await ipcHandlers.get('shell:openExternal')!({}, '')) as { ok: boolean };
    const b = (await ipcHandlers.get('shell:openExternal')!({}, 123 as unknown)) as { ok: boolean };
    expect(a.ok).toBe(false);
    expect(b.ok).toBe(false);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs and does NOT call openExternal', async () => {
    const { registerShellIpc } = await importModule();
    const openExternal = vi.fn(async () => {});
    registerShellIpc(fakeIpcMain as never, { openExternal });
    const result = (await ipcHandlers.get('shell:openExternal')!({}, 'not a url')) as {
      ok: boolean;
    };
    expect(openExternal).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });
});

describe('preload + env.d.ts (AC3)', () => {
  it('preload registers starShell with openExternal using shell:openExternal', () => {
    const preload = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starShell['"]/);
    expect(preload).toMatch(/['"]shell:openExternal['"]/);
    expect(preload).toMatch(/openExternal/);
  });

  it('env.d.ts declares Window.starShell with an openExternal(url) method', () => {
    const env = readFileSync(path.join(SRC_DIR, 'env.d.ts'), 'utf8');
    expect(env).toMatch(/starShell\??:/);
    expect(env).toMatch(/openExternal/);
  });
});
