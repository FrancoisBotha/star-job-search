/**
 * Unit tests for tailorGates (TDE-002 — Epic 9: Tailoring Diff Engine).
 *
 * Acceptance criteria covered:
 *  - AC1: four-gate validation
 *         (1) path in editable allowlist
 *         (2) not a blocked/frozen path/leaf-field
 *         (3) path resolves on the document
 *         (4) replace.original matches actual text (case/space-insensitive)
 *  - AC2: action-safety per action
 *         replace -> string
 *         append  -> non-empty string onto a list
 *         reorder -> permutation of existing items
 *         add_skill -> only an allowed verified skill target
 *  - AC3: reorder salvage — skills keeps only verified new items and never drops
 *         a real item; other lists drop unverified new items.
 *  - AC4: apply returns (result, applied[], rejected[]) and never mutates input;
 *         rejections carry a reason.
 *  - AC5: this file is the exhaustive test suite required by the ticket.
 */
import { describe, expect, it } from 'vitest';

import type { CvParsedFields } from '../cvStructurer.js';
import { buildTailoringDocument, type TailoringDocument } from '../tailoringDocument.js';
import { apply, type ProposedChange } from '../tailorGates.js';

const PARSED: CvParsedFields = {
  name: 'Alex Morgan',
  contact: { email: 'alex@example.com', phone: '+44 7000 000000' },
  targetRole: 'Senior Engineer',
  skills: ['TypeScript', 'Node.js', 'PostgreSQL'],
  employmentHistory: [
    {
      company: 'Acme Co',
      role: 'Staff Engineer',
      startDate: '2022-01',
      endDate: '2026-01',
      summary: '- Led migration of monolith to services\n- Cut p95 latency by 40%\n- Mentored 5 engineers',
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
  const doc = buildTailoringDocument(PARSED, '');
  // Add a project so projects[0].bullets becomes addressable.
  return {
    ...doc,
    projects: [{ name: 'Open Source Thing', bullets: ['Initial release', 'Plugin API'] }],
  };
}

describe('tailorGates.apply — four gates', () => {
  it('Gate 1 — rejects a path not in the editable allowlist', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'meta.bulletSource',
      action: 'replace',
      original: 'parsed',
      value: 'none',
      reason: 'edit meta',
    };
    const r = apply(doc, [change]);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/allowlist|editable/i);
    expect(r.result).toEqual(doc);
  });

  it('Gate 2 — rejects edits to a frozen leaf field (identity.name)', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'identity.name',
      action: 'replace',
      original: 'Alex Morgan',
      value: 'Alex M',
      reason: 'shorten name',
    };
    const r = apply(doc, [change]);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/frozen|blocked/i);
  });

  it('Gate 2 — rejects edits to a frozen experience leaf (company)', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'experience[0].company',
      action: 'replace',
      original: 'Acme Co',
      value: 'Acme Inc',
      reason: '',
    };
    const r = apply(doc, [change]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/frozen|blocked/i);
  });

  it('Gate 3 — rejects when path does not resolve', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'experience[5].bullets[0]',
      action: 'replace',
      original: 'whatever',
      value: 'new',
      reason: '',
    };
    const r = apply(doc, [change]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/resolve/i);
  });

  it('Gate 4 — rejects replace when original text does not match', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'experience[0].bullets[0]',
      action: 'replace',
      original: 'Wrong original text',
      value: 'Led migration of monolith to microservices',
      reason: '',
    };
    const r = apply(doc, [change]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/original/i);
  });

  it('Gate 4 — accepts replace when original matches case/space-insensitive', () => {
    const doc = makeDoc();
    const change: ProposedChange = {
      path: 'experience[0].bullets[0]',
      action: 'replace',
      original: '  LED migration of MONOLITH   to   services  ',
      value: 'Led migration of monolith to microservices',
      reason: '',
    };
    const r = apply(doc, [change]);
    expect(r.rejected).toHaveLength(0);
    expect(r.applied).toHaveLength(1);
    expect(r.result.experience[0]!.bullets[0]).toBe(
      'Led migration of monolith to microservices',
    );
  });
});

describe('tailorGates.apply — action safety', () => {
  it('replace — value must be a string', () => {
    const doc = makeDoc();
    const r = apply(doc, [
      {
        path: 'summary',
        action: 'replace',
        original: '',
        value: 42 as unknown as string,
        reason: '',
      },
    ]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/string/i);
  });

  it('append — value must be a non-empty string onto a list', () => {
    const doc = makeDoc();
    const r = apply(doc, [
      { path: 'experience[0].bullets', action: 'append', value: '', reason: '' },
    ]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toMatch(/non-empty|string/i);

    const ok = apply(doc, [
      {
        path: 'experience[0].bullets',
        action: 'append',
        value: 'Drove the platform team',
        reason: '',
      },
    ]);
    expect(ok.rejected).toHaveLength(0);
    expect(ok.applied).toHaveLength(1);
    expect(ok.result.experience[0]!.bullets).toContain('Drove the platform team');
    // never mutates input
    expect(doc.experience[0]!.bullets).not.toContain('Drove the platform team');
  });

  it('append — path must point to a list (not a leaf string)', () => {
    const doc = makeDoc();
    const r = apply(doc, [
      { path: 'summary', action: 'append', value: 'x', reason: '' },
    ]);
    expect(r.rejected).toHaveLength(1);
  });

  it('reorder — strict permutation succeeds', () => {
    const doc = makeDoc();
    const original = [...doc.experience[0]!.bullets];
    const permuted = [original[2]!, original[0]!, original[1]!];
    const r = apply(doc, [
      { path: 'experience[0].bullets', action: 'reorder', value: permuted, reason: '' },
    ]);
    expect(r.rejected).toHaveLength(0);
    expect(r.applied).toHaveLength(1);
    expect(r.result.experience[0]!.bullets).toEqual(permuted);
  });

  it('reorder — value must be an array of strings', () => {
    const doc = makeDoc();
    const r = apply(doc, [
      {
        path: 'experience[0].bullets',
        action: 'reorder',
        value: 'not-an-array' as unknown,
        reason: '',
      },
    ]);
    expect(r.rejected).toHaveLength(1);
  });

  it('add_skill — must target the skills list, value verified', () => {
    const doc = makeDoc();
    const denied = apply(
      doc,
      [{ path: 'skills', action: 'add_skill', value: 'Rust', reason: '' }],
      { verifiedSkills: ['Go'] },
    );
    expect(denied.rejected).toHaveLength(1);
    expect(denied.rejected[0]!.reason).toMatch(/verified/i);

    const ok = apply(
      doc,
      [{ path: 'skills', action: 'add_skill', value: 'Go', reason: '' }],
      { verifiedSkills: ['Go'] },
    );
    expect(ok.rejected).toHaveLength(0);
    expect(ok.result.skills).toContain('Go');
  });

  it('add_skill — wrong target path is rejected', () => {
    const doc = makeDoc();
    const r = apply(
      doc,
      [{ path: 'experience[0].bullets', action: 'add_skill', value: 'Go', reason: '' }],
      { verifiedSkills: ['Go'] },
    );
    expect(r.rejected).toHaveLength(1);
  });
});

describe('tailorGates.apply — reorder salvage', () => {
  it('skills — drops unverified new items but NEVER drops a real item', () => {
    const doc = makeDoc(); // skills: TypeScript, Node.js, PostgreSQL
    const proposal = ['PostgreSQL', 'Rust', 'TypeScript', 'Go'];
    const r = apply(
      doc,
      [{ path: 'skills', action: 'reorder', value: proposal, reason: '' }],
      { verifiedSkills: ['Go'] }, // Go verified, Rust not
    );
    expect(r.rejected).toHaveLength(0);
    expect(r.applied).toHaveLength(1);
    // Real items preserved: TypeScript, Node.js, PostgreSQL all present.
    expect(r.result.skills).toEqual(expect.arrayContaining(['TypeScript', 'Node.js', 'PostgreSQL']));
    // Verified new kept; unverified new dropped.
    expect(r.result.skills).toContain('Go');
    expect(r.result.skills).not.toContain('Rust');
    // Proposed-order honoured for the items it kept, missing real items appended.
    expect(r.result.skills.indexOf('PostgreSQL')).toBeLessThan(r.result.skills.indexOf('TypeScript'));
    expect(r.result.skills).toContain('Node.js');
  });

  it('non-skills list — drops new items (none verified for non-skills)', () => {
    const doc = makeDoc();
    const existing = [...doc.experience[0]!.bullets];
    const proposal = [existing[1]!, 'Brand new fabricated bullet', existing[0]!];
    const r = apply(doc, [
      { path: 'experience[0].bullets', action: 'reorder', value: proposal, reason: '' },
    ]);
    expect(r.rejected).toHaveLength(0);
    expect(r.applied).toHaveLength(1);
    expect(r.result.experience[0]!.bullets).not.toContain('Brand new fabricated bullet');
    // never drops a real item
    for (const item of existing) {
      expect(r.result.experience[0]!.bullets).toContain(item);
    }
  });
});

describe('tailorGates.apply — result contract', () => {
  it('returns {result, applied, rejected}; never mutates the input document', () => {
    const doc = makeDoc();
    const snapshot = JSON.parse(JSON.stringify(doc));
    const changes: ProposedChange[] = [
      { path: 'summary', action: 'replace', original: '', value: 'A short summary.', reason: '' },
      { path: 'identity.name', action: 'replace', original: 'Alex Morgan', value: 'X', reason: '' },
    ];
    const r = apply(doc, changes);
    expect(r.applied).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]!.reason).toBeTruthy();
    // Input unchanged
    expect(doc).toEqual(snapshot);
    // Result reflects accepted change
    expect(r.result.summary).toBe('A short summary.');
    expect(r.result.identity.name).toBe('Alex Morgan');
  });
});
