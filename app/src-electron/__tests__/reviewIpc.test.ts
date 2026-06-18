/**
 * Unit tests for the review IPC layer (AIREV-003).
 *
 * Acceptance criteria covered:
 *  - AC1: registerReviewIpc registers `review:generate` and `review:get`.
 *         generate reads key + default model + JD (Epic 3 jobs) + CV text +
 *         Profile (Epic 4), runs matchReview, persists via match_reviews,
 *         returns the review. get returns the cached review with stale.
 *  - AC2: handlers return a tagged-union result with stable error codes —
 *         NO_API_KEY / NO_DEFAULT_MODEL / MODEL_NOT_CAPABLE / LLM_ERROR —
 *         never throwing raw errors across IPC.
 *  - AC3: preload bridge declares window.starReview (generate / get); env.d.ts
 *         declares Window.starReview + MatchReview renderer types.
 *  - AC4: mark-stale hook flags affected reviews stale when CV/Profile changes
 *         or a job is re-extracted (FR-004).
 *  - AC5: generate returns NO_API_KEY when no key is configured and
 *         NO_DEFAULT_MODEL when no default model is selected (FR-001 / FR-005).
 *  - AC6: the review path performs no read/write of the Epic 5 match_scores
 *         store (FR-007 / NFR-001), and opens no egress beyond OpenRouter (NFR-002).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MatchReviewLLM, Review } from '../matchReview';
import type { PersistedMatchReview } from '../matchReviews';
import type { JobRecord } from '../jobs';
import type { CvRecord } from '../cv';
import type { ProfileRecord } from '../profile';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ELECTRON_DIR = path.resolve(__dirname, '..');
const SRC_DIR = path.resolve(ELECTRON_DIR, '..', 'src');

vi.mock('better-sqlite3', () => ({ default: class {} }));

// --- Fake IPC -------------------------------------------------------------

const ipcHandlers = new Map<string, (...args: unknown[]) => unknown>();
const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    ipcHandlers.set(channel, fn);
  },
  removeHandler: (channel: string) => {
    ipcHandlers.delete(channel);
  },
};

// --- Fixtures -------------------------------------------------------------

function makeJob(over: Partial<JobRecord> = {}): JobRecord {
  return {
    sourceId: 'job-1',
    hostname: 'jobs.example.com',
    url: 'https://jobs.example.com/1',
    title: 'Senior Platform Engineer',
    company: 'Acme',
    location: 'Remote',
    description: 'Must know Kubernetes. JD_NEEDLE.',
    postedAt: null,
    fetchedAt: 1,
    status: 'new',
    ...over,
  };
}

function makeProfile(over: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    name: 'Alice',
    targetRole: 'Platform Engineer',
    yearsExperience: 8,
    location: 'Remote',
    workMode: 'Remote',
    salaryMin: null,
    salaryCurrency: 'USD',
    linkedinUrl: '',
    links: [],
    skills: ['kubernetes', 'go'],
    strengthScore: 0,
    updatedAt: 0,
    ...over,
  };
}

function makeCv(over: Partial<CvRecord> = {}): CvRecord {
  return {
    id: 'cv-1',
    profileId: 'singleton',
    fileName: 'cv.pdf',
    mime: 'pdf',
    storagePath: 'cv/singleton/1-cv.pdf',
    parsedText: 'CV_NEEDLE: 8 years SRE / K8s.',
    parsedFields: null,
    version: 1,
    confidence: null,
    uploadedAt: 1,
    ...over,
  };
}

const RESPONSE_OK: Review = {
  requirements: [{ requirement: 'Kubernetes', evidence: 'CV_NEEDLE: 8 years SRE / K8s.', met: true }],
  gaps: [],
  strengths: ['Deep platform background'],
  keywords: ['kubernetes'],
  summary: 'Solid platform fit.',
};

function makeReviewsStore() {
  const rows = new Map<string, PersistedMatchReview>();
  return {
    rows,
    get: (id: string) => rows.get(id),
    upsert: (review: PersistedMatchReview | { sourceId: string } & Review & { modelSlug?: string; generatedAt?: number }) => {
      const stale = 'stale' in review ? (review as PersistedMatchReview).stale : false;
      rows.set(review.sourceId, { ...(review as PersistedMatchReview), stale });
    },
    markStale: (id: string) => {
      const r = rows.get(id);
      if (r) r.stale = true;
    },
  };
}

function makeJobsStore(jobs: JobRecord[] = [makeJob()]) {
  return {
    knownSourceIds: () => new Set(jobs.map((j) => j.sourceId)),
    upsertJobs: () => 0,
    listJobs: () => jobs,
    setStatus: vi.fn(),
    getSiteProfile: () => undefined,
    saveSiteProfile: vi.fn(),
  };
}

function makeCvStore(cvs: CvRecord[] = [makeCv()]) {
  return {
    upload: vi.fn(),
    list: () => [...cvs].sort((a, b) => b.version - a.version),
    get: (id: string) => cvs.find((c) => c.id === id) ?? null,
  };
}

function makeLlm(response: unknown, opts: { throwMessage?: string } = {}) {
  const calls: Array<{ prompt: unknown }> = [];
  const llm: MatchReviewLLM = {
    withStructuredOutput<T>(_schema: T) {
      return {
        invoke: async (prompt: unknown) => {
          calls.push({ prompt });
          if (opts.throwMessage) throw new Error(opts.throwMessage);
          return response as never;
        },
      };
    },
  };
  return { llm, calls };
}

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../reviewIpc');
}

// --- AC1: channel registration + happy path -------------------------------

describe('registerReviewIpc — channel registration (AC1)', () => {
  it('registers review:generate and review:get', async () => {
    const { registerReviewIpc } = await importModule();
    registerReviewIpc(fakeIpcMain as never, {
      store: makeReviewsStore() as never,
      jobsStore: makeJobsStore() as never,
      cvStore: makeCvStore() as never,
      getProfile: () => makeProfile(),
      getApiKey: () => 'sk-test',
      getDefaultModel: () => 'openrouter/test',
      buildLlm: async () => makeLlm(RESPONSE_OK).llm,
    });
    expect(ipcHandlers.has('review:generate')).toBe(true);
    expect(ipcHandlers.has('review:get')).toBe(true);
  });
});

describe('review:generate happy path (AC1)', () => {
  it('reads JD + CV + Profile, runs matchReview, persists, returns review', async () => {
    const { registerReviewIpc } = await importModule();
    const store = makeReviewsStore();
    const jd = 'Senior Platform Engineer. JD_NEEDLE_K8S.';
    const cv = makeCv({ parsedText: 'CV_NEEDLE_8YR' });
    const { llm, calls } = makeLlm(RESPONSE_OK);
    registerReviewIpc(fakeIpcMain as never, {
      store: store as never,
      jobsStore: makeJobsStore([makeJob({ description: jd })]) as never,
      cvStore: makeCvStore([cv]) as never,
      getProfile: () => makeProfile({ name: 'Alice' }),
      getApiKey: () => 'sk-test',
      getDefaultModel: () => 'openrouter/test',
      buildLlm: async () => llm,
      now: () => 12345,
    });

    const result = (await ipcHandlers.get('review:generate')!({}, 'job-1')) as
      | { ok: true; review: PersistedMatchReview }
      | { ok: false; code: string };
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.review.sourceId).toBe('job-1');
      expect(result.review.summary).toBe('Solid platform fit.');
      expect(result.review.generatedAt).toBe(12345);
      expect(result.review.modelSlug).toBe('openrouter/test');
      expect(result.review.stale).toBe(false);
    }
    expect(store.rows.get('job-1')).toBeDefined();

    // Prompt embedded JD + CV + Profile (sanity check via needles).
    const prompt = String(calls[0]?.prompt ?? '');
    expect(prompt).toContain('JD_NEEDLE_K8S');
    expect(prompt).toContain('CV_NEEDLE_8YR');
    expect(prompt).toContain('Alice');
  });
});

describe('review:get (AC1)', () => {
  it('returns the cached review with stale flag, or null if none', async () => {
    const { registerReviewIpc } = await importModule();
    const store = makeReviewsStore();
    store.upsert({
      sourceId: 'job-1',
      requirements: [],
      gaps: [],
      strengths: [],
      keywords: [],
      summary: 'cached',
      generatedAt: 1,
      modelSlug: 'm/x',
      stale: true,
    });
    registerReviewIpc(fakeIpcMain as never, {
      store: store as never,
      jobsStore: makeJobsStore() as never,
      cvStore: makeCvStore() as never,
      getProfile: () => makeProfile(),
      getApiKey: () => 'sk-test',
      getDefaultModel: () => 'm/x',
      buildLlm: async () => makeLlm(RESPONSE_OK).llm,
    });
    const got = (await ipcHandlers.get('review:get')!({}, 'job-1')) as PersistedMatchReview;
    expect(got.sourceId).toBe('job-1');
    expect(got.summary).toBe('cached');
    expect(got.stale).toBe(true);

    const miss = await ipcHandlers.get('review:get')!({}, 'nope');
    expect(miss).toBeNull();
  });
});

// --- AC2 + AC5: tagged-union with stable error codes -----------------------

describe('review:generate stable error codes (AC2 / AC5)', () => {
  function setup(overrides: Partial<Parameters<Awaited<ReturnType<typeof importModule>>['registerReviewIpc']>[1]> = {}) {
    return async () => {
      const { registerReviewIpc } = await importModule();
      registerReviewIpc(fakeIpcMain as never, {
        store: makeReviewsStore() as never,
        jobsStore: makeJobsStore() as never,
        cvStore: makeCvStore() as never,
        getProfile: () => makeProfile(),
        getApiKey: () => 'sk-test',
        getDefaultModel: () => 'openrouter/test',
        buildLlm: async () => makeLlm(RESPONSE_OK).llm,
        ...overrides,
      } as never);
    };
  }

  it('returns NO_API_KEY when no key is configured', async () => {
    await setup({ getApiKey: () => null })();
    const result = (await ipcHandlers.get('review:generate')!({}, 'job-1')) as {
      ok: false;
      code: string;
    };
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NO_API_KEY');
  });

  it('returns NO_API_KEY when the key is empty/whitespace', async () => {
    await setup({ getApiKey: () => '   ' })();
    const result = (await ipcHandlers.get('review:generate')!({}, 'job-1')) as {
      ok: false;
      code: string;
    };
    expect(result.code).toBe('NO_API_KEY');
  });

  it('returns NO_DEFAULT_MODEL when no default model is selected', async () => {
    await setup({ getDefaultModel: () => null })();
    const result = (await ipcHandlers.get('review:generate')!({}, 'job-1')) as {
      ok: false;
      code: string;
    };
    expect(result.code).toBe('NO_DEFAULT_MODEL');
  });

  it('returns MODEL_NOT_CAPABLE when the model rejects function calling', async () => {
    const { llm } = makeLlm(RESPONSE_OK, {
      throwMessage: 'This model does not support function calling',
    });
    await setup({ buildLlm: async () => llm })();
    const result = (await ipcHandlers.get('review:generate')!({}, 'job-1')) as {
      ok: false;
      code: string;
    };
    expect(result.code).toBe('MODEL_NOT_CAPABLE');
  });

  it('returns LLM_ERROR on a generic network / model error', async () => {
    const { llm } = makeLlm(RESPONSE_OK, { throwMessage: 'ECONNRESET' });
    await setup({ buildLlm: async () => llm })();
    const result = (await ipcHandlers.get('review:generate')!({}, 'job-1')) as {
      ok: false;
      code: string;
    };
    expect(result.code).toBe('LLM_ERROR');
  });

  it('returns JOB_NOT_FOUND when the sourceId does not match a job', async () => {
    await setup({ jobsStore: makeJobsStore([]) as never })();
    const result = (await ipcHandlers.get('review:generate')!({}, 'job-missing')) as {
      ok: false;
      code: string;
    };
    expect(result.code).toBe('JOB_NOT_FOUND');
  });

  it('returns NO_CV when there is no CV uploaded yet', async () => {
    await setup({ cvStore: makeCvStore([]) as never })();
    const result = (await ipcHandlers.get('review:generate')!({}, 'job-1')) as {
      ok: false;
      code: string;
    };
    expect(result.code).toBe('NO_CV');
  });

  it('never throws across the IPC boundary — always resolves to a tagged result', async () => {
    const failingBuilder = vi.fn(async () => {
      throw new Error('builder blew up');
    });
    await setup({ buildLlm: failingBuilder as never })();
    await expect(ipcHandlers.get('review:generate')!({}, 'job-1')).resolves.toMatchObject({
      ok: false,
    });
  });
});

// --- AC4: mark-stale hooks -------------------------------------------------

describe('mark-stale hooks (AC4 / FR-004)', () => {
  it('exports markAllReviewsStale that flips every known review stale (CV / Profile change)', async () => {
    const mod = await importModule();
    expect(typeof (mod as Record<string, unknown>).markAllReviewsStale).toBe('function');
    const store = makeReviewsStore();
    store.upsert({
      sourceId: 'a',
      requirements: [],
      gaps: [],
      strengths: [],
      keywords: [],
      summary: 'a',
      stale: false,
      generatedAt: 1,
    });
    store.upsert({
      sourceId: 'b',
      requirements: [],
      gaps: [],
      strengths: [],
      keywords: [],
      summary: 'b',
      stale: false,
      generatedAt: 1,
    });
    const jobsStore = makeJobsStore([makeJob({ sourceId: 'a' }), makeJob({ sourceId: 'b' })]);
    (mod as { markAllReviewsStale: (s: unknown, j: unknown) => void }).markAllReviewsStale(
      store,
      jobsStore,
    );
    expect(store.get('a')!.stale).toBe(true);
    expect(store.get('b')!.stale).toBe(true);
  });

  it('exports markReviewStale that flips one review stale (re-extract of one job)', async () => {
    const mod = await importModule();
    expect(typeof (mod as Record<string, unknown>).markReviewStale).toBe('function');
    const store = makeReviewsStore();
    store.upsert({
      sourceId: 'a',
      requirements: [],
      gaps: [],
      strengths: [],
      keywords: [],
      summary: 'a',
      stale: false,
      generatedAt: 1,
    });
    (mod as { markReviewStale: (s: unknown, id: string) => void }).markReviewStale(store, 'a');
    expect(store.get('a')!.stale).toBe(true);
  });
});

// --- AC6: strict separation from match_scores + no extra egress ------------

describe('strict separation from Epic 5 score store + egress (AC6 / NFR-001 / NFR-002)', () => {
  it('reviewIpc.ts source code never references the match_scores table or store', () => {
    const source = readFileSync(path.join(ELECTRON_DIR, 'reviewIpc.ts'), 'utf8');
    expect(source).not.toMatch(/match_scores/i);
    expect(source).not.toMatch(/MatchScoresStore/);
    expect(source).not.toMatch(/createMatchScoresStore/);
    expect(source).not.toMatch(/scores:/);
  });

  it('reviewIpc.ts opens no new egress — only the OpenRouter path via matchReview.ts', () => {
    const source = readFileSync(path.join(ELECTRON_DIR, 'reviewIpc.ts'), 'utf8');
    // No direct fetch / https / http requests
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/require\(['"]https?['"]\)/);
    expect(source).not.toMatch(/from\s+['"]node:https?['"]/);
    // No raw URL strings other than the OpenRouter one (which lives in matchReview.ts, not here).
    expect(source).not.toMatch(/https?:\/\//);
  });
});

// --- AC3: preload + env.d.ts bridge types ----------------------------------

describe('preload + env.d.ts bridge (AC3)', () => {
  it('electron-preload.ts exposes a window.starReview bridge with generate + get', () => {
    const source = readFileSync(path.join(ELECTRON_DIR, 'electron-preload.ts'), 'utf8');
    expect(source).toMatch(/starReview/);
    expect(source).toMatch(/review:generate/);
    expect(source).toMatch(/review:get/);
  });

  it('env.d.ts declares Window.starReview + MatchReview renderer types', () => {
    const source = readFileSync(path.join(SRC_DIR, 'env.d.ts'), 'utf8');
    expect(source).toMatch(/starReview\?:/);
    expect(source).toMatch(/StarReviewApi/);
    expect(source).toMatch(/StarMatchReview\b/);
    // narrative-only — no number / score / stars / percent in the renderer mirror
    const block = source.match(/interface StarMatchReview[\s\S]*?\n\}/);
    expect(block).toBeTruthy();
    if (block) {
      expect(block[0]).not.toMatch(/\bscore\b/i);
      expect(block[0]).not.toMatch(/\bstars?\b/i);
      expect(block[0]).not.toMatch(/\bpercent\b/i);
      expect(block[0]).not.toMatch(/\brating\b/i);
    }
  });
});
