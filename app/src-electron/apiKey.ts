/**
 * OpenRouter API key persistence module (LLM-001).
 *
 * Owns the on-disk store of the user's OpenRouter API key. The raw key is
 * encrypted with Electron's `safeStorage` (OS-keychain–backed on macOS/Linux,
 * DPAPI on Windows) and the resulting blob is written to
 * `<userData>/openrouter-key.bin`. The raw key never lands in SQLite or any
 * plaintext file, and never crosses the IPC boundary back to the renderer.
 *
 * Renderer talks to this module via the preload-bridge channels:
 *   apiKey:save | apiKey:getStatus | apiKey:clear
 *
 * Both save and getStatus return only `{ present, masked }` — the renderer
 * only ever needs to render the masked form (dots + last 4 chars) and a
 * present/absent indicator. Anything that wants to actually call OpenRouter
 * does so from the main process, where it can decrypt locally.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';
import type { IpcMain } from 'electron';

export interface ApiKeyStatus {
  present: boolean;
  masked: string | null;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

// Minimal slice of the node:fs surface we use — keeps the store unit-testable
// with a fully in-memory fake.
export interface ApiKeyFsLike {
  existsSync(p: string): boolean;
  readFileSync(p: string): Buffer;
  writeFileSync(p: string, data: Buffer | string): void;
  unlinkSync(p: string): void;
  mkdirSync(p: string, opts?: { recursive?: boolean }): void;
}

export interface ApiKeyStore {
  save(rawKey: string): ApiKeyStatus;
  getStatus(): ApiKeyStatus;
  clear(): void;
  /**
   * Returns the decrypted raw key for use by other main-process modules
   * (e.g. the OpenRouter model catalogue in LLM-002). Stays in main —
   * never wired to an IPC channel.
   */
  getRawKey(): string | null;
}

export interface ApiKeyStoreOptions {
  safeStorage: SafeStorageLike;
  filePath: string;
  fs?: ApiKeyFsLike;
}

/**
 * Render a key as `•••••••••••••••••••••••••1234` — every character masked with
 * a dot except the last 4, preserving the key's length so the masked preview
 * lines up with what the user typed. Keys of 4 chars or fewer are fully masked
 * (nothing is revealed). The renderer uses this purely for display; the raw key
 * never leaves main.
 */
export function maskKey(key: string): string {
  const trimmed = key ?? '';
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '•'.repeat(trimmed.length);
  return '•'.repeat(trimmed.length - 4) + trimmed.slice(-4);
}

export function createApiKeyStore(opts: ApiKeyStoreOptions): ApiKeyStore {
  const { safeStorage, filePath } = opts;
  const fs: ApiKeyFsLike = opts.fs ?? (nodeFs as unknown as ApiKeyFsLike);

  function readMasked(): string | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const blob = fs.readFileSync(filePath);
      const decrypted = safeStorage.decryptString(blob);
      return maskKey(decrypted);
    } catch {
      // A corrupt / unreadable blob is treated as no key present.
      return null;
    }
  }

  return {
    save(rawKey: string): ApiKeyStatus {
      const trimmed = (rawKey ?? '').trim();
      if (!trimmed) {
        throw new Error('OpenRouter API key is required');
      }
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error(
          'OS encryption is not available — refusing to store the OpenRouter API key in plaintext.',
        );
      }
      const blob = safeStorage.encryptString(trimmed);
      const dir = nodePath.dirname(filePath);
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {
        // mkdir on an existing dir is fine; surface real write errors below.
      }
      fs.writeFileSync(filePath, blob);
      return { present: true, masked: maskKey(trimmed) };
    },
    getStatus(): ApiKeyStatus {
      const masked = readMasked();
      if (masked === null) return { present: false, masked: null };
      return { present: true, masked };
    },
    clear(): void {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    },
    getRawKey(): string | null {
      if (!fs.existsSync(filePath)) return null;
      try {
        const blob = fs.readFileSync(filePath);
        return safeStorage.decryptString(blob);
      } catch {
        return null;
      }
    },
  };
}

/**
 * Register the `apiKey:save`, `apiKey:getStatus`, `apiKey:clear` IPC handlers.
 *
 * Mirrors `registerSitesIpc` — each handler is `async` so the renderer's UI
 * thread is never blocked (NFR-003), and each returns only the masked status
 * payload, never the raw key.
 */
export function registerApiKeyIpc(ipcMain: IpcMain, store: ApiKeyStore): void {
  ipcMain.handle('apiKey:save', async (_event, rawKey: string) => store.save(rawKey));
  ipcMain.handle('apiKey:getStatus', async () => store.getStatus());
  ipcMain.handle('apiKey:clear', async () => {
    store.clear();
  });
}
