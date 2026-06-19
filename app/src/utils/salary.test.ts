/**
 * Unit tests for the shared salary formatter (EXTR-015).
 *
 * The board tile and the job-detail modal must read the same job the same
 * way (AC3 "shared formatting"). A single formatter, exercised here, is what
 * guarantees that.
 */
import { describe, expect, it } from 'vitest';
import { formatSalary } from './salary';

describe('formatSalary', () => {
  it("returns 'not stated' for null, undefined, empty, or whitespace", () => {
    expect(formatSalary(undefined)).toBe('not stated');
    expect(formatSalary(null)).toBe('not stated');
    expect(formatSalary('')).toBe('not stated');
    expect(formatSalary('   ')).toBe('not stated');
  });

  it('returns the trimmed raw string when stated', () => {
    expect(formatSalary('£70k–£90k')).toBe('£70k–£90k');
    expect(formatSalary('  $120,000  ')).toBe('$120,000');
  });

  it("never returns 'undefined', '0', or a blank string when a value is absent", () => {
    const out = formatSalary(null);
    expect(out).not.toBe('');
    expect(out).not.toBe('undefined');
    expect(out).not.toBe('0');
  });
});
