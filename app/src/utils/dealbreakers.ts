/**
 * Pure deterministic dealbreaker evaluator (DEAL-001).
 *
 * Offline, no LLM, no network — given a job and a set of rules, returns a
 * verdict describing whether any rule fired and, if so, exactly which
 * rule/field/term combinations matched. The contract is shaped so the UI
 * (and tests) can render a precise reason for each hit rather than a
 * boolean "dropped" outcome.
 */

export interface DealbreakerRules {
  /** Whole-word, case-insensitive substrings matched against TITLE and DESCRIPTION. Phrases allowed. */
  dealbreakerKeywords: string[];
  /** Case-insensitive exact-match (after trim) against the job's company. */
  dealbreakerCompanies: string[];
  /** Minimum acceptable salary. NO-OP unless the job states a salary that parses below this. */
  dealbreakerSalaryMin: number | null;
}

export interface DealbreakerJob {
  title?: string | null;
  description?: string | null;
  company?: string | null;
  salary?: string | null | undefined;
}

export type DealbreakerRuleName = 'keyword' | 'company' | 'salaryMin';
export type DealbreakerField = 'title' | 'description' | 'company' | 'salary';

export interface DealbreakerHit {
  rule: DealbreakerRuleName;
  field: DealbreakerField;
  term: string;
}

export interface DealbreakerVerdict {
  flagged: boolean;
  hits: DealbreakerHit[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Word-boundary substring test that works for phrases containing hyphens or
 * spaces — JavaScript's `\b` keys off `\w` (ASCII only) and treats hyphens
 * as boundaries, which would let 'java' match 'java-script'. We anchor on
 * "not preceded/followed by a letter, digit, or underscore" instead.
 */
function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const pattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(needle)}(?=[^\\p{L}\\p{N}_]|$)`,
    'iu',
  );
  return pattern.test(haystack);
}

/**
 * Pull the lowest plausible salary number out of a free-text salary field.
 * Recognises 'k'/'K' as thousands and ignores commas. Returns null when no
 * number can be extracted (treated as 'not stated' by the caller).
 */
function parseMinSalary(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '');
  const re = /(\d+(?:\.\d+)?)\s*([kKmM])?/g;
  const nums: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    let n = parseFloat(m[1]!);
    const suffix = m[2]?.toLowerCase();
    if (suffix === 'k') n *= 1_000;
    else if (suffix === 'm') n *= 1_000_000;
    nums.push(n);
  }
  if (!nums.length) return null;
  return Math.min(...nums);
}

function isSalaryStated(raw?: string | null): boolean {
  if (raw === undefined || raw === null) return false;
  const s = String(raw).trim();
  if (!s) return false;
  if (s.toLowerCase() === 'not stated') return false;
  return true;
}

export function evaluateDealbreakers(
  job: DealbreakerJob,
  rules: DealbreakerRules,
): DealbreakerVerdict {
  const hits: DealbreakerHit[] = [];

  const title = (job.title ?? '').toString();
  const description = (job.description ?? '').toString();

  for (const term of rules.dealbreakerKeywords) {
    if (!term || !term.trim()) continue;
    if (containsWord(title, term)) {
      hits.push({ rule: 'keyword', field: 'title', term });
    }
    if (containsWord(description, term)) {
      hits.push({ rule: 'keyword', field: 'description', term });
    }
  }

  const company = (job.company ?? '').toString().trim().toLowerCase();
  if (company) {
    for (const term of rules.dealbreakerCompanies) {
      if (!term || !term.trim()) continue;
      if (term.trim().toLowerCase() === company) {
        hits.push({ rule: 'company', field: 'company', term });
      }
    }
  }

  if (rules.dealbreakerSalaryMin !== null && rules.dealbreakerSalaryMin !== undefined) {
    if (isSalaryStated(job.salary)) {
      const parsed = parseMinSalary(String(job.salary));
      if (parsed !== null && parsed < rules.dealbreakerSalaryMin) {
        hits.push({
          rule: 'salaryMin',
          field: 'salary',
          term: String(rules.dealbreakerSalaryMin),
        });
      }
    }
  }

  return { flagged: hits.length > 0, hits };
}
