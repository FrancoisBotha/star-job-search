/**
 * Unit tests for the eval-report IPC (EVAL-004 / Epic 14).
 *
 * Acceptance criteria coverage:
 *  - AC1: `eval:generate` / `eval:get` return a TAGGED-UNION result with the
 *         five stable error codes (NO_API_KEY / MODEL_NOT_CAPABLE /
 *         RATE_LIMITED / NETWORK / NO_SCORE); progress events stream over
 *         `eval:progress`.
 *  - AC3: the `webResearchEnabled` setting is persisted + exposed through
 *         dedicated IPC channels and the disclosure copy travels with it.
 *  - AC4: `eval:generate` triggers the Epic 6 review when missing (delegates
 *         to the EVAL-003 orchestrator) and the `markAll*` / `mark*` stale
 *         hooks flip cached reports without deleting them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('better-sqlite3', () => ({ default: class {} }));

import {
  EVAL_GENERATE_CHANNEL,
  EVAL_GET_CHANNEL,
  EVAL_PROGRESS_CHANNEL,
  WEB_RESEARCH_ACK_DISCLOSURE_CHANNEL,
  WEB_RESEARCH_GET_SETTING_CHANNEL,
  WEB_RESEARCH_SET_ENABLED_CHANNEL,
  markAllEvalReportsStale,
  markEvalReportStale,
  registerEvalIpc,
  type EvalGenerateResult,
  type EvalIpcDeps,
  type EvalProgressEvent,
} from '../evalIpc';
import type { JobsStore, JobRecord } from '../jobs';
import type { CvStore, CvRecord } from '../cv';
import type { ProfileRecord } from '../profile';
import type { MatchScoresStore } from '../matchScores';
import type {
  EvalReport,
  EvalReportsStore,
  PersistedEvalReport,
} from '../evalReports';
import type {
  MatchReviewsStore,
  PersistedMatchReview,
} from '../matchReviews';
import type { WebResearch } from '../webResearch';
import { WEB_RESEARCH_DISCLOSURE } from '../webResearch';
import type { WebResearchSettingsStore } from '../webResearchSettings';
import type { MatchScore } from '../scorer';

// --- Fake IPC -------------------------------------------------------------

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  },
  removeHandler: (channel: string) => handlers.delete(channel),
} as unknown as Electron.IpcMain;

beforeEach(() => handlers.clear());
afterEach(() => handlers.clear());

// --- Fakes ----------------------------------------------------------------

function profileFixture(over: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    name: 'Tester',
    targetRole: 'Platform Engineer',
    yearsExperience: 8,
    location: 'NYC',
    workMode: 'Remote',
    salaryMin: 200_000,
    salaryCurrency: 'USD',
    linkedinUrl: '',
    links: [],
    skills: ['kubernetes'],
    strengthScore: 80,
    dealbreakerKeywords: [],
    dealbreakerCompanies: [],
    dealbreakerSalaryMin: null,
    updatedAt: 1,
    ...over,
  };
}

function jobFixture(over: Partial<JobRecord> = {}): JobRecord {
  return {
    sourceId: 'job-1',
    hostname: 'example.com',
    url: 'https://example.com/jobs/1',
    title: 'Senior Platform Engineer',
    company: 'Acme Corp',
    location: 'NYC',
    description: 'Senior platform engineer. Stated comp: $180k.',
    salary: '$180k',
    fetchedAt: 1,
    status: 'new',
    ...over,
  };
}

function makeJobsStore(jobs: JobRecord[]): JobsStore {
  const known = new Set(jobs.map((j) => j.sourceId));
  return {
    knownSourceIds: () => new Set(known),
    upsertJobs: () => 0,
    listJobs: () => jobs.slice(),
    setStatus: () => undefined,
    deleteAll: () => 0,
    delete: () => 0,
    getSiteProfile: () => undefined,
    saveSiteProfile: () => undefined,
  };
}

function makeCvStore(text: string | null): CvStore {
  return {
    upload: async () => ({} as CvRecord),
    list: () =>
      text === null
        ? []
        : ([
            {
              id: 'cv-1',
              profileId: 'p-1',
              fileName: 'cv.pdf',
              mime: 'pdf',
              storagePath: 'cv/p-1/cv.pdf',
              parsedText: text,
              parsedFields: null,
              version: 1,
              confidence: null,
              uploadedAt: 1,
            },
          ] as CvRecord[]),
    get: () => null,
    clear: async () => ({ removedRows: 0, removedFiles: 0 }),
  };
}

function makeScoresStore(score?: MatchScore): MatchScoresStore {
  return {
    get: () => score,
    list: () => (score ? [score] : []),
    upsert: () => undefined,
    markStale: () => undefined,
    deleteAll: () => undefined,
    delete: () => undefined,
  };
}

function makeReviewsStore(
  initial?: PersistedMatchReview,
): MatchReviewsStore & { _row: () => PersistedMatchReview | undefined } {
  let row = initial;
  const upserts: PersistedMatchReview[] = [];
  return {
    get: () => row,
    upsert: (r) => {
      row = { ...r, stale: 'stale' in r ? r.stale : false };
      upserts.push({ ...row });
    },
    markStale: () => undefined,
    deleteAll: () => undefined,
    delete: () => undefined,
    _row: () => row,
  } as MatchReviewsStore & { _row: () => PersistedMatchReview | undefined };
}

function makeEvalReportsStore(): EvalReportsStore & {
  _upserts: () => EvalReport[];
  _staleCalls: () => string[];
} {
  const upserts: EvalReport[] = [];
  const staleCalls: string[] = [];
  let row: PersistedEvalReport | undefined;
  return {
    get: () => row,
    upsert: (r) => {
      upserts.push({ ...(r as EvalReport) });
      row = { ...(r as EvalReport), stale: false };
    },
    markStale: (id) => {
      staleCalls.push(id);
      if (row) row = { ...row, stale: true };
    },
    deleteAll: () => undefined,
    delete: () => undefined,
    _upserts: () => upserts,
    _staleCalls: () => staleCalls,
  } as EvalReportsStore & {
    _upserts: () => EvalReport[];
    _staleCalls: () => string[];
  };
}

function makeWebResearch(): WebResearch {
  return {
    isEnabled: () => false,
    setEnabled: () => undefined,
    isDisclosureAcknowledged: () => true,
    acknowledgeDisclosure: () => undefined,
    search: async () => ({
      ok: false,
      code: 'research_disabled',
      error: 'disabled',
    }),
    fetchUrl: async () => ({
      ok: false,
      code: 'research_disabled',
      error: 'disabled',
    }),
  };
}

function settingsFake(initial = {
  webResearchEnabled: false,
  disclosureAcknowledged: false,
}): WebResearchSettingsStore {
  let state = { ...initial };
  return {
    get: () => ({ ...state }),
    setEnabled: (enabled) => {
      state = { ...state, webResearchEnabled: enabled };
      return { ...state };
    },
    acknowledgeDisclosure: () => {
      state = { ...state, disclosureAcknowledged: true };
      return { ...state };
    },
  };
}

interface BuildLlmCalls {
  buildLlmCalls: Array<{ apiKey: string; model: string }>;
}

function buildLlmFactory(
  router: (schemaName: string | undefined) => unknown,
): EvalIpcDeps['buildLlm'] & BuildLlmCalls {
  const calls: BuildLlmCalls['buildLlmCalls'] = [];
  const fn = async ({ apiKey, model }: { apiKey: string; model: string }) => {
    calls.push({ apiKey, model });
    return {
      withStructuredOutput<T>(_schema: T, opts?: { name?: string }) {
        return {
          invoke: async () => router(opts?.name),
        };
      },
    } as unknown as Awaited<ReturnType<EvalIpcDeps['buildLlm']>>;
  };
  (fn as typeof fn & BuildLlmCalls).buildLlmCalls = calls;
  return fn as typeof fn & BuildLlmCalls;
}

function defaultRouter(schemaName: string | undefined): unknown {
  switch (schemaName) {
    case 'EvalBlockA':
      return { narrative: 'A narrative' };
    case 'EvalBlockC':
      return { narrative: 'C narrative' };
    case 'EvalBlockD':
      return { narrative: 'D narrative' };
    case 'EvalBlockG':
      return {
        narrative: 'G narrative',
        legitimacyVerdict: 'legitimate' as const,
        verificationNote: 'looks legitimate',
      };
    case 'MatchReview':
      return {
        requirements: [],
        gaps: [],
        strengths: ['s'],
        keywords: ['k'],
        summary: 'block B',
      };
    default:
      throw new Error(`unrecognised schemaName: ${String(schemaName)}`);
  }
}

function baseDeps(
  over: Partial<EvalIpcDeps> = {},
): EvalIpcDeps & {
  progressEvents: EvalProgressEvent[];
  evalReportsStore: ReturnType<typeof makeEvalReportsStore>;
  matchReviewsStore: ReturnType<typeof makeReviewsStore>;
} {
  const progressEvents: EvalProgressEvent[] = [];
  const evalReportsStore = makeEvalReportsStore();
  const matchReviewsStore = makeReviewsStore({
    sourceId: 'job-1',
    requirements: [],
    gaps: [],
    strengths: ['existing'],
    keywords: ['kw'],
    summary: 'cached block B',
    stale: false,
  });
  const deps: EvalIpcDeps = {
    store: evalReportsStore,
    matchScoresStore: makeScoresStore({
      sourceId: 'job-1',
      stars: 4,
      percent: 75,
      factors: [],
      weightsVersion: 'v1',
      stale: false,
      scoredAt: 1,
    }),
    matchReviewsStore,
    jobsStore: makeJobsStore([jobFixture()]),
    cvStore: makeCvStore('cv text'),
    getProfile: () => profileFixture(),
    getApiKey: () => 'sk-test',
    getDefaultModel: () => 'model-x',
    buildLlm: buildLlmFactory(defaultRouter),
    webResearch: makeWebResearch(),
    settingsStore: settingsFake(),
    emitProgress: (e) => progressEvents.push(e),
    now: () => 1_700_000_000,
    ...over,
  };
  return Object.assign(deps, {
    progressEvents,
    evalReportsStore: deps.store as ReturnType<typeof makeEvalReportsStore>,
    matchReviewsStore: deps.matchReviewsStore as ReturnType<typeof makeReviewsStore>,
  });
}

// --- Tests ----------------------------------------------------------------

describe('evalIpc — EVAL-004', () => {
  it('AC1: registers eval:get / eval:generate and webResearch:* channels', () => {
    const deps = baseDeps();
    registerEvalIpc(fakeIpcMain, deps);
    expect(handlers.has(EVAL_GET_CHANNEL)).toBe(true);
    expect(handlers.has(EVAL_GENERATE_CHANNEL)).toBe(true);
    expect(handlers.has(WEB_RESEARCH_GET_SETTING_CHANNEL)).toBe(true);
    expect(handlers.has(WEB_RESEARCH_SET_ENABLED_CHANNEL)).toBe(true);
    expect(handlers.has(WEB_RESEARCH_ACK_DISCLOSURE_CHANNEL)).toBe(true);
    expect(EVAL_PROGRESS_CHANNEL).toBe('eval:progress');
  });

  it('AC1: NO_API_KEY when the OpenRouter key is missing — tagged-union, no throw', async () => {
    const deps = baseDeps({ getApiKey: () => null });
    registerEvalIpc(fakeIpcMain, deps);
    const res = (await handlers.get(EVAL_GENERATE_CHANNEL)!(
      {},
      'job-1',
    )) as EvalGenerateResult;
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('NO_API_KEY');
    expect(deps.progressEvents.some((e) => e.phase === 'result')).toBe(true);
  });

  it('AC1: NO_SCORE when no deterministic Epic 5 score has been computed yet', async () => {
    const deps = baseDeps({ matchScoresStore: makeScoresStore() });
    registerEvalIpc(fakeIpcMain, deps);
    const res = (await handlers.get(EVAL_GENERATE_CHANNEL)!(
      {},
      'job-1',
    )) as EvalGenerateResult;
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('NO_SCORE');
  });

  it('AC1: MODEL_NOT_CAPABLE bubbles through from the orchestrator', async () => {
    const buildLlm = buildLlmFactory((name) => {
      if (name === 'EvalBlockA') {
        throw new Error('this model does not support function calling');
      }
      return defaultRouter(name);
    });
    const deps = baseDeps({ buildLlm });
    registerEvalIpc(fakeIpcMain, deps);
    const res = (await handlers.get(EVAL_GENERATE_CHANNEL)!(
      {},
      'job-1',
    )) as EvalGenerateResult;
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('MODEL_NOT_CAPABLE');
  });

  it('AC1: RATE_LIMITED classification for 429 / rate-limit errors', async () => {
    const buildLlm = buildLlmFactory((name) => {
      if (name === 'EvalBlockA') {
        throw new Error('429 Too Many Requests — please retry');
      }
      return defaultRouter(name);
    });
    const deps = baseDeps({ buildLlm });
    registerEvalIpc(fakeIpcMain, deps);
    const res = (await handlers.get(EVAL_GENERATE_CHANNEL)!(
      {},
      'job-1',
    )) as EvalGenerateResult;
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('RATE_LIMITED');
  });

  it('AC1: NETWORK classification for fetch / connection errors', async () => {
    const buildLlm = buildLlmFactory((name) => {
      if (name === 'EvalBlockA') {
        throw new Error('fetch failed: ENOTFOUND openrouter.ai');
      }
      return defaultRouter(name);
    });
    const deps = baseDeps({ buildLlm });
    registerEvalIpc(fakeIpcMain, deps);
    const res = (await handlers.get(EVAL_GENERATE_CHANNEL)!(
      {},
      'job-1',
    )) as EvalGenerateResult;
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe('NETWORK');
  });

  it('AC1: success returns the persisted report + the forwarded Epic 5 rating; eval:get returns it', async () => {
    const deps = baseDeps();
    registerEvalIpc(fakeIpcMain, deps);
    const res = (await handlers.get(EVAL_GENERATE_CHANNEL)!(
      {},
      'job-1',
    )) as EvalGenerateResult;
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.rating).toBe(4);
    expect(res.report.sourceId).toBe('job-1');
    expect(res.report.stale).toBe(false);
    const phases = deps.progressEvents.map((e) => e.phase);
    expect(phases).toContain('generating');
    expect(phases[phases.length - 1]).toBe('result');

    const got = await handlers.get(EVAL_GET_CHANNEL)!({}, 'job-1');
    expect(got).toBeTruthy();
    expect((got as PersistedEvalReport).sourceId).toBe('job-1');
  });

  it('AC4: when no Epic 6 review is cached, eval:generate triggers the orchestrator to build Block B and emits a "reviewing" progress event', async () => {
    const reviewsStore = makeReviewsStore(undefined);
    const deps = baseDeps({ matchReviewsStore: reviewsStore });
    registerEvalIpc(fakeIpcMain, deps);
    const res = (await handlers.get(EVAL_GENERATE_CHANNEL)!(
      {},
      'job-1',
    )) as EvalGenerateResult;
    expect(res.ok).toBe(true);
    expect(reviewsStore._row()).toBeTruthy();
    expect(deps.progressEvents.some((e) => e.phase === 'reviewing')).toBe(true);
  });

  it('AC4: markAllEvalReportsStale flips every known sourceId stale without deleting the row', () => {
    const store = makeEvalReportsStore();
    // Seed one row so we can observe the markStale hit.
    store.upsert({
      sourceId: 'job-1',
      blockA: 'a',
      blockC: 'c',
      blockD: 'd',
      blockG: 'g',
      blockH: '',
      sources: [],
      legitimacyVerdict: 'legitimate',
      verificationNote: '',
      generatedAt: 1,
    });
    const jobs = makeJobsStore([jobFixture(), jobFixture({ sourceId: 'job-2' })]);
    markAllEvalReportsStale(store, jobs);
    expect(store._staleCalls().sort()).toEqual(['job-1', 'job-2']);
  });

  it('AC4: markEvalReportStale flips just one row', () => {
    const store = makeEvalReportsStore();
    markEvalReportStale(store, 'job-7');
    expect(store._staleCalls()).toEqual(['job-7']);
  });

  it('AC3: webResearch:getSetting returns persisted flags + the verbatim disclosure copy', async () => {
    const settings = settingsFake({
      webResearchEnabled: true,
      disclosureAcknowledged: true,
    });
    const deps = baseDeps({ settingsStore: settings });
    registerEvalIpc(fakeIpcMain, deps);
    const got = (await handlers.get(WEB_RESEARCH_GET_SETTING_CHANNEL)!({})) as {
      webResearchEnabled: boolean;
      disclosureAcknowledged: boolean;
      disclosure: string;
    };
    expect(got.webResearchEnabled).toBe(true);
    expect(got.disclosureAcknowledged).toBe(true);
    expect(got.disclosure).toBe(WEB_RESEARCH_DISCLOSURE);
  });

  it('AC3: webResearch:setEnabled persists the toggle (consumed by EVAL-001)', async () => {
    const settings = settingsFake();
    const deps = baseDeps({ settingsStore: settings });
    registerEvalIpc(fakeIpcMain, deps);
    const updated = (await handlers.get(WEB_RESEARCH_SET_ENABLED_CHANNEL)!(
      {},
      true,
    )) as { webResearchEnabled: boolean; disclosure: string };
    expect(updated.webResearchEnabled).toBe(true);
    expect(settings.get().webResearchEnabled).toBe(true);
    expect(updated.disclosure).toBe(WEB_RESEARCH_DISCLOSURE);
  });

  it('AC3: webResearch:acknowledgeDisclosure flips the disclosure flag', async () => {
    const settings = settingsFake();
    const deps = baseDeps({ settingsStore: settings });
    registerEvalIpc(fakeIpcMain, deps);
    const updated = (await handlers.get(WEB_RESEARCH_ACK_DISCLOSURE_CHANNEL)!(
      {},
    )) as { disclosureAcknowledged: boolean };
    expect(updated.disclosureAcknowledged).toBe(true);
    expect(settings.get().disclosureAcknowledged).toBe(true);
  });
});
