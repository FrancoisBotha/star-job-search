/**
 * Unit tests for EVAL-008 documentation — architecture + data-model +
 * NOTICE coverage of the Job Evaluation Report (Epic 14).
 *
 * Acceptance criteria coverage:
 *  - AC1: Architecture + Data Model docs describe the Eval report (A–H),
 *         the deterministic-stars-as-rating rule, the opt-in web-research
 *         egress + disclosure + local-only setting, the shared
 *         webResearch capability, and the anti-bot-no-bypass rule.
 *  - AC2: The career-ops MIT attribution (conceptual; no code/text copied;
 *         emit no number) is recorded against Epic 14.
 *  - AC3: The PRD is not modified — the egress relaxation stays scoped to
 *         the epic and is documented here, not in the PRD.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const ARCHITECTURE = readFileSync(
  path.join(REPO_ROOT, 'docs', 'Architecture', 'Architecture.md'),
  'utf8',
);
const EVAL_DATAMODEL = readFileSync(
  path.join(REPO_ROOT, 'docs', 'Data Model', 'EvalReport.md'),
  'utf8',
);
const NOTICE = readFileSync(path.join(REPO_ROOT, 'NOTICE.md'), 'utf8');

describe('Architecture.md — Epic 14 (Job Evaluation Report) coverage', () => {
  it('introduces a dedicated Job Evaluation Report subsystem section (Epic 14)', () => {
    expect(ARCHITECTURE).toMatch(/Job Evaluation Report|Eval(uation)? Report Subsystem/i);
    expect(ARCHITECTURE).toMatch(/Epic 14/);
  });

  it('describes the A–H block composition (A/C/D/G LLM, B Epic 6, E/F/H CTA)', () => {
    expect(ARCHITECTURE).toMatch(/Block A/);
    expect(ARCHITECTURE).toMatch(/Block B|Match with CV/);
    expect(ARCHITECTURE).toMatch(/Block C/);
    expect(ARCHITECTURE).toMatch(/Block D/);
    expect(ARCHITECTURE).toMatch(/Block E/);
    expect(ARCHITECTURE).toMatch(/Block F/);
    expect(ARCHITECTURE).toMatch(/Block G/);
    expect(ARCHITECTURE).toMatch(/Block H/);
  });

  it('states the deterministic Epic 5 stars carry the rating; the report emits no number', () => {
    expect(ARCHITECTURE).toMatch(/determinist/i);
    expect(ARCHITECTURE).toMatch(/Epic 5/);
    expect(ARCHITECTURE).toMatch(/no (number|score|rating)|never (a |emits |produces )?(number|score|rating)|words only|narrative/i);
  });

  it('describes the opt-in web-research egress + disclosure + local-only setting', () => {
    expect(ARCHITECTURE).toMatch(/web research|webResearch/i);
    expect(ARCHITECTURE).toMatch(/opt(-|\s)?in/i);
    expect(ARCHITECTURE).toMatch(/off by default|default(s)? (to )?off|default OFF|disabled by default/i);
    expect(ARCHITECTURE).toMatch(/local(-|\s)only|stays on this device/i);
    expect(ARCHITECTURE).toMatch(/one(\s|-)time.*disclosure|disclosure.*one(\s|-)time/i);
  });

  it('describes the shared webResearch capability reusing the embedded browser surface', () => {
    expect(ARCHITECTURE).toMatch(/shared.*webResearch|webResearch.*shared|reuse(d|s)? the (embedded|same) browser/i);
    expect(ARCHITECTURE).toMatch(/persist:job-browser|partition(ed)? session|Epic 1|Epic 3.*crawler/i);
  });

  it('documents the anti-bot / CAPTCHA detect-and-stop, no-bypass rule', () => {
    expect(ARCHITECTURE).toMatch(/CAPTCHA|anti(\s|-)bot/i);
    expect(ARCHITECTURE).toMatch(/never bypass|does not bypass|do(es)? not (attempt to )?bypass|stop|uncertain/i);
  });

  it('keeps the two-egress posture intact — egress relaxation scoped to the epic, not the PRD', () => {
    expect(ARCHITECTURE).toMatch(/no new egress|reuses (rather than|the) existing|same (sanctioned|egress)|two(-|\s)egress/i);
  });
});

describe('docs/Data Model/EvalReport.md — Epic 14 data shapes', () => {
  it('exists with a clear Epic 14 title', () => {
    expect(EVAL_DATAMODEL).toMatch(/Eval(uation)? Report/i);
    expect(EVAL_DATAMODEL).toMatch(/Epic 14/);
  });

  it('documents the A–H blocks', () => {
    expect(EVAL_DATAMODEL).toMatch(/Block A|^.*A.*Role Summary/im);
    expect(EVAL_DATAMODEL).toMatch(/Block B|Match with CV/);
    expect(EVAL_DATAMODEL).toMatch(/Block C/);
    expect(EVAL_DATAMODEL).toMatch(/Block D/);
    expect(EVAL_DATAMODEL).toMatch(/Block E/);
    expect(EVAL_DATAMODEL).toMatch(/Block F/);
    expect(EVAL_DATAMODEL).toMatch(/Block G/);
    expect(EVAL_DATAMODEL).toMatch(/Block H/);
  });

  it('documents the eval_reports persistence shape (no score column, provenance + sources)', () => {
    expect(EVAL_DATAMODEL).toMatch(/eval_reports/);
    expect(EVAL_DATAMODEL).toMatch(/no (score|number|rating) column|never store(s)? (a )?number|emit(s)? no number/i);
    expect(EVAL_DATAMODEL).toMatch(/sources/);
    expect(EVAL_DATAMODEL).toMatch(/legitimacy(_verdict)?|legitimacyVerdict/);
  });

  it('documents the deterministic-stars-as-rating rule against Epic 5', () => {
    expect(EVAL_DATAMODEL).toMatch(/Epic 5/);
    expect(EVAL_DATAMODEL).toMatch(/determinist/i);
    expect(EVAL_DATAMODEL).toMatch(/star/i);
  });

  it('documents the shared webResearch capability + opt-in + disclosure + local-only', () => {
    expect(EVAL_DATAMODEL).toMatch(/webResearch|web research/i);
    expect(EVAL_DATAMODEL).toMatch(/opt(-|\s)?in/i);
    expect(EVAL_DATAMODEL).toMatch(/disclosure/i);
    expect(EVAL_DATAMODEL).toMatch(/local(-|\s)only|stays on this device/i);
    expect(EVAL_DATAMODEL).toMatch(/off by default|default(s)? (to )?off|default OFF|disabled by default/i);
  });

  it('documents the anti-bot-no-bypass rule', () => {
    expect(EVAL_DATAMODEL).toMatch(/CAPTCHA|anti(\s|-)bot/i);
    expect(EVAL_DATAMODEL).toMatch(/never bypass|does not bypass|do(es)? not (attempt to )?bypass|uncertain/i);
  });

  it('points at NOTICE.md §1 for career-ops attribution', () => {
    expect(EVAL_DATAMODEL).toMatch(/NOTICE\.md/);
    expect(EVAL_DATAMODEL).toMatch(/career-ops/i);
  });
});

describe('NOTICE.md — career-ops conceptual attribution covers Epic 14', () => {
  it('mentions Epic 14 in the career-ops §1 provenance', () => {
    expect(NOTICE).toMatch(/Epic 14/);
  });

  it('records the conceptual-only scope and the emit-no-number rule', () => {
    expect(NOTICE).toMatch(/conceptual inspiration only|conceptual influence|conceptually inspired/i);
    expect(NOTICE).toMatch(/emit(s)? no number|no number is emitted|never emits? a number/i);
  });
});
