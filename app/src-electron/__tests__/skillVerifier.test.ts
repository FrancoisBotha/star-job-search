/**
 * Unit tests for the 3-tier skill verifier (TDE-003, AC1).
 */
import { describe, expect, it } from 'vitest';

import { verifySkill, verifySkills } from '../skillVerifier.js';

const MASTER_CV = {
  skills: ['TypeScript', 'Node.js', 'PostgreSQL', 'GraphQL'],
  text: `Senior engineer with 8 years building APIs. Led Kubernetes adoption at Acme.
- Designed event-driven systems on AWS using SNS and SQS.
- Mentored 5 engineers and ran weekly architecture reviews.
`,
};

describe('verifySkill (3-tier)', () => {
  it('classifies skills present in master skills list as existing', () => {
    const r = verifySkill('TypeScript', MASTER_CV, 'We use TypeScript and Go.');
    expect(r.classification).toBe('existing');
    expect(r.accepted).toBe(true);
  });

  it('classifies JD keywords absent from CV but explicitly in JD as jd_added', () => {
    const r = verifySkill('Go', MASTER_CV, 'We use TypeScript and Go.');
    expect(r.classification).toBe('jd_added');
    expect(r.accepted).toBe(true);
  });

  it('classifies skills supported by master-CV prose as supported_by_resume', () => {
    const r = verifySkill('Kubernetes', MASTER_CV, 'Frontend role.');
    expect(r.classification).toBe('supported_by_resume');
    expect(r.accepted).toBe(true);
  });

  it('REJECTS unsupported skills (not in CV, not in JD, no prose support)', () => {
    const r = verifySkill('Rust', MASTER_CV, 'Frontend role.');
    expect(r.classification).toBe('rejected');
    expect(r.accepted).toBe(false);
  });

  it('batch verifySkills feeds an add_skill-shaped accepted list', () => {
    const out = verifySkills(['TypeScript', 'Rust', 'Go', 'Kubernetes'], MASTER_CV, 'Need Go.');
    const accepted = out.filter((r) => r.accepted).map((r) => r.skill);
    expect(accepted).toContain('TypeScript');
    expect(accepted).toContain('Go');
    expect(accepted).toContain('Kubernetes');
    expect(accepted).not.toContain('Rust');
  });
});
