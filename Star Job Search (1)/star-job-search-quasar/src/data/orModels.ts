/**
 * Derived OpenRouter model catalogue (LLM-004 AC2).
 *
 * The raw `ModelInfo` rows returned by the `llm:listModels` IPC bridge are
 * minimal — pricing is a per-token decimal string and the context length is
 * a raw integer. The Settings model picker needs display-ready fields
 * (vendor, formatted context, formatted price, free / SOTA flags) plus
 * numeric counterparts for sorting. `deriveCatalogue` enriches each raw row
 * with those derived fields and preserves the original input order via
 * `orderIndex`, so the UI can apply its own ordering without losing the
 * relative position the OpenRouter API returned them in.
 */

/** Single raw row from the OpenRouter catalogue (matches StarModelInfo). */
export interface RawModel {
  id: string;
  name: string;
  contextLength: number;
  pricing: { prompt: string; completion: string };
  created: number;
}

/**
 * Enriched model row used by the renderer. Carries both the raw values
 * (so the UI can show the source-of-truth slug) and pre-computed
 * presentational fields so the template stays declarative.
 */
export interface DerivedModel extends RawModel {
  vendor: string;
  contextLengthNum: number;
  contextLengthFormatted: string;
  promptPriceNum: number;
  completionPriceNum: number;
  priceFormatted: string;
  free: boolean;
  sota: boolean;
  orderIndex: number;
}

const SOTA_PATTERNS: RegExp[] = [
  /claude-3\.5-sonnet/i,
  /claude-3\.7/i,
  /claude-3-opus/i,
  /claude-opus/i,
  /gpt-4o/i,
  /gpt-4\.1/i,
  /gpt-5/i,
  /gemini-1\.5-pro/i,
  /gemini-2/i,
  /o1-preview/i,
];

function deriveVendor(id: string): string {
  const slash = id.indexOf('/');
  if (slash <= 0) return 'unknown';
  return id.slice(0, slash);
}

function formatContextLength(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function parsePerTokenPrice(raw: string): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function formatPerMillionUsd(perToken: number): string {
  const perMillion = perToken * 1_000_000;
  return `$${perMillion.toFixed(2)}`;
}

function formatPrice(prompt: number, completion: number): string {
  if (prompt === 0 && completion === 0) return 'Free';
  return `${formatPerMillionUsd(prompt)} / ${formatPerMillionUsd(completion)} per 1M tokens`;
}

function detectSota(row: RawModel): boolean {
  return SOTA_PATTERNS.some((re) => re.test(row.id) || re.test(row.name));
}

/**
 * Enrich a list of raw OpenRouter model rows with the display + sort fields
 * the renderer needs. Pure, deterministic — safe to call directly from a
 * Pinia getter or to memoise on the store.
 */
export function deriveCatalogue(rows: readonly RawModel[]): DerivedModel[] {
  return rows.map((row, index) => {
    const promptPriceNum = parsePerTokenPrice(row.pricing?.prompt ?? '');
    const completionPriceNum = parsePerTokenPrice(row.pricing?.completion ?? '');
    const free = promptPriceNum === 0 && completionPriceNum === 0;
    return {
      ...row,
      vendor: deriveVendor(row.id),
      contextLengthNum: row.contextLength,
      contextLengthFormatted: formatContextLength(row.contextLength),
      promptPriceNum,
      completionPriceNum,
      priceFormatted: formatPrice(promptPriceNum, completionPriceNum),
      free,
      sota: detectSota(row),
      orderIndex: index,
    };
  });
}
