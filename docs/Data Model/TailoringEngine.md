# Data Model — Tailoring Diff Engine (Epic 9)

This document records the data shapes the Tailoring Diff Engine produces and
consumes. It is the contract between the LangGraph pipeline in main, the four
gates, the Epic 5 deterministic scorer, and the Epic 7 UI that delegates to
them.

The engine emits **structured grounded diffs** against the user's master CV.
The shapes below are closed unions — there is no escape hatch for free-form
text edits — so every change is path-addressable, reviewable, reversible, and
covered by the gate guarantees.

For the conceptual lineage and the Apache-2.0 attribution that governs reuse,
see `NOTICE.md` §4 (Resume-Matcher).

---

## 1. `TailoringDocument` — editable + frozen paths

A `TailoringDocument` is derived from the Epic 4 parsed CV plus the base CV
text (`tailoringDocument.ts`). It exposes an explicit address space that the
gates enforce against.

### Editable paths (gates allow edits here)

| Path | Type | Action vocabulary |
| --- | --- | --- |
| `summary` | `string` | `replace` |
| `experience[i].bullets[j]` | `string` | `replace` |
| `experience[i].bullets` | `string[]` | `append`, `reorder` |
| `projects[i].bullets[j]` | `string` | `replace` |
| `projects[i].bullets` | `string[]` | `append`, `reorder` |
| `education[i].description` | `string` | `replace` |
| `skills` | `string[]` | `append`, `reorder`, `add_skill` |
| `skills[i]` | `string` | `replace` |

### Frozen paths (gates block edits here)

`identity.name`, `identity.contact.email`, `identity.contact.phone`,
`identity.location`, `experience[i].company`, `experience[i].role`,
`experience[i].startDate`, `experience[i].endDate`, `projects[i].name`,
`education[i].school`, `education[i].qualification`,
`education[i].startDate`, `education[i].endDate`.

These are blocked structurally at the path level — they are not policed in
the prompt.

---

## 2. `ProposedChange` — the diff record

```ts
type ProposedChange =
  | { action: 'replace';    path: string; original: string; value: string;   reason: string }
  | { action: 'append';     path: string;                    value: string;   reason: string }
  | { action: 'reorder';    path: string;                    value: string[]; reason: string }
  | { action: 'add_skill';  path: 'skills';                  value: string;   reason: string }
```

- `action` is the closed vocabulary the gates validate.
- `path` is a dot/bracket path resolvable on the document (e.g.
  `experience[0].bullets[1]`).
- `original` is required on `replace`: it is the exact text currently at that
  path, used by Gate 4 to reject hallucinated diffs.
- `value` is the proposed new text or new ordering.
- `reason` is a one-line rationale shown in the Epic 7 suggestions dock.

---

## 3. Gate guarantees

Every `ProposedChange` runs through four pure gates before it can mutate the
working document. The gates are deterministic and unit-tested in isolation;
no validation logic lives in prompts or LangGraph edges.

1. **Editable-path allowlist.** The target path is in the editable set
   above, and its shape (leaf vs list) matches the action.
2. **Frozen-field block.** The target path is not in the frozen set
   (identity, dates, employer, school, qualification, project name).
3. **Path resolution.** The path resolves on the current document state —
   no edits land against stale or invented coordinates.
4. **Original-text match (`replace` only).** The supplied `original` matches
   the actual text at that path, case- and whitespace-insensitive. This is
   the anti-hallucination gate that keeps the diff **grounded** in the
   document — the engine **never invents** facts, metrics, employers, or
   dates, and a diff whose `original` drifts from reality is dropped.

`add_skill` is additionally gated by the 3-tier skill verifier
(`skillVerifier.ts`): only `existing` (in the master CV skills list),
`jd_added` (verbatim in the JD), or `supported_by_resume` (present in the
master CV's prose) skills are admissible; `rejected` skills are dropped.

`reorder` is **salvaged** rather than rejected: for the skills list,
unverified new items are dropped but real items are never lost; for any
other list, all new items are dropped and real items are preserved.

---

## 4. `SkillVerdict` — 3-tier verifier output

```ts
type SkillClassification =
  | 'existing'
  | 'jd_added'
  | 'supported_by_resume'
  | 'rejected'

interface SkillVerdict {
  skill: string
  classification: SkillClassification
  /** which document/text supported the classification */
  evidence?: string
}
```

Only the first three classifications feed back into the `add_skill` action.

---

## 5. Refine warnings (advisory, never blocking)

The refine helpers (`refine.ts`) emit warnings that travel alongside the
proposed diffs to the Epic 7 UI:

- `injectable` vs `non_injectable` keyword split (TDE-003 AC2)
- `aiPhraseRemoved` (TDE-003 AC3) — never removes a term that appears
  verbatim in the JD
- `alignment` (TDE-003 AC4) — proposed skill / cert / employer absent from
  both master CV and JD
- `inventedMetric` (TDE-003 AC5) — a number that was not in the `original`
- `wordCountBlowup` (TDE-003 AC5) — proposed text materially longer than
  the original

Warnings are advisory: they are surfaced in the dock so the user can decide,
but they do not block apply.

---

## 6. Rescore record (Epic 5 boundary)

The engine never writes a match score. On `tailor:apply`, the new document
is passed to the same deterministic Epic 5 scorer that backs the Job
Board's star rating:

```ts
interface RescoreResult {
  before: { match: number; stars: 1 | 2 | 3 | 4 | 5 }
  after:  { match: number; stars: 1 | 2 | 3 | 4 | 5 }
  deltaPct: number
}
```

The pre / post pair carries the before-and-after match percentage shown in
the Epic 7 chip. Because the scorer is deterministic, the same applied
diffs against the same document always yield the same rescore — no LLM
number ever flows into the store.
