/**
 * Enrichment `apply` — write a NEW enriched CV version, re-derive the
 * structured profile, and trigger the Epic 5 / Epic 6 stale hooks.
 * (ENRICH-004 — Epic 13: CV Enrichment.)
 *
 * Contract:
 *   - Input is the base TailoringDocument (the one the proposals were
 *     generated against) plus the user-accepted `ProposedChange` set.
 *   - We re-run the Epic 9 `apply` so rejected changes never reach the new
 *     version (AC5). The diff engine is the single source of truth for
 *     gating; this module does not re-implement validation.
 *   - A NEW versioned CV row is written via the injected `cvVersionWriter`
 *     (Epic 4 / CVPROF-003 versioning). The prior row is preserved; the new
 *     row's `parsedFields` carries a deterministic `__enrichmentApplyKey`
 *     so re-applying the SAME accepted set is a no-op (AC4 — dedup).
 *   - The structured profile is re-derived deterministically from the
 *     enriched TailoringDocument (skills, identity, employment summary
 *     bullets, education metadata) — no LLM call (AC2).
 *   - The Epic 5 (match scores) and Epic 6 (match reviews) stale hooks are
 *     called, plus the optional eval-report and tailored-docs hooks. The
 *     dedup branch does NOT call the hooks — re-applying must not
 *     double-mark.
 */
import {
  apply,
  type ApplyResult,
  type ProposedChange,
  type RejectedChange,
} from './tailorGates.js';
import type { CvParsedFields } from './cvStructurer.js';
import type { TailoringDocument } from './tailoringDocument.js';

// ---------------------------------------------------------------------------
// Deps — thin seams over the existing stores so this module stays unit-testable
// ---------------------------------------------------------------------------

export interface EnrichmentBaseCvRecord {
  id: string;
  profileId: string;
  version: number;
  parsedFields: Record<string, unknown> | null;
  parsedText: string;
}

export interface EnrichmentNewCvRecord {
  id: string;
  profileId: string;
  version: number;
  parsedText: string;
  parsedFields: Record<string, unknown>;
  uploadedAt: number;
}

export interface CvVersionWriter {
  /** Latest CV row for the profile (newest version), or null on first use. */
  latest(profileId?: string): EnrichmentBaseCvRecord | null;
  /** Insert a new CV row at version max+1. The writer assigns the id and
   *  inherits the storage binary from `baseCvId` (no new file is written —
   *  the enriched version is a TEXT-only derivative of the base CV). */
  create(input: {
    profileId: string;
    baseCvId: string;
    parsedText: string;
    parsedFields: Record<string, unknown>;
  }): EnrichmentNewCvRecord;
}

export interface ProfileWriter {
  save(input: {
    name?: string;
    targetRole?: string;
    yearsExperience?: number | null;
    location?: string;
    skills?: string[];
  }): void;
}

export interface EnrichmentStaleHooks {
  /** Epic 5 — flip every cached match score stale. */
  markScoresStale(): void;
  /** Epic 6 — flip every cached AI match review stale. */
  markReviewsStale(): void;
  /** Optional — Epic 14 eval reports. */
  markEvalReportsStale?(): void;
  /** Optional — Epic 7 tailored docs (cv / cover letter). */
  markTailoredDocsStale?(): void;
}

export interface EnrichmentApplyDeps {
  cvVersionWriter: CvVersionWriter;
  profileWriter: ProfileWriter;
  staleHooks: EnrichmentStaleHooks;
  /** Optional override; defaults to a built-in deterministic markdown renderer. */
  renderText?(doc: TailoringDocument): string;
}

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface EnrichmentApplyInput {
  /** Base TailoringDocument the proposals were generated against. */
  doc: TailoringDocument;
  /** User-accepted ProposedChange set (from the ENRICH-003 generation). */
  acceptedChanges: ReadonlyArray<ProposedChange>;
  /** Optional verified-skills allowlist for any `add_skill` actions. */
  verifiedSkills?: ReadonlyArray<string>;
  /** Optional profileId override; defaults to the latest CV's profile. */
  profileId?: string;
}

export interface EnrichmentApplyResult {
  /** The CV row referenced by this apply — new if `created` is true, the
   *  existing latest row if dedup hit. */
  cv: EnrichmentNewCvRecord | EnrichmentBaseCvRecord;
  /** True when this call wrote a new version; false on dedup. */
  created: boolean;
  /** Subset of `acceptedChanges` that passed Epic 9's gates. */
  applied: ProposedChange[];
  /** Epic 9 rejections (never reach the new version — AC5). */
  rejected: RejectedChange[];
  /** Final TailoringDocument persisted in the new version. */
  result: TailoringDocument;
  /** Deterministic dedup key — same input → same key. */
  applyKey: string;
  /** Re-derived structured profile (CvParsedFields). */
  parsedFields: CvParsedFields;
}

// ---------------------------------------------------------------------------
// Apply key — deterministic dedup
// ---------------------------------------------------------------------------

/**
 * Compute a stable apply-key from the (ordered) applied change set. The key
 * is intentionally INDEPENDENT of the base CV id — each `original` pins the
 * change to the exact substring it replaces, so a key that matches across
 * two calls means the same edits would touch the same prior text. That lets
 * dedup survive across the chain of enriched versions: row N's stored key
 * still matches when applyEnrichment is called again with the same accepted
 * set, even though `latest()` now returns row N (not the original row 1).
 */
export function computeApplyKey(
  _baseCvId: string,
  applied: ReadonlyArray<ProposedChange>,
): string {
  const norm = applied
    .map((c) =>
      JSON.stringify({
        p: c.path,
        a: c.action,
        o: c.original ?? '',
        v: c.value ?? '',
      }),
    )
    .sort()
    .join('|');
  // FNV-1a 32-bit; deterministic and dependency-free.
  let hash = 0x811c9dc5;
  const buf = norm;
  for (let i = 0; i < buf.length; i++) {
    hash ^= buf.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `e1:${(hash >>> 0).toString(16).padStart(8, '0')}:${applied.length}`;
}

export const ENRICHMENT_APPLY_KEY_FIELD = '__enrichmentApplyKey';

// ---------------------------------------------------------------------------
// Profile re-derive — deterministic, no LLM
// ---------------------------------------------------------------------------

function readPrevFields(raw: Record<string, unknown> | null): CvParsedFields | null {
  if (!raw || typeof raw !== 'object') return null;
  const contactRaw = (raw.contact as Record<string, unknown> | null) ?? null;
  const employmentRaw = Array.isArray(raw.employmentHistory)
    ? (raw.employmentHistory as Array<Record<string, unknown>>)
    : [];
  const educationRaw = Array.isArray(raw.education)
    ? (raw.education as Array<Record<string, unknown>>)
    : [];
  return {
    name: (raw.name ?? null) as string | null,
    contact: {
      email: (contactRaw?.email ?? null) as string | null,
      phone: (contactRaw?.phone ?? null) as string | null,
    },
    targetRole: (raw.targetRole ?? null) as string | null,
    skills: Array.isArray(raw.skills)
      ? (raw.skills as unknown[]).filter((s): s is string => typeof s === 'string')
      : [],
    employmentHistory: employmentRaw.map((e) => ({
      company: (e.company ?? null) as string | null,
      role: (e.role ?? null) as string | null,
      startDate: (e.startDate ?? null) as string | null,
      endDate: (e.endDate ?? null) as string | null,
      summary: (e.summary ?? null) as string | null,
    })),
    education: educationRaw.map((e) => ({
      school: (e.school ?? null) as string | null,
      qualification: (e.qualification ?? null) as string | null,
      startDate: (e.startDate ?? null) as string | null,
      endDate: (e.endDate ?? null) as string | null,
    })),
    totalYearsExperience:
      typeof raw.totalYearsExperience === 'number'
        ? (raw.totalYearsExperience as number)
        : null,
    location: (raw.location ?? null) as string | null,
  };
}

/**
 * Re-derive CvParsedFields from the enriched TailoringDocument.
 * Editable fields come from `doc`; frozen/unrepresented fields fall back to
 * the previous parse so non-enriched data (targetRole, totalYearsExperience)
 * survives.
 */
export function deriveCvParsedFieldsFromDoc(
  doc: TailoringDocument,
  prev: CvParsedFields | null,
): CvParsedFields {
  return {
    name: doc.identity.name ?? prev?.name ?? null,
    contact: {
      email: doc.identity.contact.email ?? prev?.contact.email ?? null,
      phone: doc.identity.contact.phone ?? prev?.contact.phone ?? null,
    },
    targetRole: prev?.targetRole ?? null,
    skills: [...doc.skills],
    employmentHistory: doc.experience.map((e) => ({
      company: e.company,
      role: e.role,
      startDate: e.startDate,
      endDate: e.endDate,
      summary: e.bullets.length ? e.bullets.map((b) => `- ${b}`).join('\n') : null,
    })),
    education: doc.education.map((ed) => ({
      school: ed.school,
      qualification: ed.qualification,
      startDate: ed.startDate,
      endDate: ed.endDate,
    })),
    totalYearsExperience: prev?.totalYearsExperience ?? null,
    location: doc.identity.location ?? prev?.location ?? null,
  };
}

// ---------------------------------------------------------------------------
// Default text renderer (TailoringDocument → markdown)
// ---------------------------------------------------------------------------

function defaultRenderText(doc: TailoringDocument): string {
  const lines: string[] = [];
  if (doc.identity.name) lines.push(`# ${doc.identity.name}`);
  if (doc.summary) {
    lines.push('', '## Summary', doc.summary);
  }
  if (doc.skills.length) {
    lines.push('', '## Skills', doc.skills.join(', '));
  }
  if (doc.experience.length) {
    lines.push('', '## Experience');
    for (const e of doc.experience) {
      const header = [e.role, e.company].filter(Boolean).join(' — ');
      const dates = [e.startDate, e.endDate].filter(Boolean).join(' – ');
      lines.push('', `### ${header || '(role)'}${dates ? `  (${dates})` : ''}`);
      for (const b of e.bullets) lines.push(`- ${b}`);
    }
  }
  if (doc.education.length) {
    lines.push('', '## Education');
    for (const ed of doc.education) {
      const header = [ed.qualification, ed.school].filter(Boolean).join(' — ');
      const dates = [ed.startDate, ed.endDate].filter(Boolean).join(' – ');
      lines.push('', `### ${header || '(qualification)'}${dates ? `  (${dates})` : ''}`);
      if (ed.description) lines.push(ed.description);
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// applyEnrichment
// ---------------------------------------------------------------------------

export function applyEnrichment(
  input: EnrichmentApplyInput,
  deps: EnrichmentApplyDeps,
): EnrichmentApplyResult {
  const { doc, acceptedChanges } = input;

  // AC5 — funnel accepted changes through Epic 9 so any that fail the gates
  // are dropped before they touch the new version.
  const epic9: ApplyResult = apply(
    doc,
    [...acceptedChanges],
    input.verifiedSkills ? { verifiedSkills: input.verifiedSkills } : {},
  );

  const base = deps.cvVersionWriter.latest(input.profileId);
  if (!base) {
    throw new Error(
      'applyEnrichment: no base CV available — upload one before enriching',
    );
  }
  const profileId = input.profileId ?? base.profileId;
  const applyKey = computeApplyKey(base.id, epic9.applied);

  // AC4 — dedup: if the latest CV row was already produced by this same
  // accepted set, return it without writing a new row or firing the hooks.
  // An empty applied set is NEVER treated as a dedup hit — nothing was
  // actually applied, so the caller should see `created: false` only when a
  // prior identical apply genuinely produced the latest row.
  const baseKey = (base.parsedFields ?? {})[ENRICHMENT_APPLY_KEY_FIELD];
  if (
    epic9.applied.length > 0 &&
    typeof baseKey === 'string' &&
    baseKey === applyKey
  ) {
    const prevFields = readPrevFields(base.parsedFields) ?? {
      name: null,
      contact: { email: null, phone: null },
      targetRole: null,
      skills: [],
      employmentHistory: [],
      education: [],
      totalYearsExperience: null,
      location: null,
    };
    return {
      cv: base,
      created: false,
      applied: epic9.applied,
      rejected: epic9.rejected,
      result: epic9.result,
      applyKey,
      parsedFields: prevFields,
    };
  }

  // AC2 — deterministic profile re-derive from the enriched TailoringDocument.
  const prevFields = readPrevFields(base.parsedFields);
  const parsedFields = deriveCvParsedFieldsFromDoc(epic9.result, prevFields);

  const render = deps.renderText ?? defaultRenderText;
  const parsedText = render(epic9.result);

  // AC1 — write a NEW versioned CV row via Epic 4 versioning. The writer is
  // responsible for assigning version = max+1; this layer never touches the
  // version counter directly.
  const created = deps.cvVersionWriter.create({
    profileId,
    baseCvId: base.id,
    parsedText,
    parsedFields: {
      ...(parsedFields as unknown as Record<string, unknown>),
      [ENRICHMENT_APPLY_KEY_FIELD]: applyKey,
    },
  });

  // AC2 (continued) — also push the re-derived fields onto the singleton
  // Profile so the rest of the app (scoring, review, tailor) reads them.
  deps.profileWriter.save({
    name: parsedFields.name ?? '',
    targetRole: parsedFields.targetRole ?? '',
    yearsExperience: parsedFields.totalYearsExperience,
    location: parsedFields.location ?? '',
    skills: parsedFields.skills,
  });

  // AC3 — Epic 5 + Epic 6 (+ Epic 14 eval reports / Epic 7 tailored docs)
  // stale hooks. Mirrors the CV-upload hook in electron-main.ts so apply is
  // indistinguishable from a fresh CV upload for downstream caches.
  deps.staleHooks.markScoresStale();
  deps.staleHooks.markReviewsStale();
  deps.staleHooks.markEvalReportsStale?.();
  deps.staleHooks.markTailoredDocsStale?.();

  return {
    cv: created,
    created: true,
    applied: epic9.applied,
    rejected: epic9.rejected,
    result: epic9.result,
    applyKey,
    parsedFields,
  };
}
