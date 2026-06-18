/**
 * Unit tests for the CVPROF-005 app-store wiring: Profile + CV state/actions,
 * profile-strength getter, minimum-scorable gate, and scoring-relevant edit
 * staleness.
 *
 * Covers:
 *  - AC1: profile state + actions backed by window.starProfile.{get,save}
 *  - AC2: CV state + actions backed by window.starCv.* + structuring flow
 *  - AC3: the store does not import the PARSED_SKILLS / Alex_Morgan mock
 *  - AC4: profileStrength / isScorable / missingScoringFields / strengthRubric
 *  - AC5: editing scoring-relevant fields sets scoresStale
 *  - AC6: workMode binding still works against the new Profile state
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_SOURCE = readFileSync(path.join(__dirname, 'app-store.ts'), 'utf8');

interface FakeProfile {
  name: string;
  targetRole: string;
  yearsExperience: number | null;
  location: string;
  workMode: 'Remote' | 'Hybrid' | 'On-site';
  salaryMin: number | null;
  salaryCurrency: string;
  linkedinUrl: string;
  links: string[];
  skills: string[];
  strengthScore: number;
  updatedAt: number;
}

function emptyProfile(): FakeProfile {
  return {
    name: '',
    targetRole: '',
    yearsExperience: null,
    location: '',
    workMode: 'Remote',
    salaryMin: null,
    salaryCurrency: 'GBP',
    linkedinUrl: '',
    links: [],
    skills: [],
    strengthScore: 0,
    updatedAt: 0,
  };
}

interface FakeCv {
  id: string;
  profileId: string;
  fileName: string;
  mime: 'pdf' | 'docx';
  storagePath: string;
  parsedText: string;
  parsedFields: Record<string, unknown> | null;
  version: number;
  confidence: number | null;
  uploadedAt: number;
}

function installBridges(opts: {
  profile?: FakeProfile;
  profileSave?: (patch: Partial<FakeProfile>) => Promise<FakeProfile>;
  cvs?: FakeCv[];
  cvUpload?: (input: { filePath: string; fileName: string; mime: 'pdf' | 'docx' }) => Promise<FakeCv>;
  structureResult?:
    | { ok: true; parsedFields: Record<string, unknown>; confidence: { overall: number; perField: Record<string, number> } }
    | { ok: false; code: string; message: string };
} = {}) {
  const profile = opts.profile ?? emptyProfile();
  let currentProfile = { ...profile };
  const cvs = opts.cvs ?? [];

  const starProfile = {
    get: vi.fn(async () => ({ ...currentProfile })),
    save: vi.fn(async (patch: Partial<FakeProfile>) => {
      if (opts.profileSave) {
        currentProfile = await opts.profileSave(patch);
      } else {
        currentProfile = { ...currentProfile, ...patch, updatedAt: 123 };
      }
      return { ...currentProfile };
    }),
  };
  const starCv = {
    upload: vi.fn(opts.cvUpload ?? (async (input) => {
      const cv: FakeCv = {
        id: `cv-${cvs.length + 1}`,
        profileId: 'p1',
        fileName: input.fileName,
        mime: input.mime,
        storagePath: `cv/${cvs.length + 1}.${input.mime}`,
        parsedText: '',
        parsedFields: null,
        version: cvs.length + 1,
        confidence: null,
        uploadedAt: Date.now(),
      };
      cvs.push(cv);
      return { ...cv };
    })),
    list: vi.fn(async () => cvs.map((c) => ({ ...c }))),
    get: vi.fn(async (id: string) => {
      const found = cvs.find((c) => c.id === id);
      return found ? { ...found } : null;
    }),
  };
  const starCvStructurer = {
    structure: vi.fn(async (_text: string) =>
      opts.structureResult ?? {
        ok: true as const,
        parsedFields: { name: 'A', skills: ['x'] },
        confidence: { overall: 0.9, perField: {} },
      },
    ),
  };

  (globalThis as { window?: unknown }).window = {
    starProfile,
    starCv,
    starCvStructurer,
  };
  return { starProfile, starCv, starCvStructurer, getCurrentProfile: () => currentProfile };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('app-store profile — AC1 backed by window.starProfile', () => {
  it('loadProfile pulls the persisted Profile and hydrates state', async () => {
    const persisted: FakeProfile = {
      ...emptyProfile(),
      name: 'Alex',
      targetRole: 'Senior Product Designer',
      skills: ['Figma', 'Design systems'],
      location: 'Manchester',
      workMode: 'Hybrid',
    };
    const { starProfile } = installBridges({ profile: persisted });
    const store = useAppStore();

    await store.loadProfile();

    expect(starProfile.get).toHaveBeenCalledTimes(1);
    expect(store.profile?.name).toBe('Alex');
    expect(store.profile?.targetRole).toBe('Senior Product Designer');
    expect(store.profile?.workMode).toBe('Hybrid');
    // workMode top-level mirror also rehydrated for the existing ProfilePage binding
    expect(store.workMode).toBe('Hybrid');
  });

  it('saveProfile persists the patch via starProfile.save and merges the response', async () => {
    const { starProfile } = installBridges();
    const store = useAppStore();
    await store.loadProfile();

    await store.saveProfile({ targetRole: 'Lead UX Designer', skills: ['Figma'] });

    expect(starProfile.save).toHaveBeenCalledWith({
      targetRole: 'Lead UX Designer',
      skills: ['Figma'],
    });
    expect(store.profile?.targetRole).toBe('Lead UX Designer');
    expect(store.profile?.skills).toEqual(['Figma']);
  });
});

describe('app-store CV — AC2 backed by window.starCv', () => {
  it('listCvs populates cvs and currentCv (latest version) from starCv.list', async () => {
    const cvs: FakeCv[] = [
      {
        id: 'a', profileId: 'p1', fileName: 'old.pdf', mime: 'pdf', storagePath: 'cv/a.pdf',
        parsedText: '', parsedFields: null, version: 1, confidence: 0.8, uploadedAt: 1,
      },
      {
        id: 'b', profileId: 'p1', fileName: 'new.pdf', mime: 'pdf', storagePath: 'cv/b.pdf',
        parsedText: '', parsedFields: null, version: 2, confidence: 0.9, uploadedAt: 2,
      },
    ];
    const { starCv } = installBridges({ cvs });
    const store = useAppStore();
    await store.listCvs();
    expect(starCv.list).toHaveBeenCalledTimes(1);
    expect(store.cvs).toHaveLength(2);
    expect(store.currentCv?.id).toBe('b');
    expect(store.currentCv?.version).toBe(2);
  });

  it('uploadCv calls starCv.upload, appends the version, sets currentCv', async () => {
    const { starCv } = installBridges();
    const store = useAppStore();
    await store.uploadCv({ filePath: '/tmp/cv.pdf', fileName: 'cv.pdf', mime: 'pdf' });
    expect(starCv.upload).toHaveBeenCalledTimes(1);
    expect(store.currentCv?.fileName).toBe('cv.pdf');
    expect(store.currentCv?.version).toBe(1);
  });

  it('structureCv invokes the LLM structuring bridge and returns its result', async () => {
    const { starCvStructurer } = installBridges();
    const store = useAppStore();
    const result = await store.structureCv('plain CV text');
    expect(starCvStructurer.structure).toHaveBeenCalledWith('plain CV text');
    expect(result?.ok).toBe(true);
    expect(store.cvParseStatus).toBe('ready');
  });

  it('structureCv surfaces structured failure on the store', async () => {
    installBridges({
      structureResult: { ok: false, code: 'NO_API_KEY', message: 'No key' },
    });
    const store = useAppStore();
    const result = await store.structureCv('plain CV text');
    expect(result?.ok).toBe(false);
    expect(store.cvParseStatus).toBe('error');
    expect(store.cvParseError).toBe('No key');
  });
});

describe('app-store — AC3 PARSED_SKILLS mock is not on the store path', () => {
  it('the store source does not import PARSED_SKILLS or Alex_Morgan sample data', () => {
    expect(STORE_SOURCE).not.toMatch(/PARSED_SKILLS/);
    expect(STORE_SOURCE).not.toMatch(/Alex_Morgan/);
  });
});

describe('app-store — AC4 profile strength + minimum-scorable gate', () => {
  it('profileStrength is 0 on an empty profile and 100 when every rubric field is set', async () => {
    installBridges();
    const store = useAppStore();
    await store.loadProfile();
    expect(store.profileStrength).toBe(0);
    expect(store.isScorable).toBe(false);

    await store.saveProfile({
      name: 'Alex',
      targetRole: 'Senior Product Designer',
      skills: ['Figma'],
      location: 'Manchester',
      workMode: 'Hybrid',
      yearsExperience: 8,
      salaryMin: 65000,
      linkedinUrl: 'https://www.linkedin.com/in/alex',
      links: ['https://alex.dev'],
    });
    expect(store.profileStrength).toBe(100);
    expect(store.isScorable).toBe(true);
    expect(store.missingScoringFields).toEqual([]);
  });

  it('missingScoringFields reports targetRole + skills + location + workMode gaps', async () => {
    installBridges();
    const store = useAppStore();
    await store.loadProfile();
    // empty profile has workMode default 'Remote' — still counts as set; targetRole/skills/location missing
    expect(store.missingScoringFields).toEqual(
      expect.arrayContaining(['targetRole', 'skills', 'location']),
    );
    expect(store.isScorable).toBe(false);
  });

  it('strengthRubric exposes per-field points + achieved flag', async () => {
    installBridges();
    const store = useAppStore();
    await store.loadProfile();
    const rubric = store.strengthRubric;
    expect(Array.isArray(rubric)).toBe(true);
    const total = rubric.reduce((sum, item) => sum + item.points, 0);
    expect(total).toBe(100);
    const fields = rubric.map((r) => r.field);
    expect(fields).toEqual(
      expect.arrayContaining(['targetRole', 'skills', 'location', 'workMode']),
    );
    for (const item of rubric) {
      expect(typeof item.achieved).toBe('boolean');
    }
  });
});

describe('app-store — AC5 editing a scoring-relevant field marks scores stale', () => {
  it('saveProfile with a scoring-relevant field flips scoresStale to true', async () => {
    installBridges();
    const store = useAppStore();
    await store.loadProfile();
    expect(store.scoresStale).toBe(false);
    await store.saveProfile({ targetRole: 'Lead UX' });
    expect(store.scoresStale).toBe(true);
  });

  it('saveProfile with a non-scoring field (linkedinUrl) does not mark scores stale', async () => {
    installBridges();
    const store = useAppStore();
    await store.loadProfile();
    await store.saveProfile({ linkedinUrl: 'https://www.linkedin.com/in/x' });
    expect(store.scoresStale).toBe(false);
  });
});

describe('app-store — AC6 workMode binding continues to work', () => {
  it('direct store.workMode mutation (existing binding) updates state without throwing', async () => {
    installBridges();
    const store = useAppStore();
    await store.loadProfile();
    store.workMode = 'On-site';
    expect(store.workMode).toBe('On-site');
  });

  it('setWorkMode persists via starProfile.save and marks scores stale', async () => {
    const { starProfile } = installBridges();
    const store = useAppStore();
    await store.loadProfile();
    await store.setWorkMode('On-site');
    expect(starProfile.save).toHaveBeenCalledWith({ workMode: 'On-site' });
    expect(store.workMode).toBe('On-site');
    expect(store.profile?.workMode).toBe('On-site');
    expect(store.scoresStale).toBe(true);
  });
});
