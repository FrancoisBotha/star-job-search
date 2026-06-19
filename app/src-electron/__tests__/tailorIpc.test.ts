/**
 * Unit tests for the tailor IPC layer (TAILOR-004).
 *
 * Acceptance criteria coverage:
 *  - AC1: registerTailorIpc registers tailor:generate | get | accept | export.
 *         generate reads JD (Epic 3), CV text + structured fields + Profile
 *         (Epic 4), and the cached Epic 6 review when present; calls tailor.ts
 *         + checkAts; persists via tailored_docs.
 *  - AC2: handlers return tagged-union results with stable error codes
 *         (NO_API_KEY, NO_DEFAULT_MODEL, NO_CV, JOB_NOT_FOUND, MODEL_NOT_CAPABLE,
 *         RATE_LIMITED, NETWORK_ERROR, LLM_ERROR, SCHEMA_ERROR, DRAFT_NOT_FOUND,
 *         SUGGESTION_NOT_FOUND); never throw across the IPC boundary.
 *  - AC3: accept(suggestionId) updates the draft and recomputes the score via
 *         the existing Epic 5 deterministic scorer (NOT the LLM). Declining
 *         leaves the score untouched; tailoring otherwise never writes scores.
 *  - AC4: export returns the document as text/Markdown for copy/export; no
 *         submission path exists.
 *  - AC5: markAllTailoredDocsStale / markTailoredDocStale hooks flip drafts
 *         stale when the base CV/Profile changes or the job is re-extracted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TailorLLM, TailoredCv } from '../tailor';
import type { TailoredDoc, TailoredDocsStore } from '../tailoredDocs';
import type { JobRecord } from '../jobs';
import type { CvRecord } from '../cv';
import type { ProfileRecord } from '../profile';
import type { PersistedMatchReview } from '../matchReviews';

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
    id: 'cv-7',
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

const TAILORED_CV_OK: TailoredCv = {
  summary: 'Senior platform engineer with 8 years SRE.',
  competencies: ['Kubernetes', 'Go', 'Terraform'],
  achievementBullets: ['Built K8s platforms at scale.'],
  keywords: ['kubernetes', 'terraform'],
  suggestions: [
    {
      area: 'summary',
      suggestion: 'Add a Kubernetes lead line',
      rationale: 'JD emphasises K8s ownership',
    },
    {
      area: 'bullets',
      suggestion: 'Lead with Terraform footprint',
      rationale: 'JD lists Terraform as required',
    },
  ],
  gaps: [
    { keyword: 'rust', severity: 'nice_to_have', adjacentExperience: 'Go' },
  ],
};

function makeTailoredDocsStore(initial: TailoredDoc[] = []) {
  const rows = new Map<string, TailoredDoc>();
  for (const d of initial) rows.set(`${d.sourceId}::${d.kind}`, d);
  const store: TailoredDocsStore = {
    get: (sourceId, kind) => rows.get(`${sourceId}::${kind}`),
    upsert: (doc) => {
      rows.set(`${doc.sourceId}::${doc.kind}`, { ...doc });
    },
    markStale: (sourceId, kind) => {
      if (kind) {
        const row = rows.get(`${sourceId}::${kind}`);
        if (row) row.stale = true;
      } else {
        for (const [k, v] of Array.from(rows.entries())) {
          if (v.sourceId === sourceId) {
            v.stale = true;
            rows.set(k, v);
          }
        }
      }
    },
  };
  return { store, rows };
}

function makeJobsStore(jobs: JobRecord[] = [makeJob()]) {
  return {
    knownSourceIds: () => new Set(jobs.map((j) => j.sourceId)),
    upsertJobs: () => 0,
    listJobs: () => jobs,
    setStatus: vi.fn(),
    deleteAll: () => 0,
    getSiteProfile: () => undefined,
    saveSiteProfile: vi.fn(),
  };
}

function makeCvStore(cvs: CvRecord[] = [makeCv()]) {
  return {
    upload: vi.fn(),
    list: () => [...cvs].sort((a, b) => b.version - a.version),
    get: (id: string) => cvs.find((c) => c.id === id) ?? null,
    clear: vi.fn(),
  };
}

function makeReviewsStore(reviews: PersistedMatchReview[] = []) {
  const rows = new Map<string, PersistedMatchReview>();
  for (const r of reviews) rows.set(r.sourceId, r);
  return {
    rows,
    get: (id: string) => rows.get(id),
    upsert: vi.fn(),
    markStale: (id: string) => {
      const r = rows.get(id);
      if (r) r.stale = true;
    },
  };
}

interface MakeLlmOpts {
  throwMessage?: string;
  response?: TailoredCv;
}

function makeLlm(opts: MakeLlmOpts = {}) {
  const calls: Array<{ prompt: unknown }> = [];
  const llm: TailorLLM = {
    withStructuredOutput<T>(_schema: T) {
      return {
        invoke: async (prompt: unknown) => {
          calls.push({ prompt });
          if (opts.throwMessage) throw new Error(opts.throwMessage);
          return (opts.response ?? TAILORED_CV_OK) as never;
        },
      };
    },
  };
  return { llm, calls };
}

function baseDeps(over: Record<string, unknown> = {}) {
  const docsStore = makeTailoredDocsStore();
  const jobsStore = makeJobsStore();
  const cvStore = makeCvStore();
  const reviewsStore = makeReviewsStore();
  const rescore = vi.fn(async (_sourceId: string) => ({ scored: 1 }));
  const { llm } = makeLlm();
  return {
    docsStore,
    jobsStore,
    cvStore,
    reviewsStore,
    rescore,
    deps: {
      store: docsStore.store,
      jobsStore,
      cvStore,
      reviewsStore,
      getProfile: () => makeProfile(),
      getApiKey: () => 'sk-test' as string | null,
      getDefaultModel: () => 'openrouter/test' as string | null,
      buildLlm: async () => llm,
      rescore,
      now: () => 12345,
      ...over,
    },
  };
}

beforeEach(() => {
  ipcHandlers.clear();
});

afterEach(() => {
  vi.resetModules();
});

async function importModule() {
  return await import('../tailorIpc');
}

// --- AC1: registration + happy path --------------------------------------

describe('registerTailorIpc — channel registration (AC1)', () => {
  it('registers tailor:generate | get | accept | export', async () => {
    const { registerTailorIpc } = await importModule();
    const { deps } = baseDeps();
    registerTailorIpc(fakeIpcMain as never, deps as never);
    expect(ipcHandlers.has('tailor:generate')).toBe(true);
    expect(ipcHandlers.has('tailor:get')).toBe(true);
    expect(ipcHandlers.has('tailor:accept')).toBe(true);
    expect(ipcHandlers.has('tailor:export')).toBe(true);
  });
});

describe('tailor:generate happy path (AC1)', () => {
  it('reads JD + CV + Profile, runs tailor.ts + ATS check, persists via tailored_docs', async () => {
    const { registerTailorIpc } = await importModule();
    const setup = baseDeps();
    const { llm, calls } = makeLlm();
    const deps = {
      ...setup.deps,
      buildLlm: async () => llm,
    };
    registerTailorIpc(fakeIpcMain as never, deps as never);

    const result = (await ipcHandlers.get('tailor:generate')!({}, {
      sourceId: 'job-1',
      kind: 'cv',
    })) as { ok: true; doc: TailoredDoc } | { ok: false; code: string };

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.sourceId).toBe('job-1');
      expect(result.doc.kind).toBe('cv');
      expect(result.doc.baseCvId).toBe('cv-7');
      expect(result.doc.modelSlug).toBe('openrouter/test');
      expect(result.doc.generatedAt).toBe(12345);
      expect(result.doc.stale).toBe(false);
      expect(result.doc.suggestions.length).toBeGreaterThan(0);
      expect(result.doc.atsReport).toBeDefined();
      expect(Array.isArray(result.doc.keywords)).toBe(true);
    }
    expect(setup.docsStore.rows.get('job-1::cv')).toBeDefined();

    const prompt = String(calls[0]?.prompt ?? '');
    expect(prompt).toContain('JD_NEEDLE');
    expect(prompt).toContain('CV_NEEDLE');
    expect(prompt).toContain('Alice');
  });

  it('embeds the cached Epic 6 review as a tailoring brief when present', async () => {
    const { registerTailorIpc } = await importModule();
    const reviewsStore = makeReviewsStore([
      {
        sourceId: 'job-1',
        archetype: 'platform',
        requirements: [],
        gaps: [],
        strengths: ['Strong K8s ownership'],
        keywords: ['kubernetes'],
        summary: 'REVIEW_NEEDLE: a strong fit overall.',
        stale: false,
        generatedAt: 1,
        modelSlug: 'm/x',
      },
    ]);
    const { llm, calls } = makeLlm();
    const setup = baseDeps({ reviewsStore, buildLlm: async () => llm });
    const deps = { ...setup.deps, reviewsStore, buildLlm: async () => llm };
    registerTailorIpc(fakeIpcMain as never, deps as never);

    await ipcHandlers.get('tailor:generate')!({}, { sourceId: 'job-1', kind: 'cv' });
    const prompt = String(calls[0]?.prompt ?? '');
    expect(prompt).toContain('REVIEW_NEEDLE');
  });
});

describe('tailor:get (AC1)', () => {
  it('returns cached doc or null', async () => {
    const { registerTailorIpc } = await importModule();
    const cached: TailoredDoc = {
      sourceId: 'job-1',
      kind: 'cv',
      content: 'cached body',
      suggestions: [],
      atsReport: { score: 0, missingKeywords: [] },
      keywords: [],
      intensity: 'light',
      baseCvId: 'cv-7',
      modelSlug: 'm/x',
      generatedAt: 1,
      stale: true,
    };
    const docsStore = makeTailoredDocsStore([cached]);
    const setup = baseDeps();
    registerTailorIpc(fakeIpcMain as never, {
      ...setup.deps,
      store: docsStore.store,
    } as never);

    const got = (await ipcHandlers.get('tailor:get')!({}, {
      sourceId: 'job-1',
      kind: 'cv',
    })) as TailoredDoc;
    expect(got.content).toBe('cached body');
    expect(got.stale).toBe(true);

    const miss = await ipcHandlers.get('tailor:get')!({}, {
      sourceId: 'nope',
      kind: 'cv',
    });
    expect(miss).toBeNull();
  });
});

// --- AC2: tagged-union with stable error codes ---------------------------

describe('tailor:generate stable error codes (AC2)', () => {
  async function run(over: Record<string, unknown>, input: unknown = { sourceId: 'job-1', kind: 'cv' }) {
    const { registerTailorIpc } = await importModule();
    const setup = baseDeps(over);
    registerTailorIpc(fakeIpcMain as never, { ...setup.deps, ...over } as never);
    return (await ipcHandlers.get('tailor:generate')!({}, input)) as {
      ok: false;
      code: string;
    };
  }

  it('NO_API_KEY when no key configured', async () => {
    const r = await run({ getApiKey: () => null });
    expect(r.code).toBe('NO_API_KEY');
  });

  it('NO_API_KEY when key is whitespace', async () => {
    const r = await run({ getApiKey: () => '   ' });
    expect(r.code).toBe('NO_API_KEY');
  });

  it('NO_DEFAULT_MODEL when no default model selected', async () => {
    const r = await run({ getDefaultModel: () => null });
    expect(r.code).toBe('NO_DEFAULT_MODEL');
  });

  it('JOB_NOT_FOUND when sourceId not in jobs store', async () => {
    const r = await run({ jobsStore: makeJobsStore([]) }, { sourceId: 'missing', kind: 'cv' });
    expect(r.code).toBe('JOB_NOT_FOUND');
  });

  it('NO_CV when no CV uploaded yet', async () => {
    const r = await run({ cvStore: makeCvStore([]) });
    expect(r.code).toBe('NO_CV');
  });

  it('MODEL_NOT_CAPABLE when the model rejects function calling', async () => {
    const { llm } = makeLlm({ throwMessage: 'This model does not support function calling' });
    const r = await run({ buildLlm: async () => llm });
    expect(r.code).toBe('MODEL_NOT_CAPABLE');
  });

  it('RATE_LIMITED on HTTP 429', async () => {
    const { llm } = makeLlm({ throwMessage: 'HTTP 429 rate limit exceeded' });
    const r = await run({ buildLlm: async () => llm });
    expect(r.code).toBe('RATE_LIMITED');
  });

  it('NETWORK_ERROR on ECONNRESET / fetch failure', async () => {
    const { llm } = makeLlm({ throwMessage: 'fetch failed: ECONNRESET' });
    const r = await run({ buildLlm: async () => llm });
    expect(r.code).toBe('NETWORK_ERROR');
  });

  it('LLM_ERROR on a generic model error', async () => {
    const { llm } = makeLlm({ throwMessage: 'unexpected model error' });
    const r = await run({ buildLlm: async () => llm });
    expect(r.code).toBe('LLM_ERROR');
  });

  it('never throws across the IPC boundary — always tagged result', async () => {
    const failingBuilder = vi.fn(async () => {
      throw new Error('builder blew up');
    });
    await expect(
      (async () => {
        const r = await run({ buildLlm: failingBuilder });
        return r;
      })(),
    ).resolves.toMatchObject({ ok: false });
  });
});

// --- AC3: accept triggers Epic 5 rescore; decline does not write scores --

describe('tailor:accept triggers deterministic Epic 5 rescore (AC3)', () => {
  it('accept(suggestionId) updates the draft and calls rescore(sourceId) — NOT the LLM', async () => {
    const { registerTailorIpc } = await importModule();
    const cached: TailoredDoc = {
      sourceId: 'job-1',
      kind: 'cv',
      content: 'body',
      suggestions: [
        { id: 'sug-1', type: 'Keyword', gain: 5, text: 'Add K8s line' },
        { id: 'sug-2', type: 'Reword', gain: 3, text: 'Clarify ownership' },
      ],
      atsReport: { score: 70, missingKeywords: [] },
      keywords: [],
      intensity: 'light',
      baseCvId: 'cv-7',
      modelSlug: 'm/x',
      generatedAt: 1,
      stale: false,
    };
    const docsStore = makeTailoredDocsStore([cached]);
    const rescore = vi.fn(async (_id: string) => ({ scored: 1 }));
    const { llm, calls } = makeLlm();
    const setup = baseDeps();
    registerTailorIpc(fakeIpcMain as never, {
      ...setup.deps,
      store: docsStore.store,
      rescore,
      buildLlm: async () => llm,
    } as never);

    const result = (await ipcHandlers.get('tailor:accept')!({}, {
      sourceId: 'job-1',
      kind: 'cv',
      suggestionId: 'sug-1',
    })) as { ok: true; doc: TailoredDoc; scored: number };

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.doc.suggestions.find((s) => s.id === 'sug-1')).toBeUndefined();
      expect(result.doc.suggestions.find((s) => s.id === 'sug-2')).toBeDefined();
    }
    expect(rescore).toHaveBeenCalledWith('job-1');
    // accept must NEVER call the LLM (AC3 — deterministic scorer only).
    expect(calls.length).toBe(0);
  });

  it('returns DRAFT_NOT_FOUND if no draft exists yet', async () => {
    const { registerTailorIpc } = await importModule();
    const setup = baseDeps();
    registerTailorIpc(fakeIpcMain as never, setup.deps as never);

    const r = (await ipcHandlers.get('tailor:accept')!({}, {
      sourceId: 'job-1',
      kind: 'cv',
      suggestionId: 'sug-1',
    })) as { ok: false; code: string };
    expect(r.code).toBe('DRAFT_NOT_FOUND');
    expect(setup.rescore).not.toHaveBeenCalled();
  });

  it('returns SUGGESTION_NOT_FOUND when the suggestion id is unknown — does not rescore', async () => {
    const { registerTailorIpc } = await importModule();
    const cached: TailoredDoc = {
      sourceId: 'job-1',
      kind: 'cv',
      content: 'body',
      suggestions: [{ id: 'sug-1', type: 't', gain: 1, text: 'x' }],
      atsReport: { score: 0, missingKeywords: [] },
      keywords: [],
      intensity: 'light',
      baseCvId: 'cv-7',
      modelSlug: 'm/x',
      generatedAt: 1,
      stale: false,
    };
    const docsStore = makeTailoredDocsStore([cached]);
    const setup = baseDeps();
    const rescore = vi.fn(async () => ({ scored: 1 }));
    registerTailorIpc(fakeIpcMain as never, {
      ...setup.deps,
      store: docsStore.store,
      rescore,
    } as never);

    const r = (await ipcHandlers.get('tailor:accept')!({}, {
      sourceId: 'job-1',
      kind: 'cv',
      suggestionId: 'sug-missing',
    })) as { ok: false; code: string };
    expect(r.code).toBe('SUGGESTION_NOT_FOUND');
    expect(rescore).not.toHaveBeenCalled();
  });
});

// --- AC4: export returns text/markdown -----------------------------------

describe('tailor:export (AC4)', () => {
  it('returns the document as text/Markdown for copy/export — no submission path', async () => {
    const { registerTailorIpc } = await importModule();
    const cached: TailoredDoc = {
      sourceId: 'job-1',
      kind: 'cv',
      content: '# Tailored CV\n\nBody text.',
      suggestions: [],
      atsReport: { score: 0, missingKeywords: [] },
      keywords: [],
      intensity: 'light',
      baseCvId: 'cv-7',
      modelSlug: 'm/x',
      generatedAt: 1,
      stale: false,
    };
    const docsStore = makeTailoredDocsStore([cached]);
    const setup = baseDeps();
    registerTailorIpc(fakeIpcMain as never, {
      ...setup.deps,
      store: docsStore.store,
    } as never);

    const result = (await ipcHandlers.get('tailor:export')!({}, {
      sourceId: 'job-1',
      kind: 'cv',
    })) as { ok: true; format: string; mimeType: string; content: string };

    expect(result.ok).toBe(true);
    expect(result.format).toBe('markdown');
    expect(result.mimeType).toMatch(/^text\/(markdown|plain)/);
    expect(result.content).toContain('# Tailored CV');
  });

  it('returns DRAFT_NOT_FOUND when no draft exists', async () => {
    const { registerTailorIpc } = await importModule();
    const setup = baseDeps();
    registerTailorIpc(fakeIpcMain as never, setup.deps as never);
    const r = (await ipcHandlers.get('tailor:export')!({}, {
      sourceId: 'job-1',
      kind: 'cv',
    })) as { ok: false; code: string };
    expect(r.code).toBe('DRAFT_NOT_FOUND');
  });
});

// --- AC5: mark-stale hooks -----------------------------------------------

describe('mark-stale hooks (AC5 / FR-016)', () => {
  it('markAllTailoredDocsStale stales every known doc (CV / Profile change)', async () => {
    const mod = await importModule();
    expect(typeof (mod as Record<string, unknown>).markAllTailoredDocsStale).toBe('function');
    const docs: TailoredDoc[] = [
      {
        sourceId: 'a',
        kind: 'cv',
        content: 'x',
        suggestions: [],
        atsReport: { score: 0, missingKeywords: [] },
        keywords: [],
        intensity: 'light',
        baseCvId: 'cv-1',
        modelSlug: 'm',
        generatedAt: 1,
        stale: false,
      },
      {
        sourceId: 'b',
        kind: 'cover-letter',
        content: 'y',
        suggestions: [],
        atsReport: { score: 0, missingKeywords: [] },
        keywords: [],
        intensity: 'light',
        baseCvId: 'cv-1',
        modelSlug: 'm',
        generatedAt: 1,
        stale: false,
      },
    ];
    const docsStore = makeTailoredDocsStore(docs);
    const jobsStore = makeJobsStore([makeJob({ sourceId: 'a' }), makeJob({ sourceId: 'b' })]);

    (mod as { markAllTailoredDocsStale: (s: unknown, j: unknown) => void }).markAllTailoredDocsStale(
      docsStore.store,
      jobsStore,
    );
    expect(docsStore.store.get('a', 'cv')!.stale).toBe(true);
    expect(docsStore.store.get('b', 'cover-letter')!.stale).toBe(true);
  });

  it('markTailoredDocStale stales every draft for one job (per-job re-extract)', async () => {
    const mod = await importModule();
    expect(typeof (mod as Record<string, unknown>).markTailoredDocStale).toBe('function');
    const docs: TailoredDoc[] = [
      {
        sourceId: 'job-1',
        kind: 'cv',
        content: 'x',
        suggestions: [],
        atsReport: { score: 0, missingKeywords: [] },
        keywords: [],
        intensity: 'light',
        baseCvId: 'cv-1',
        modelSlug: 'm',
        generatedAt: 1,
        stale: false,
      },
      {
        sourceId: 'job-1',
        kind: 'cover-letter',
        content: 'y',
        suggestions: [],
        atsReport: { score: 0, missingKeywords: [] },
        keywords: [],
        intensity: 'light',
        baseCvId: 'cv-1',
        modelSlug: 'm',
        generatedAt: 1,
        stale: false,
      },
    ];
    const docsStore = makeTailoredDocsStore(docs);
    (mod as { markTailoredDocStale: (s: unknown, id: string) => void }).markTailoredDocStale(
      docsStore.store,
      'job-1',
    );
    expect(docsStore.store.get('job-1', 'cv')!.stale).toBe(true);
    expect(docsStore.store.get('job-1', 'cover-letter')!.stale).toBe(true);
  });
});

// --- AC6: preload bridge + env.d.ts types --------------------------------

describe('preload bridge + env.d.ts (AC6)', () => {
  it('electron-preload.ts exposes window.starTailor with generate/get/accept/export', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const preload = readFileSync(
      path.resolve(process.cwd(), 'src-electron', 'electron-preload.ts'),
      'utf8',
    );
    expect(preload).toMatch(/exposeInMainWorld\(\s*['"]starTailor['"]/);
    expect(preload).toMatch(/tailor:generate/);
    expect(preload).toMatch(/tailor:get/);
    expect(preload).toMatch(/tailor:accept/);
    expect(preload).toMatch(/tailor:export/);
  });

  it('env.d.ts declares window.starTailor + StarTailoredDoc renderer types', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const env = readFileSync(
      path.resolve(process.cwd(), 'src', 'env.d.ts'),
      'utf8',
    );
    expect(env).toMatch(/StarTailoredDoc/);
    expect(env).toMatch(/StarTailorApi/);
    expect(env).toMatch(/starTailor\?:/);
  });
});
