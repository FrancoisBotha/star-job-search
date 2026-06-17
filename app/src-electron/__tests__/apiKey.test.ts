/**
 * Unit tests for the OpenRouter API key persistence module (LLM-001).
 *
 * Covers:
 *  - AC1: Key persisted as encrypted blob via Electron safeStorage; no plaintext on disk
 *  - AC2: IPC channels apiKey:save / apiKey:getStatus / apiKey:clear
 *  - AC3: getStatus/save return only { present, masked }; raw key never crosses IPC
 *  - AC4: Blank/whitespace input is rejected with a validation error; input is trimmed
 *  - AC5: Preload exposes window.starApiKey + env.d.ts declares the matching Window type
 *  - AC6: When safeStorage.isEncryptionAvailable() is false, save fails and no plaintext is written
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ELECTRON_DIR, '../src');

// --- Fake fs + safeStorage --------------------------------------------------

class FakeFs {
  files = new Map<string, Buffer>();
  existsSync(p: string) {
    return this.files.has(p);
  }
  readFileSync(p: string): Buffer {
    const b = this.files.get(p);
    if (!b) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return b;
  }
  writeFileSync(p: string, data: Buffer | string) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.files.set(p, buf);
  }
  unlinkSync(p: string) {
    this.files.delete(p);
  }
  mkdirSync(_p: string, _opts?: { recursive?: boolean }) {
    // no-op for the fake
  }
}

class FakeSafeStorage {
  available = true;
  isEncryptionAvailable() {
    return this.available;
  }
  encryptString(s: string): Buffer {
    // Reversibly transform so we can detect plaintext bleed-through.
    return Buffer.from('ENC:' + Buffer.from(s, 'utf8').toString('base64'), 'utf8');
  }
  decryptString(b: Buffer): string {
    const raw = b.toString('utf8');
    if (!raw.startsWith('ENC:')) throw new Error('bad blob');
    return Buffer.from(raw.slice(4), 'base64').toString('utf8');
  }
}

// --- IPC mock ---------------------------------------------------------------

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
  return await import('../apiKey');
}

const FILE_PATH = '/userData/openrouter-key.bin';

function newStore(overrides: { fs?: FakeFs; safeStorage?: FakeSafeStorage } = {}) {
  const fs = overrides.fs ?? new FakeFs();
  const safeStorage = overrides.safeStorage ?? new FakeSafeStorage();
  return { fs, safeStorage };
}

// --- Tests ------------------------------------------------------------------

describe('maskKey (AC3)', () => {
  it('returns dots + the last 4 chars of the key', async () => {
    const { maskKey } = await importModule();
    const masked = maskKey('sk-or-v1-abcdefghijklmnop1234');
    expect(masked.endsWith('1234')).toBe(true);
    expect(masked).not.toContain('abc');
    expect(masked.length).toBe('sk-or-v1-abcdefghijklmnop1234'.length);
  });
});

describe('createApiKeyStore.save (AC1, AC4, AC6)', () => {
  it('AC1: encrypts the key via safeStorage and writes it to the configured file path', async () => {
    const { createApiKeyStore } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });

    const result = store.save('sk-or-v1-rawsecret1234');
    expect(result.present).toBe(true);
    expect(result.masked.endsWith('1234')).toBe(true);

    expect(fs.existsSync(FILE_PATH)).toBe(true);
    const onDisk = fs.readFileSync(FILE_PATH).toString('utf8');
    expect(onDisk.startsWith('ENC:')).toBe(true);
    // No plaintext key ever hits disk.
    expect(onDisk).not.toContain('sk-or-v1-rawsecret1234');
    expect(onDisk).not.toContain('rawsecret');
  });

  it('AC4: rejects a blank key with a validation error and writes nothing', async () => {
    const { createApiKeyStore } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });

    expect(() => store.save('')).toThrow();
    expect(() => store.save('   ')).toThrow();
    expect(() => store.save('\t\n  ')).toThrow();
    expect(fs.existsSync(FILE_PATH)).toBe(false);
  });

  it('AC4: trims surrounding whitespace before persisting and masking', async () => {
    const { createApiKeyStore } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });

    const result = store.save('   sk-or-v1-rawsecretWXYZ   ');
    expect(result.masked.endsWith('WXYZ')).toBe(true);

    const decrypted = safeStorage.decryptString(fs.readFileSync(FILE_PATH));
    expect(decrypted).toBe('sk-or-v1-rawsecretWXYZ');
  });

  it('AC6: fails with a clear error when safeStorage is not available, and writes no plaintext', async () => {
    const { createApiKeyStore } = await importModule();
    const fs = new FakeFs();
    const safeStorage = new FakeSafeStorage();
    safeStorage.available = false;
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });

    expect(() => store.save('sk-or-v1-rawsecret1234')).toThrow(/encryption/i);
    expect(fs.existsSync(FILE_PATH)).toBe(false);
  });
});

describe('createApiKeyStore.getStatus (AC1, AC3)', () => {
  it('returns { present: false, masked: null } when no key has been saved', async () => {
    const { createApiKeyStore } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });

    expect(store.getStatus()).toEqual({ present: false, masked: null });
  });

  it('returns { present: true, masked } after a save, without leaking the raw key', async () => {
    const { createApiKeyStore } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });

    store.save('sk-or-v1-rawsecret1234');
    const status = store.getStatus();
    expect(status.present).toBe(true);
    expect(status.masked.endsWith('1234')).toBe(true);
    expect(status.masked).not.toContain('rawsecret');
    // The status payload exposes only the masked form — nothing else.
    expect(Object.keys(status).sort()).toEqual(['masked', 'present']);
  });
});

describe('createApiKeyStore.clear (AC1)', () => {
  it('removes the on-disk blob and reports no key present afterwards', async () => {
    const { createApiKeyStore } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });
    store.save('sk-or-v1-rawsecret1234');
    expect(fs.existsSync(FILE_PATH)).toBe(true);

    store.clear();
    expect(fs.existsSync(FILE_PATH)).toBe(false);
    expect(store.getStatus()).toEqual({ present: false, masked: null });
  });

  it('is a no-op when no key is present', async () => {
    const { createApiKeyStore } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });
    expect(() => store.clear()).not.toThrow();
  });
});

describe('registerApiKeyIpc — IPC channels (AC2, AC3)', () => {
  it('AC2: registers apiKey:save, apiKey:getStatus, apiKey:clear handlers', async () => {
    const { createApiKeyStore, registerApiKeyIpc } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });
    registerApiKeyIpc(fakeIpcMain as never, store);

    for (const channel of ['apiKey:save', 'apiKey:getStatus', 'apiKey:clear']) {
      expect(ipcHandlers.has(channel), `missing handler for ${channel}`).toBe(true);
    }
  });

  it('AC3: apiKey:save returns only { present, masked }', async () => {
    const { createApiKeyStore, registerApiKeyIpc } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });
    registerApiKeyIpc(fakeIpcMain as never, store);

    const result = (await ipcHandlers.get('apiKey:save')!({}, 'sk-or-v1-rawsecret1234')) as {
      present: boolean;
      masked: string;
    };
    expect(result.present).toBe(true);
    expect(result.masked.endsWith('1234')).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['masked', 'present']);
    // Raw key must never come back across IPC.
    expect(JSON.stringify(result)).not.toContain('rawsecret');
  });

  it('AC3: apiKey:getStatus returns only { present, masked }', async () => {
    const { createApiKeyStore, registerApiKeyIpc } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });
    store.save('sk-or-v1-rawsecret1234');
    registerApiKeyIpc(fakeIpcMain as never, store);

    const status = (await ipcHandlers.get('apiKey:getStatus')!({})) as Record<string, unknown>;
    expect(Object.keys(status).sort()).toEqual(['masked', 'present']);
    expect(status.present).toBe(true);
    expect(JSON.stringify(status)).not.toContain('rawsecret');
  });

  it('AC2 + AC4: apiKey:save rejects a blank key over IPC', async () => {
    const { createApiKeyStore, registerApiKeyIpc } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });
    registerApiKeyIpc(fakeIpcMain as never, store);

    await expect(ipcHandlers.get('apiKey:save')!({}, '   ')).rejects.toThrow();
  });

  it('AC2: apiKey:clear removes the saved key', async () => {
    const { createApiKeyStore, registerApiKeyIpc } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });
    store.save('sk-or-v1-rawsecret1234');
    registerApiKeyIpc(fakeIpcMain as never, store);

    await ipcHandlers.get('apiKey:clear')!({});
    expect(store.getStatus().present).toBe(false);
  });
});

describe('main process wiring (AC2)', () => {
  it('createWindow registers the apiKey IPC handlers, mirroring registerSitesIpc', () => {
    const main = readFileSync(path.join(ELECTRON_DIR, 'electron-main.ts'), 'utf8');
    expect(main).toMatch(/registerApiKeyIpc/);
    // Wired from inside createWindow, not at the module top level.
    const createWindowBlock = main.split('function createWindow')[1] ?? '';
    expect(createWindowBlock).toMatch(/registerApiKeyIpc/);
  });
});

describe('preload bridge (AC5)', () => {
  it('exposes window.starApiKey with save / getStatus / clear', () => {
    const preload = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starApiKey['"]/);
    for (const channel of ['apiKey:save', 'apiKey:getStatus', 'apiKey:clear']) {
      expect(preload, `preload missing channel ${channel}`).toContain(channel);
    }
  });

  it('env.d.ts declares a matching Window.starApiKey type', () => {
    const envDts = readFileSync(path.join(SRC_DIR, 'env.d.ts'), 'utf8');
    expect(envDts).toMatch(/starApiKey\??:/);
    expect(envDts).toMatch(/save\s*:/);
    expect(envDts).toMatch(/getStatus\s*:/);
    expect(envDts).toMatch(/clear\s*:/);
  });
});

describe('scope boundary (no raw key in plaintext anywhere on disk)', () => {
  it('apiKey.ts never writes the raw key string to its persistence path', async () => {
    const { createApiKeyStore } = await importModule();
    const { fs, safeStorage } = newStore();
    const store = createApiKeyStore({ safeStorage, fs, filePath: FILE_PATH });
    const raw = 'sk-or-v1-PLAINTEXTSECRETzzzz';
    store.save(raw);
    for (const [, buf] of fs.files) {
      expect(buf.toString('utf8')).not.toContain(raw);
      expect(buf.toString('utf8')).not.toContain('PLAINTEXTSECRET');
    }
  });
});
