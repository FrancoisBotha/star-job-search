/**
 * Unit tests for the preferred-models persistence module (LLM-003).
 *
 * Covers:
 *  - AC1: preferred_models table (slug PK, is_default, position) on star.db
 *  - AC2: invariants — max 5 rows, exactly one is_default=1 when non-empty,
 *         first added becomes default automatically
 *  - AC3: setDefault flips exactly one default; remove of the default
 *         promotes the earliest remaining by position
 *  - AC4: add returns typed errors EMPTY_SLUG / DUPLICATE / LIMIT_REACHED
 *  - AC5: IPC preferredModels:list|add|remove|setDefault are registered and
 *         each returns the updated PreferredModel[] list (add returns it via
 *         the success branch of the tagged union)
 *  - AC6: preload exposes window.starPreferredModels.*; env.d.ts declares
 *         the matching types; list + default survive a restart
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ELECTRON_DIR, '..', 'src');

vi.mock('better-sqlite3', () => {
  return { default: class {} };
});

// --- Fake in-memory database mimicking the small better-sqlite3 surface ---

interface PrefRow {
  slug: string;
  is_default: number;
  position: number;
}

class FakeDatabase {
  rows: PrefRow[] = [];
  exec(_sql: string) {
    // CREATE TABLE — no-op for the fake.
  }
  prepare(sql: string) {
    const text = sql.trim();
    if (/^INSERT\s+INTO\s+preferred_models/i.test(text)) {
      return {
        run: (params: PrefRow) => {
          this.rows.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^DELETE\s+FROM\s+preferred_models/i.test(text)) {
      return {
        run: (slug: string) => {
          const before = this.rows.length;
          this.rows = this.rows.filter((r) => r.slug !== slug);
          return { changes: before - this.rows.length };
        },
      };
    }
    if (/^UPDATE\s+preferred_models\s+SET\s+is_default\s*=\s*0/i.test(text)) {
      return {
        run: () => {
          let changes = 0;
          for (const r of this.rows) {
            if (r.is_default !== 0) {
              r.is_default = 0;
              changes++;
            }
          }
          return { changes };
        },
      };
    }
    if (/^UPDATE\s+preferred_models\s+SET\s+is_default\s*=\s*1/i.test(text)) {
      return {
        run: (slug: string) => {
          const row = this.rows.find((r) => r.slug === slug);
          if (!row) return { changes: 0 };
          row.is_default = 1;
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT/i.test(text)) {
      return {
        all: () => [...this.rows].sort((a, b) => a.position - b.position),
      };
    }
    throw new Error(`FakeDatabase: unsupported SQL: ${text}`);
  }
}

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
  return await import('../preferredModels');
}

// --- Tests -----------------------------------------------------------------

describe('preferred_models DDL (AC1)', () => {
  it('exec runs a CREATE TABLE IF NOT EXISTS with slug PK, is_default, position', async () => {
    const { createPreferredModelsStore } = await importModule();
    const calls: string[] = [];
    const spyDb = {
      exec(sql: string) {
        calls.push(sql);
      },
      prepare(_sql: string) {
        return { run: () => ({ changes: 0 }), all: () => [] };
      },
    };
    createPreferredModelsStore(spyDb as never);
    const ddl = calls.join('\n');
    expect(ddl).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+preferred_models/i);
    expect(ddl).toMatch(/slug\s+TEXT\s+PRIMARY\s+KEY/i);
    expect(ddl).toMatch(/is_default\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i);
    expect(ddl).toMatch(/position\s+INTEGER\s+NOT\s+NULL/i);
  });
});

describe('createPreferredModelsStore — invariants (AC2)', () => {
  it('the first model added becomes default automatically', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    const result = store.add('openai/gpt-5');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.models).toHaveLength(1);
    expect(result.models[0]!.slug).toBe('openai/gpt-5');
    expect(result.models[0]!.isDefault).toBe(true);
    expect(result.models[0]!.position).toBe(0);
  });

  it('subsequent models do NOT become default — only the first one is', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    store.add('openai/gpt-5');
    const result = store.add('anthropic/claude');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const defaults = result.models.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.slug).toBe('openai/gpt-5');
  });

  it('enforces an upper bound of 5 rows', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    for (let i = 0; i < 5; i++) {
      const r = store.add(`vendor/model-${i}`);
      expect(r.ok).toBe(true);
    }
    const sixth = store.add('vendor/overflow');
    expect(sixth.ok).toBe(false);
    if (sixth.ok) return;
    expect(sixth.code).toBe('LIMIT_REACHED');
    expect(store.list()).toHaveLength(5);
  });

  it('positions are monotonically assigned in insertion order', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    store.add('vendor/a');
    store.add('vendor/b');
    store.add('vendor/c');
    const list = store.list();
    expect(list.map((m) => m.slug)).toEqual(['vendor/a', 'vendor/b', 'vendor/c']);
    expect(list.map((m) => m.position)).toEqual([0, 1, 2]);
  });
});

describe('setDefault and remove behaviour (AC3)', () => {
  it('setDefault flips exactly one is_default flag', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    store.add('vendor/a');
    store.add('vendor/b');
    store.add('vendor/c');
    const updated = store.setDefault('vendor/b');
    const defaults = updated.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.slug).toBe('vendor/b');
  });

  it('removing the default promotes the earliest remaining model by position', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    store.add('vendor/a'); // default by virtue of being first
    store.add('vendor/b');
    store.add('vendor/c');
    const updated = store.remove('vendor/a');
    expect(updated.map((m) => m.slug)).toEqual(['vendor/b', 'vendor/c']);
    const defaults = updated.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.slug).toBe('vendor/b');
  });

  it('removing a non-default model leaves the default unchanged', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    store.add('vendor/a');
    store.add('vendor/b');
    store.add('vendor/c');
    const updated = store.remove('vendor/c');
    const defaults = updated.filter((m) => m.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.slug).toBe('vendor/a');
  });

  it('removing the last model leaves the list empty (no default required)', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    store.add('vendor/a');
    const updated = store.remove('vendor/a');
    expect(updated).toEqual([]);
  });
});

describe('add validation errors (AC4)', () => {
  it('returns code EMPTY_SLUG for blank input', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    const r = store.add('   ');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('EMPTY_SLUG');
  });

  it('returns code DUPLICATE when the slug already exists', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    store.add('vendor/a');
    const r = store.add('vendor/a');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('DUPLICATE');
  });

  it('returns code LIMIT_REACHED once 5 models are stored', async () => {
    const { createPreferredModelsStore } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    for (let i = 0; i < 5; i++) store.add(`vendor/m${i}`);
    const r = store.add('vendor/extra');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('LIMIT_REACHED');
  });
});

describe('registerPreferredModelsIpc — IPC channels (AC5)', () => {
  it('registers preferredModels:list|add|remove|setDefault handlers', async () => {
    const { createPreferredModelsStore, registerPreferredModelsIpc } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    registerPreferredModelsIpc(fakeIpcMain as never, store);
    for (const ch of [
      'preferredModels:list',
      'preferredModels:add',
      'preferredModels:remove',
      'preferredModels:setDefault',
    ]) {
      expect(ipcHandlers.has(ch), `missing handler for ${ch}`).toBe(true);
    }
  });

  it('list / remove / setDefault return PreferredModel[]; add returns the success union', async () => {
    const { createPreferredModelsStore, registerPreferredModelsIpc } = await importModule();
    const store = createPreferredModelsStore(new FakeDatabase() as never);
    registerPreferredModelsIpc(fakeIpcMain as never, store);

    const added = (await ipcHandlers.get('preferredModels:add')!({}, 'vendor/a')) as {
      ok: boolean;
    };
    expect(added.ok).toBe(true);

    await ipcHandlers.get('preferredModels:add')!({}, 'vendor/b');

    const list = (await ipcHandlers.get('preferredModels:list')!({})) as Array<{ slug: string }>;
    expect(list.map((m) => m.slug)).toEqual(['vendor/a', 'vendor/b']);

    const afterSet = (await ipcHandlers.get('preferredModels:setDefault')!(
      {},
      'vendor/b',
    )) as Array<{ slug: string; isDefault: boolean }>;
    expect(afterSet.find((m) => m.isDefault)!.slug).toBe('vendor/b');

    const afterRemove = (await ipcHandlers.get('preferredModels:remove')!(
      {},
      'vendor/b',
    )) as Array<{ slug: string; isDefault: boolean }>;
    expect(afterRemove).toHaveLength(1);
    expect(afterRemove[0]!.slug).toBe('vendor/a');
    expect(afterRemove[0]!.isDefault).toBe(true);
  });
});

describe('restart durability (AC6)', () => {
  it('a second store opened on the same DB sees previously-added models and the default', async () => {
    const { createPreferredModelsStore } = await importModule();
    const db = new FakeDatabase();

    const s1 = createPreferredModelsStore(db as never);
    s1.add('vendor/a');
    s1.add('vendor/b');
    s1.setDefault('vendor/b');

    const s2 = createPreferredModelsStore(db as never);
    const list = s2.list();
    expect(list.map((m) => m.slug)).toEqual(['vendor/a', 'vendor/b']);
    expect(list.find((m) => m.isDefault)!.slug).toBe('vendor/b');
  });
});

describe('preload + env.d.ts wiring (AC5, AC6)', () => {
  it('preload exposes a starPreferredModels bridge invoking the four channels', () => {
    const preload = readFileSync(
      path.join(ELECTRON_DIR, 'electron-preload.ts'),
      'utf8',
    );
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starPreferredModels['"]/);
    for (const ch of [
      'preferredModels:list',
      'preferredModels:add',
      'preferredModels:remove',
      'preferredModels:setDefault',
    ]) {
      expect(preload, `preload missing channel ${ch}`).toContain(ch);
    }
  });

  it('env.d.ts declares StarPreferredModelsApi and attaches it to Window', () => {
    const env = readFileSync(path.join(SRC_DIR, 'env.d.ts'), 'utf8');
    expect(env).toMatch(/StarPreferredModelsApi/);
    expect(env).toMatch(/starPreferredModels\??:\s*StarPreferredModelsApi/);
  });

  it('electron-main wires the store + IPC from createWindow on the shared star.db', () => {
    const main = readFileSync(path.join(ELECTRON_DIR, 'electron-main.ts'), 'utf8');
    expect(main).toMatch(/registerPreferredModelsIpc/);
    expect(main).toMatch(/createPreferredModelsStore/);
  });
});
