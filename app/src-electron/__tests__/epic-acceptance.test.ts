/**
 * Epic-level acceptance verification (BRWSR-006).
 *
 * Holistically verifies the §9 Acceptance Criteria of
 * docs/Epics/epic_01_EMBEDDED_JOB_SITE_BROWSER.md against the actual
 * implementation produced by BRWSR-001..005 — not just the per-ticket
 * test phases. Each `it` here is anchored to one bullet of the epic §9
 * list (or to one of the NFR / scope-boundary clauses backing it).
 *
 * The intent is a single fail-fast guard: if a later change quietly
 * regresses an epic-level guarantee (session isolation, scope boundary,
 * empty state copy, etc.), this file flags it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..');
const ELECTRON_DIR = path.join(REPO_DIR, 'src-electron');
const PAGES_DIR = path.join(REPO_DIR, 'src', 'pages');
const STORES_DIR = path.join(REPO_DIR, 'src', 'stores');

const SURFACE = readFileSync(path.join(ELECTRON_DIR, 'browser-surface.ts'), 'utf8');
const SITES = readFileSync(path.join(ELECTRON_DIR, 'sites.ts'), 'utf8');
const PRELOAD = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
const MAIN = readFileSync(path.join(ELECTRON_DIR, 'electron-main.ts'), 'utf8');
const DISCOVER = readFileSync(path.join(PAGES_DIR, 'DiscoverPage.vue'), 'utf8');
const SETTINGS = readFileSync(path.join(PAGES_DIR, 'SettingsPage.vue'), 'utf8');
const STORE = readFileSync(path.join(STORES_DIR, 'app-store.ts'), 'utf8');

describe('Epic §9 AC1 — site is normalised, persists, survives restart', () => {
  it('sites.ts exposes URL normalisation (scheme defaulting, host derivation)', () => {
    expect(SITES).toMatch(/normaliseSiteInput/);
    expect(SITES).toMatch(/https:\/\//);
    expect(SITES).toMatch(/host/);
  });

  it('sites are persisted via SQLite (not an in-memory list)', () => {
    expect(SITES).toMatch(/CREATE TABLE IF NOT EXISTS sites/);
    expect(SITES).toMatch(/better-sqlite3/);
    // electron-main opens the DB under userData so it survives restarts.
    expect(MAIN).toMatch(/openSitesDatabase/);
    expect(MAIN).toMatch(/getPath\(\s*['"]userData['"]\s*\)/);
  });
});

describe('Epic §9 AC2 — removed site disappears from Settings AND Discover', () => {
  it('Settings and Discover render from the same store.sites source', () => {
    expect(SETTINGS).toMatch(/store\.sites/);
    expect(DISCOVER).toMatch(/store\.sites/);
  });

  it('removeSite updates the shared store after the IPC call', () => {
    expect(STORE).toMatch(/removeSite/);
    expect(STORE).toMatch(/sites\s*=\s*this\.sites\.filter/);
  });
});

describe('Epic §9 AC3 — Discover site tabs list exactly the persisted active sites', () => {
  it('the site tabs are rendered from store.enabledSites (no hard-coded site list)', () => {
    // EXTR superseded the original q-select dropdown with a browser-style tab
    // strip — one tab per active site, sourced from the persisted store.
    expect(DISCOVER).toMatch(/v-for="s in store\.enabledSites"/);
    // The old hard-coded toggle list must be gone.
    expect(DISCOVER).not.toMatch(/siteToggles/);
  });
});

describe('Epic §9 AC4 — selecting a site loads it and the URL bar reflects it', () => {
  it('onSelectSite navigates the embedded browser and updates activeUrl', () => {
    expect(DISCOVER).toMatch(/activeUrl\.value\s*=\s*site\.url/);
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.navigate\(\s*site\.url\s*\)/);
  });

  it('the URL pill renders the reactive activeUrl', () => {
    expect(DISCOVER).toMatch(/\{\{\s*activeUrl[^}]*\}\}/);
  });
});

describe('Epic §9 AC5 — back/forward navigation works', () => {
  it('preload exposes back and forward bridges that hit the IPC channels', () => {
    expect(PRELOAD).toMatch(/back:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]job-browser:back['"]/);
    expect(PRELOAD).toMatch(/forward:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]job-browser:forward['"]/);
  });

  it('main-process handlers drive webContents.goBack / goForward', () => {
    expect(SURFACE).toMatch(/goBack\(\)/);
    expect(SURFACE).toMatch(/goForward\(\)/);
  });

  it('Discover chrome wires the chevrons to the bridge', () => {
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.back\(\)/);
    expect(DISCOVER).toMatch(/starBrowser[^\n]*\.forward\(\)/);
  });
});

describe('Epic §9 AC6 — session isolated from app state (NFR-001)', () => {
  it('embedded view uses the persist:job-browser partition', () => {
    expect(SURFACE).toMatch(/persist:job-browser/);
    expect(SURFACE).toMatch(/partition:\s*JOB_BROWSER_PARTITION/);
  });

  it('partition is not the renderer default (empty string)', () => {
    // The exported constant exists and is non-empty; the renderer's default
    // session would be partition: '' — which would let site cookies / JS
    // reach app data.
    expect(SURFACE).toMatch(/JOB_BROWSER_PARTITION\s*=\s*['"]persist:job-browser['"]/);
  });

  it('embedded view keeps contextIsolation:true, nodeIntegration:false, sandbox:true', () => {
    expect(SURFACE).toMatch(/contextIsolation:\s*true/);
    expect(SURFACE).toMatch(/nodeIntegration:\s*false/);
    expect(SURFACE).toMatch(/sandbox:\s*true/);
  });

  it('app renderer keeps contextIsolation:true and never enables nodeIntegration', () => {
    expect(MAIN).toMatch(/contextIsolation:\s*true/);
    expect(MAIN).not.toMatch(/nodeIntegration:\s*true/);
  });
});

describe('Epic §9 AC7 — Discover empty state when no sites are configured', () => {
  it('shows the required empty-state copy', () => {
    expect(DISCOVER.toLowerCase()).toMatch(/add a site in settings to start browsing/);
  });

  it('the empty state replaces the chrome + tabs (mutually exclusive)', () => {
    expect(DISCOVER).toMatch(/v-if="store\.enabledSites\.length"/);
    expect(DISCOVER).toMatch(/v-else\b/);
  });
});

describe('Epic §9 AC8 — works on macOS, Windows, Linux from one codebase', () => {
  it('uses cross-platform primitives (Electron BrowserView, better-sqlite3) — no OS-specific shells', () => {
    expect(SURFACE).toMatch(/BrowserView/);
    expect(SITES).toMatch(/better-sqlite3/);
    // No platform-gated branches in the surface or sites modules — both
    // run unchanged on win32, darwin, and linux.
    expect(SURFACE).not.toMatch(/process\.platform/);
    expect(SITES).not.toMatch(/process\.platform/);
  });

  it('the DB path is derived from app.getPath("userData") — the per-OS convention', () => {
    expect(MAIN).toMatch(/getPath\(\s*['"]userData['"]\s*\)/);
  });
});

describe('Epic §9 AC9 — scope boundary: no scraping / extraction / scoring / scheduling', () => {
  const FORBIDDEN: Array<[string, RegExp]> = [
    ['scrape', /scrape/i],
    ['extract', /extract(?!or)/i],
    ['executeJavaScript', /executeJavaScript/i],
    ['insertCSS', /insertCSS/i],
    ['scoring', /scoring/i],
    ['matchScore', /MatchScore/],
    ['matchFactor', /MatchFactor/],
    ['jobListing', /JobListing/],
    ['cron', /cron/i],
    ['schedule', /\bschedule\b/i],
    ['setInterval', /setInterval/],
    ['robots.txt', /robots\.txt/i],
    ['ratePolicy', /ratePolicy/],
    ['searchUrlTemplate', /searchUrlTemplate/],
    ['adapterId', /adapterId/],
  ];

  // Files added or substantively rewired by epic 1. SettingsPage.vue is
  // omitted from this strict scan because its pre-existing "About" dialog
  // already includes the word "scoring" as marketing copy describing the
  // product — that text predates this epic and is not in scope here.
  // electron-main.ts and electron-preload.ts are no longer scanned here:
  // EXTR-006 legitimately wires the extraction runtime (ai:extract,
  // board:list/setStatus, view:open, extract:progress) into those files.
  // The scope boundary BRWSR-001 cared about is still enforced on the
  // surface itself, the persisted sites store, and the renderer pieces.
  const FILES: Array<[string, string]> = [
    ['browser-surface.ts', SURFACE],
    ['sites.ts', SITES],
    ['DiscoverPage.vue', DISCOVER],
    ['app-store.ts', STORE],
  ];

  // The `extract` pattern is no longer forbidden on the renderer pieces:
  // EXTR-008/009 legitimately wired the AI Extract button + progress and the
  // store's extract action into DiscoverPage.vue and app-store.ts (the same
  // reasoning that lifted the scan from main/preload above). Every other scope
  // boundary — scraping, executeJavaScript/insertCSS, scoring, scheduling — is
  // still enforced on all four files; the embedded surface and sites store
  // remain extraction-free.
  const EXTRACT_ALLOWED = new Set(['DiscoverPage.vue', 'app-store.ts']);

  for (const [fileName, body] of FILES) {
    for (const [label, pattern] of FORBIDDEN) {
      if (label === 'extract' && EXTRACT_ALLOWED.has(fileName)) continue;
      it(`${fileName} contains no "${label}" — deferred to a later epic`, () => {
        expect(body, `${fileName} matched forbidden pattern ${pattern}`).not.toMatch(pattern);
      });
    }
  }
});

describe('Epic NFR-002 — only user-selected sites are navigated', () => {
  it('Discover navigates with the persisted Site.url — never a free-form URL bar input', () => {
    // The renderer must look up the site object from the persisted list and
    // pass its url to the bridge. A free-form `<input v-model="urlBar">`
    // wired to navigate() would violate the egress guarantee.
    expect(DISCOVER).toMatch(/store\.sites\.find\(/);
    expect(DISCOVER).toMatch(/navigate\(\s*site\.url\s*\)/);
    // The URL pill is read-only display, not a text input.
    expect(DISCOVER).not.toMatch(/<input[^>]*v-model="activeUrl"/);
    expect(DISCOVER).not.toMatch(/<q-input[^>]*v-model="activeUrl"/);
  });
});

describe('Epic NFR-003 — persisting and loading never block the main UI thread', () => {
  it('all sites IPC handlers are async (return promises)', () => {
    expect(SITES).toMatch(/ipcMain\.handle\(\s*['"]sites:list['"]\s*,\s*async/);
    expect(SITES).toMatch(/ipcMain\.handle\(\s*['"]sites:add['"]\s*,\s*async/);
    expect(SITES).toMatch(/ipcMain\.handle\(\s*['"]sites:remove['"]\s*,\s*async/);
  });

  it('the navigate IPC handler returns the loadURL promise', () => {
    expect(SURFACE).toMatch(/return ensureView\(\)\.webContents\.loadURL/);
  });
});
