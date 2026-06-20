/**
 * 3-tier skill verifier (TDE-003, AC1 — Epic 9: Tailoring Diff Engine).
 *
 * Classifies each candidate skill against the master CV + JD text:
 *
 *   - 'existing'             — skill appears in the master CV's explicit skills list
 *   - 'jd_added'             — skill appears verbatim in the JD (acceptable injection)
 *   - 'supported_by_resume'  — skill appears in the master CV's prose / bullets
 *   - 'rejected'             — none of the above; unsupported, MUST NOT be injected
 *
 * Pure / deterministic. Output of `verifySkills` is shaped so that the
 * accepted entries feed straight into the TDE-002 `add_skill` action.
 */

export type SkillClassification =
  | 'existing'
  | 'jd_added'
  | 'supported_by_resume'
  | 'rejected';

export interface MasterCv {
  /** Explicit skills list (e.g. CvParsedFields.skills). */
  skills: string[];
  /** Full base-CV text — bullets, prose, summary. Used for tier-3 support. */
  text: string;
}

export interface SkillVerdict {
  skill: string;
  classification: SkillClassification;
  /** True for the first three tiers; false for `rejected`. */
  accepted: boolean;
  /** Short human-readable rationale (useful for tests + UI tooltips). */
  reason: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function wordBoundaryRe(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:^|[^A-Za-z0-9_+#])${escaped}(?:[^A-Za-z0-9_+#]|$)`, 'i');
}

function containedAsTerm(haystack: string, term: string): boolean {
  if (!term.trim()) return false;
  return wordBoundaryRe(term).test(haystack);
}

export function verifySkill(
  candidate: string,
  master: MasterCv,
  jdText: string,
): SkillVerdict {
  const skill = candidate.trim();

  const inSkillsList = master.skills.some((s) => norm(s) === norm(skill));
  if (inSkillsList) {
    return {
      skill,
      classification: 'existing',
      accepted: true,
      reason: 'present in master CV skills list',
    };
  }

  if (containedAsTerm(jdText, skill)) {
    return {
      skill,
      classification: 'jd_added',
      accepted: true,
      reason: 'present in JD; allowed as JD-added keyword',
    };
  }

  if (containedAsTerm(master.text, skill)) {
    return {
      skill,
      classification: 'supported_by_resume',
      accepted: true,
      reason: 'supported by prose / bullets in master CV',
    };
  }

  return {
    skill,
    classification: 'rejected',
    accepted: false,
    reason: 'not in master CV skills, JD, or CV prose — unsupported',
  };
}

export function verifySkills(
  candidates: string[],
  master: MasterCv,
  jdText: string,
): SkillVerdict[] {
  return candidates.map((c) => verifySkill(c, master, jdText));
}
