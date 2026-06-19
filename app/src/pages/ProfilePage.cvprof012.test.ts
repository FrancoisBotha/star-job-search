/**
 * Unit tests for CVPROF-012: add an editable "Full name" text input to the
 * Profile page, bound to the profile's existing `name` field.
 *
 * Mirrors the regex-scan style used by the CVPROF-006 ProfilePage tests —
 * no @vue/test-utils.
 *
 * Acceptance criteria:
 *  1. Profile page shows a 'Full name' text input bound to the profile's
 *     existing `name` field.
 *  2. Editing the name persists through `store.saveProfile({ name })` (the
 *     existing save path → SQLite round-trip is exercised by the
 *     CVPROF-005 store tests).
 *  3. An empty name is allowed; the field reuses the existing q-input
 *     styling/pattern used by the LinkedIn / Portfolio fields.
 *  4. No backend/IPC/schema changes — the `name` column and save path
 *     already exist.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(path.join(__dirname, 'ProfilePage.vue'), 'utf8');

describe('ProfilePage — Full name field (AC1)', () => {
  it('renders a q-input labelled "Full name"', () => {
    const nameInput = SRC.match(/<q-input[^>]*label="Full name"[^>]*\/?>/);
    expect(nameInput).not.toBeNull();
  });

  it('binds the Full name input to the persisted profile.name', () => {
    const nameInput = SRC.match(/<q-input[^>]*label="Full name"[^>]*\/?>/);
    expect(nameInput).not.toBeNull();
    expect(nameInput![0]).toMatch(/profile\??\.name/);
  });
});

describe('ProfilePage — Editing the name persists via saveProfile (AC2)', () => {
  it('calls store.saveProfile({ name: ... }) on update', () => {
    expect(SRC).toMatch(/saveProfile\(\s*\{\s*name/);
  });
});

describe('ProfilePage — Empty name is allowed; reuses existing field styling (AC3)', () => {
  it('does not block empty values (no required attribute on the Full name input)', () => {
    const nameInput = SRC.match(/<q-input[^>]*label="Full name"[^>]*\/?>/);
    expect(nameInput).not.toBeNull();
    expect(nameInput![0]).not.toMatch(/\brequired\b/);
  });

  it('reuses the existing q-input outlined/dense/field pattern used by LinkedIn/Portfolio', () => {
    const nameInput = SRC.match(/<q-input[^>]*label="Full name"[^>]*\/?>/);
    expect(nameInput).not.toBeNull();
    expect(nameInput![0]).toMatch(/\boutlined\b/);
    expect(nameInput![0]).toMatch(/\bdense\b/);
  });
});
