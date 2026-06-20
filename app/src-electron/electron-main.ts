/**
 * Electron main process (used only when running `quasar dev -m electron`).
 * Opens the app in a frameless 1320×880 window — the design's native size —
 * with its own in-app title bar and window controls (see MainLayout.vue).
 */
import { app, BrowserWindow, dialog, Menu, ipcMain, safeStorage, shell, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJobBrowser, JOB_BROWSER_PARTITION } from './browser-surface';
import { createSitesStore, openSitesDatabase, registerSitesIpc } from './sites';
import { createProfileStore, registerProfileIpc } from './profile';
import { createCvStore, registerCvIpc } from './cv';
import { extractCvText } from './cvTextExtractor';
import { createApiKeyStore, registerApiKeyIpc } from './apiKey';
import { createLlmCatalogue, registerLlmCatalogueIpc } from './llmCatalogue';
import { createPreferredModelsStore, registerPreferredModelsIpc } from './preferredModels';
import { createCvStructurer, registerCvStructuringIpc } from './cvStructurer';
import { startMcpBrowserServer, type RunningMcpBrowserServer } from './mcp-browser-server';
import { createJobsStore } from './jobs';
import { buildDefaultExtractor, registerExtractionIpc } from './extraction';
import { registerShellIpc } from './shell';
import { compileTailoredDocToPdf } from './pdfExport';
import {
  createInMemoryPdfExportRecordsStore,
  registerPdfExportIpc,
} from './pdfExportIpc';
import { renderTailoredDocToDocx } from './wordExport';
import {
  createInMemoryWordExportRecordsStore,
  registerWordExportIpc,
} from './wordExportIpc';
import { createMatchScoresStore } from './matchScores';
import { createMatchReviewsStore } from './matchReviews';
import { buildMatchReviewLlm } from './matchReview';
import { markAllReviewsStale, registerReviewIpc } from './reviewIpc';
import { createTailoredDocsStore } from './tailoredDocs';
import { buildTailorLlm } from './tailor';
import {
  markAllTailoredDocsStale,
  markTailoredDocStale,
  registerTailorIpc,
} from './tailorIpc';
import {
  registerTailorEngineIpc,
  TAILOR_ENGINE_PROGRESS_CHANNEL,
  type TailorEngineProgressEvent,
} from './tailorEngineIpc';
import {
  registerExtractVisibleIpc,
  EXTRACT_VISIBLE_PROGRESS_CHANNEL,
} from './extractVisibleJobIpc';
import {
  createScoringRunner,
  isScoringRelevantProfileChange,
  registerScoringIpc,
  SCORES_PROGRESS_CHANNEL,
  type ScoringProgressEvent,
} from './scoring';
import type { ProfileInput, ProfileStore } from './profile';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

// A focused single-window app — drop Electron's auto-generated
// File/Edit/View/Window menu bar so it doesn't read as a generic shell.
Menu.setApplicationMenu(null);

// Windows: give the app its own taskbar identity so it groups on its own and
// shows the Star icon instead of electron.exe's default.
if (process.platform === 'win32') app.setAppUserModelId('com.starjobsearch.app');

// Expose the renderer's DevTools protocol during development only.
if (process.env.DEV) {
  app.commandLine.appendSwitch('remote-debugging-port', '9222');
}

let mainWindow: BrowserWindow | undefined;

// Active-target seam (EXTR-001). Tool calls into the in-process MCP browser
// server resolve their target via getActiveTarget() so a later ticket can
// retarget to a hidden crawler webContents without changing tool definitions.
let jobBrowser: ReturnType<typeof createJobBrowser> | undefined;
let activeTargetOverride: WebContents | undefined;
let mcpBrowserServer: RunningMcpBrowserServer | undefined;
let crawlerWindow: BrowserWindow | undefined;

export function getActiveTarget(): WebContents | undefined {
  // Default: the Discover-tab embedded browser. Override wins when set.
  return activeTargetOverride ?? jobBrowser?.view?.webContents;
}

export function setActiveTarget(wc: WebContents | undefined): void {
  activeTargetOverride = wc;
}

function createWindow() {
  // Windows taskbar/title use the multi-res .ico; png elsewhere. In dev the
  // icons aren't copied next to the compiled main, so resolve them from the
  // src-electron source; a packaged build has them beside the main process.
  const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconPath = process.env.DEV
    ? path.resolve(currentDir, '..', '..', 'src-electron', 'icons', iconName)
    : path.resolve(currentDir, 'icons', iconName);

  mainWindow = new BrowserWindow({
    icon: iconPath,
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 700,
    useContentSize: true,
    // Frameless: the renderer paints the title bar and window controls,
    // so the chrome matches the app's design on every platform.
    frame: false,
    backgroundColor: '#f3f1ea',
    webPreferences: {
      contextIsolation: true,
      preload: path.resolve(
        currentDir,
        path.join(
          process.env.QUASAR_ELECTRON_PRELOAD_FOLDER!,
          'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION,
        ),
      ),
    },
  });

  if (process.env.DEV) {
    void mainWindow.loadURL(process.env.APP_URL!);
  } else {
    void mainWindow.loadFile('index.html');
  }

  // Wire the embedded job-site browser surface (partitioned session,
  // preload-bridge channels). See src-electron/browser-surface.ts.
  jobBrowser = createJobBrowser(mainWindow);

  // Wire the persisted job-sites store + IPC. The DB file lives under the
  // OS-standard userData dir so it survives app restarts (FR-002).
  const sitesDb = openSitesDatabase(path.join(app.getPath('userData'), 'star.db'));
  registerSitesIpc(ipcMain, createSitesStore(sitesDb));

  // Wire the persisted match-scores store (SCORE-003). Reuses the shared
  // star.db handle so scores survive an app restart alongside the jobs and
  // profile rows. The store creates its own `match_scores` table on first run.
  const matchScoresStore = createMatchScoresStore(sitesDb);

  // Wire the persisted match-reviews store (AIREV-002 / Epic 6 §7). Reuses
  // the shared star.db handle so the AI narrative survives a restart. The
  // store is STRICTLY separate from match_scores — narrative only, no score
  // column by construction (Epic 6 hard boundary / NFR-001).
  const matchReviewsStore = createMatchReviewsStore(sitesDb);

  // Wire the persisted tailored-docs store (TAILOR-003 / Epic 7 FR-016).
  // Reuses the shared star.db handle; the store creates its own
  // `tailored_docs` table on first run. Drafts (CV + cover letter) per job
  // survive an app restart and are flagged stale (not deleted) when the
  // underlying CV/Profile changes or the job is re-extracted.
  const tailoredDocsStore = createTailoredDocsStore(sitesDb);

  // Wire the persisted jobs store (EXTR-003). Created here (earlier than its
  // historical position) so the mark-stale review hooks below have a stable
  // handle to enumerate known sourceIds with.
  const jobsStore = createJobsStore(sitesDb);

  // Wire the singleton Profile store + IPC (CVPROF-001). Reuses the shared
  // star.db handle; the store creates its own `profile` table on first run.
  //
  // SCORE-004 / FR-006: wrap the store so a save to a scoring-relevant field
  // flips affected MatchScore rows `stale` (the Epic 4 hook). Non-scoring
  // edits leave the prior scores untouched. The wrapper preserves the
  // ProfileStore contract so registerProfileIpc is unaware of the hook.
  const profileStore = createProfileStore(sitesDb);
  const profileStoreWithStaleHook: ProfileStore = {
    get: () => profileStore.get(),
    save: (input: ProfileInput) => {
      const prev = profileStore.get();
      const next = profileStore.save(input);
      if (isScoringRelevantProfileChange(prev, next)) {
        const ids = matchScoresStore.list().map((s) => s.sourceId);
        if (ids.length > 0) matchScoresStore.markStale(ids);
      }
      // AIREV-003 / FR-004: a Profile change can shift the LLM-side review
      // (skills emphasised, archetype focus, gap mitigation). Flip every
      // cached review stale so the UI offers a "regenerate" — the narrative
      // blob is preserved alongside it.
      markAllReviewsStale(matchReviewsStore, jobsStore);
      // TAILOR-004 / FR-016: a Profile change can shift the tailoring brief
      // (skills, target role). Flip every cached tailored draft stale so the
      // UI offers a regenerate; the prior draft is preserved.
      markAllTailoredDocsStale(tailoredDocsStore, jobsStore);
      return next;
    },
  };
  registerProfileIpc(ipcMain, profileStoreWithStaleHook);

  // Wire the versioned CV store + IPC (CVPROF-003). Binaries live under
  // <userData>/cv/<profileId>/ as portable relative paths; metadata and
  // extracted text live in the shared star.db. Text extraction is delegated
  // to the CVPROF-002 off-thread extractor so the UI thread is never blocked.
  //
  // AIREV-003 / FR-004: wrap `upload` so a new CV version flips every cached
  // AI Match Review stale — the narrative blob is preserved alongside a
  // "regenerate" affordance.
  const cvStore = createCvStore(sitesDb, {
    storageRoot: app.getPath('userData'),
    extractor: ({ filePath, mime }) => extractCvText({ filePath, mime }),
  });
  const cvStoreWithReviewStaleHook: typeof cvStore = {
    upload: async (input) => {
      const rec = await cvStore.upload(input);
      markAllReviewsStale(matchReviewsStore, jobsStore);
      // TAILOR-004 / FR-016: a new CV version invalidates the per-job tailored
      // drafts (they were grounded in a prior CV). Flag stale; preserve content.
      markAllTailoredDocsStale(tailoredDocsStore, jobsStore);
      return rec;
    },
    list: (profileId) => cvStore.list(profileId),
    get: (id) => cvStore.get(id),
    // CVPROF-014: clearing the CV invalidates every cached review for the
    // same reason an upload does — the JD-vs-CV narrative is now stale.
    clear: async (profileId) => {
      const result = await cvStore.clear(profileId);
      markAllReviewsStale(matchReviewsStore, jobsStore);
      // TAILOR-004 / FR-016: clearing the CV invalidates every cached draft.
      markAllTailoredDocsStale(tailoredDocsStore, jobsStore);
      return result;
    },
  };
  registerCvIpc(ipcMain, cvStoreWithReviewStaleHook);

  // Wire the preferred-models store + IPC (LLM-003). Shares the star.db
  // handle opened above; the store creates its own `preferred_models` table
  // on first run and enforces the max-5 / single-default invariants.
  const preferredModelsStore = createPreferredModelsStore(sitesDb);
  registerPreferredModelsIpc(ipcMain, preferredModelsStore);

  // Wire the OpenRouter API key store + IPC (LLM-001). The key is encrypted
  // with safeStorage and the blob lives next to the SQLite DB under userData.
  const apiKeyStore = createApiKeyStore({
    safeStorage,
    filePath: path.join(app.getPath('userData'), 'openrouter-key.bin'),
  });
  registerApiKeyIpc(ipcMain, apiKeyStore);

  // Wire the OpenRouter model catalogue + IPC (LLM-002). The catalogue reads
  // the decrypted key from the apiKey store, caches successful results, and
  // de-duplicates concurrent calls so reopening Settings doesn't refetch.
  const llmCatalogue = createLlmCatalogue({
    getApiKey: () => apiKeyStore.getRawKey(),
  });
  registerLlmCatalogueIpc(ipcMain, llmCatalogue);

  // Wire the CV LLM-structuring + IPC (CVPROF-004). The first real OpenRouter
  // completion call: reuses Epic 2's saved key (LLM-001) and selected default
  // model (LLM-003) and goes through the existing https://openrouter.ai/api/v1
  // egress (NFR-002). The renderer hands in the extracted CV text from
  // starCv.get(...).parsedText and receives parsedFields + per-field /
  // overall confidence flags for the review-and-edit step (FR-003, FR-004).
  const cvStructurer = createCvStructurer({
    getApiKey: () => apiKeyStore.getRawKey(),
    getDefaultModel: () => {
      const models = preferredModelsStore.list();
      const def = models.find((m) => m.isDefault);
      return def?.slug ?? null;
    },
  });
  registerCvStructuringIpc(ipcMain, cvStructurer);

  // Wire the agentic extraction runtime + IPC (EXTR-006). The jobs store is
  // backed by the same star.db handle used by sites / preferred-models. The
  // runtime drives a HIDDEN crawler webContents that shares the Discover
  // browser's partitioned session, so cookies / consent state carry over
  // without forcing the user to watch the page being scraped underneath
  // them. The active-target seam from EXTR-001 is used to retarget MCP tool
  // calls to the crawler for the duration of the run. (`jobsStore` is created
  // earlier — alongside the match-reviews store — so the mark-stale hooks can
  // enumerate known sourceIds.)
  const preferredModelsForExtraction = createPreferredModelsStore(sitesDb);

  // Wire the scoring runtime (SCORE-004). The runner pulls the freshest
  // Profile per batch via profileStore.get() so a CV upload / profile edit
  // takes effect on the next run. Progress streams to the renderer over the
  // shared `scores:progress` channel — the preload bridge subscribes to it.
  // Scoring is local-only: no API key, no model, no network reach this code
  // path (FR-008, NFR-002).
  const emitScoresProgress = (event: ScoringProgressEvent) => {
    mainWindow?.webContents.send(SCORES_PROGRESS_CHANNEL, event);
  };
  const scoringRunner = createScoringRunner({
    scoresStore: matchScoresStore,
    jobsStore,
    getProfile: () => profileStore.get(),
    emitProgress: emitScoresProgress,
  });
  registerScoringIpc(ipcMain, {
    scoresStore: matchScoresStore,
    jobsStore,
    getProfile: () => profileStore.get(),
    emitProgress: emitScoresProgress,
  });
  const preloadPath = path.resolve(
    currentDir,
    path.join(
      process.env.QUASAR_ELECTRON_PRELOAD_FOLDER!,
      'electron-preload' + process.env.QUASAR_ELECTRON_PRELOAD_EXTENSION,
    ),
  );
  const ensureCrawler = async (): Promise<WebContents> => {
    if (crawlerWindow && !crawlerWindow.isDestroyed()) {
      return crawlerWindow.webContents;
    }
    crawlerWindow = new BrowserWindow({
      show: false,
      width: 1280,
      height: 900,
      webPreferences: {
        partition: JOB_BROWSER_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: preloadPath,
      },
    });
    crawlerWindow.on('closed', () => {
      crawlerWindow = undefined;
    });
    return crawlerWindow.webContents;
  };

  registerExtractionIpc(ipcMain, {
    store: jobsStore,
    getVisibleTarget: () => jobBrowser?.view?.webContents,
    setActiveTarget,
    ensureCrawler,
    visibleNavigate: async (url: string) => {
      const wc = jobBrowser?.view?.webContents;
      if (!wc) throw new Error('Discover browser is not initialised yet');
      await wc.loadURL(url);
    },
    getApiKey: () => apiKeyStore.getRawKey(),
    getDefaultModel: () => {
      const models = preferredModelsForExtraction.list();
      const def = models.find((m) => m.isDefault);
      return def?.slug ?? null;
    },
    // EXTR-012 AC4: when the renderer triggers "delete all imported jobs",
    // also wipe every per-job derived row so no orphaned scores / reviews
    // remain to surface in the renderer caches or on the next restart.
    deleteRelated: () => {
      matchScoresStore.deleteAll();
      matchReviewsStore.deleteAll();
    },
    // EXTR-016 AC2: same cascade, but for a single sourceId — when the
    // renderer triggers a per-row permanent delete, also clear the matching
    // match_scores + match_reviews rows so no orphans remain.
    deleteRelatedOne: (sourceId: string) => {
      matchScoresStore.delete(sourceId);
      matchReviewsStore.delete(sourceId);
    },
    buildExtractor: (input) =>
      buildDefaultExtractor({
        ...input,
        // Only set mcpUrl when the server is up — exactOptionalPropertyTypes
        // forbids assigning `undefined` to the optional mcpUrl property.
        ...(mcpBrowserServer?.url ? { mcpUrl: mcpBrowserServer.url } : {}),
      }),
    emitProgress: (e) => {
      mainWindow?.webContents.send('extract:progress', e);
      // SCORE-004 / FR-006: when an extraction run completes, score the
      // jobs that don't have a MatchScore row yet. Fire-and-forget — the
      // scoring runner reports its own progress over `scores:progress`.
      if (e && (e as { phase?: string }).phase === 'done') {
        void scoringRunner.scoreNewJobs().catch(() => {
          // Best-effort: a scoring failure must never abort the extract.
        });
        // AIREV-003 / FR-004: an extraction run may have re-extracted (or
        // displaced) job descriptions; flip every cached review stale so the
        // UI offers a regenerate. Prior narrative blobs are preserved.
        try {
          markAllReviewsStale(matchReviewsStore, jobsStore);
        } catch {
          // Best-effort: a stale-marking failure must never abort the extract.
        }
        // TAILOR-004 / FR-016: a re-extracted JD invalidates each affected
        // job's tailored drafts. Flag stale; preserve content for the UI to
        // surface alongside the regenerate affordance.
        try {
          for (const id of Array.from(jobsStore.knownSourceIds())) {
            markTailoredDocStale(tailoredDocsStore, id);
          }
        } catch {
          // Best-effort: never abort the extract on a stale-marking failure.
        }
      }
    },
  });

  // Wire the AI Match Review IPC (AIREV-003 / Epic 6 §8). Reads the Epic 2
  // key + default model, the JD (Epic 3 jobs), and CV text + Profile
  // (Epic 4); runs one structured-output call via matchReview.ts; persists
  // via match_reviews. The review path NEVER reads or writes the Epic 5
  // match_scores store (NFR-001) and reuses the existing OpenRouter egress
  // (NFR-002) — no new egress here.
  registerReviewIpc(ipcMain, {
    store: matchReviewsStore,
    jobsStore,
    cvStore: cvStoreWithReviewStaleHook,
    getProfile: () => profileStore.get(),
    getApiKey: () => apiKeyStore.getRawKey(),
    getDefaultModel: () => {
      const models = preferredModelsStore.list();
      const def = models.find((m) => m.isDefault);
      return def?.slug ?? null;
    },
    buildLlm: ({ apiKey, model }) => buildMatchReviewLlm({ apiKey, model }),
  });

  // Wire the Tailor IPC (TAILOR-004 / Epic 7 §8). Reuses the Epic 2 key +
  // default model, the JD (Epic 3 jobs), CV text + structured fields +
  // Profile (Epic 4), and the cached Epic 6 review when present. The accept
  // path delegates score recomputation to the SAME deterministic Epic 5
  // scoring runner used by the rest of the app — tailoring NEVER calls the
  // LLM to score (FR-012 / NFR-002 hard boundary) and never writes
  // match_scores directly.
  registerTailorIpc(ipcMain, {
    store: tailoredDocsStore,
    jobsStore,
    cvStore: cvStoreWithReviewStaleHook,
    reviewsStore: matchReviewsStore,
    getProfile: () => profileStore.get(),
    getApiKey: () => apiKeyStore.getRawKey(),
    getDefaultModel: () => {
      const models = preferredModelsStore.list();
      const def = models.find((m) => m.isDefault);
      return def?.slug ?? null;
    },
    buildLlm: async ({ apiKey, model }) => {
      const built = await buildTailorLlm({ apiKey, model });
      if (!built.ok) {
        const err = built as unknown as { error: string };
        throw new Error(err.error);
      }
      return built.llm;
    },
    rescore: (sourceId: string) => scoringRunner.rescoreOne(sourceId),
  });

  // Wire the Tailor Engine IPC (TDE-006 / Epic 9). `tailor:propose` runs the
  // bounded LangGraph pipeline (TDE-005) and returns the full
  // TailorEngineResult for the renderer's diff-review UI. `tailor:apply`
  // applies the user-accepted subset DETERMINISTICALLY through the TDE-002
  // gates (NO LLM call), persists the saved tailored doc, and delegates the
  // rescore to the SAME Epic 5 scoring runner (FR-012 / NFR-002 hard
  // boundary). Per-node progress events stream over
  // `tailor-engine:progress`.
  const emitTailorEngineProgress = (event: TailorEngineProgressEvent) => {
    mainWindow?.webContents.send(TAILOR_ENGINE_PROGRESS_CHANNEL, event);
  };
  registerTailorEngineIpc(ipcMain, {
    store: tailoredDocsStore,
    jobsStore,
    cvStore: cvStoreWithReviewStaleHook,
    reviewsStore: matchReviewsStore,
    getProfile: () => profileStore.get(),
    getApiKey: () => apiKeyStore.getRawKey(),
    getDefaultModel: () => {
      const models = preferredModelsStore.list();
      const def = models.find((m) => m.isDefault);
      return def?.slug ?? null;
    },
    buildLlm: async ({ apiKey, model }) => {
      const built = await buildTailorLlm({ apiKey, model });
      if (!built.ok) {
        const err = built as unknown as { error: string };
        throw new Error(err.error);
      }
      return built.llm;
    },
    rescore: (sourceId: string) => scoringRunner.rescoreOne(sourceId),
    emitProgress: emitTailorEngineProgress,
  });

  // Wire the Extract-this-job IPC (XJOB-003 / Epic 11). Captures the
  // FOREGROUND embedded-browser tab (XJOB-001), runs ONE structured-output
  // LLM call against the Epic 3 JobSchema (XJOB-002), persists the row with
  // `source: 'manual'` provenance, and triggers the SAME Epic 5
  // deterministic rescore used by the bulk extractor (FR-006 / NFR-002).
  // Reuses the same OpenRouter egress + structured-output LLM builder as the
  // Epic 3 bulk extractor — no new network egress.
  registerExtractVisibleIpc(ipcMain, {
    jobsStore,
    getVisibleTarget: () => jobBrowser?.view?.webContents,
    getApiKey: () => apiKeyStore.getRawKey(),
    getDefaultModel: () => {
      const models = preferredModelsStore.list();
      const def = models.find((m) => m.isDefault);
      return def?.slug ?? null;
    },
    buildLlm: async ({ apiKey, model }) => {
      const built = await buildTailorLlm({ apiKey, model });
      if (!built.ok) {
        const err = built as unknown as { error: string };
        throw new Error(err.error);
      }
      return built.llm;
    },
    scoreOne: (sourceId: string) => scoringRunner.rescoreOne(sourceId),
    emitProgress: (e) =>
      mainWindow?.webContents.send(EXTRACT_VISIBLE_PROGRESS_CHANNEL, e),
  });

  // Wire the PDF-export IPC (PDFEX-004 / Epic 8 §7). Compiles the persisted
  // TailoredDoc via the bundled LaTeX engine (PDFEX-002), opens a native save
  // dialog, writes the PDF locally, and records provenance. Star performs NO
  // submission — it only writes a local file (FR-008). The compile function
  // is the PDFEX-002 entry point; dialog + shell + writeFile are passed in so
  // the IPC module stays free of direct Electron coupling and is unit-testable.
  const pdfExportRecords = createInMemoryPdfExportRecordsStore();
  registerPdfExportIpc(ipcMain, {
    docsStore: tailoredDocsStore,
    jobsStore,
    recordsStore: pdfExportRecords,
    compile: (input, opts) => compileTailoredDocToPdf(input, opts),
    dialog: {
      showSaveDialog: (opts) =>
        mainWindow
          ? dialog.showSaveDialog(mainWindow, opts)
          : dialog.showSaveDialog(opts),
    },
    shell: {
      showItemInFolder: (fullPath: string) => shell.showItemInFolder(fullPath),
    },
    writeFile: (filePath: string, data: Buffer) => writeFile(filePath, data),
  });

  // Wire the Word (.docx) export IPC (UEXP-003 / Epic 12). Renders the
  // approved tailored CV (+ optional cover letter) through the pinned `docx`
  // library (UEXP-002), opens a native save dialog, writes the .docx
  // locally, and records provenance. Star performs NO submission — it only
  // writes a local file (epic §9). The dialog / shell / writeFile / render
  // are passed in so the IPC module stays free of direct Electron coupling
  // and is unit-testable.
  const wordExportRecords = createInMemoryWordExportRecordsStore();
  registerWordExportIpc(ipcMain, {
    docsStore: tailoredDocsStore,
    jobsStore,
    recordsStore: wordExportRecords,
    render: (input) => renderTailoredDocToDocx(input),
    dialog: {
      showSaveDialog: (opts) =>
        mainWindow
          ? dialog.showSaveDialog(mainWindow, opts)
          : dialog.showSaveDialog(opts),
    },
    shell: {
      showItemInFolder: (fullPath: string) => shell.showItemInFolder(fullPath),
    },
    writeFile: (filePath: string, data: Buffer) => writeFile(filePath, data),
  });

  // Wire the external-shell IPC (JOBDET-001). Opens http/https URLs in the
  // user's OS default browser via Electron's `shell.openExternal`. Scheme
  // validation lives in the handler so file:/javascript:/etc. never reach
  // shell.openExternal.
  registerShellIpc(ipcMain, {
    openExternal: (url: string) => shell.openExternal(url),
  });

  // Keep the renderer's maximize control in sync with the real window state.
  const emitMaximized = () =>
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized());
  mainWindow.on('maximize', emitMaximized);
  mainWindow.on('unmaximize', emitMaximized);

  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
}

// Window-control IPC, driven by the in-app title bar.
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow?.close());

void app.whenReady().then(async () => {
  createWindow();
  // EXTR-001: bring up the in-process MCP browser server. Failure here must
  // never crash the app — startMcpBrowserServer catches and logs internally,
  // and we keep the optional return so close() can run on shutdown.
  mcpBrowserServer = await startMcpBrowserServer({ getActiveTarget });
});

app.on('will-quit', () => {
  void mcpBrowserServer?.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === undefined) createWindow();
});
