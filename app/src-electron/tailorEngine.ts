/**
 * Tailoring diff-engine pipeline (TDE-005 — Epic 9: Tailoring Diff Engine).
 *
 * Wires a LangGraph StateGraph that drives the tailoring pipeline through
 * five LLM-or-deterministic nodes:
 *
 *   extract-JD-signals (or reuse cached Epic 6 keywords)
 *     → plan/verify-skills
 *     → generate-diffs
 *     → gate-filter
 *     → refine loop (inject-keywords → strip-AI-phrases → align-check)
 *     → rescore
 *
 * The graph only ROUTES. Every gate / verifier / refine / rescore call is a
 * pure TS helper imported from TDE-001/002/003/004 + Epic 5 — no validation
 * logic lives in prompts or edges.
 *
 *   - Gates / apply: `tailorGates.apply`
 *   - Skill verifier: `skillVerifier.verifySkills`
 *   - Refine helpers: `refine.analyzeGaps`, `refine.removeAiPhrases`,
 *                     `refine.checkMasterAlignment`,
 *                     `refine.inventedMetricsWarnings`,
 *                     `refine.wordCountBlowupWarnings`
 *   - Rescore: `scorer.score` (Epic 5 deterministic scorer; no LLM number)
 *
 * The refine loop is BOUNDED by `maxRefinePasses` (default 3) and exits on:
 *   - no new injectable keywords,
 *   - no match-% improvement vs the prior pass, or
 *   - N passes reached.
 *
 * The engine returns a `TailorEngineResult` and PERSISTS NOTHING — no DB,
 * IPC, disk, network, or clock dependency. The LLM client is injectable so
 * unit tests drive the call without network access. A structured-output
 * capability guard maps "model does not support tools" failures to the
 * `MODEL_NOT_CAPABLE` per-code error.
 */
import { z } from 'zod';

import {
  ProposedChangeListSchema,
  SkillTargetListSchema,
  buildGenerateDiffsPrompt,
  buildSkillTargetPrompt,
} from './diffPrompts.js';
import {
  analyzeGaps,
  checkMasterAlignment,
  inventedMetricsWarnings,
  removeAiPhrases,
  wordCountBlowupWarnings,
  type RefineWarning,
} from './refine.js';
import {
  DEFAULT_EVALUATORS,
  DEFAULT_WEIGHTS,
  score,
  type FactorEvaluator,
  type FactorKey,
  type ScorerWeights,
  type ScoringListing,
  type ScoringProfile,
} from './scorer.js';
import { verifySkills, type MasterCv, type SkillVerdict } from './skillVerifier.js';
import {
  apply,
  type ApplyResult,
  type ProposedChange,
  type RejectedChange,
} from './tailorGates.js';
import {
  listEditablePaths,
  resolvePath,
  type TailoringDocument,
} from './tailoringDocument.js';

// ---------------------------------------------------------------------------
// LLM contract (injectable)
// ---------------------------------------------------------------------------

export interface TailorLLM {
  withStructuredOutput<T extends z.ZodTypeAny>(
    schema: T,
    opts?: { name?: string },
  ): { invoke(input: string | unknown): Promise<z.infer<T>> };
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TailorEngineInputs {
  jdText: string;
  masterCvText: string;
  doc: TailoringDocument;
  listing: ScoringListing;
  profile: ScoringProfile;
  /** Cached Epic 6 keywords. When provided, the extract-JD-signals node is
   *  SKIPPED — the criterion explicitly allows reusing them. */
  jdKeywords?: string[];
  /** Bound for the refine loop. Default 3. */
  maxRefinePasses?: number;
  /** Optional weights override for the Epic 5 rescore. */
  weights?: ScorerWeights;
  /** Optional Epic 5 factor evaluators. Defaults to the stubs that ship
   *  with the scorer module. */
  evaluators?: Record<FactorKey, FactorEvaluator>;
}

export interface TailorEngineDeps {
  llm: TailorLLM;
  /** Optional progress sink. Every node emits at least one event. */
  onEvent?: (event: TailorEngineEvent) => void;
}

export type TailorEnginePhase =
  | 'extract-jd-signals'
  | 'plan-skills'
  | 'generate-diffs'
  | 'gate-filter'
  | 'refine'
  | 'rescore'
  | 'done';

export interface TailorEngineEvent {
  phase: TailorEnginePhase;
  /** Refine pass index when phase === 'refine'. */
  pass?: number;
  /** Free-form node-local note (e.g. counts, exit-reason). */
  note?: string;
}

export interface RefinementStats {
  initialPercent: number;
  finalPercent: number;
  passes: number;
  /** Why the loop exited. Useful for logs + UI. */
  exitReason: 'no_injectable_keywords' | 'no_improvement' | 'max_passes' | 'not_started';
}

export interface TailorEngineResult {
  /** All ProposedChanges the gates ACCEPTED across generate + refine. */
  proposedChanges: ProposedChange[];
  /** Every change the gates rejected, with reason. */
  rejected: RejectedChange[];
  /** Refine-side warnings (invented metrics, word-count blow-ups, alignment
   *  info-level notes). NOT a rejection — surfaced for user review. */
  warnings: RefineWarning[];
  refinementStats: RefinementStats;
  /** The working tailored document. PERSISTS NOTHING — the caller decides. */
  doc: TailoringDocument;
  /** Per-skill verifier output, useful for UI tooltips. */
  skillVerdicts: SkillVerdict[];
}

export type TailorEngineErrorCode =
  | 'MISSING_KEY'
  | 'MODEL_NOT_CAPABLE'
  | 'LLM_ERROR'
  | 'SCHEMA_ERROR';

export type RunTailorEngineResult =
  | { ok: true; result: TailorEngineResult }
  | { ok: false; code: TailorEngineErrorCode; error: string };

// ---------------------------------------------------------------------------
// Capability guard
// ---------------------------------------------------------------------------

const FUNCTION_CALLING_HINTS =
  /(tool|function[- ]calling|function call|does not support|tools? are not supported|no tools)/i;

function classifyError(err: unknown): { code: TailorEngineErrorCode; error: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (FUNCTION_CALLING_HINTS.test(message)) {
    return {
      code: 'MODEL_NOT_CAPABLE',
      error:
        `The selected model does not appear to support structured / function-calling output. ` +
        `Pick a function-calling capable model under Settings → Preferred models. (${message})`,
    };
  }
  return { code: 'LLM_ERROR', error: message };
}

// ---------------------------------------------------------------------------
// Local schema for the JD-signals node
// ---------------------------------------------------------------------------

const JdSignalsSchema = z.object({
  keywords: z.array(z.string().min(1)),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten every editable string on the document into one big text blob so
 *  the gap analyser and AI-phrase remover can see "what the resume currently
 *  says" without us threading paths around. */
function docToText(doc: TailoringDocument): string {
  const parts: string[] = [];
  if (doc.summary) parts.push(doc.summary);
  for (const s of doc.skills) parts.push(s);
  for (const e of doc.experience) for (const b of e.bullets) parts.push(b);
  for (const p of doc.projects) for (const b of p.bullets) parts.push(b);
  for (const ed of doc.education) if (ed.description) parts.push(ed.description);
  return parts.join('\n');
}

/** Project tailored-doc skills into the ScoringProfile so the Epic 5 scorer
 *  reflects refinement progress without coupling the scorer to Epic 9. */
function profileFromDoc(base: ScoringProfile, doc: TailoringDocument): ScoringProfile {
  return { ...base, skills: doc.skills };
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Walk editable string paths and emit a `replace` ProposedChange whenever
 *  removeAiPhrases would alter the text. Pure / deterministic. */
function buildAiPhraseReplaceChanges(
  doc: TailoringDocument,
  jdText: string,
): { changes: ProposedChange[]; warnings: RefineWarning[] } {
  const changes: ProposedChange[] = [];
  const warnings: RefineWarning[] = [];
  for (const path of listEditablePaths(doc)) {
    const current = resolvePath(doc, path);
    if (typeof current !== 'string' || current.length === 0) continue;
    const cleaned = removeAiPhrases(current, jdText);
    if (cleaned === current) continue;
    changes.push({
      path,
      action: 'replace',
      original: current,
      value: cleaned,
      reason: 'remove AI-phrase filler',
    });
    warnings.push(...inventedMetricsWarnings(current, cleaned));
    warnings.push(...wordCountBlowupWarnings(current, cleaned));
  }
  return { changes, warnings };
}

/** For each injectable keyword that matches an existing master-CV skill,
 *  build an `add_skill` ProposedChange. We only mechanically inject skills
 *  the verifier already accepts — bullet-level reframing is the LLM's job
 *  in the generate-diffs node. */
function buildInjectChanges(
  injectable: string[],
  master: MasterCv,
  doc: TailoringDocument,
): ProposedChange[] {
  const masterSkillsNorm = new Set(master.skills.map(norm));
  const docSkillsNorm = new Set(doc.skills.map(norm));
  const out: ProposedChange[] = [];
  for (const kw of injectable) {
    const n = norm(kw);
    if (docSkillsNorm.has(n)) continue;
    if (!masterSkillsNorm.has(n)) continue;
    // Keep the master CV's original casing.
    const original = master.skills.find((s) => norm(s) === n)!;
    out.push({
      path: 'skills',
      action: 'add_skill',
      value: original,
      reason: `inject JD keyword "${kw}" found in master CV skills`,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const DEFAULT_MAX_PASSES = 3;

export async function runTailorEngine(
  inputs: TailorEngineInputs,
  deps: TailorEngineDeps,
): Promise<RunTailorEngineResult> {
  const { llm, onEvent } = deps;
  const emit = (e: TailorEngineEvent): void => {
    try {
      onEvent?.(e);
    } catch {
      // never let a downstream sink crash the engine
    }
  };

  const evaluators = inputs.evaluators ?? DEFAULT_EVALUATORS;
  const weights = inputs.weights ?? DEFAULT_WEIGHTS;
  const maxPasses = Math.max(0, inputs.maxRefinePasses ?? DEFAULT_MAX_PASSES);

  const master: MasterCv = {
    skills: inputs.doc.skills.slice(),
    text: inputs.masterCvText,
  };

  // Lazy-import LangGraph so the dependency only loads when the engine
  // actually runs (test envs that don't exercise it pay nothing).
  const { StateGraph, END } = (await import('@langchain/langgraph')) as typeof import(
    '@langchain/langgraph'
  );

  // -------------------------------------------------------------------------
  // Mutable run state — captured by the node closures. The StateGraph
  // channels could carry these, but storing them here keeps each node tiny
  // and avoids fighting LangGraph's channel types for non-reducer fields.
  // -------------------------------------------------------------------------
  type S = { tick: number };
  let workingDoc: TailoringDocument = inputs.doc;
  let jdKeywords: string[] = inputs.jdKeywords ?? [];
  let skillVerdicts: SkillVerdict[] = [];
  const acceptedChanges: ProposedChange[] = [];
  const rejected: RejectedChange[] = [];
  const warnings: RefineWarning[] = [];
  let initialPercent = 0;
  let finalPercent = 0;
  let passesRun = 0;
  let exitReason: RefinementStats['exitReason'] = 'not_started';
  let failure: { code: TailorEngineErrorCode; error: string } | null = null;

  const verifiedSkillsSet = (): Set<string> => {
    const out = new Set<string>();
    for (const v of skillVerdicts) if (v.accepted) out.add(v.skill);
    for (const s of master.skills) out.add(s);
    return out;
  };

  // ---- Node: extract-JD-signals --------------------------------------------
  async function extractJdSignalsNode(_state: S): Promise<Partial<S>> {
    if (failure) return {};
    if (jdKeywords.length > 0) {
      emit({ phase: 'extract-jd-signals', note: 'cached-keywords; skipped' });
      return { tick: 1 };
    }
    emit({ phase: 'extract-jd-signals' });
    try {
      const structured = llm.withStructuredOutput(JdSignalsSchema, { name: 'JdSignals' });
      const prompt = [
        'Extract the candidate-facing keywords from this job description: tools,',
        'frameworks, languages, methodologies, certifications, proper nouns.',
        'Skip generic sentence words. Return at most 30.',
        '',
        '----- BEGIN UNTRUSTED JD -----',
        inputs.jdText,
        '----- END UNTRUSTED JD -----',
        '',
        'Return ONLY { "keywords": string[] }.',
      ].join('\n');
      const raw = await structured.invoke(prompt);
      const parsed = JdSignalsSchema.safeParse(raw);
      if (!parsed.success) {
        failure = {
          code: 'SCHEMA_ERROR',
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        };
        return {};
      }
      jdKeywords = parsed.data.keywords;
    } catch (err) {
      failure = classifyError(err);
    }
    return { tick: 1 };
  }

  // ---- Node: plan/verify-skills --------------------------------------------
  async function planSkillsNode(_state: S): Promise<Partial<S>> {
    if (failure) return {};
    emit({ phase: 'plan-skills' });
    try {
      const structured = llm.withStructuredOutput(SkillTargetListSchema, {
        name: 'SkillCandidates',
      });
      const prompt = buildSkillTargetPrompt({
        jdText: inputs.jdText,
        masterCvText: inputs.masterCvText,
        existingSkills: workingDoc.skills,
      });
      const raw = await structured.invoke(prompt);
      const parsed = SkillTargetListSchema.safeParse(raw);
      if (!parsed.success) {
        failure = {
          code: 'SCHEMA_ERROR',
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        };
        return {};
      }
      skillVerdicts = verifySkills(parsed.data.skills, master, inputs.jdText);
    } catch (err) {
      failure = classifyError(err);
    }
    return { tick: 1 };
  }

  // ---- Node: generate-diffs ------------------------------------------------
  async function generateDiffsNode(_state: S): Promise<Partial<S>> {
    if (failure) return {};
    emit({ phase: 'generate-diffs' });
    try {
      const structured = llm.withStructuredOutput(ProposedChangeListSchema, {
        name: 'ProposedChanges',
      });
      const prompt = buildGenerateDiffsPrompt({
        jdText: inputs.jdText,
        masterCvText: inputs.masterCvText,
        editablePaths: listEditablePaths(workingDoc),
      });
      const raw = await structured.invoke(prompt);
      const parsed = ProposedChangeListSchema.safeParse(raw);
      if (!parsed.success) {
        failure = {
          code: 'SCHEMA_ERROR',
          error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
        };
        return {};
      }
      // Carry the LLM-proposed changes through gate-filter via state. We
      // store them on a closure so the node remains side-effect-light.
      pendingChanges = parsed.data.changes as ProposedChange[];
    } catch (err) {
      failure = classifyError(err);
    }
    return { tick: 1 };
  }
  // Buffer between generate-diffs and gate-filter.
  let pendingChanges: ProposedChange[] = [];

  // ---- Node: gate-filter ---------------------------------------------------
  async function gateFilterNode(_state: S): Promise<Partial<S>> {
    if (failure) return {};
    emit({ phase: 'gate-filter', note: `${pendingChanges.length} candidate(s)` });

    // Add the LLM-proposed-skills as add_skill changes too — verifier has
    // already classified them; gates do their final allow/deny.
    const verifiedAccepted = skillVerdicts.filter((v) => v.accepted);
    const skillSeen = new Set(workingDoc.skills.map(norm));
    const addSkillChanges: ProposedChange[] = [];
    for (const v of verifiedAccepted) {
      const n = norm(v.skill);
      if (skillSeen.has(n)) continue;
      skillSeen.add(n);
      addSkillChanges.push({
        path: 'skills',
        action: 'add_skill',
        value: v.skill,
        reason: `verified skill candidate (${v.classification})`,
      });
    }

    const all = [...pendingChanges, ...addSkillChanges];
    const result: ApplyResult = apply(workingDoc, all, {
      verifiedSkills: verifiedSkillsSet(),
    });
    workingDoc = result.result;
    acceptedChanges.push(...result.applied);
    rejected.push(...result.rejected);
    pendingChanges = [];
    return { tick: 1 };
  }

  // ---- Node: refine (loop body — each call runs ONE pass) ------------------
  async function refineNode(state: S): Promise<Partial<S>> {
    if (failure) return {};
    const passIdx = passesRun + 1;
    emit({ phase: 'refine', pass: passIdx });

    // Exit pre-condition: max passes already reached → record + return.
    if (passesRun >= maxPasses) {
      exitReason = 'max_passes';
      return { tick: state.tick + 1 };
    }

    const currentText = docToText(workingDoc);
    const gaps = analyzeGaps(inputs.jdText, master.text, currentText, jdKeywords);

    if (gaps.injectable.length === 0) {
      exitReason = passesRun === 0 ? 'no_injectable_keywords' : exitReason;
      // Stays at whatever the prior exit was; if we already ran refine passes
      // and now nothing is injectable, that IS the no-injectable exit.
      exitReason = 'no_injectable_keywords';
      return { tick: state.tick + 1 };
    }

    // Align-check the candidates against the master CV before injection.
    const allowedKeywords: string[] = [];
    for (const kw of gaps.injectable) {
      const verdict = checkMasterAlignment(
        kw,
        'skill',
        { skills: master.skills, text: master.text },
        inputs.jdText,
      );
      if (verdict.level === 'info') {
        warnings.push({
          kind: 'invented_metric', // reuse the warning channel; alignment notes ride along
          message: verdict.note,
          value: kw,
        });
        continue;
      }
      if (!verdict.ok) continue;
      allowedKeywords.push(kw);
    }

    // Mechanical inject-keywords pass.
    const injectChanges = buildInjectChanges(allowedKeywords, master, workingDoc);
    // Strip-AI-phrases pass (over the current working doc).
    const stripPass = buildAiPhraseReplaceChanges(workingDoc, inputs.jdText);
    warnings.push(...stripPass.warnings);

    const candidates = [...injectChanges, ...stripPass.changes];
    if (candidates.length === 0) {
      exitReason = 'no_injectable_keywords';
      return { tick: state.tick + 1 };
    }

    const before = score(
      inputs.listing,
      profileFromDoc(inputs.profile, workingDoc),
      weights,
      evaluators,
    ).percent;

    const applyR = apply(workingDoc, candidates, {
      verifiedSkills: verifiedSkillsSet(),
    });
    workingDoc = applyR.result;
    acceptedChanges.push(...applyR.applied);
    rejected.push(...applyR.rejected);
    passesRun = passIdx;

    const after = score(
      inputs.listing,
      profileFromDoc(inputs.profile, workingDoc),
      weights,
      evaluators,
    ).percent;

    if (after <= before) {
      exitReason = 'no_improvement';
      return { tick: state.tick + 1 };
    }

    if (passesRun >= maxPasses) {
      exitReason = 'max_passes';
    }

    return { tick: state.tick + 1 };
  }

  function routeAfterRefine(_state: S): 'refine' | 'rescore' {
    if (failure) return 'rescore';
    if (passesRun >= maxPasses) return 'rescore';
    if (exitReason === 'no_injectable_keywords' || exitReason === 'no_improvement') {
      return 'rescore';
    }
    return 'refine';
  }

  // ---- Node: rescore -------------------------------------------------------
  async function rescoreNode(_state: S): Promise<Partial<S>> {
    emit({ phase: 'rescore' });
    if (failure) return {};
    finalPercent = score(
      inputs.listing,
      profileFromDoc(inputs.profile, workingDoc),
      weights,
      evaluators,
    ).percent;
    emit({ phase: 'done' });
    return { tick: 1 };
  }

  // -------------------------------------------------------------------------
  // Build + invoke the graph
  // -------------------------------------------------------------------------
  initialPercent = score(
    inputs.listing,
    profileFromDoc(inputs.profile, workingDoc),
    weights,
    evaluators,
  ).percent;

  const graph = new StateGraph<S>({
    channels: { tick: null },
  } as unknown as never)
    .addNode('extractJdSignals', extractJdSignalsNode as never)
    .addNode('planSkills', planSkillsNode as never)
    .addNode('generateDiffs', generateDiffsNode as never)
    .addNode('gateFilter', gateFilterNode as never)
    .addNode('refine', refineNode as never)
    .addNode('rescore', rescoreNode as never)
    .addEdge('__start__' as never, 'extractJdSignals' as never)
    .addEdge('extractJdSignals' as never, 'planSkills' as never)
    .addEdge('planSkills' as never, 'generateDiffs' as never)
    .addEdge('generateDiffs' as never, 'gateFilter' as never)
    .addEdge('gateFilter' as never, 'refine' as never)
    .addConditionalEdges(
      'refine' as never,
      routeAfterRefine as never,
      { refine: 'refine', rescore: 'rescore' } as never,
    )
    .addEdge('rescore' as never, END as never);

  const compiled = graph.compile();
  try {
    await compiled.invoke({ tick: 0 } as S);
  } catch (err) {
    if (!failure) failure = classifyError(err);
  }

  if (failure) {
    return { ok: false, ...failure };
  }

  return {
    ok: true,
    result: {
      proposedChanges: acceptedChanges,
      rejected,
      warnings,
      refinementStats: {
        initialPercent,
        finalPercent,
        passes: passesRun,
        exitReason,
      },
      doc: workingDoc,
      skillVerdicts,
    },
  };
}
