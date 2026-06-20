/**
 * DEAL-002 — app-store saveProfile / loadProfile pass dealbreaker fields
 * through to / from the preload bridge (AC2 / AC3).
 */
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from './app-store';

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
  dealbreakerKeywords: string[];
  dealbreakerCompanies: string[];
  dealbreakerSalaryMin: number | null;
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
    dealbreakerKeywords: [],
    dealbreakerCompanies: [],
    dealbreakerSalaryMin: null,
    updatedAt: 0,
  };
}

function makeBackingStore() {
  let row: FakeProfile = emptyProfile();
  return {
    install() {
      const starProfile = {
        get: vi.fn(async () => ({ ...row })),
        save: vi.fn(async (patch: Partial<FakeProfile>) => {
          row = { ...row, ...patch, updatedAt: Date.now() };
          return { ...row };
        }),
      };
      (globalThis as { window?: unknown }).window = { starProfile };
      return starProfile;
    },
    peek: () => ({ ...row }),
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('DEAL-002 — app-store passes dealbreaker fields through (AC2)', () => {
  it('loadProfile hydrates the dealbreaker fields with empty defaults', async () => {
    const backing = makeBackingStore();
    backing.install();
    const store = useAppStore();
    await store.loadProfile();
    expect(store.profile?.dealbreakerKeywords).toEqual([]);
    expect(store.profile?.dealbreakerCompanies).toEqual([]);
    expect(store.profile?.dealbreakerSalaryMin).toBeNull();
  });

  it('saveProfile forwards dealbreaker fields to main and round-trips them on reload (AC2/AC3)', async () => {
    const backing = makeBackingStore();
    const bridge = backing.install();
    const store = useAppStore();
    await store.loadProfile();
    await store.saveProfile({
      dealbreakerKeywords: ['onsite-only', 'security clearance'],
      dealbreakerCompanies: ['Acme', 'Initech'],
      dealbreakerSalaryMin: 70000,
    });

    expect(bridge.save).toHaveBeenCalledWith(
      expect.objectContaining({
        dealbreakerKeywords: ['onsite-only', 'security clearance'],
        dealbreakerCompanies: ['Acme', 'Initech'],
        dealbreakerSalaryMin: 70000,
      }),
    );
    expect(store.profile?.dealbreakerKeywords).toEqual([
      'onsite-only',
      'security clearance',
    ]);
    expect(store.profile?.dealbreakerCompanies).toEqual(['Acme', 'Initech']);
    expect(store.profile?.dealbreakerSalaryMin).toBe(70000);

    // Simulate a renderer reload — fresh pinia, same backing row.
    setActivePinia(createPinia());
    const reloaded = useAppStore();
    await reloaded.loadProfile();
    expect(reloaded.profile?.dealbreakerKeywords).toEqual([
      'onsite-only',
      'security clearance',
    ]);
    expect(reloaded.profile?.dealbreakerCompanies).toEqual(['Acme', 'Initech']);
    expect(reloaded.profile?.dealbreakerSalaryMin).toBe(70000);
  });
});
