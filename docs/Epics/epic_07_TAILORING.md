# Epic 7 — Tailoring (CV + cover letter)

## §1 Goal

Tailor the user's master CV and a cover letter to a specific job posting,
using a gated, grounded LangGraph pipeline (see `docs/Data Model/TailoringEngine.md`)
that proposes diffs, validates them against anti-hallucination gates, and
re-invokes the Epic 5 deterministic scorer after apply.

## §6 UI / Tailor view

The Tailor view shows the proposed-diffs dock, the working document, and the
projected match-% delta.

### §6.1 Export entry point — delegated to Epic 12

> **Delegation note (Epic 7 → Epic 12).**
> The Tailor view no longer renders its own standalone **Copy** /
> **Export text** / **Export Markdown** button. The single entry point
> for exporting a tailored document is the **unified Export menu**
> defined in **[Epic 12 — Unified Export](epic_12_UNIFIED_EXPORT.md)
> §10** (UI) and **§13.5** (dispatch). The **Markdown** item of that
> menu delegates back to this epic's Markdown writer; Epic 7 still owns
> the actual Markdown rendering and the tailored-document data model —
> only the button / control surface has moved.

The rest of the Tailor view (proposed-diffs dock, accept/reject controls,
high-risk indicators, before→after match-%) is unchanged by that
delegation.

## §14 References

- `docs/Data Model/TailoringEngine.md` — engine data shapes and gates.
- `docs/Architecture/Architecture.md` §"Epic 7 delegation" — IPC contract.
- Epic 12 (Unified Export) §10, §13.5 — single Export menu entry point.
- Epic 8 (PDF Export) — PDF format owner; reached via the Epic 12 menu.
