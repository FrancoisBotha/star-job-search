/**
 * Web-research settings store (EVAL-004 / Epic 14).
 *
 * Persists the two local-only toggles that gate every EVAL-001 webResearch
 * call:
 *
 *  - `webResearchEnabled` — default OFF; user must explicitly opt in under
 *    Settings → Web research. When off, EVAL-001 short-circuits every
 *    `search` / `fetchUrl` with `code: 'research_disabled'` and the eval
 *    orchestrator's `gatherResearch` returns `{ disabled: true }`.
 *
 *  - `disclosureAcknowledged` — default FALSE. The first time the user
 *    enables web research, the renderer is expected to show the
 *    `WEB_RESEARCH_DISCLOSURE` copy from `webResearch.ts` and call
 *    `acknowledgeDisclosure()`. Until acknowledged, EVAL-001 returns
 *    `code: 'disclosure_required'` even when the toggle is on.
 *
 * Both values live in a tiny key-value table on the shared `star.db` so they
 * survive a restart. The store is intentionally minimal — no migrations, no
 * versioning, just two integer rows — because the disclosure / opt-in
 * contract is intentionally narrow.
 */

export interface WebResearchSettingsDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get?(...args: unknown[]): unknown;
    all?(...args: unknown[]): unknown[];
  };
}

export interface WebResearchSettings {
  webResearchEnabled: boolean;
  disclosureAcknowledged: boolean;
}

export interface WebResearchSettingsStore {
  get(): WebResearchSettings;
  setEnabled(enabled: boolean): WebResearchSettings;
  acknowledgeDisclosure(): WebResearchSettings;
}

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS web_research_settings (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  )
`;

const KEY_ENABLED = 'webResearchEnabled';
const KEY_ACK = 'disclosureAcknowledged';

interface SettingRow {
  key: string;
  value: number;
}

export function createWebResearchSettingsStore(
  db: WebResearchSettingsDatabaseLike,
): WebResearchSettingsStore {
  db.exec(CREATE_TABLE_SQL);

  const readStmt = db.prepare(
    'SELECT key, value FROM web_research_settings WHERE key = ?',
  );
  const upsertStmt = db.prepare(
    'INSERT OR REPLACE INTO web_research_settings (key, value) VALUES (?, ?)',
  );

  function readFlag(key: string): boolean {
    // Prefer .get if the seam supplies it, else fall back to .all — keeps the
    // store compatible with the same test fakes used by sites/jobs.
    const row =
      typeof readStmt.get === 'function'
        ? (readStmt.get(key) as SettingRow | undefined)
        : ((readStmt.all?.(key) ?? [])[0] as SettingRow | undefined);
    return row?.value === 1;
  }

  function snapshot(): WebResearchSettings {
    return {
      webResearchEnabled: readFlag(KEY_ENABLED),
      disclosureAcknowledged: readFlag(KEY_ACK),
    };
  }

  return {
    get(): WebResearchSettings {
      return snapshot();
    },
    setEnabled(enabled: boolean): WebResearchSettings {
      upsertStmt.run(KEY_ENABLED, enabled ? 1 : 0);
      return snapshot();
    },
    acknowledgeDisclosure(): WebResearchSettings {
      upsertStmt.run(KEY_ACK, 1);
      return snapshot();
    },
  };
}
