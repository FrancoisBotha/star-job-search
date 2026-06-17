/**
 * CV LLM-structuring module (CVPROF-004).
 *
 * The FIRST real OpenRouter completion call in the app. Takes the extracted
 * plain text of a CV (produced by the CVPROF-002 off-thread extractor and
 * stashed on the CV record by CVPROF-003) and asks the user's selected
 * default model — via Epic 2's saved OpenRouter key and Epic 2's existing
 * `https://openrouter.ai/api/v1` egress (NFR-002) — to structure it into
 * profile fields + per-field / overall confidence (FR-003, FR-004).
 *
 * The call is single-shot (no retries inside the module — the renderer offers
 * retry / different file / manual entry on failure per FR-005) and uses
 * OpenRouter's `response_format: { type: 'json_schema' }` so the model is
 * forced to emit a parseable object. If the selected model does not support
 * structured output the call surfaces `MODEL_NO_STRUCTURED_OUTPUT` so the
 * frontend can suggest picking a function-calling-capable model (epic §10).
 *
 * Renderer talks to this module via:
 *   cv:structure
 *
 * The handler returns a tagged-union result `{ ok, parsedFields, confidence }`
 * or `{ ok: false, code, message }` with a stable `code` so the renderer can
 * branch without parsing exception messages.
 */
import type { IpcMain } from 'electron';

export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';

export type CvStructuringErrorCode =
  | 'NO_API_KEY'
  | 'NO_DEFAULT_MODEL'
  | 'EMPTY_TEXT'
  | 'AUTH_ERROR'
  | 'RATE_LIMITED'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'BAD_RESPONSE'
  | 'PARSE_ERROR'
  | 'MODEL_NO_STRUCTURED_OUTPUT';

export class CvStructuringError extends Error {
  readonly code: CvStructuringErrorCode;
  constructor(code: CvStructuringErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CvStructuringError';
    this.code = code;
  }
}

/** A single employment-history row inside parsedFields. Free-form strings —
 *  the LLM is asked to leave unknown fields null. */
export interface ParsedEmploymentEntry {
  company: string | null;
  role: string | null;
  startDate: string | null;
  endDate: string | null;
  summary: string | null;
}

export interface ParsedEducationEntry {
  school: string | null;
  qualification: string | null;
  startDate: string | null;
  endDate: string | null;
}

/** The structured profile fields the LLM is asked to extract. Mirrors the
 *  epic §3 / FR-003 list; nullable on every field so the review-and-edit step
 *  can flag low-confidence / missing values (FR-004). */
export interface CvParsedFields {
  name: string | null;
  contact: { email: string | null; phone: string | null };
  targetRole: string | null;
  skills: string[];
  employmentHistory: ParsedEmploymentEntry[];
  education: ParsedEducationEntry[];
  totalYearsExperience: number | null;
  location: string | null;
}

export interface CvParsedConfidence {
  /** 0..1 overall confidence reported by the model. */
  overall: number;
  /** 0..1 per-field confidences, keyed by field name. Unknown fields default to overall. */
  perField: Record<string, number>;
}

export interface CvStructuringResult {
  parsedFields: CvParsedFields;
  confidence: CvParsedConfidence;
}

export interface CvStructurerOptions {
  /** Returns the decrypted OpenRouter API key from the LLM-001 store, or null. */
  getApiKey: () => string | null;
  /** Returns the user's selected default model slug (LLM-003), or null. */
  getDefaultModel: () => string | null;
  /** Override for tests; defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface CvStructurer {
  structure(text: string): Promise<CvStructuringResult>;
}

// --- JSON schema sent to OpenRouter ---------------------------------------
//
// OpenRouter's structured-output path forwards the JSON schema to the
// underlying provider (OpenAI / Anthropic / etc). Keep the schema flat and
// nullable — providers reject overly nested / over-constrained schemas, and
// the renderer's review step is the place where missing values are flagged.
const PARSED_FIELDS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: ['string', 'null'] },
    contact: {
      type: 'object',
      additionalProperties: false,
      properties: {
        email: { type: ['string', 'null'] },
        phone: { type: ['string', 'null'] },
      },
      required: ['email', 'phone'],
    },
    targetRole: { type: ['string', 'null'] },
    skills: { type: 'array', items: { type: 'string' } },
    employmentHistory: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          company: { type: ['string', 'null'] },
          role: { type: ['string', 'null'] },
          startDate: { type: ['string', 'null'] },
          endDate: { type: ['string', 'null'] },
          summary: { type: ['string', 'null'] },
        },
        required: ['company', 'role', 'startDate', 'endDate', 'summary'],
      },
    },
    education: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          school: { type: ['string', 'null'] },
          qualification: { type: ['string', 'null'] },
          startDate: { type: ['string', 'null'] },
          endDate: { type: ['string', 'null'] },
        },
        required: ['school', 'qualification', 'startDate', 'endDate'],
      },
    },
    totalYearsExperience: { type: ['number', 'null'] },
    location: { type: ['string', 'null'] },
    confidence: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overall: { type: 'number' },
        perField: {
          type: 'object',
          additionalProperties: { type: 'number' },
        },
      },
      required: ['overall', 'perField'],
    },
  },
  required: [
    'name',
    'contact',
    'targetRole',
    'skills',
    'employmentHistory',
    'education',
    'totalYearsExperience',
    'location',
    'confidence',
  ],
} as const;

const SYSTEM_PROMPT =
  'You are a CV-structuring assistant. Given the plain text of a candidate\'s CV, ' +
  'extract their profile into the requested JSON schema. ' +
  'Leave any field you cannot find as null (do NOT guess). ' +
  'For the "confidence" block, return an `overall` number in [0,1] and a `perField` ' +
  'object with 0..1 confidence scores for each top-level field you populated.';

const STRUCTURED_OUTPUT_HINTS =
  /(response_format|json_schema|structured\s*output|tools?\s+are\s+not\s+supported|function[- ]calling|does not support)/i;

function clampUnit(n: unknown): number {
  if (typeof n !== 'number' || Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normaliseParsed(raw: unknown): CvStructuringResult {
  if (!raw || typeof raw !== 'object') {
    throw new CvStructuringError(
      'PARSE_ERROR',
      'Structured response was not an object',
    );
  }
  const o = raw as Record<string, unknown>;

  const contactRaw = (o.contact as Record<string, unknown> | null | undefined) ?? {};
  const skills = Array.isArray(o.skills)
    ? (o.skills as unknown[]).filter((s): s is string => typeof s === 'string')
    : [];

  const employmentHistory = Array.isArray(o.employmentHistory)
    ? (o.employmentHistory as Array<Record<string, unknown>>).map((e) => ({
        company: typeof e.company === 'string' ? e.company : null,
        role: typeof e.role === 'string' ? e.role : null,
        startDate: typeof e.startDate === 'string' ? e.startDate : null,
        endDate: typeof e.endDate === 'string' ? e.endDate : null,
        summary: typeof e.summary === 'string' ? e.summary : null,
      }))
    : [];

  const education = Array.isArray(o.education)
    ? (o.education as Array<Record<string, unknown>>).map((e) => ({
        school: typeof e.school === 'string' ? e.school : null,
        qualification: typeof e.qualification === 'string' ? e.qualification : null,
        startDate: typeof e.startDate === 'string' ? e.startDate : null,
        endDate: typeof e.endDate === 'string' ? e.endDate : null,
      }))
    : [];

  const confRaw = (o.confidence as Record<string, unknown> | null | undefined) ?? {};
  const overall = clampUnit(confRaw.overall);
  const perFieldRaw =
    (confRaw.perField as Record<string, unknown> | null | undefined) ?? {};
  const perField: Record<string, number> = {};
  for (const [k, v] of Object.entries(perFieldRaw)) {
    perField[k] = clampUnit(v);
  }

  const parsedFields: CvParsedFields = {
    name: typeof o.name === 'string' ? o.name : null,
    contact: {
      email: typeof contactRaw.email === 'string' ? contactRaw.email : null,
      phone: typeof contactRaw.phone === 'string' ? contactRaw.phone : null,
    },
    targetRole: typeof o.targetRole === 'string' ? o.targetRole : null,
    skills,
    employmentHistory,
    education,
    totalYearsExperience:
      typeof o.totalYearsExperience === 'number' ? o.totalYearsExperience : null,
    location: typeof o.location === 'string' ? o.location : null,
  };

  return { parsedFields, confidence: { overall, perField } };
}

export function createCvStructurer(opts: CvStructurerOptions): CvStructurer {
  const { getApiKey, getDefaultModel } = opts;
  const doFetch: typeof fetch = opts.fetch ?? (globalThis.fetch as typeof fetch);

  return {
    async structure(text: string): Promise<CvStructuringResult> {
      const key = (getApiKey() ?? '').trim();
      if (!key) {
        throw new CvStructuringError(
          'NO_API_KEY',
          'No OpenRouter API key is saved — connect an AI provider in Settings to structure CVs.',
        );
      }
      const model = (getDefaultModel() ?? '').trim();
      if (!model) {
        throw new CvStructuringError(
          'NO_DEFAULT_MODEL',
          'No default model selected — pick one under Settings → Preferred models.',
        );
      }
      const cvText = (text ?? '').trim();
      if (!cvText) {
        throw new CvStructuringError(
          'EMPTY_TEXT',
          'CV text is empty — nothing to structure.',
        );
      }

      const body = JSON.stringify({
        model,
        temperature: 0,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'cv_profile',
            strict: true,
            schema: PARSED_FIELDS_SCHEMA,
          },
        },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Structure the following CV text into the cv_profile schema.\n\n${cvText}`,
          },
        ],
      });

      let response: Response;
      try {
        response = await doFetch(OPENROUTER_CHAT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body,
        });
      } catch (err) {
        throw new CvStructuringError(
          'NETWORK_ERROR',
          err instanceof Error ? err.message : 'Network error contacting OpenRouter',
        );
      }

      if (!response.ok) {
        const status = response.status;
        let errText = '';
        try {
          errText = await response.text();
        } catch {
          errText = '';
        }
        if (status === 401 || status === 403) {
          throw new CvStructuringError(
            'AUTH_ERROR',
            `OpenRouter rejected the API key (HTTP ${status})`,
          );
        }
        if (status === 429) {
          throw new CvStructuringError(
            'RATE_LIMITED',
            'OpenRouter rate-limited the structuring request',
          );
        }
        if (status === 400 && STRUCTURED_OUTPUT_HINTS.test(errText)) {
          throw new CvStructuringError(
            'MODEL_NO_STRUCTURED_OUTPUT',
            `Model "${model}" does not support structured output. ` +
              'Pick a JSON-schema / function-calling capable model under Settings → Preferred models.',
          );
        }
        throw new CvStructuringError(
          'HTTP_ERROR',
          `OpenRouter returned HTTP ${status}`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (err) {
        throw new CvStructuringError(
          'BAD_RESPONSE',
          err instanceof Error ? err.message : 'OpenRouter response was not valid JSON',
        );
      }

      const choices =
        payload && typeof payload === 'object'
          ? ((payload as { choices?: unknown }).choices as unknown)
          : null;
      if (!Array.isArray(choices) || choices.length === 0) {
        throw new CvStructuringError(
          'BAD_RESPONSE',
          'OpenRouter response missing "choices" array',
        );
      }
      const first = choices[0] as { message?: { content?: unknown } } | null;
      const content = first?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {
        throw new CvStructuringError(
          'BAD_RESPONSE',
          'OpenRouter response had no message content',
        );
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (err) {
        throw new CvStructuringError(
          'PARSE_ERROR',
          err instanceof Error
            ? `Model returned non-JSON content: ${err.message}`
            : 'Model returned non-JSON content',
        );
      }

      return normaliseParsed(parsed);
    },
  };
}

export type CvStructureIpcResult =
  | { ok: true; parsedFields: CvParsedFields; confidence: CvParsedConfidence }
  | { ok: false; code: CvStructuringErrorCode; message: string };

/**
 * Register the `cv:structure` IPC handler. The renderer hands in the
 * extracted CV text (typically pulled off `starCv.get(id).parsedText`) and
 * receives a tagged-union result so it can branch on the stable `code`
 * without parsing exception messages.
 */
export function registerCvStructuringIpc(
  ipcMain: IpcMain,
  structurer: CvStructurer,
): void {
  ipcMain.handle(
    'cv:structure',
    async (_event, text: string): Promise<CvStructureIpcResult> => {
      try {
        const { parsedFields, confidence } = await structurer.structure(text);
        return { ok: true, parsedFields, confidence };
      } catch (err) {
        if (err instanceof CvStructuringError) {
          return { ok: false, code: err.code, message: err.message };
        }
        return {
          ok: false,
          code: 'HTTP_ERROR',
          message: err instanceof Error ? err.message : 'Unknown structuring error',
        };
      }
    },
  );
}
