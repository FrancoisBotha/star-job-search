/**
 * Epic-level acceptance verification (TDE-009 / Epic 9: Tailoring Diff Engine).
 *
 * AC1  Help + architecture/data-model docs describe the engine:
 *      structured grounded diffs, the gate guarantees, the Epic 7
 *      delegation, and the strict Epic 5 rescore separation.
 * AC2  Resume-Matcher (Apache-2.0 © srbhr) is attributed as conceptual
 *      inspiration; IF code was ported, NOTICE preserves the LICENSE +
 *      NOTICE and STATES the changes made, with borrowed-file headers.
 * AC3  The architecture doc records the deliberate
 *      'LangGraph orchestrates, gates pure, apply UI-driven' decision.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.resolve(__dirname, '..', '..', '..');

function read(rel: string): string {
  return readFileSync(path.join(REPO_DIR, rel), 'utf8');
}

const HELP_REL = 'app/src/pages/HelpPage.vue';
const ARCH_REL = 'docs/Architecture/Architecture.md';
const DATA_REL = 'docs/Data Model/TailoringEngine.md';
const NOTICE_REL = 'NOTICE.md';

describe('TDE-009 / AC1 — Help + architecture/data-model docs describe the engine', () => {
  it('the architecture doc has a dedicated Tailoring Diff Engine (Epic 9) section', () => {
    const arch = read(ARCH_REL);
    expect(arch).toMatch(/Tailoring Diff Engine/i);
    expect(arch).toMatch(/Epic 9/);
  });

  it('the architecture doc describes structured grounded diffs', () => {
    const arch = read(ARCH_REL);
    expect(arch).toMatch(/structured/i);
    expect(arch).toMatch(/grounded/i);
    expect(arch).toMatch(/ProposedChange|diff/i);
  });

  it('the architecture doc describes the four gate guarantees', () => {
    const arch = read(ARCH_REL);
    expect(arch).toMatch(/gate/i);
    // The four gates: editable-path allowlist, frozen-field block,
    // path resolution, and original-text match for replace.
    expect(arch).toMatch(/allowlist|editable/i);
    expect(arch).toMatch(/frozen/i);
    expect(arch).toMatch(/original/i);
  });

  it('the architecture doc records Epic 7 delegation (UI delegates to engine)', () => {
    const arch = read(ARCH_REL);
    expect(arch).toMatch(/Epic 7/);
    expect(arch).toMatch(/delegat/i);
  });

  it('the architecture doc records the strict Epic 5 rescore separation', () => {
    const arch = read(ARCH_REL);
    expect(arch).toMatch(/Epic 5/);
    expect(arch).toMatch(/rescore|re(\s|-)score/i);
    // The separation: engine never writes match scores; the deterministic
    // Epic 5 scorer is invoked on apply, never derived from LLM output.
    expect(arch).toMatch(/determinist/i);
    expect(arch).toMatch(/never.*LLM|no.*LLM.*number|separat/i);
  });

  it('a data-model doc for the engine exists and is reachable', () => {
    expect(existsSync(path.join(REPO_DIR, DATA_REL))).toBe(true);
  });

  it('the data-model doc documents the editable + frozen path sets and ProposedChange shape', () => {
    const data = read(DATA_REL);
    expect(data).toMatch(/editable/i);
    expect(data).toMatch(/frozen/i);
    expect(data).toMatch(/ProposedChange/);
    // Action vocabulary the gates validate.
    expect(data).toMatch(/replace/);
    expect(data).toMatch(/append/);
    expect(data).toMatch(/add_skill/);
  });

  it('the data-model doc states the gate guarantees and the grounding rule', () => {
    const data = read(DATA_REL);
    expect(data).toMatch(/gate/i);
    expect(data).toMatch(/grounded|never invent|no.*invent/i);
  });

  it('the help page explains the engine in user-facing language (grounded diff + gates + rescore separation)', () => {
    const help = read(HELP_REL);
    expect(help).toMatch(/grounded|evidence|from your CV/i);
    expect(help).toMatch(/diff/i);
    // Epic 5 rescore separation, in user words.
    expect(help).toMatch(/determinist/i);
    expect(help).toMatch(/rescore|re(\s|-)score/i);
    // Gate guarantees, in user words — frozen / blocked fields.
    expect(help).toMatch(/never.*invent|cannot.*invent|will not invent|not.*allowed.*invent/i);
  });
});

describe('TDE-009 / AC2 — Resume-Matcher attribution', () => {
  it('NOTICE.md attributes Resume-Matcher with the Apache-2.0 licence and the © srbhr copyright', () => {
    const notice = read(NOTICE_REL);
    expect(notice).toMatch(/Resume[- ]Matcher/);
    expect(notice).toMatch(/Apache[- ]?2\.0|Apache License,? Version 2\.0/);
    expect(notice).toMatch(/srbhr/);
  });

  it('NOTICE.md classifies the scope of reuse (conceptual inspiration vs ported code)', () => {
    const notice = read(NOTICE_REL);
    const idx = notice.search(/Resume[- ]Matcher/);
    expect(idx).toBeGreaterThan(-1);
    const section = notice.slice(idx, idx + 4000);
    expect(section).toMatch(/conceptual inspiration|conceptual|inspired|no code (was )?(copied|ported)|independently (re)?implemented/i);
  });

  it('IF any source file declares it ports Resume-Matcher code, the NOTICE preserves the LICENSE + NOTICE and states the changes made', () => {
    const candidates = [
      'app/src-electron/tailorEngine.ts',
      'app/src-electron/tailorGates.ts',
      'app/src-electron/skillVerifier.ts',
      'app/src-electron/refine.ts',
      'app/src-electron/diffPrompts.ts',
      'app/src-electron/tailoringDocument.ts',
    ];
    const ported = candidates.filter((rel) => {
      const src = read(rel);
      return /ported from Resume[- ]Matcher|adapted from Resume[- ]Matcher|copied from Resume[- ]Matcher/i.test(
        src,
      );
    });
    if (ported.length === 0) {
      // Engine is wholly independent — conceptual-inspiration entry in
      // NOTICE is sufficient; nothing further is required.
      return;
    }
    const notice = read(NOTICE_REL);
    // Apache-2.0 NOTICE + LICENSE preserved + changes stated.
    expect(notice).toMatch(/Apache License,? Version 2\.0/);
    expect(notice).toMatch(/Licensed under the Apache License/);
    expect(notice).toMatch(/changes made|modifications|We modified|Star Job Search modifies/i);
    // Borrowed-file headers on each ported file.
    for (const rel of ported) {
      const src = read(rel);
      expect(src).toMatch(/Resume[- ]Matcher/);
      expect(src).toMatch(/Apache[- ]?2\.0|Apache License,? Version 2\.0/);
      expect(src).toMatch(/srbhr/);
    }
  });
});

describe("TDE-009 / AC3 — Architecture decision: 'LangGraph orchestrates, gates pure, apply UI-driven'", () => {
  it('Key Decisions section names LangGraph as the orchestrator', () => {
    const arch = read(ARCH_REL);
    expect(arch).toMatch(/LangGraph/);
    expect(arch).toMatch(/orchestrat/i);
  });

  it('the decision spells out gates-are-pure and apply-is-UI-driven', () => {
    const arch = read(ARCH_REL);
    // pure / no side-effects in gates
    expect(arch).toMatch(/gates? (are )?pure|pure (TS )?gates?|no validation logic.*prompt/i);
    // apply is UI-driven (accept/dismiss in Epic 7), never auto-applied
    expect(arch).toMatch(/apply.*UI|UI(\s|-)driven|user(\s|-)driven apply|accept.*dismiss|never auto/i);
  });
});
