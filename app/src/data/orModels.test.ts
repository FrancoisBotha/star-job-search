/**
 * Unit tests for deriveCatalogue() (LLM-004 AC2).
 *
 * Covers enrichment of raw `StarModelInfo` rows from the OpenRouter catalogue
 * with display-ready fields (vendor, formatted context/price, sota/free flags)
 * and sortable numeric fields used by the Settings model picker.
 */
import { describe, expect, it } from 'vitest';
import { deriveCatalogue, type DerivedModel } from './orModels';

interface RawModel {
  id: string;
  name: string;
  contextLength: number;
  pricing: { prompt: string; completion: string };
  created: number;
}

const RAW: RawModel[] = [
  {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Anthropic: Claude 3.5 Sonnet',
    contextLength: 200000,
    pricing: { prompt: '0.000003', completion: '0.000015' },
    created: 1_700_000_000,
  },
  {
    id: 'openai/gpt-4o',
    name: 'OpenAI: GPT-4o',
    contextLength: 128000,
    pricing: { prompt: '0.000005', completion: '0.000015' },
    created: 1_700_000_100,
  },
  {
    id: 'meta-llama/llama-3-8b-instruct:free',
    name: 'Meta: Llama 3 8B Instruct (free)',
    contextLength: 8192,
    pricing: { prompt: '0', completion: '0' },
    created: 1_700_000_200,
  },
  {
    id: 'badly-formed-id-without-vendor-slash',
    name: 'Mystery',
    contextLength: 0,
    pricing: { prompt: '', completion: '' },
    created: 0,
  },
];

describe('deriveCatalogue — vendor', () => {
  it('extracts the vendor from the id prefix before the first slash', () => {
    const out = deriveCatalogue(RAW);
    expect(out[0]!.vendor).toBe('anthropic');
    expect(out[1]!.vendor).toBe('openai');
    expect(out[2]!.vendor).toBe('meta-llama');
  });

  it('falls back to "unknown" when there is no slash in the id', () => {
    const out = deriveCatalogue(RAW);
    expect(out[3]!.vendor).toBe('unknown');
  });
});

describe('deriveCatalogue — context formatting', () => {
  it('formats large context windows with a K suffix', () => {
    const out = deriveCatalogue(RAW);
    expect(out[0]!.contextLengthFormatted).toBe('200K');
    expect(out[1]!.contextLengthFormatted).toBe('128K');
    expect(out[2]!.contextLengthFormatted).toBe('8K');
  });

  it('exposes the raw number for sorting', () => {
    const out = deriveCatalogue(RAW);
    expect(out[0]!.contextLengthNum).toBe(200000);
    expect(out[3]!.contextLengthNum).toBe(0);
  });

  it('formats a missing/zero context as a dash', () => {
    const out = deriveCatalogue(RAW);
    expect(out[3]!.contextLengthFormatted).toBe('—');
  });
});

describe('deriveCatalogue — price formatting', () => {
  it('renders per-1M-token prompt/completion prices', () => {
    const out = deriveCatalogue(RAW);
    expect(out[0]!.priceFormatted).toBe('$3.00 / $15.00 per 1M tokens');
    expect(out[1]!.priceFormatted).toBe('$5.00 / $15.00 per 1M tokens');
  });

  it('renders "Free" when both prompt and completion are zero', () => {
    const out = deriveCatalogue(RAW);
    expect(out[2]!.priceFormatted).toBe('Free');
  });

  it('exposes per-token numeric prices for sorting', () => {
    const out = deriveCatalogue(RAW);
    expect(out[0]!.promptPriceNum).toBeCloseTo(0.000003);
    expect(out[0]!.completionPriceNum).toBeCloseTo(0.000015);
    expect(out[2]!.promptPriceNum).toBe(0);
  });
});

describe('deriveCatalogue — flags', () => {
  it('flags free models', () => {
    const out = deriveCatalogue(RAW);
    expect(out[2]!.free).toBe(true);
    expect(out[0]!.free).toBe(false);
  });

  it('flags state-of-the-art frontier models', () => {
    const out = deriveCatalogue(RAW);
    // Claude 3.5 Sonnet and GPT-4o are recognised SOTA.
    expect(out[0]!.sota).toBe(true);
    expect(out[1]!.sota).toBe(true);
    // A small free model is not.
    expect(out[2]!.sota).toBe(false);
  });
});

describe('deriveCatalogue — orderIndex and created', () => {
  it('preserves the original order via orderIndex', () => {
    const out = deriveCatalogue(RAW);
    expect(out.map((m: DerivedModel) => m.orderIndex)).toEqual([0, 1, 2, 3]);
  });

  it('passes through the created timestamp', () => {
    const out = deriveCatalogue(RAW);
    expect(out[0]!.created).toBe(1_700_000_000);
    expect(out[3]!.created).toBe(0);
  });
});
