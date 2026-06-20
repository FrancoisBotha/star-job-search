/**
 * Tailoring diff-engine gates + applier (TDE-002 — Epic 9).
 *
 * Validates a stream of LLM-proposed edits against a TailoringDocument
 * (TDE-001) and produces a new document, never mutating the input.
 *
 * A ProposedChange is validated through four gates:
 *   1. path is in the editable allowlist (computed from the document shape
 *      — different per action: leaf paths for `replace`, list paths for
 *      `append`/`reorder`, exactly `skills` for `add_skill`).
 *   2. path is not a frozen / blocked leaf-field (identity, dates, etc.).
 *   3. path resolves on the current document state.
 *   4. for `replace`, the supplied `original` matches the actual text
 *      case- and whitespace-insensitive.
 *
 * Action safety:
 *   - replace   : value is a string; target is a string.
 *   - append    : value is a non-empty string; target is a list.
 *   - reorder   : value is a string[]; target is a list. The proposal is
 *                 SALVAGED — for the skills list, unverified new items are
 *                 dropped but real items are NEVER lost; for any other list,
 *                 all new items are dropped (only verified-new is meaningful
 *                 for skills) and real items are likewise preserved.
 *   - add_skill : value is a verified skill (case/space-insensitive match
 *                 against the supplied verifiedSkills set); path must be
 *                 `skills`; duplicates rejected.
 */
import {
  type TailoringDocument,
  isFrozenPath,
  resolvePath,
  setPath,
} from './tailoringDocument.js';

/** Shape patterns for editable LEAF paths (replace targets). Index ranges
 *  are not bound here — Gate 3 (resolve) is what enforces in-range. */
const EDITABLE_LEAF_PATTERNS: RegExp[] = [
  /^summary$/,
  /^skills\[\d+\]$/,
  /^experience\[\d+\]\.bullets\[\d+\]$/,
  /^projects\[\d+\]\.bullets\[\d+\]$/,
  /^education\[\d+\]\.description$/,
];

/** Shape patterns for editable LIST paths (append / reorder targets). */
const EDITABLE_LIST_PATTERNS: RegExp[] = [
  /^skills$/,
  /^experience\[\d+\]\.bullets$/,
  /^projects\[\d+\]\.bullets$/,
];

function matchesAny(path: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(path));
}

export type TailorAction = 'replace' | 'append' | 'reorder' | 'add_skill';

export interface ProposedChange {
  path: string;
  action: TailorAction;
  /** Required for `replace`; ignored for other actions. */
  original?: string;
  value: unknown;
  reason: string;
}

export interface RejectedChange {
  change: ProposedChange;
  reason: string;
}

export interface ApplyResult {
  result: TailoringDocument;
  applied: ProposedChange[];
  rejected: RejectedChange[];
}

export interface ApplyOptions {
  /** Verified-skill allowlist. Matched case/space-insensitive. */
  verifiedSkills?: ReadonlyArray<string> | ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function toNormSet(v: ApplyOptions['verifiedSkills']): Set<string> {
  const out = new Set<string>();
  if (!v) return out;
  const iter = v instanceof Set ? Array.from(v) : v;
  for (const s of iter) out.add(normalize(s));
  return out;
}

type ValidationOk = { ok: true; next: TailoringDocument };
type ValidationFail = { ok: false; reason: string };
type Validation = ValidationOk | ValidationFail;

function applyOne(
  doc: TailoringDocument,
  change: ProposedChange,
  verified: Set<string>,
): Validation {
  const { path, action, value } = change;

  // Gate 2 — frozen check first; a frozen path is never editable regardless of action.
  if (isFrozenPath(doc, path)) {
    return { ok: false, reason: 'path is a frozen / blocked leaf-field' };
  }

  // Gate 1 — per-action editable allowlist (shape-only; range checked by Gate 3).
  if (action === 'replace') {
    if (!matchesAny(path, EDITABLE_LEAF_PATTERNS)) {
      return { ok: false, reason: 'path is not in the editable allowlist for replace' };
    }
  } else if (action === 'append' || action === 'reorder') {
    if (!matchesAny(path, EDITABLE_LIST_PATTERNS)) {
      return { ok: false, reason: `path is not an editable list (required for ${action})` };
    }
  } else if (action === 'add_skill') {
    if (path !== 'skills') {
      return { ok: false, reason: 'add_skill must target the skills list' };
    }
  } else {
    return { ok: false, reason: `unknown action: ${String(action)}` };
  }

  // Gate 3 — path resolves on the document.
  const current = resolvePath(doc, path);
  if (current === undefined) {
    return { ok: false, reason: 'path does not resolve on the document' };
  }

  switch (action) {
    case 'replace': {
      if (typeof value !== 'string') {
        return { ok: false, reason: 'replace value must be a string' };
      }
      if (typeof current !== 'string') {
        return { ok: false, reason: 'replace target is not a string leaf' };
      }
      // Gate 4 — original must match (case/space-insensitive).
      if (typeof change.original !== 'string') {
        return { ok: false, reason: 'replace requires an `original` string' };
      }
      if (normalize(change.original) !== normalize(current)) {
        return { ok: false, reason: 'supplied `original` does not match current text' };
      }
      return { ok: true, next: setPath(doc, path, value) };
    }

    case 'append': {
      if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, reason: 'append value must be a non-empty string' };
      }
      if (!Array.isArray(current)) {
        return { ok: false, reason: 'append target is not a list' };
      }
      const next = setPath(doc, path, [...(current as string[]), value]);
      return { ok: true, next };
    }

    case 'add_skill': {
      if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, reason: 'add_skill value must be a non-empty string' };
      }
      const norm = normalize(value);
      if (!verified.has(norm)) {
        return { ok: false, reason: 'skill is not in the verified allowlist' };
      }
      const skills = current as string[];
      if (skills.some((s) => normalize(s) === norm)) {
        return { ok: false, reason: 'skill already present' };
      }
      return { ok: true, next: setPath(doc, path, [...skills, value]) };
    }

    case 'reorder': {
      if (!Array.isArray(value)) {
        return { ok: false, reason: 'reorder value must be an array of strings' };
      }
      if (!Array.isArray(current)) {
        return { ok: false, reason: 'reorder target is not a list' };
      }
      if (!(value as unknown[]).every((v) => typeof v === 'string')) {
        return { ok: false, reason: 'reorder items must all be strings' };
      }
      const existing = current as string[];
      const existingByNorm = new Map<string, string>();
      for (const e of existing) existingByNorm.set(normalize(e), e);
      const isSkills = path === 'skills';

      // Salvage pass: walk the proposal, drop dupes and unverified-new
      // (for skills, "verified-new" is allowed; for other lists, no new
      // item is acceptable so they are all dropped).
      const seen = new Set<string>();
      const salvaged: string[] = [];
      for (const raw of value as string[]) {
        const n = normalize(raw);
        if (seen.has(n)) continue;
        seen.add(n);
        const existingItem = existingByNorm.get(n);
        if (existingItem !== undefined) {
          salvaged.push(existingItem); // preserve original casing
          continue;
        }
        if (isSkills && verified.has(n)) {
          salvaged.push(raw);
          continue;
        }
        // unverified new item — drop.
      }

      // Never drop a real item: append any existing item missing from the salvage.
      const included = new Set(salvaged.map(normalize));
      for (const e of existing) {
        if (!included.has(normalize(e))) salvaged.push(e);
      }

      return { ok: true, next: setPath(doc, path, salvaged) };
    }
  }
}

export function apply(
  doc: TailoringDocument,
  changes: ReadonlyArray<ProposedChange>,
  options: ApplyOptions = {},
): ApplyResult {
  const verified = toNormSet(options.verifiedSkills);
  let current: TailoringDocument = doc;
  const applied: ProposedChange[] = [];
  const rejected: RejectedChange[] = [];
  for (const change of changes) {
    const r = applyOne(current, change, verified);
    if (r.ok) {
      current = r.next;
      applied.push(change);
    } else {
      rejected.push({ change, reason: r.reason });
    }
  }
  return { result: current, applied, rejected };
}
