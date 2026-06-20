/**
 * Deterministic prompt-injection sanitizer (TDE-004 — Epic 9: Tailoring
 * Diff Engine, AC3).
 *
 * Pure, no-LLM redactor. Run JD / CV text through this BEFORE handing it to
 * any LLM node. The goal is defence-in-depth alongside the inline "treat
 * this as untrusted data" framing already used by the Epic 3 / 6 / 7
 * prompts: a hostile JD that smuggles a literal "ignore previous
 * instructions" or "</jd>" fence-break gets the offending span replaced
 * with a single neutral `[redacted]` token so the model never sees a
 * plausible directive.
 *
 * The redactor is intentionally conservative:
 *   - Patterns target wording that is unmistakably a control-flow command
 *     ("ignore previous instructions", "as an AI", "system:" at the start
 *     of a line, role-hijack openers).
 *   - Plain narrative content ("the candidate ignored a deadline") is NOT
 *     redacted — the patterns require directive verbs / role tokens.
 *   - We never silently drop characters: every redaction substitutes
 *     `[redacted]` so the downstream consumer can see that something was
 *     removed (and the caller can count redactions for telemetry).
 *
 * Shared by design: the function operates on a plain string so the Epic 3
 * extractor, Epic 6 review, Epic 7 tailor, and Epic 9 diff-generator can
 * all funnel JD / CV input through it without coupling to each other.
 */

/**
 * Injection-pattern catalogue. Order matters only insofar as more specific
 * patterns should not be subsumed by broader ones — the regex set below is
 * disjoint enough in practice that ordering is incidental.
 *
 * `flags` always includes `g` (we want every occurrence redacted) and `i`
 * (case-insensitive). `multiline` is added where the pattern anchors on a
 * line start.
 */
const INJECTION_PATTERNS: RegExp[] = [
  // "ignore (all|the|previous|prior|above|earlier) (instructions|directives|prompt|system prompt|rules)"
  /ignore\s+(?:all\s+|any\s+|the\s+|every\s+)?(?:previous|prior|above|earlier|preceding|foregoing)?\s*(?:instructions?|directives?|prompts?|system\s+prompts?|rules?|messages?)/gi,
  // "disregard / forget / override (the above|previous|prior) ..."
  /(?:disregard|forget|override|bypass)\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier|preceding|foregoing|prior|existing)\s+(?:instructions?|directives?|prompts?|system\s+prompts?|rules?|messages?|context)/gi,
  // Role hijacks: "you are now ...", "act as ...", "pretend to be ..."
  /\byou\s+are\s+now\s+(?:a|an|the)\s+\w[\w\s-]{0,40}/gi,
  /\bact\s+as\s+(?:a|an|the)\s+\w[\w\s-]{0,40}/gi,
  /\bpretend\s+(?:to\s+be|you\s+are)\s+(?:a|an|the)?\s*\w[\w\s-]{0,40}/gi,
  // Role tokens at the start of a line (system:, assistant:, user:)
  /^[ \t]*(?:system|assistant|user|developer)\s*:\s*/gim,
  // Self-identification probes / jailbreak markers
  /\bas\s+an?\s+ai\s+(?:language\s+)?model\b/gi,
  /\bdo\s+anything\s+now\b/gi,
  /\bjailbreak\b/gi,
  // Exfiltration / data-dump asks
  /\b(?:print|output|reveal|show|dump|display|leak|exfiltrate)\s+(?:the\s+|your\s+|all\s+)?(?:system\s+prompt|hidden\s+prompt|prior\s+instructions?|context|cv|resume|api\s+key|secret)/gi,
  // Fence-break attempts: closing tags meant to escape our fences
  /<\/(?:jd|cv|untrusted|data|system|instructions?)>/gi,
  // Triple-backtick or fenced markers paired with a directive verb
  /```\s*(?:system|instructions?|prompt)\b/gi,
];

export interface SanitizeResult {
  /** The input with every injection match replaced by `[redacted]`. */
  sanitized: string;
  /** Number of distinct redactions applied. */
  redactionCount: number;
  /** The verbatim spans that were redacted, in input order. Useful for tests
   *  and for surfacing a "we removed suspicious content" notice to the UI. */
  redactedSpans: string[];
}

const REDACTION_TOKEN = '[redacted]';

/**
 * Run the deterministic redactor over `input` and return both the sanitized
 * text and a small audit trail (count + verbatim spans).
 *
 * Safe on empty / null-ish input: a non-string returns the empty result.
 */
export function sanitizeForPrompt(input: string): SanitizeResult {
  if (typeof input !== 'string' || input.length === 0) {
    return { sanitized: '', redactionCount: 0, redactedSpans: [] };
  }

  const spans: string[] = [];
  let out = input;

  for (const pattern of INJECTION_PATTERNS) {
    out = out.replace(pattern, (match) => {
      spans.push(match);
      return REDACTION_TOKEN;
    });
  }

  return {
    sanitized: out,
    redactionCount: spans.length,
    redactedSpans: spans,
  };
}

/** Convenience wrapper — returns only the sanitized text. */
export function sanitizeText(input: string): string {
  return sanitizeForPrompt(input).sanitized;
}
