/**
 * EXTR-017 — Manage 'Not interested' dialog on the Job Board.
 *
 * Acceptance criteria:
 *  1. The 'Restore N hidden' control opens a Manage-hidden dialog instead of
 *     restoring everything at once; the count label is preserved.
 *  2. The dialog lists each not-interested job (title, company, hostname/
 *     location) from the `notInterestedJobs` getter.
 *  3. Each row has Restore (uses `restoreJob`) and Delete permanently
 *     (uses `deleteJob`); both update the list and the board reactively.
 *  4. Permanent delete is guarded by a confirm; convenience Restore all /
 *     Delete all hidden actions are available at the dialog level.
 *  5. The dialog closes cleanly when no hidden jobs remain.
 *  6. Test covers: opening the dialog, restoring one (leaves the rest), and
 *     deleting one (row + job gone).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActivePinia, createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../stores/app-store';
import type { JobRecord } from 'src/types/models';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, 'JobBoardPage.vue'), 'utf8');

describe('JobBoardPage — Restore N hidden opens dialog (AC1)', () => {
  it("the Restore N hidden button no longer wires straight into restoreNotInterested()", () => {
    const btn = SRC.match(/<q-btn[\s\S]*?class="restore-btn"[\s\S]*?\/>/);
    expect(btn, 'restore-btn missing').not.toBeNull();
    // Must NOT call restoreNotInterested directly any more — it opens the
    // manage-hidden dialog instead.
    expect(btn![0]).not.toMatch(/store\.restoreNotInterested\(/);
  });

  it('opens a manage-hidden dialog state instead', () => {
    // A dedicated ref controls the dialog visibility.
    expect(SRC).toMatch(/manageHidden\s*=\s*ref\(false\)|manageHiddenOpen\s*=\s*ref\(false\)/);
    const btn = SRC.match(/<q-btn[\s\S]*?class="restore-btn"[\s\S]*?\/>/);
    expect(btn).not.toBeNull();
    expect(btn![0]).toMatch(/manageHidden|manageHiddenOpen/);
  });

  it('preserves the "Restore N hidden" count label', () => {
    expect(SRC).toMatch(/Restore \$\{store\.notInterestedCount\} hidden/);
  });

  it('the button is only shown while notInterestedCount > 0', () => {
    const btn = SRC.match(/<q-btn[\s\S]*?class="restore-btn"[\s\S]*?\/>/);
    expect(btn).not.toBeNull();
    expect(btn![0]).toMatch(/v-if="store\.notInterestedCount\s*>\s*0"/);
  });
});

describe('JobBoardPage — dialog lists hidden jobs (AC2)', () => {
  it('iterates over store.notInterestedJobs', () => {
    expect(SRC).toMatch(/v-for="[^"]+ in store\.notInterestedJobs"/);
  });

  it('renders title, company, and hostname/location per row', () => {
    // Find the hidden-row template region.
    const region = SRC.match(/class="hidden-row"[\s\S]*?<\/li>|class="hidden-row"[\s\S]*?<\/div>/);
    expect(region, 'hidden-row block missing').not.toBeNull();
    const block = region![0];
    expect(block).toMatch(/\.title/);
    expect(block).toMatch(/\.company/);
    expect(block).toMatch(/\.hostname|\.location/);
  });
});

describe('JobBoardPage — per-row Restore + Delete permanently (AC3, AC4 confirm)', () => {
  it('each row has a Restore button calling store.restoreJob', () => {
    expect(SRC).toMatch(/label="Restore"[^>]*@click="[^"]*store\.restoreJob\(/);
  });

  it('each row has a Delete permanently button', () => {
    expect(SRC).toMatch(/label="Delete permanently"/);
  });

  it('Delete permanently is guarded by a confirm before calling store.deleteJob', () => {
    // The click on the per-row delete must NOT call store.deleteJob directly —
    // it should arm a confirm dialog first.
    const deleteBtn = SRC.match(
      /<q-btn[\s\S]*?label="Delete permanently"[\s\S]*?\/>/,
    );
    expect(deleteBtn, 'Delete permanently button missing').not.toBeNull();
    expect(deleteBtn![0]).not.toMatch(/store\.deleteJob\(/);
    // A confirm-delete dialog exists.
    expect(SRC).toMatch(/confirmDeleteHidden|confirmHiddenDelete/);
    // The confirm path eventually calls store.deleteJob.
    expect(SRC).toMatch(/store\.deleteJob\(/);
  });
});

describe('JobBoardPage — dialog-level Restore all / Delete all hidden (AC4)', () => {
  it("has a 'Restore all' action that wires into store.restoreNotInterested", () => {
    expect(SRC).toMatch(/label="Restore all"/);
    expect(SRC).toMatch(/store\.restoreNotInterested\(/);
  });

  it("has a 'Delete all hidden' action with its own confirm", () => {
    expect(SRC).toMatch(/label="Delete all hidden"/);
    // A second confirm gates the bulk delete.
    expect(SRC).toMatch(/confirmDeleteAllHidden/);
  });
});

describe('JobBoardPage — dialog auto-closes when no hidden jobs remain (AC5)', () => {
  it('watches notInterestedCount and closes the dialog when it drops to 0', () => {
    expect(SRC).toMatch(/watch\(\s*\(\)\s*=>\s*store\.notInterestedCount/);
  });
});

// ---------------------------------------------------------------------------
// Behavioural test (AC6) — exercise the store actions the dialog calls so the
// "restoring one leaves the rest" and "deleting one removes the row + job"
// invariants are protected at runtime, not just in markup.
// ---------------------------------------------------------------------------

function installBridge(overrides: Partial<{
  deleteFn: (sourceId: string) => Promise<{ ok: true; deleted: number }>;
  setStatus: (input: { sourceId: string; status: string }) => Promise<{ ok: true }>;
}> = {}) {
  (globalThis as { window?: unknown }).window = {
    starBoard: {
      delete: overrides.deleteFn ?? (async () => ({ ok: true as const, deleted: 1 })),
      setStatus: overrides.setStatus ?? (async () => ({ ok: true as const })),
    },
  };
}

function hidden(sourceId: string, fetchedAt: number): JobRecord {
  return {
    sourceId,
    hostname: 'example.com',
    url: `https://example.com/jobs/${sourceId}`,
    title: `Job ${sourceId}`,
    company: 'Acme',
    location: 'Remote',
    description: null,
    postedAt: null,
    fetchedAt,
    status: 'not_interested',
  };
}

describe('JobBoardPage — manage-hidden dialog behaviour (AC6)', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("opens with the current hidden list (notInterestedJobs is the dialog's data source)", () => {
    installBridge();
    const store = useAppStore();
    store.jobs = [hidden('b', 200), hidden('c', 300)];
    expect(store.notInterestedCount).toBe(2);
    expect(store.notInterestedJobs.map((j) => j.sourceId).sort()).toEqual(['b', 'c']);
  });

  it('restoring one row leaves the rest hidden', async () => {
    const setStatus = vi.fn(async () => ({ ok: true as const }));
    installBridge({ setStatus });
    const store = useAppStore();
    store.jobs = [hidden('b', 200), hidden('c', 300)];

    await store.restoreJob('b');

    expect(setStatus).toHaveBeenCalledTimes(1);
    expect(store.notInterestedJobs.map((j) => j.sourceId)).toEqual(['c']);
    expect(store.visibleJobs.map((j) => j.sourceId)).toEqual(['b']);
    expect(store.notInterestedCount).toBe(1);
  });

  it('permanently deleting one row removes that row and the job', async () => {
    const deleteFn = vi.fn(async () => ({ ok: true as const, deleted: 1 }));
    installBridge({ deleteFn });
    const store = useAppStore();
    store.jobs = [hidden('b', 200), hidden('c', 300)];

    await store.deleteJob('c');

    expect(deleteFn).toHaveBeenCalledWith('c');
    expect(store.jobs.map((j) => j.sourceId)).toEqual(['b']);
    expect(store.notInterestedJobs.map((j) => j.sourceId)).toEqual(['b']);
    expect(store.visibleJobs).toEqual([]);
  });
});
