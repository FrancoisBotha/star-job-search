/**
 * Enrichment `generate` + answer-provenance grounding gate
 * (ENRICH-003 — Epic 13: CV Enrichment).
 *
 * Given the prioritized weak-bullet candidates (ENRICH-001), the
 * discovery questions (ENRICH-002), and the user's answers, produce a set
 * of Epic 9 `ProposedChange` diffs that improve the weakest bullets.
 *
 * Grounding rules (non-negotiable):
 *   - The rewrites are grounded ONLY in the bullet's existing CV content
 *     (reworded) or in the user's answered values. No JD, no scoring, no
 *     external knowledge.
 *   - Generated changes are routed through the Epic 9 four-gate validator
 *     (`tailorGates.apply`) — identity, employers, dates, institutions and
 *     degrees are frozen / unreachable.
 *   - A NEW answer-provenance metric gate accepts a new number ONLY if the
 *     number's token already exists in the user's answers OR in the
 *     existing CV (the TailoringDocument). Every other added number is
 *     rejected — never estimated, never invented.
 *   - A `skipped` / unusable answer downgrades the rewrite to a minimal
 *     reword (active verb / clarity) with no fabricated metric. If the LLM
 *     tries to inject a number for a skipped item, the provenance gate
 *     strips it and we fall back to a deterministic minimal active-verb
 *     rewording.
 *
 * Each emitted `EnrichmentProposal` carries the underlying Epic 9
 * `ProposedChange`, the human-readable `reason`, the `provenance` string
 * (e.g. "from your answer: 250k users"), and the gate verdict.
 */
import {
  apply,
  type ApplyResult,
  type ProposedChange,
  type RejectedChange,
} from './tailorGates.js';
import {
  isFrozenPath,
  resolvePath,
  type TailoringDocument,
} from './tailoringDocument.js';
import {
  isAnswerUsable,
  type MetricAnswer,
  type MetricQuestion,
} from './metricQuestionGenerator.js';
import type { WeakBulletCandidate } from './weakBulletAnalyzer.js';

// ---------------------------------------------------------------------------
// Number extraction (AC3)
// ---------------------------------------------------------------------------

/**
 * Extract numeric tokens used by the provenance gate. Produces a generous
 * set so equivalent representations match:
 *   - raw digit runs ("250", "40")
 *   - the run with its unit suffix where present ("40%", "$1.2m", "250k")
 *   - canonical-expanded forms for k/m/b suffixes ("250000", "1200000")
 *
 * Years (1990-2099 / 1900-2999) are NOT special-cased — if the original
 * already has them they appear in `docCorpus`, otherwise they need a
 * provenance just like any other number.
 */
const NUMBER_RE = /(\$\s?)?(\d+(?:[.,]\d+)?)(\s?(%|k|m|b|bn|million|billion|thousand))?/gi;

export function extractNumberTokens(text: string): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(NUMBER_RE)) {
    const dollar = m[1] ? '$' : '';
    const raw = m[2]!;
    const unit = (m[4] || '').toLowerCase();
    const normRaw = raw.replace(/[,\s]/g, '');
    out.add(normRaw);
    if (dollar) out.add(`$${normRaw}`);
    if (unit) {
      out.add(`${normRaw}${unit}`);
      const n = Number(normRaw);
      if (!Number.isNaN(n)) {
        let mult = 1;
        if (unit === 'k' || unit === 'thousand') mult = 1_000;
        else if (unit === 'm' || unit === 'million') mult = 1_000_000;
        else if (unit === 'b' || unit === 'bn' || unit === 'billion') mult = 1_000_000_000;
        if (mult !== 1) out.add(String(Math.round(n * mult)));
      }
      if (unit === '%') out.add(`${normRaw}%`);
    }
  }
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// Answer-provenance gate (AC3, AC6)
// ---------------------------------------------------------------------------

export interface AnswerProvenanceInput {
  originalText: string;
  rewrittenText: string;
  /** All usable user-answer values joined into one string. */
  answerCorpus: string;
  /** All existing CV content (TailoringDocument, joined) — numbers already
   *  present in the CV are accepted by reference. */
  docCorpus: string;
}

export interface GateVerdict {
  ok: boolean;
  reason: string;
  /** The number tokens in `rewrittenText` that did NOT trace anywhere. */
  untraceable: string[];
}

export function answerProvenanceGate(input: AnswerProvenanceInput): GateVerdict {
  const originalNums = new Set(extractNumberTokens(input.originalText));
  const answerNums = new Set(extractNumberTokens(input.answerCorpus));
  const docNums = new Set(extractNumberTokens(input.docCorpus));
  const rewrittenNums = extractNumberTokens(input.rewrittenText);

  const untraceable: string[] = [];
  for (const n of rewrittenNums) {
    if (originalNums.has(n)) continue;
    if (answerNums.has(n)) continue;
    if (docNums.has(n)) continue;
    untraceable.push(n);
  }
  if (untraceable.length === 0) {
    return { ok: true, reason: 'no untraceable numbers', untraceable: [] };
  }
  return {
    ok: false,
    reason: `untraceable / invented number(s): ${untraceable.join(', ')}`,
    untraceable,
  };
}

// ---------------------------------------------------------------------------
// Minimal deterministic reword (AC5)
// ---------------------------------------------------------------------------

/** Generic-verb phrases → active replacements. Lowercase keys. */
const ACTIVE_VERB_REWRITES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bresponsible for\b/i, 'Owned'],
  [/\bresponsibilities included\b/i, 'Owned'],
  [/\bduties included\b/i, 'Owned'],
  [/\bworked on\b/i, 'Built'],
  [/\bworked with\b/i, 'Partnered with'],
  [/\bhelped with\b/i, 'Supported'],
  [/\bhelped to\b/i, 'Supported'],
  [/\bassisted with\b/i, 'Supported'],
  [/\bassisted in\b/i, 'Supported'],
  [/\binvolved in\b/i, 'Drove'],
  [/\bparticipated in\b/i, 'Contributed to'],
  [/\btasked with\b/i, 'Led'],
  [/\bin charge of\b/i, 'Led'],
  [/\bpart of a team that\b/i, 'Helped to'],
  [/\bpart of the team that\b/i, 'Helped to'],
];

/**
 * Deterministic minimal reword: replace the first generic phrase with an
 * active verb. If none fires, return the original (no change). NEVER adds
 * a number — that's the whole point of this path.
 */
export function minimalReword(text: string): string {
  let out = text;
  for (const [re, replacement] of ACTIVE_VERB_REWRITES) {
    if (re.test(out)) {
      out = out.replace(re, replacement);
      // Lowercase first char of the next word so "Owned the…" reads natural.
      out = out.replace(/^(\s*)(\w)/, (_, sp, ch) => `${sp}${ch.toUpperCase()}`);
      return out;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Doc-corpus extraction (AC3 — CV-existing numbers count as provenance)
// ---------------------------------------------------------------------------

function collectDocCorpus(doc: TailoringDocument): string {
  const parts: string[] = [];
  parts.push(doc.summary || '');
  for (const s of doc.skills) parts.push(s);
  for (const exp of doc.experience) {
    parts.push(exp.company || '', exp.role || '', exp.startDate || '', exp.endDate || '');
    for (const b of exp.bullets) parts.push(b);
  }
  for (const p of doc.projects) {
    parts.push(p.name || '');
    for (const b of p.bullets) parts.push(b);
  }
  for (const e of doc.education) {
    parts.push(
      e.school || '',
      e.qualification || '',
      e.startDate || '',
      e.endDate || '',
      e.description || '',
    );
  }
  return parts.filter(Boolean).join(' \n ');
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

export interface EnrichmentLLM {
  /**
   * Rewrite a single weak bullet. Implementations should produce a
   * condensed-STAR (situation → task → action → result) or X-Y-Z
   * (accomplished X, measured by Y, by doing Z) phrasing using only:
   *   - words already in `originalText`, and
   *   - the supplied `answerValues` (the user's real numbers).
   * Implementations MUST NOT invent numbers — but if they do, the
   * provenance gate downstream rejects the change.
   */
  rewriteBullet(input: {
    originalText: string;
    answerValues: string[];
    path: string;
  }): Promise<string>;
}

export interface EnrichmentProposal {
  /** The Epic 9 diff that, if applied, performs this rewrite. */
  change: ProposedChange;
  /** Human-readable rationale for the proposal. */
  reason: string;
  /** "from your answer: 250k users" / "minimal reword (no fabricated metric)" / etc. */
  provenance: string;
  /** Final gate verdict — combined provenance + Epic 9 gates. */
  gateVerdict: GateVerdict;
}

export interface GenerateEnrichmentInput {
  doc: TailoringDocument;
  candidates: ReadonlyArray<WeakBulletCandidate>;
  questions: ReadonlyArray<MetricQuestion>;
  answers: ReadonlyArray<MetricAnswer>;
  /** Optional LLM rewriter; when omitted every item uses the deterministic
   *  minimal reword (no new numbers ever). */
  llm?: EnrichmentLLM;
}

export interface GenerateEnrichmentResult {
  proposals: EnrichmentProposal[];
  applied: ProposedChange[];
  rejected: RejectedChange[];
  /** Final document with all applied changes. */
  result: TailoringDocument;
}

function answersForPath(
  path: string,
  questions: ReadonlyArray<MetricQuestion>,
  answers: ReadonlyArray<MetricAnswer>,
): { usable: string[]; hasAnswered: boolean } {
  const qsAtPath = questions.filter((q) => q.path === path);
  const ids = new Set(qsAtPath.map((q) => q.id));
  const usable: string[] = [];
  let hasAnswered = false;
  for (const a of answers) {
    if (!ids.has(a.questionId)) continue;
    if (a.status === 'answered') hasAnswered = true;
    if (isAnswerUsable(a)) usable.push(a.value);
  }
  return { usable, hasAnswered };
}

export async function generateEnrichment(
  input: GenerateEnrichmentInput,
): Promise<GenerateEnrichmentResult> {
  const { doc, candidates, questions, answers, llm } = input;
  const docCorpus = collectDocCorpus(doc);

  const proposals: EnrichmentProposal[] = [];

  for (const c of candidates) {
    const { usable } = answersForPath(c.path, questions, answers);
    const answerCorpus = usable.join(' ');

    // Generate the rewritten text.
    let rewritten: string | null = null;
    let provenance: string;

    if (usable.length > 0 && llm) {
      try {
        rewritten = await llm.rewriteBullet({
          originalText: c.text,
          answerValues: usable,
          path: c.path,
        });
      } catch {
        rewritten = null;
      }
      provenance = `from your answer: ${usable.join('; ')}`;
    } else {
      // Skipped / no number → deterministic minimal reword (AC5).
      rewritten = minimalReword(c.text);
      provenance = 'minimal reword (no fabricated metric)';
    }

    if (!rewritten || rewritten.trim().length === 0 || rewritten.trim() === c.text.trim()) {
      // Nothing useful to propose — emit a verdict-failed proposal for the UI
      // to surface, but don't queue it for apply.
      proposals.push({
        change: {
          path: c.path,
          action: 'replace',
          original: c.text,
          value: c.text,
          reason: c.reason,
        },
        reason: c.reason,
        provenance,
        gateVerdict: { ok: false, reason: 'no rewrite produced', untraceable: [] },
      });
      continue;
    }

    // Apply the provenance gate first.
    let verdict = answerProvenanceGate({
      originalText: c.text,
      rewrittenText: rewritten,
      answerCorpus,
      docCorpus,
    });

    // AC5 — if the LLM smuggled in a number for a skipped/no-answer item,
    // strip back to the deterministic minimal reword and re-check.
    if (!verdict.ok && usable.length === 0) {
      rewritten = minimalReword(c.text);
      verdict = answerProvenanceGate({
        originalText: c.text,
        rewrittenText: rewritten,
        answerCorpus,
        docCorpus,
      });
      provenance = 'minimal reword (no fabricated metric)';
    }

    const change: ProposedChange = {
      path: c.path,
      action: 'replace',
      original: c.text,
      value: rewritten,
      reason: `${c.reason} → improved: ${provenance}`,
    };

    // Pre-check frozen for AC2 — fast-fail before we even hand to Epic 9.
    if (isFrozenPath(doc, c.path)) {
      proposals.push({
        change,
        reason: c.reason,
        provenance,
        gateVerdict: {
          ok: false,
          reason: 'frozen field — identity / employers / dates / institutions / degrees are unreachable',
          untraceable: [],
        },
      });
      continue;
    }

    proposals.push({
      change,
      reason: c.reason,
      provenance,
      gateVerdict: verdict,
    });
  }

  // Run the proposals that passed the provenance gate through Epic 9.
  const queued = proposals.filter((p) => p.gateVerdict.ok).map((p) => p.change);
  const epic9: ApplyResult = apply(doc, queued);

  // Reflect Epic 9 rejections back onto the proposal verdicts.
  const rejectedByPath = new Map<string, string>();
  for (const r of epic9.rejected) {
    // We use original+path as the key — for replace, both pin the change.
    rejectedByPath.set(`${r.change.path}::${r.change.original ?? ''}`, r.reason);
  }
  for (const p of proposals) {
    if (!p.gateVerdict.ok) continue;
    const key = `${p.change.path}::${p.change.original ?? ''}`;
    const why = rejectedByPath.get(key);
    if (why !== undefined) {
      p.gateVerdict = { ok: false, reason: `Epic 9 gate: ${why}`, untraceable: [] };
    }
  }

  // Sanity check: if a proposal targets a path that does not resolve on the
  // doc (e.g. invented path from a malformed candidate), reflect that too.
  for (const p of proposals) {
    if (!p.gateVerdict.ok) continue;
    if (resolvePath(doc, p.change.path) === undefined) {
      p.gateVerdict = {
        ok: false,
        reason: 'path does not resolve on the document',
        untraceable: [],
      };
    }
  }

  return {
    proposals,
    applied: epic9.applied,
    rejected: epic9.rejected,
    result: epic9.result,
  };
}
