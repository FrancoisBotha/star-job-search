/**
 * Tailoring-document model (TDE-001 — Epic 9: Tailoring Diff Engine).
 *
 * Derives a structured tailoring document from the Epic 4 parsed CV
 * (`CvParsedFields` produced by `cvStructurer.ts`) plus the base CV text
 * (`CV.parsedText`). The document exposes an explicit, addressable set of
 * EDITABLE paths and a complementary FROZEN set:
 *
 *   editable: summary
 *             experience[i].bullets[j]
 *             projects[i].bullets[j]
 *             education[i].description
 *             skills[i]
 *
 *   frozen:   identity.name
 *             identity.contact.email / .phone
 *             identity.location
 *             experience[i].company / .role / .startDate / .endDate
 *             projects[i].name
 *             education[i].school / .qualification / .startDate / .endDate
 *
 * The substrate question for per-role bullets is resolved deterministically:
 *
 *   1. If `employmentHistory[i].summary` (Epic 4 parsed) contains bullet /
 *      newline markers (`*`, `-`, `•`, `\n`), split it into bullets.
 *      `meta.bulletSource === 'parsed'`.
 *   2. Else, scan the base CV text for the role anchor
 *      (`role @ company` / `role, company`) and harvest contiguous bullet
 *      lines underneath. `meta.bulletSource === 'baseCvText'`.
 *   3. Else, leave bullets empty. Structure is NEVER fabricated.
 *
 * Epic 4 has no `projects` field, so `projects` starts empty — projects are
 * added later by the user or a future structuring pass.
 *
 * `resolvePath` / `setPath` are pure helpers supporting dot + bracket syntax
 * (`experience[0].bullets[1]`, `skills[2]`, `summary`). They round-trip
 * values and fail safely on bad paths: `resolvePath` returns `undefined`,
 * `setPath` returns the original document unchanged.
 */
import type { CvParsedFields } from './cvStructurer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TailoringIdentity {
  name: string | null;
  contact: { email: string | null; phone: string | null };
  location: string | null;
}

export interface TailoringExperience {
  /** frozen */ company: string | null;
  /** frozen */ role: string | null;
  /** frozen */ startDate: string | null;
  /** frozen */ endDate: string | null;
  /** editable */ bullets: string[];
}

export interface TailoringProject {
  /** frozen */ name: string | null;
  /** editable */ bullets: string[];
}

export interface TailoringEducation {
  /** frozen */ school: string | null;
  /** frozen */ qualification: string | null;
  /** frozen */ startDate: string | null;
  /** frozen */ endDate: string | null;
  /** editable */ description: string;
}

export interface TailoringDocument {
  /** frozen */ identity: TailoringIdentity;
  /** editable */ summary: string;
  /** editable */ skills: string[];
  experience: TailoringExperience[];
  projects: TailoringProject[];
  education: TailoringEducation[];
  meta: {
    /** Documents where bullets came from (AC4). 'parsed' wins per entry; if
     *  any entry fell back to the base CV text, the doc-level source is
     *  'baseCvText'; if neither yielded anything the source is 'none'. */
    bulletSource: 'parsed' | 'baseCvText' | 'none';
  };
}

// ---------------------------------------------------------------------------
// Bullet derivation
// ---------------------------------------------------------------------------

const BULLET_LINE_RE = /^\s*(?:[-*•·●]|•)\s*(.+?)\s*$/;

function splitParsedSummaryIntoBullets(summary: string | null | undefined): string[] {
  if (!summary || !summary.trim()) return [];
  const text = summary.replace(/\r\n/g, '\n');
  const hasBulletMarker = /[\n\r]|[-*•·●]/.test(text);
  if (!hasBulletMarker) return [];
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const out: string[] = [];
  for (const line of lines) {
    const m = BULLET_LINE_RE.exec(line);
    out.push(m ? m[1]! : line);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function deriveBulletsFromBaseText(
  role: string | null,
  company: string | null,
  baseCvText: string,
): string[] {
  if (!baseCvText) return [];
  const text = baseCvText.replace(/\r\n/g, '\n');
  const anchors: RegExp[] = [];
  if (role && company) {
    anchors.push(new RegExp(`${escapeRegExp(role)}[^\\n]*${escapeRegExp(company)}`, 'i'));
    anchors.push(new RegExp(`${escapeRegExp(company)}[^\\n]*${escapeRegExp(role)}`, 'i'));
  }
  if (role) anchors.push(new RegExp(escapeRegExp(role), 'i'));
  if (company) anchors.push(new RegExp(escapeRegExp(company), 'i'));

  for (const anchor of anchors) {
    const m = anchor.exec(text);
    if (!m) continue;
    const after = text.slice(m.index + m[0].length).split('\n');
    const collected: string[] = [];
    for (let i = 0; i < after.length; i++) {
      const line = after[i]!.trim();
      if (line.length === 0) {
        if (collected.length > 0) break;
        continue;
      }
      const bm = BULLET_LINE_RE.exec(line);
      if (bm) {
        collected.push(bm[1]!);
        continue;
      }
      if (collected.length > 0) break;
    }
    if (collected.length > 0) return collected;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export function buildTailoringDocument(
  parsed: CvParsedFields,
  baseCvText: string,
): TailoringDocument {
  let anyParsed = false;
  let anyFallback = false;

  const experience: TailoringExperience[] = (parsed.employmentHistory ?? []).map((e) => {
    let bullets = splitParsedSummaryIntoBullets(e.summary);
    if (bullets.length > 0) {
      anyParsed = true;
    } else {
      bullets = deriveBulletsFromBaseText(e.role, e.company, baseCvText);
      if (bullets.length > 0) anyFallback = true;
    }
    return {
      company: e.company ?? null,
      role: e.role ?? null,
      startDate: e.startDate ?? null,
      endDate: e.endDate ?? null,
      bullets,
    };
  });

  const education: TailoringEducation[] = (parsed.education ?? []).map((ed) => ({
    school: ed.school ?? null,
    qualification: ed.qualification ?? null,
    startDate: ed.startDate ?? null,
    endDate: ed.endDate ?? null,
    description: '',
  }));

  const bulletSource: TailoringDocument['meta']['bulletSource'] = anyParsed
    ? 'parsed'
    : anyFallback
      ? 'baseCvText'
      : 'none';

  return {
    identity: {
      name: parsed.name ?? null,
      contact: {
        email: parsed.contact?.email ?? null,
        phone: parsed.contact?.phone ?? null,
      },
      location: parsed.location ?? null,
    },
    summary: '',
    skills: [...(parsed.skills ?? [])],
    experience,
    projects: [],
    education,
    meta: { bulletSource },
  };
}

// ---------------------------------------------------------------------------
// Path resolution (dot + bracket)
// ---------------------------------------------------------------------------

type PathStep = { kind: 'prop'; name: string } | { kind: 'index'; index: number };

function parsePath(path: string): PathStep[] | null {
  if (typeof path !== 'string' || path.length === 0) return null;
  const steps: PathStep[] = [];
  const re = /([A-Za-z_$][A-Za-z0-9_$]*)|\[(\d+)\]|\./g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(path)) !== null) {
    if (m.index !== last) return null;
    last = re.lastIndex;
    if (m[1] !== undefined) {
      steps.push({ kind: 'prop', name: m[1] });
    } else if (m[2] !== undefined) {
      steps.push({ kind: 'index', index: Number(m[2]) });
    }
  }
  if (last !== path.length) return null;
  if (steps.length === 0) return null;
  if (steps[0]!.kind !== 'prop') return null;
  return steps;
}

export function resolvePath(doc: unknown, path: string): unknown {
  const steps = parsePath(path);
  if (!steps) return undefined;
  let cur: unknown = doc;
  for (const step of steps) {
    if (cur == null) return undefined;
    if (step.kind === 'prop') {
      if (typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[step.name];
    } else {
      if (!Array.isArray(cur)) return undefined;
      if (step.index < 0 || step.index >= cur.length) return undefined;
      cur = cur[step.index];
    }
  }
  return cur;
}

function cloneWithSet(target: unknown, steps: PathStep[], value: unknown): unknown | undefined {
  const step = steps[0]!;
  const rest = steps.slice(1);
  if (step.kind === 'prop') {
    if (target == null || typeof target !== 'object' || Array.isArray(target)) return undefined;
    const obj = target as Record<string, unknown>;
    if (!Object.prototype.hasOwnProperty.call(obj, step.name)) return undefined;
    if (rest.length === 0) {
      return { ...obj, [step.name]: value };
    }
    const child = cloneWithSet(obj[step.name], rest, value);
    if (child === undefined) return undefined;
    return { ...obj, [step.name]: child };
  } else {
    if (!Array.isArray(target)) return undefined;
    if (step.index < 0 || step.index >= target.length) return undefined;
    const arr = target.slice();
    if (rest.length === 0) {
      arr[step.index] = value;
      return arr;
    }
    const child = cloneWithSet(arr[step.index], rest, value);
    if (child === undefined) return undefined;
    arr[step.index] = child;
    return arr;
  }
}

export function setPath<T>(doc: T, path: string, value: unknown): T {
  const steps = parsePath(path);
  if (!steps) return doc;
  const next = cloneWithSet(doc, steps, value);
  if (next === undefined) return doc;
  return next as T;
}

// ---------------------------------------------------------------------------
// Editable / frozen partition
// ---------------------------------------------------------------------------

export function listEditablePaths(doc: TailoringDocument): string[] {
  const paths: string[] = ['summary'];
  for (let i = 0; i < doc.skills.length; i++) paths.push(`skills[${i}]`);
  for (let i = 0; i < doc.experience.length; i++) {
    const exp = doc.experience[i]!;
    for (let j = 0; j < exp.bullets.length; j++) {
      paths.push(`experience[${i}].bullets[${j}]`);
    }
  }
  for (let i = 0; i < doc.projects.length; i++) {
    const p = doc.projects[i]!;
    for (let j = 0; j < p.bullets.length; j++) {
      paths.push(`projects[${i}].bullets[${j}]`);
    }
  }
  for (let i = 0; i < doc.education.length; i++) {
    paths.push(`education[${i}].description`);
  }
  return paths;
}

const FROZEN_PATTERNS: RegExp[] = [
  /^identity\.name$/,
  /^identity\.contact\.email$/,
  /^identity\.contact\.phone$/,
  /^identity\.location$/,
  /^experience\[\d+\]\.(company|role|startDate|endDate)$/,
  /^projects\[\d+\]\.name$/,
  /^education\[\d+\]\.(school|qualification|startDate|endDate)$/,
];

export function isFrozenPath(_doc: TailoringDocument, path: string): boolean {
  return FROZEN_PATTERNS.some((re) => re.test(path));
}
