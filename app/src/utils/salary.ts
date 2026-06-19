/**
 * Shared salary formatter (EXTR-015).
 *
 * The Job Board tile and the Job Detail modal both display the extracted
 * salary field (EXTR-013) — running both through this single helper is what
 * guarantees the same job reads the same in both places.
 *
 * The extractor stores the salary verbatim as the posting states it (e.g.
 * "£70k–£90k") or `null` when the posting states none. This helper does
 * not normalise currencies or parse ranges — it only trims whitespace and
 * collapses every "no salary stated" form (null / undefined / empty /
 * whitespace) onto a single human-readable label so the UI never leaks
 * 'undefined', '0', or a blank cell.
 */
export function formatSalary(raw?: string | null): string {
  if (raw === undefined || raw === null) return 'not stated';
  const s = String(raw).trim();
  if (!s) return 'not stated';
  return s;
}

/**
 * True when [[formatSalary]] would fall back to the 'not stated' label —
 * useful where the caller wants to prefix the line with "Salary " only when
 * no value is available (e.g. a standalone meta line on a board tile).
 */
export function isSalaryStated(raw?: string | null): boolean {
  if (raw === undefined || raw === null) return false;
  return String(raw).trim().length > 0;
}
