/**
 * Unit tests for the tailoring-document model (TDE-001).
 *
 * Covers the ticket acceptance criteria:
 *  - AC1: structured 'tailoring document' is derived from the Epic 4 parsed CV
 *         (+ base CV text) and exposes addressable editable paths:
 *         summary, experience[i].bullets[j], projects[i].bullets[j],
 *         education[i].description, skills[]
 *  - AC2: identity / employer / date / institution / degree / contact /
 *         location are FROZEN (not in the editable-path set)
 *  - AC3: pure path resolve / set helpers (dot+bracket) round-trip values and
 *         fail safely on bad paths
 *  - AC4: per-role bullets come from Epic 4 parsed fields if present, else
 *         are derived from the base CV text (documented via meta.bulletSource);
 *         structure is never fabricated
 *  - AC5: (this file) editable-vs-frozen partition exposed via
 *         listEditablePaths / isFrozenPath, with unit coverage
 */
import { describe, expect, it } from 'vitest';

import type { CvParsedFields } from '../cvStructurer.js';
import {
  buildTailoringDocument,
  isFrozenPath,
  listEditablePaths,
  resolvePath,
  setPath,
} from '../tailoringDocument.js';

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
      summary:
        '- Led migration of monolith to services\n- Cut p95 latency by 40%\n- Mentored 5 engineers',
    },
    {
      company: 'Beta Ltd',
      role: 'Senior Engineer',
      startDate: '2019-06',
      endDate: '2021-12',
      summary: 'Owned billing platform. Shipped subscription redesign.',
    },
  ],
  education: [
    {
      school: 'University of Cape Town',
      qualification: 'BSc Computer Science',
      startDate: '2010',
      endDate: '2013',
    },
  ],
  totalYearsExperience: 10,
  location: 'London, UK',
};

const BASE_CV_TEXT = `Alex Morgan
Staff Engineer
SUMMARY
Pragmatic engineer with 10 years of experience shipping production systems.
`;

describe('buildTailoringDocument (TDE-001 AC1, AC2, AC4)', () => {
  it('derives the structured doc with editable paths exposed', () => {
    const doc = buildTailoringDocument(PARSED, BASE_CV_TEXT);

    expect(typeof doc.summary).toBe('string');
    expect(Array.isArray(doc.skills)).toBe(true);
    expect(doc.skills).toEqual(['TypeScript', 'Node.js', 'PostgreSQL']);
    expect(doc.experience).toHaveLength(2);
    expect(doc.experience[0]!.company).toBe('Acme Co');
    expect(doc.experience[0]!.role).toBe('Staff Engineer');
    expect(doc.experience[0]!.bullets.length).toBeGreaterThan(0);
    expect(doc.education).toHaveLength(1);
    expect(doc.education[0]!.school).toBe('University of Cape Town');
    expect(typeof doc.education[0]!.description).toBe('string');
    expect(Array.isArray(doc.projects)).toBe(true);
  });

  it('keeps identity/contact/location/dates/employer/institution/degree frozen on the doc', () => {
    const doc = buildTailoringDocument(PARSED, BASE_CV_TEXT);
    expect(doc.identity.name).toBe('Alex Morgan');
    expect(doc.identity.contact.email).toBe('alex@example.com');
    expect(doc.identity.contact.phone).toBe('+44 7000 000000');
    expect(doc.identity.location).toBe('London, UK');
    expect(doc.experience[0]!.startDate).toBe('2022-01');
    expect(doc.experience[0]!.endDate).toBe('2026-01');
    expect(doc.education[0]!.qualification).toBe('BSc Computer Science');
  });

  it('uses parsed bullets when employmentHistory.summary contains bullet/newline markers', () => {
    const doc = buildTailoringDocument(PARSED, BASE_CV_TEXT);
    expect(doc.experience[0]!.bullets).toEqual([
      'Led migration of monolith to services',
      'Cut p95 latency by 40%',
      'Mentored 5 engineers',
    ]);
    expect(doc.meta.bulletSource).toBe('parsed');
  });

  it('falls back to base CV text when parsed fields have no bullet structure', () => {
    const parsedNoBullets: CvParsedFields = {
      ...PARSED,
      employmentHistory: [
        {
          company: 'Acme Co',
          role: 'Staff Engineer',
          startDate: '2022-01',
          endDate: '2026-01',
          summary: null,
        },
      ],
    };
    const baseText =
      'EXPERIENCE\n' +
      'Staff Engineer, Acme Co (2022-2026)\n' +
      '* Built the platform\n' +
      '* Shipped feature X\n' +
      '* Hired 3 engineers\n';
    const doc = buildTailoringDocument(parsedNoBullets, baseText);
    expect(doc.experience[0]!.bullets).toEqual([
      'Built the platform',
      'Shipped feature X',
      'Hired 3 engineers',
    ]);
    expect(doc.meta.bulletSource).toBe('baseCvText');
  });

  it('never fabricates structure: when neither parsed nor base text yields bullets, the bullets array is empty', () => {
    const parsedNoBullets: CvParsedFields = {
      ...PARSED,
      employmentHistory: [
        {
          company: 'Acme Co',
          role: 'Staff Engineer',
          startDate: '2022-01',
          endDate: '2026-01',
          summary: null,
        },
      ],
    };
    const doc = buildTailoringDocument(parsedNoBullets, '');
    expect(doc.experience[0]!.bullets).toEqual([]);
  });
});

describe('resolvePath / setPath (TDE-001 AC3)', () => {
  it('resolves dotted paths to scalar fields', () => {
    const doc = buildTailoringDocument(PARSED, BASE_CV_TEXT);
    expect(resolvePath(doc, 'summary')).toBe(doc.summary);
    expect(resolvePath(doc, 'skills[0]')).toBe('TypeScript');
    expect(resolvePath(doc, 'experience[0].bullets[1]')).toBe('Cut p95 latency by 40%');
    expect(resolvePath(doc, 'experience[1].bullets[0]')).toBe(doc.experience[1]!.bullets[0]);
    expect(resolvePath(doc, 'education[0].description')).toBe(doc.education[0]!.description);
  });

  it('round-trips values via setPath (immutable: returns a new doc, original untouched)', () => {
    const doc = buildTailoringDocument(PARSED, BASE_CV_TEXT);
    const updated = setPath(doc, 'summary', 'NEW SUMMARY');
    expect(resolvePath(updated, 'summary')).toBe('NEW SUMMARY');
    expect(doc.summary).not.toBe('NEW SUMMARY');

    const updated2 = setPath(updated, 'experience[0].bullets[1]', 'Rewrote bullet 1');
    expect(resolvePath(updated2, 'experience[0].bullets[1]')).toBe('Rewrote bullet 1');
    expect(resolvePath(updated, 'experience[0].bullets[1]')).toBe('Cut p95 latency by 40%');

    const updated3 = setPath(updated2, 'skills[0]', 'Rust');
    expect(resolvePath(updated3, 'skills[0]')).toBe('Rust');
    expect(resolvePath(updated3, 'skills[1]')).toBe('Node.js');
  });

  it('returns undefined for unknown paths (resolve) and the original doc (set), failing safely', () => {
    const doc = buildTailoringDocument(PARSED, BASE_CV_TEXT);
    expect(resolvePath(doc, 'nonExistent')).toBeUndefined();
    expect(resolvePath(doc, 'experience[99].bullets[0]')).toBeUndefined();
    expect(resolvePath(doc, 'experience[0].bullets[99]')).toBeUndefined();
    expect(resolvePath(doc, '')).toBeUndefined();
    expect(resolvePath(doc, 'experience[abc].bullets[0]')).toBeUndefined();

    const unchanged = setPath(doc, 'experience[99].bullets[0]', 'nope');
    expect(unchanged).toBe(doc);
    const unchanged2 = setPath(doc, 'totally.bogus.path', 'x');
    expect(unchanged2).toBe(doc);
  });
});

describe('editable-vs-frozen partition (TDE-001 AC2, AC5)', () => {
  it('listEditablePaths enumerates only the editable substrate', () => {
    const doc = buildTailoringDocument(PARSED, BASE_CV_TEXT);
    const paths = listEditablePaths(doc);
    expect(paths).toContain('summary');
    for (let i = 0; i < doc.skills.length; i++) {
      expect(paths).toContain(`skills[${i}]`);
    }
    for (let i = 0; i < doc.experience.length; i++) {
      for (let j = 0; j < doc.experience[i]!.bullets.length; j++) {
        expect(paths).toContain(`experience[${i}].bullets[${j}]`);
      }
    }
    for (let i = 0; i < doc.education.length; i++) {
      expect(paths).toContain(`education[${i}].description`);
    }
    // Frozen paths are NOT in the editable set
    expect(paths).not.toContain('identity.name');
    expect(paths).not.toContain('identity.contact.email');
    expect(paths).not.toContain('identity.contact.phone');
    expect(paths).not.toContain('identity.location');
    expect(paths).not.toContain('experience[0].company');
    expect(paths).not.toContain('experience[0].role');
    expect(paths).not.toContain('experience[0].startDate');
    expect(paths).not.toContain('experience[0].endDate');
    expect(paths).not.toContain('education[0].school');
    expect(paths).not.toContain('education[0].qualification');
  });

  it('isFrozenPath marks identity / employer / date / institution / degree / contact / location frozen', () => {
    const doc = buildTailoringDocument(PARSED, BASE_CV_TEXT);
    expect(isFrozenPath(doc, 'identity.name')).toBe(true);
    expect(isFrozenPath(doc, 'identity.contact.email')).toBe(true);
    expect(isFrozenPath(doc, 'identity.contact.phone')).toBe(true);
    expect(isFrozenPath(doc, 'identity.location')).toBe(true);
    expect(isFrozenPath(doc, 'experience[0].company')).toBe(true);
    expect(isFrozenPath(doc, 'experience[0].role')).toBe(true);
    expect(isFrozenPath(doc, 'experience[0].startDate')).toBe(true);
    expect(isFrozenPath(doc, 'experience[0].endDate')).toBe(true);
    expect(isFrozenPath(doc, 'education[0].school')).toBe(true);
    expect(isFrozenPath(doc, 'education[0].qualification')).toBe(true);
    expect(isFrozenPath(doc, 'education[0].startDate')).toBe(true);
    expect(isFrozenPath(doc, 'education[0].endDate')).toBe(true);

    expect(isFrozenPath(doc, 'summary')).toBe(false);
    expect(isFrozenPath(doc, 'skills[0]')).toBe(false);
    expect(isFrozenPath(doc, 'experience[0].bullets[0]')).toBe(false);
    expect(isFrozenPath(doc, 'education[0].description')).toBe(false);
  });
});
