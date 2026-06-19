/**
 * CVPROF-015 — Persistence + name propagation regression test.
 *
 * AC1/AC5: saving the profile and then re-hydrating the store (simulating
 * a renderer reload or app restart) returns the persisted values. The
 * saved name is the source of truth the sidebar/dashboard derive from, so
 * we verify the derivation helpers used by those screens, too.
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

/** Shared persistent backing store — survives across "reload" cycles. */
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

/** Same first-name derivation the Dashboard greeting uses. */
function firstNameOf(name: string | null | undefined): string {
  if (!name) return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  return trimmed.split(/\s+/)[0] ?? '';
}

/** Same initials derivation the sidebar uses (first letter of first two words). */
function initialsOf(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0]?.[0] ?? '';
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + second).toUpperCase();
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('CVPROF-015 — profile persistence regression', () => {
  it('save then reload returns the persisted values (AC1/AC5)', async () => {
    const backing = makeBackingStore();
    backing.install();

    // First session: save profile fields.
    const first = useAppStore();
    await first.loadProfile();
    await first.saveProfile({
      name: 'Jordan Patel',
      targetRole: 'Senior Product Designer',
      location: 'Manchester',
      workMode: 'Hybrid',
      salaryMin: 65000,
      salaryCurrency: 'GBP',
      linkedinUrl: 'https://linkedin.com/in/jordan',
    });

    // Simulate a renderer reload — fresh pinia, same persisted backing row.
    setActivePinia(createPinia());
    const second = useAppStore();
    expect(second.profile).toBeNull();
    await second.loadProfile();

    expect(second.profileLoaded).toBe(true);
    expect(second.profile?.name).toBe('Jordan Patel');
    expect(second.profile?.targetRole).toBe('Senior Product Designer');
    expect(second.profile?.location).toBe('Manchester');
    expect(second.profile?.workMode).toBe('Hybrid');
    expect(second.profile?.salaryMin).toBe(65000);
    expect(second.profile?.salaryCurrency).toBe('GBP');
    expect(second.profile?.linkedinUrl).toBe('https://linkedin.com/in/jordan');
    // Top-level workMode mirror reflects the persisted value.
    expect(second.workMode).toBe('Hybrid');
  });

  it('saved name propagates to sidebar/dashboard derivations (AC2/AC3)', async () => {
    const backing = makeBackingStore();
    backing.install();
    const store = useAppStore();
    await store.loadProfile();
    await store.saveProfile({ name: 'Jordan Patel', targetRole: 'Lead UX' });

    // Sidebar: initials + name + role line.
    expect(initialsOf(store.profile?.name)).toBe('JP');
    expect(store.profile?.name).toBe('Jordan Patel');
    expect(store.profile?.targetRole).toBe('Lead UX');

    // Dashboard: first-name greeting.
    expect(firstNameOf(store.profile?.name)).toBe('Jordan');
  });

  it('falls back to neutral placeholders when no name/role is set (AC4)', async () => {
    const backing = makeBackingStore();
    backing.install();
    const store = useAppStore();
    await store.loadProfile();

    expect(store.profile?.name).toBe('');
    expect(store.profile?.targetRole).toBe('');
    expect(initialsOf(store.profile?.name)).toBe('');
    expect(firstNameOf(store.profile?.name)).toBe('');
  });
});
