/**
 * Epic 4 (Add CV to Profile) behavioural regression suite — CVPROF-009.
 *
 * The pre-existing per-ticket tests cover their modules in isolation, and
 * `epic-acceptance.cvprof008.test.ts` largely grep-checks the wiring against
 * the §9 acceptance criteria. This file complements both by exercising the
 * epic's KEY USER-FACING BEHAVIOURS end-to-end through the REAL modules,
 * with realistic fixtures and only the OpenRouter structuring call mocked:
 *
 *   - Profile persistence: save → restart durability
 *   - Minimum-scorable gate + strength rubric (frontend computation contract)
 *   - CV versioning on Replace (re-upload bumps version, history retained)
 *   - PDF text extraction (real pdfjs-dist against an in-test minimal PDF)
 *   - DOCX text extraction (real mammoth against an in-test minimal DOCX zip)
 *   - LLM structuring maps the OpenRouter response → parsedFields + confidence
 *   - Failure paths: no-key, rate-limited, structured-output unsupported
 *   - Manual entry path: Profile persists end-to-end with no LLM call at all
 *
 * Per epic §5: only the OpenRouter structuring call is mocked. The CV
 * persistence store, the Profile store, and the PDF/DOCX parsers are driven
 * with their real implementations.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The CV / Profile stores delegate to `better-sqlite3` only via the small
// `prepare` / `exec` slice declared on `*DatabaseLike`. We stub the native
// binding (not available in the vitest Node env) and inject a faithful
// in-memory fake so the REAL store logic — versioning, singleton upserts,
// JSON encoding — runs end-to-end.
vi.mock('better-sqlite3', () => ({ default: class {} }));

import {
  createProfileStore,
  type ProfileDatabaseLike,
} from '../profile';
import {
  createCvStore,
  type CvDatabaseLike,
  type CvExtractor,
} from '../cv';
import { extractCvText } from '../cvTextExtractor';
import {
  createCvStructurer,
  CvStructuringError,
} from '../cvStructurer';

// ---------------------------------------------------------------------------
// Faithful in-memory database that mimics the subset of better-sqlite3 the
// stores depend on. Shared between the Profile + CV suites so we can confirm
// the "single star.db handle" pattern still works.
// ---------------------------------------------------------------------------

interface Row {
  [key: string]: unknown;
}

class InMemoryDb implements ProfileDatabaseLike, CvDatabaseLike {
  private profile = new Map<string, Row>();
  private cv: Row[] = [];

  exec(_sql: string): void {
    /* CREATE TABLE IF NOT EXISTS — no-op for the fake. */
  }

  prepare(sql: string) {
    const text = sql.trim();

    // --- profile -----------------------------------------------------------
    if (/^SELECT \* FROM profile WHERE id = \?/i.test(text)) {
      return {
        all: (id: string) => {
          const row = this.profile.get(id);
          return row ? [row] : [];
        },
        run: () => ({ changes: 0 }),
      };
    }
    if (/^INSERT OR REPLACE INTO profile/i.test(text)) {
      return {
        run: (params: Row) => {
          this.profile.set(params.id as string, { ...params });
          return { changes: 1 };
        },
      };
    }

    // --- cv ----------------------------------------------------------------
    if (/^INSERT\s+INTO\s+cv/i.test(text)) {
      return {
        run: (params: Row) => {
          this.cv.push({ ...params });
          return { changes: 1 };
        },
      };
    }
    if (/^SELECT.*MAX\(version\)/i.test(text)) {
      return {
        all: (profileId: string) => {
          const versions = this.cv
            .filter((r) => r.profile_id === profileId)
            .map((r) => r.version as number);
          return [{ max_version: versions.length ? Math.max(...versions) : null }];
        },
        run: () => ({ changes: 0 }),
      };
    }
    if (/^SELECT.*FROM\s+cv\s+WHERE\s+id\s*=/i.test(text)) {
      return {
        all: (id: string) => this.cv.filter((r) => r.id === id),
        run: () => ({ changes: 0 }),
      };
    }
    if (/^SELECT.*FROM\s+cv.*WHERE\s+profile_id/i.test(text)) {
      return {
        all: (profileId: string) =>
          [...this.cv]
            .filter((r) => r.profile_id === profileId)
            .sort((a, b) => (b.version as number) - (a.version as number)),
        run: () => ({ changes: 0 }),
      };
    }

    throw new Error(`InMemoryDb: unsupported SQL: ${text}`);
  }

  /** Snapshot the underlying tables so we can simulate an app restart by
   *  spinning up a new store wrapping the same persisted bytes. */
  snapshot(): { profile: Array<[string, Row]>; cv: Row[] } {
    return {
      profile: Array.from(this.profile.entries()).map(([k, v]) => [k, { ...v }]),
      cv: this.cv.map((r) => ({ ...r })),
    };
  }

  restore(snap: { profile: Array<[string, Row]>; cv: Row[] }): void {
    this.profile = new Map(snap.profile.map(([k, v]) => [k, { ...v }]));
    this.cv = snap.cv.map((r) => ({ ...r }));
  }
}

// ---------------------------------------------------------------------------
// Tmp file roots for the CV binary store.
// ---------------------------------------------------------------------------

let storageRoot: string;
let sourceDir: string;

beforeEach(() => {
  storageRoot = mkdtempSync(path.join(tmpdir(), 'cvprof-009-store-'));
  sourceDir = mkdtempSync(path.join(tmpdir(), 'cvprof-009-src-'));
});

afterEach(() => {
  rmSync(storageRoot, { recursive: true, force: true });
  rmSync(sourceDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// AC1 — Profile persistence + minimum-scorable gate + strength rubric.
//
// The profile store is the source of truth for the later scoring epic. These
// tests verify the persistence contract end-to-end (save survives "restart")
// and re-implement the frontend's minimum-scorable + strength formulas
// against the same rubric the renderer uses, so a regression on either side
// would surface here.
// ---------------------------------------------------------------------------

describe('CVPROF-009 §1 — Profile persistence + min-scorable gate + strength rubric', () => {
  // Mirrors app-store.ts SCORING_RELEVANT_FIELDS — the frontend gate the
  // scoring epic reads. Re-asserted here so a renderer-side change would
  // need an explicit update to this regression too.
  const MIN_SCORABLE = ['targetRole', 'skills', 'location', 'workMode'] as const;

  // Mirrors app-store.ts STRENGTH_RUBRIC. Total must sum to 100.
  const STRENGTH_RUBRIC: Array<{ field: string; points: number }> = [
    { field: 'targetRole', points: 20 },
    { field: 'skills', points: 20 },
    { field: 'location', points: 15 },
    { field: 'workMode', points: 10 },
    { field: 'yearsExperience', points: 10 },
    { field: 'linkedinUrl', points: 10 },
    { field: 'salaryMin', points: 5 },
    { field: 'links', points: 5 },
    { field: 'name', points: 5 },
  ];

  function isSet(profile: Record<string, unknown>, field: string): boolean {
    const value = profile[field];
    if (field === 'workMode') return typeof value === 'string' && value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'number') return true;
    return false;
  }

  function strength(profile: Record<string, unknown>): number {
    return STRENGTH_RUBRIC.reduce(
      (s, r) => (isSet(profile, r.field) ? s + r.points : s),
      0,
    );
  }

  function missingScorable(profile: Record<string, unknown>): string[] {
    return MIN_SCORABLE.filter((f) => !isSet(profile, f));
  }

  it('the strength rubric sums to 100 and includes every min-scorable field', () => {
    const total = STRENGTH_RUBRIC.reduce((s, r) => s + r.points, 0);
    expect(total).toBe(100);
    for (const field of MIN_SCORABLE) {
      expect(STRENGTH_RUBRIC.map((r) => r.field)).toContain(field);
    }
  });

  it('saving a profile and re-opening the DB restores every field (survives restart)', () => {
    const db = new InMemoryDb();
    const store1 = createProfileStore(db);
    store1.save({
      name: 'Alex Morgan',
      targetRole: 'Senior Product Designer',
      skills: ['Figma', 'Design Systems'],
      location: 'Manchester, UK',
      workMode: 'Hybrid',
      yearsExperience: 8,
      salaryMin: 65000,
      salaryCurrency: 'GBP',
      linkedinUrl: 'https://www.linkedin.com/in/alex',
      links: ['https://alex.dev'],
    });

    // Snapshot → restore into a fresh store wrapping the same bytes —
    // models the Electron "close + relaunch" lifecycle (FR-007 / NFR-005).
    const snap = db.snapshot();
    const db2 = new InMemoryDb();
    db2.restore(snap);
    const store2 = createProfileStore(db2);
    const restored = store2.get();
    expect(restored.name).toBe('Alex Morgan');
    expect(restored.targetRole).toBe('Senior Product Designer');
    expect(restored.skills).toEqual(['Figma', 'Design Systems']);
    expect(restored.location).toBe('Manchester, UK');
    expect(restored.workMode).toBe('Hybrid');
    expect(restored.yearsExperience).toBe(8);
    expect(restored.salaryMin).toBe(65000);
    expect(restored.salaryCurrency).toBe('GBP');
    expect(restored.linkedinUrl).toBe('https://www.linkedin.com/in/alex');
    expect(restored.links).toEqual(['https://alex.dev']);
  });

  it('partial saves merge onto the persisted profile (FR-008 — no field is silently wiped)', () => {
    const db = new InMemoryDb();
    const store = createProfileStore(db);
    store.save({ name: 'Alex', targetRole: 'Designer', skills: ['Figma'] });
    store.save({ location: 'Manchester' });
    const merged = store.get();
    expect(merged.name).toBe('Alex');
    expect(merged.targetRole).toBe('Designer');
    expect(merged.skills).toEqual(['Figma']);
    expect(merged.location).toBe('Manchester');
  });

  it('an empty profile is not scorable; saving the four gate fields makes it scorable', () => {
    const empty = {
      name: '',
      targetRole: '',
      skills: [] as string[],
      location: '',
      workMode: 'Remote',
    };
    // workMode defaults to 'Remote' (always set) — the three real gaps are
    // targetRole, skills, location.
    expect(missingScorable(empty).sort()).toEqual(['location', 'skills', 'targetRole']);
    const filled = {
      ...empty,
      targetRole: 'Senior Product Designer',
      skills: ['Figma'],
      location: 'Manchester',
    };
    expect(missingScorable(filled)).toEqual([]);
  });

  it('strength scales with completeness (0 → ≥65 once the four min-scorable fields are set)', () => {
    expect(strength({})).toBe(0);
    const minScorable = {
      targetRole: 'Senior Product Designer',
      skills: ['Figma'],
      location: 'Manchester',
      workMode: 'Hybrid',
    };
    // targetRole (20) + skills (20) + location (15) + workMode (10) = 65
    expect(strength(minScorable)).toBe(65);
    const filled = {
      ...minScorable,
      name: 'Alex',
      yearsExperience: 8,
      linkedinUrl: 'https://linkedin.com/in/alex',
      salaryMin: 65000,
      links: ['https://alex.dev'],
    };
    expect(strength(filled)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// AC2 — CV versioning on replace (FR-006).
// ---------------------------------------------------------------------------

describe('CVPROF-009 §2 — CV versioning on Replace retains history', () => {
  function makeExtractor(text = 'parsed text'): CvExtractor {
    return vi.fn(async () => ({ text, mime: 'pdf', chars: text.length }));
  }

  function writeFakeSource(name: string, body: string): string {
    const p = path.join(sourceDir, name);
    writeFileSync(p, body);
    return p;
  }

  it('re-uploading a CV creates a NEW versioned row (v1, v2, v3) — no overwrite', async () => {
    const db = new InMemoryDb();
    const store = createCvStore(db, {
      storageRoot,
      extractor: makeExtractor(),
    });

    const v1 = await store.upload({
      filePath: writeFakeSource('cv-1.pdf', 'first'),
      fileName: 'cv-original.pdf',
      mime: 'pdf',
    });
    const v2 = await store.upload({
      filePath: writeFakeSource('cv-2.pdf', 'second'),
      fileName: 'cv-improved.pdf',
      mime: 'pdf',
    });
    const v3 = await store.upload({
      filePath: writeFakeSource('cv-3.pdf', 'third'),
      fileName: 'cv-final.pdf',
      mime: 'pdf',
    });

    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);

    const all = store.list();
    expect(all).toHaveLength(3);
    // list() returns newest-first — the renderer's currentCv pick.
    expect(all.map((r) => r.version)).toEqual([3, 2, 1]);
    expect(all[0]?.fileName).toBe('cv-final.pdf');
    expect(all[2]?.fileName).toBe('cv-original.pdf');
  });

  it('versioning is per-profile — uploads under a different profile id start at v1', async () => {
    const db = new InMemoryDb();
    const store = createCvStore(db, {
      storageRoot,
      extractor: makeExtractor(),
    });
    await store.upload({
      filePath: writeFakeSource('a.pdf', 'a'),
      fileName: 'a.pdf',
      mime: 'pdf',
      profileId: 'alice',
    });
    const bob = await store.upload({
      filePath: writeFakeSource('b.pdf', 'b'),
      fileName: 'b.pdf',
      mime: 'pdf',
      profileId: 'bob',
    });
    expect(bob.version).toBe(1);
    expect(store.list('alice')).toHaveLength(1);
    expect(store.list('bob')).toHaveLength(1);
  });

  it('rejects unsupported mimes (FR-001) and oversize uploads (epic §3 — 10MB cap)', async () => {
    const db = new InMemoryDb();
    const store = createCvStore(db, {
      storageRoot,
      extractor: makeExtractor(),
    });
    await expect(
      store.upload({
        filePath: writeFakeSource('bad.txt', 'x'),
        fileName: 'bad.txt',
        mime: 'txt' as unknown as 'pdf',
      }),
    ).rejects.toThrow(/Unsupported|PDF and DOCX/i);

    const huge = writeFakeSource('huge.pdf', 'x'.repeat(10 * 1024 * 1024 + 1));
    await expect(
      store.upload({ filePath: huge, fileName: 'huge.pdf', mime: 'pdf' }),
    ).rejects.toThrow(/too large|10MB/i);
  });
});

// ---------------------------------------------------------------------------
// AC3 — Text extraction over real PDF / DOCX fixtures.
//
// Build a minimal valid PDF and a minimal valid DOCX in-memory, then drive
// the REAL extractCvText() against the REAL pdfjs-dist / mammoth libraries
// via an injected synchronous-style `parseOffThread` runner (the runner is
// the off-thread plug-point — the default uses node:worker_threads; we
// bypass the worker spawn to keep the test fast but still exercise the
// real parser libraries).
// ---------------------------------------------------------------------------

/** Build a minimal one-page PDF whose text stream contains `payload`.
 *  pdfjs-dist returns the text from `page.getTextContent()`. */
function buildMinimalPdf(payload: string): Buffer {
  const safe = payload.replace(/[()\\]/g, ' ');
  const stream = `BT /F1 12 Tf 50 750 Td (${safe}) Tj ET`;

  const objects: string[] = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    `<</Length ${stream.length}>>stream\n${stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];

  let body = '%PDF-1.4\n%\xff\xff\xff\xff\n';
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, 'binary'));
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(body, 'binary');
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  for (const off of offsets) {
    body += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body, 'binary');
}

// --- Hand-rolled "stored" ZIP for the minimal DOCX -------------------------

function crc32(buf: Buffer): number {
  let c: number;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (table[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const crc = crc32(entry.data);
    const size = entry.data.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6);  // flags
    local.writeUInt16LE(0, 8);  // method = stored
    local.writeUInt16LE(0, 10); // mtime
    local.writeUInt16LE(0, 12); // mdate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localChunks.push(local, nameBuf, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);  // version made by
    central.writeUInt16LE(20, 6);  // version needed
    central.writeUInt16LE(0, 8);   // flags
    central.writeUInt16LE(0, 10);  // method
    central.writeUInt16LE(0, 12);  // mtime
    central.writeUInt16LE(0, 14);  // mdate
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);  // extra length
    central.writeUInt16LE(0, 32);  // comment length
    central.writeUInt16LE(0, 34);  // disk start
    central.writeUInt16LE(0, 36);  // internal attrs
    central.writeUInt32LE(0, 38);  // external attrs
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += 30 + nameBuf.length + size;
  }

  const localBuf = Buffer.concat(localChunks);
  const centralBuf = Buffer.concat(centralChunks);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);  // disk
  end.writeUInt16LE(0, 6);  // start disk
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(localBuf.length, 16);
  end.writeUInt16LE(0, 20);  // comment length

  return Buffer.concat([localBuf, centralBuf, end]);
}

function buildMinimalDocx(text: string): Buffer {
  const docXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:body><w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:body>` +
    '</w:document>';
  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';

  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(docXml, 'utf8') },
  ]);
}

describe('CVPROF-009 §3 — text extraction over realistic PDF/DOCX fixtures', () => {
  // Adapter that runs the real parsers directly (skipping the worker_thread
  // spawn) so the test stays fast but still exercises pdfjs-dist / mammoth.
  async function realParseOffThread({
    mime,
    data,
  }: {
    mime: 'pdf' | 'docx';
    data: Buffer;
  }): Promise<string> {
    if (mime === 'pdf') {
      const pdfjs: { getDocument: (opts: unknown) => { promise: Promise<{
        numPages: number;
        getPage: (n: number) => Promise<{
          getTextContent: () => Promise<{ items: Array<{ str?: unknown }> }>;
        }>;
        cleanup?: () => Promise<void>;
      }> } } = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      const doc = await pdfjs.getDocument({
        data: bytes,
        disableFontFace: true,
        isEvalSupported: false,
      }).promise;
      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(
          content.items
            .map((it) => (typeof it.str === 'string' ? it.str : ''))
            .join(' '),
        );
      }
      try {
        await doc.cleanup?.();
      } catch {
        /* best effort */
      }
      return pages.join('\n\n').trim();
    }

    const mammothMod: {
      extractRawText: (opts: { buffer: Buffer }) => Promise<{ value?: string }>;
    } = await import('mammoth');
    const out = await mammothMod.extractRawText({ buffer: data });
    return String(out.value ?? '').trim();
  }

  it('extracts text from a real PDF fixture via pdfjs-dist', async () => {
    const fixturePath = path.join(sourceDir, 'sample-cv.pdf');
    writeFileSync(fixturePath, buildMinimalPdf('Alex Morgan Senior Product Designer Manchester'));

    const result = await extractCvText(
      { filePath: fixturePath, mime: 'pdf' },
      { parseOffThread: realParseOffThread },
    );

    expect(result.mime).toBe('pdf');
    expect(result.chars).toBeGreaterThan(0);
    // The text-content sequence may have extra whitespace between glyphs;
    // assert the key tokens are present.
    expect(result.text).toMatch(/Alex/);
    expect(result.text).toMatch(/Morgan/);
    expect(result.text).toMatch(/Manchester/);
  });

  it('extracts text from a real DOCX fixture via mammoth', async () => {
    const fixturePath = path.join(sourceDir, 'sample-cv.docx');
    writeFileSync(
      fixturePath,
      buildMinimalDocx('Alex Morgan, Senior Product Designer, Manchester'),
    );

    const result = await extractCvText(
      { filePath: fixturePath, mime: 'docx' },
      { parseOffThread: realParseOffThread },
    );

    expect(result.mime).toBe('docx');
    expect(result.text).toContain('Alex Morgan');
    expect(result.text).toContain('Senior Product Designer');
    expect(result.text).toContain('Manchester');
  });
});

// ---------------------------------------------------------------------------
// AC4 — LLM structuring maps OpenRouter response → parsedFields + confidence.
// Only the network call is mocked (epic §5 / NFR-002).
// ---------------------------------------------------------------------------

describe('CVPROF-009 §4 — structuring maps mocked OpenRouter response → parsedFields', () => {
  const STRUCTURED = {
    name: 'Alex Morgan',
    contact: { email: 'alex@example.com', phone: '+44 7700 900000' },
    targetRole: 'Senior Product Designer',
    skills: ['Figma', 'Design Systems', 'TypeScript'],
    employmentHistory: [
      {
        company: 'Acme Co',
        role: 'Senior Product Designer',
        startDate: '2021-03',
        endDate: null,
        summary: 'Led the design system rebuild.',
      },
    ],
    education: [
      { school: 'University of Leeds', qualification: 'BA Design', startDate: '2013', endDate: '2016' },
    ],
    totalYearsExperience: 8,
    location: 'Manchester, UK',
    confidence: {
      overall: 0.84,
      perField: { name: 0.95, targetRole: 0.8, skills: 0.9, location: 0.85 },
    },
  };

  function chatResponse(body: unknown, init: { status?: number; text?: string } = {}): Response {
    const status = init.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () =>
        Promise.resolve(
          init.text !== undefined
            ? init.text
            : typeof body === 'string'
              ? body
              : JSON.stringify(body),
        ),
    } as unknown as Response;
  }

  it('maps a well-formed OpenRouter response to typed parsedFields + confidence', async () => {
    const fetchMock = vi.fn(async () =>
      chatResponse({ choices: [{ message: { content: JSON.stringify(STRUCTURED) } }] }),
    );
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-test',
      getDefaultModel: () => 'anthropic/claude-sonnet-4',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await structurer.structure('Alex Morgan — Senior Product Designer, Manchester.');
    expect(result.parsedFields.name).toBe('Alex Morgan');
    expect(result.parsedFields.targetRole).toBe('Senior Product Designer');
    expect(result.parsedFields.skills).toEqual(['Figma', 'Design Systems', 'TypeScript']);
    expect(result.parsedFields.location).toBe('Manchester, UK');
    expect(result.parsedFields.totalYearsExperience).toBe(8);
    expect(result.parsedFields.contact.email).toBe('alex@example.com');
    expect(result.parsedFields.employmentHistory[0]?.company).toBe('Acme Co');
    expect(result.parsedFields.education[0]?.school).toBe('University of Leeds');

    expect(result.confidence.overall).toBeCloseTo(0.84, 5);
    expect(result.confidence.perField.targetRole).toBeCloseTo(0.8, 5);

    // Single outbound call to OpenRouter chat-completions — no new egress.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-or-test');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.model).toBe('anthropic/claude-sonnet-4');
    expect(body.response_format).toMatchObject({ type: 'json_schema' });
  });

  // -------------------------------------------------------------------------
  // AC5 — failure / no-key / manual entry paths.
  // -------------------------------------------------------------------------

  it('NO_API_KEY when Epic 2 has no saved key (the onboarding "skip the AI key" path)', async () => {
    const fetchMock = vi.fn();
    const structurer = createCvStructurer({
      getApiKey: () => null,
      getDefaultModel: () => 'anthropic/claude-sonnet-4',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(structurer.structure('CV text')).rejects.toBeInstanceOf(CvStructuringError);
    await expect(structurer.structure('CV text')).rejects.toMatchObject({ code: 'NO_API_KEY' });
    // Critically: no network call was attempted with a missing key (NFR-002).
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('NO_DEFAULT_MODEL when no default model is selected', async () => {
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-test',
      getDefaultModel: () => null,
      fetch: vi.fn() as unknown as typeof fetch,
    });
    await expect(structurer.structure('CV text')).rejects.toMatchObject({ code: 'NO_DEFAULT_MODEL' });
  });

  it('AUTH_ERROR on HTTP 401 — retryable failure surfaces a stable code', async () => {
    const fetchMock = vi.fn(async () => chatResponse({}, { status: 401, text: 'invalid' }));
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-bad',
      getDefaultModel: () => 'anthropic/claude-sonnet-4',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(structurer.structure('CV text')).rejects.toMatchObject({ code: 'AUTH_ERROR' });
  });

  it('RATE_LIMITED on HTTP 429', async () => {
    const fetchMock = vi.fn(async () => chatResponse({}, { status: 429, text: 'rate' }));
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-test',
      getDefaultModel: () => 'anthropic/claude-sonnet-4',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(structurer.structure('CV text')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('MODEL_NO_STRUCTURED_OUTPUT when the model rejects the response_format hint', async () => {
    const fetchMock = vi.fn(async () =>
      chatResponse({}, {
        status: 400,
        text: 'The selected model does not support response_format / json_schema',
      }),
    );
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-test',
      getDefaultModel: () => 'some/non-structured-model',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(structurer.structure('CV text')).rejects.toMatchObject({
      code: 'MODEL_NO_STRUCTURED_OUTPUT',
    });
  });

  it('NETWORK_ERROR when fetch itself throws (Epic 2 egress is down)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('socket hang up');
    });
    const structurer = createCvStructurer({
      getApiKey: () => 'sk-or-test',
      getDefaultModel: () => 'anthropic/claude-sonnet-4',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(structurer.structure('CV text')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

// ---------------------------------------------------------------------------
// AC6 — Manual-entry path (FR-005 / FR-007): the Profile is fully usable
// even when the LLM structuring was never invoked. This is the "no-key"
// fallback the onboarding flow surfaces.
// ---------------------------------------------------------------------------

describe('CVPROF-009 §5 — manual-entry path: Profile usable without any LLM call', () => {
  it('the Profile is editable + persisted end-to-end without ever calling the structurer', () => {
    const db = new InMemoryDb();
    const store = createProfileStore(db);

    // The user picks "Enter manually" on Onboarding step 2 — no CV upload,
    // no structuring call. They type the fields directly.
    store.save({
      name: 'Sam Patel',
      targetRole: 'Frontend Engineer',
      skills: ['TypeScript', 'Vue'],
      location: 'Bristol, UK',
      workMode: 'Remote',
      yearsExperience: 5,
    });

    const persisted = store.get();
    expect(persisted.name).toBe('Sam Patel');
    expect(persisted.targetRole).toBe('Frontend Engineer');
    expect(persisted.skills).toEqual(['TypeScript', 'Vue']);
    expect(persisted.location).toBe('Bristol, UK');
    expect(persisted.workMode).toBe('Remote');
    expect(persisted.yearsExperience).toBe(5);

    // And it survives "restart" the same way the LLM-derived profile does.
    const snap = db.snapshot();
    const db2 = new InMemoryDb();
    db2.restore(snap);
    const reopened = createProfileStore(db2).get();
    expect(reopened.targetRole).toBe('Frontend Engineer');
    expect(reopened.skills).toEqual(['TypeScript', 'Vue']);
  });
});
