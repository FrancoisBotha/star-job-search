/**
 * DEAL-002 — Persist dealbreaker rule fields on the Profile.
 *
 * AC1: Profile gains dealbreakerKeywords / dealbreakerCompanies /
 *      dealbreakerSalaryMin; round-trip via profile:get/profile:save;
 *      old databases migrate additively (guarded).
 * AC3: Saved rules survive an app restart (persisted to SQLite).
 * AC4: Defaults are empty ([] / null) so the feature is inert until set.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

import {
  createProfileStore,
  type ProfileDatabaseLike,
} from '../profile';

interface Row {
  [key: string]: unknown;
}

/** Faithful in-memory DB that mirrors the subset of better-sqlite3 the
 *  profile store uses, with a per-column registry so we can simulate an
 *  "old database" missing the dealbreaker columns. */
class InMemoryDb implements ProfileDatabaseLike {
  private profile = new Map<string, Row>();
  private columns: Set<string>;

  constructor(initialColumns?: Set<string>) {
    this.columns = new Set(
      initialColumns ?? [
        'id',
        'name',
        'target_role',
        'years_experience',
        'location',
        'work_mode',
        'salary_min',
        'salary_currency',
        'linkedin_url',
        'links',
        'skills',
        'strength_score',
        'updated_at',
        // DEAL-002 columns — present in a fresh DB.
        'dealbreaker_keywords',
        'dealbreaker_companies',
        'dealbreaker_salary_min',
      ],
    );
  }

  exec(sql: string): void {
    const m = /^\s*ALTER\s+TABLE\s+profile\s+ADD\s+COLUMN\s+(\w+)/i.exec(sql);
    if (m) {
      const col = m[1] ?? '';
      if (this.columns.has(col)) {
        throw new Error(`duplicate column name: ${col}`);
      }
      this.columns.add(col);
      return;
    }
    /* CREATE TABLE IF NOT EXISTS — no-op */
  }

  prepare(sql: string) {
    const text = sql.trim();

    if (/^PRAGMA\s+table_info/i.test(text)) {
      return {
        all: () =>
          Array.from(this.columns).map((name, i) => ({
            cid: i,
            name,
            type: 'TEXT',
            notnull: 0,
            dflt_value: null,
            pk: name === 'id' ? 1 : 0,
          })),
        run: () => ({ changes: 0 }),
      };
    }

    if (/^ALTER\s+TABLE\s+profile\s+ADD\s+COLUMN\s+(\w+)/i.exec(text)) {
      const m = /^ALTER\s+TABLE\s+profile\s+ADD\s+COLUMN\s+(\w+)/i.exec(text);
      const col = m?.[1] ?? '';
      return {
        run: () => {
          if (this.columns.has(col)) {
            throw new Error(`duplicate column name: ${col}`);
          }
          this.columns.add(col);
          return { changes: 0 };
        },
        all: () => [],
      };
    }

    if (/^SELECT \* FROM profile WHERE id = \?/i.test(text)) {
      return {
        all: (id: string) => {
          const row = this.profile.get(id);
          return row ? [row] : [];
        },
        run: () => ({ changes: 0 }),
      };
    }
    if (/^INSERT OR REPLACE INTO profile/i.test(text)) {
      return {
        run: (params: Row) => {
          // Strip params that name a column the DB doesn't have yet so the
          // assertion "additive migration restored the column" is meaningful.
          const filtered: Row = {};
          for (const [k, v] of Object.entries(params)) {
            if (k === 'id' || this.columns.has(k)) filtered[k] = v;
          }
          this.profile.set(params.id as string, filtered);
          return { changes: 1 };
        },
        all: () => [],
      };
    }

    throw new Error(`InMemoryDb: unsupported SQL: ${text}`);
  }

  hasColumn(name: string): boolean {
    return this.columns.has(name);
  }

  snapshot(): { profile: Array<[string, Row]>; columns: string[] } {
    return {
      profile: Array.from(this.profile.entries()).map(([k, v]) => [k, { ...v }]),
      columns: Array.from(this.columns),
    };
  }

  static restore(snap: { profile: Array<[string, Row]>; columns: string[] }): InMemoryDb {
    const db = new InMemoryDb(new Set(snap.columns));
    for (const [k, v] of snap.profile) db.profile.set(k, { ...v });
    return db;
  }
}

describe('DEAL-002 — dealbreaker rule fields on the Profile', () => {
  it('defaults the three dealbreaker fields to empty / null (AC4)', () => {
    const db = new InMemoryDb();
    const store = createProfileStore(db);
    const profile = store.get();
    expect(profile.dealbreakerKeywords).toEqual([]);
    expect(profile.dealbreakerCompanies).toEqual([]);
    expect(profile.dealbreakerSalaryMin).toBeNull();
  });

  it('round-trips dealbreaker fields through profile:save → profile:get (AC1)', () => {
    const db = new InMemoryDb();
    const store = createProfileStore(db);
    store.save({
      dealbreakerKeywords: ['onsite-only', 'security clearance'],
      dealbreakerCompanies: ['Acme', 'Initech'],
      dealbreakerSalaryMin: 70000,
    });
    const persisted = store.get();
    expect(persisted.dealbreakerKeywords).toEqual([
      'onsite-only',
      'security clearance',
    ]);
    expect(persisted.dealbreakerCompanies).toEqual(['Acme', 'Initech']);
    expect(persisted.dealbreakerSalaryMin).toBe(70000);
  });

  it('saved rules survive an app restart (AC3)', () => {
    const db = new InMemoryDb();
    const store1 = createProfileStore(db);
    store1.save({
      name: 'Alex',
      dealbreakerKeywords: ['onsite-only'],
      dealbreakerCompanies: ['Acme'],
      dealbreakerSalaryMin: 80000,
    });

    // Simulate restart: snapshot the persisted bytes, re-open into a fresh
    // store (CVPROF-015 boot-hydration flow).
    const snap = db.snapshot();
    const db2 = InMemoryDb.restore(snap);
    const store2 = createProfileStore(db2);
    const restored = store2.get();
    expect(restored.name).toBe('Alex');
    expect(restored.dealbreakerKeywords).toEqual(['onsite-only']);
    expect(restored.dealbreakerCompanies).toEqual(['Acme']);
    expect(restored.dealbreakerSalaryMin).toBe(80000);
  });

  it('migrates an old database additively when the columns are missing (AC1)', () => {
    // Pre-DEAL-002 schema: every legacy column present, none of the three
    // new ones. createProfileStore must add them without dropping data.
    const legacyColumns = new Set([
      'id',
      'name',
      'target_role',
      'years_experience',
      'location',
      'work_mode',
      'salary_min',
      'salary_currency',
      'linkedin_url',
      'links',
      'skills',
      'strength_score',
      'updated_at',
    ]);
    const db = new InMemoryDb(legacyColumns);
    expect(db.hasColumn('dealbreaker_keywords')).toBe(false);

    const store = createProfileStore(db);

    // Migration ran during createProfileStore — the columns exist now.
    expect(db.hasColumn('dealbreaker_keywords')).toBe(true);
    expect(db.hasColumn('dealbreaker_companies')).toBe(true);
    expect(db.hasColumn('dealbreaker_salary_min')).toBe(true);

    // Empty defaults are returned for an old row that never had them set.
    const profile = store.get();
    expect(profile.dealbreakerKeywords).toEqual([]);
    expect(profile.dealbreakerCompanies).toEqual([]);
    expect(profile.dealbreakerSalaryMin).toBeNull();

    // And we can now save them without losing legacy fields.
    store.save({
      name: 'Existing User',
      dealbreakerKeywords: ['no-travel'],
      dealbreakerSalaryMin: 60000,
    });
    const after = store.get();
    expect(after.name).toBe('Existing User');
    expect(after.dealbreakerKeywords).toEqual(['no-travel']);
    expect(after.dealbreakerCompanies).toEqual([]);
    expect(after.dealbreakerSalaryMin).toBe(60000);
  });

  it('running the migration twice is a no-op (guarded)', () => {
    const db = new InMemoryDb();
    expect(() => createProfileStore(db)).not.toThrow();
    expect(() => createProfileStore(db)).not.toThrow();
    expect(db.hasColumn('dealbreaker_keywords')).toBe(true);
  });

  it('partial saves do not wipe previously-saved dealbreaker fields', () => {
    const db = new InMemoryDb();
    const store = createProfileStore(db);
    store.save({
      dealbreakerKeywords: ['onsite-only'],
      dealbreakerCompanies: ['Acme'],
      dealbreakerSalaryMin: 70000,
    });
    store.save({ name: 'Sam' });
    const merged = store.get();
    expect(merged.name).toBe('Sam');
    expect(merged.dealbreakerKeywords).toEqual(['onsite-only']);
    expect(merged.dealbreakerCompanies).toEqual(['Acme']);
    expect(merged.dealbreakerSalaryMin).toBe(70000);
  });
});
