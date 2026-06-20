/**
 * Unit tests for enrichmentApply.ts (ENRICH-004 — Epic 13: CV Enrichment).
 *
 * AC1 — apply writes a NEW enriched CV version via Epic 4 versioning
 *       (prior versions retained; the latest becomes current).
 * AC2 — the structured profile is re-derived deterministically from the
 *       enriched CV after apply.
 * AC3 — Epic 5 (match scores) and Epic 6 (match reviews) are marked stale
 *       via the existing hooks.
 * AC4 — apply is deterministic and dedup-safe — re-applying the same
 *       accepted set does not create spurious duplicate versions or
 *       double-mark.
 * AC5 — apply consumes the Epic 9 apply result (applied / rejected) so
 *       rejected changes never reach the new version.
 */
import { describe, expect, it } from 'vitest';

import type { CvParsedFields } from '../cvStructurer.js';
import {
  buildTailoringDocument,
  type TailoringDocument,
} from '../tailoringDocument.js';
import type { ProposedChange } from '../tailorGates.js';
import {
  applyEnrichment,
  computeApplyKey,
  deriveCvParsedFieldsFromDoc,
  ENRICHMENT_APPLY_KEY_FIELD,
  type CvVersionWriter,
  type EnrichmentApplyDeps,
  type EnrichmentBaseCvRecord,
  type EnrichmentNewCvRecord,
  type ProfileWriter,
} from '../enrichmentApply.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PARSED: CvParsedFields = {
  name: 'Alex Morgan',
  contact: { email: 'alex@example.com', phone: '+44 7000 000000' },
  targetRole: 'Senior Engineer',
  skills: ['TypeScript', 'Node.js'],
  employmentHistory: [
    {
      company: 'Acme Co',
      role: 'Staff Engineer',
      startDate: '2022-01',
      endDate: '2026-01',
      summary:
        '- Worked on the data ingestion pipeline\n- Responsible for the migration project',
    },
  ],
  education: [
    {
      school: 'Some University',
      qualification: 'BSc Computer Science',
      startDate: '2014',
      endDate: '2017',
    },
  ],
  totalYearsExperience: 10,
  location: 'London, UK',
};

function makeDoc(): TailoringDocument {
  return buildTailoringDocument(PARSED, '');
}

type FakeCvRow = EnrichmentBaseCvRecord;

function makeWriter(initial: FakeCvRow): { writer: CvVersionWriter; rows: FakeCvRow[] } {
  const rows: FakeCvRow[] = [initial];
  const writer: CvVersionWriter = {
    latest(profileId?: string) {
      const filtered = rows.filter((r) =>
        profileId ? r.profileId === profileId : true,
      );
      if (filtered.length === 0) return null;
      const sorted = [...filtered].sort((a, b) => b.version - a.version);
      return sorted[0] ?? null;
    },
    create(input) {
      const next: EnrichmentNewCvRecord = {
        id: `cv_${rows.length + 1}`,
        profileId: input.profileId,
        version: Math.max(...rows.map((r) => r.version)) + 1,
        parsedText: input.parsedText,
        parsedFields: input.parsedFields,
        uploadedAt: 1000 + rows.length,
      };
      rows.push({
        id: next.id,
        profileId: next.profileId,
        version: next.version,
        parsedText: next.parsedText,
        parsedFields: next.parsedFields,
      });
      return next;
    },
  };
  return { writer, rows };
}

interface FakeStaleCounts {
  scores: number;
  reviews: number;
  evals: number;
  tailored: number;
}

function makeStaleHooks(): {
  hooks: EnrichmentApplyDeps['staleHooks'];
  counts: FakeStaleCounts;
} {
  const counts: FakeStaleCounts = { scores: 0, reviews: 0, evals: 0, tailored: 0 };
  return {
    counts,
    hooks: {
      markScoresStale: () => {
        counts.scores += 1;
      },
      markReviewsStale: () => {
        counts.reviews += 1;
      },
      markEvalReportsStale: () => {
        counts.evals += 1;
      },
      markTailoredDocsStale: () => {
        counts.tailored += 1;
      },
    },
  };
}

function makeProfileWriter(): {
  writer: ProfileWriter;
  saved: Array<Parameters<ProfileWriter['save']>[0]>;
} {
  const saved: Array<Parameters<ProfileWriter['save']>[0]> = [];
  return {
    saved,
    writer: { save: (input) => saved.push(input) },
  };
}

function baseRow(): FakeCvRow {
  return {
    id: 'cv_1',
    profileId: 'singleton',
    version: 1,
    parsedText: '...',
    parsedFields: PARSED as unknown as Record<string, unknown>,
  };
}

// A ProposedChange that targets the first bullet (editable leaf path).
function rewrite(doc: TailoringDocument, value: string): ProposedChange {
  return {
    path: 'experience[0].bullets[0]',
    action: 'replace',
    original: doc.experience[0]!.bullets[0]!,
    value,
    reason: 'enrichment rewrite',
  };
}

// ---------------------------------------------------------------------------
// AC1, AC2, AC3 — happy path: new version + re-derive + stale hooks
// ---------------------------------------------------------------------------

describe('applyEnrichment — happy path (AC1, AC2, AC3)', () => {
  it('writes a NEW CV version with the enriched text and the prior row retained', () => {
    const doc = makeDoc();
    const { writer, rows } = makeWriter(baseRow());
    const { writer: profileWriter, saved } = makeProfileWriter();
    const { hooks, counts } = makeStaleHooks();

    const change = rewrite(doc, 'Built the data ingestion pipeline end-to-end.');
    const out = applyEnrichment(
      { doc, acceptedChanges: [change] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );

    expect(out.created).toBe(true);
    expect(out.applied.length).toBe(1);
    expect(rows.length).toBe(2);
    const prior = rows.find((r) => r.id === 'cv_1');
    const next = rows.find((r) => r.id !== 'cv_1');
    expect(prior).toBeDefined();
    expect(next).toBeDefined();
    expect(next!.version).toBe(2);
    // The enriched text contains the rewritten bullet.
    expect(next!.parsedText).toContain('Built the data ingestion pipeline end-to-end.');
    // AC2 — the parsedFields on the new row reflect the enriched bullet.
    const emp = (next!.parsedFields!.employmentHistory as Array<{ summary: string | null }>)[0]!;
    expect(emp.summary ?? '').toContain('Built the data ingestion pipeline end-to-end.');
    // AC2 — profile re-saved with the re-derived skills.
    expect(saved.length).toBe(1);
    expect(saved[0]!.skills).toEqual(doc.skills);
    expect(saved[0]!.name).toBe('Alex Morgan');
    // AC3 — Epic 5 + Epic 6 stale hooks fired exactly once.
    expect(counts.scores).toBe(1);
    expect(counts.reviews).toBe(1);
    expect(counts.evals).toBe(1);
    expect(counts.tailored).toBe(1);
  });

  it('re-derives the profile deterministically from the enriched doc (pure)', () => {
    const doc = makeDoc();
    const prev: CvParsedFields = { ...PARSED };
    const a = deriveCvParsedFieldsFromDoc(doc, prev);
    const b = deriveCvParsedFieldsFromDoc(doc, prev);
    expect(a).toEqual(b);
    // Skills come from the doc.
    expect(a.skills).toEqual(doc.skills);
    // Frozen identity reflects the doc.
    expect(a.name).toBe('Alex Morgan');
    // Non-doc fields fall back to prev.
    expect(a.targetRole).toBe('Senior Engineer');
    expect(a.totalYearsExperience).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// AC4 — dedup
// ---------------------------------------------------------------------------

describe('applyEnrichment — dedup (AC4)', () => {
  it('does not create a second version when the same accepted set is re-applied', () => {
    const doc = makeDoc();
    const { writer, rows } = makeWriter(baseRow());
    const { writer: profileWriter, saved } = makeProfileWriter();
    const { hooks, counts } = makeStaleHooks();

    const change = rewrite(doc, 'Built the data ingestion pipeline end-to-end.');

    const first = applyEnrichment(
      { doc, acceptedChanges: [change] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(first.created).toBe(true);
    expect(rows.length).toBe(2);

    // Re-apply against the NEW latest row (writer.latest now returns the
    // enriched row, which already carries the apply key).
    const second = applyEnrichment(
      { doc, acceptedChanges: [change] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(second.created).toBe(false);
    expect(rows.length).toBe(2);
    // Stale hooks fire ONCE total — not twice.
    expect(counts.scores).toBe(1);
    expect(counts.reviews).toBe(1);
    // Profile save only happens on the create path.
    expect(saved.length).toBe(1);
    // Same apply key for the same input.
    expect(second.applyKey).toBe(first.applyKey);
  });

  it('computeApplyKey is order-invariant and stable', () => {
    const c1: ProposedChange = {
      path: 'experience[0].bullets[0]',
      action: 'replace',
      original: 'a',
      value: 'b',
      reason: '',
    };
    const c2: ProposedChange = {
      path: 'experience[0].bullets[1]',
      action: 'replace',
      original: 'x',
      value: 'y',
      reason: '',
    };
    expect(computeApplyKey('cv_1', [c1, c2])).toBe(computeApplyKey('cv_1', [c2, c1]));
    expect(computeApplyKey('cv_1', [c1])).not.toBe(computeApplyKey('cv_1', [c1, c2]));
    // Same applied set → same key across any base id (key is independent of
    // base id; `original` already pins the change to its prior text).
    expect(computeApplyKey('cv_1', [c1])).toBe(computeApplyKey('cv_2', [c1]));
  });
});

// ---------------------------------------------------------------------------
// AC5 — Epic 9 rejected changes never reach the new version
// ---------------------------------------------------------------------------

describe('applyEnrichment — Epic 9 rejected never written (AC5)', () => {
  it('drops a change targeting a frozen field (identity.name) before writing the new version', () => {
    const doc = makeDoc();
    const { writer, rows } = makeWriter(baseRow());
    const { writer: profileWriter } = makeProfileWriter();
    const { hooks } = makeStaleHooks();

    const good = rewrite(doc, 'Built and shipped the data ingestion pipeline.');
    const frozen: ProposedChange = {
      path: 'identity.name',
      action: 'replace',
      original: 'Alex Morgan',
      value: 'Alex M.',
      reason: 'enrichment rewrite',
    };

    const out = applyEnrichment(
      { doc, acceptedChanges: [good, frozen] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(out.created).toBe(true);
    expect(out.applied.length).toBe(1);
    expect(out.applied[0]!.path).toBe('experience[0].bullets[0]');
    expect(out.rejected.length).toBe(1);
    expect(out.rejected[0]!.change.path).toBe('identity.name');
    // Crucially, the new CV row preserves the identity.name from the base —
    // the rejected change never reached the new version.
    const next = rows.find((r) => r.id !== 'cv_1')!;
    expect(next.parsedFields!.name).toBe('Alex Morgan');
  });

  it('a dedup key built from epic9.applied (not the raw accepted set) means re-applying a mixed batch still dedups', () => {
    const doc = makeDoc();
    const { writer, rows } = makeWriter(baseRow());
    const { writer: profileWriter } = makeProfileWriter();
    const { hooks } = makeStaleHooks();

    const good = rewrite(doc, 'Built and shipped the data ingestion pipeline.');
    const frozen: ProposedChange = {
      path: 'identity.name',
      action: 'replace',
      original: 'Alex Morgan',
      value: 'Alex M.',
      reason: 'enrichment rewrite',
    };

    applyEnrichment(
      { doc, acceptedChanges: [good, frozen] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(rows.length).toBe(2);

    const again = applyEnrichment(
      { doc, acceptedChanges: [good, frozen] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    expect(again.created).toBe(false);
    expect(rows.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Edge — no base CV
// ---------------------------------------------------------------------------

describe('applyEnrichment — guards', () => {
  it('throws when no base CV is uploaded yet', () => {
    const doc = makeDoc();
    const writer: CvVersionWriter = {
      latest: () => null,
      create: () => {
        throw new Error('should not be called');
      },
    };
    const { writer: profileWriter } = makeProfileWriter();
    const { hooks } = makeStaleHooks();
    expect(() =>
      applyEnrichment(
        { doc, acceptedChanges: [rewrite(doc, 'X')] },
        { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
      ),
    ).toThrow(/no base CV/i);
  });

  it('apply-key field is stored on the new row so dedup can detect it', () => {
    const doc = makeDoc();
    const { writer, rows } = makeWriter(baseRow());
    const { writer: profileWriter } = makeProfileWriter();
    const { hooks } = makeStaleHooks();
    applyEnrichment(
      { doc, acceptedChanges: [rewrite(doc, 'Built it.')] },
      { cvVersionWriter: writer, profileWriter, staleHooks: hooks },
    );
    const next = rows.find((r) => r.id !== 'cv_1')!;
    expect(typeof next.parsedFields![ENRICHMENT_APPLY_KEY_FIELD]).toBe('string');
  });
});
