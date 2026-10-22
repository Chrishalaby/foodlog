export interface ModelPricing {
  input: number;
  cachedInput: number;
  cacheWrite: number;
  output: number;
}

export type ModelVendor = 'openai' | 'anthropic';

export interface ModelCatalogEntry {
  id: string;
  vendor: ModelVendor;
  label: string;
  description: string;
  selectable: boolean;
  recommended: boolean;
  pricing: ModelPricing;
  minReasoningEffort: 'none' | 'low';
  explicitPromptCache: boolean;
  fastTierMultiplier: number;
}

export const TYPICAL_REQUEST_TOKENS = { input: 2800, output: 1500 } as const;

export const MODEL_CATALOG: readonly ModelCatalogEntry[] = [
  {
    id: 'gpt-5.6-sol',
    vendor: 'openai',
    label: 'GPT-5.6 Sol',
    description:
      'Default. Best measured vision accuracy among the fast models.',
    selectable: true,
    recommended: true,
    pricing: { input: 4, cachedInput: 0.4, cacheWrite: 5, output: 20 },
    minReasoningEffort: 'none',
    explicitPromptCache: true,
    fastTierMultiplier: 2,
  },
  {
    id: 'gpt-6-sol',
    vendor: 'openai',
    label: 'GPT-6 Sol',
    description:
      'Newest mid-tier model with fewer hallucinations, about half the cost of 5.6 Sol.',
    selectable: true,
    recommended: false,
    pricing: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
    minReasoningEffort: 'none',
    explicitPromptCache: true,
    fastTierMultiplier: 2,
  },
  {
    id: 'gpt-6-astra',
    vendor: 'openai',
    label: 'GPT-6 Astra',
    description:
      'Maximum accuracy. Slower (about 25 s) and about 2.5× the cost of the default.',
    selectable: true,
    recommended: false,
    pricing: { input: 10, cachedInput: 1, cacheWrite: 12.5, output: 50 },
    minReasoningEffort: 'low',
    explicitPromptCache: true,
    fastTierMultiplier: 2,
  },
  {
    id: 'gpt-5.6-luna',
    vendor: 'openai',
    label: 'GPT-5.6 Luna',
    description:
      'Budget option, about 15× cheaper. Noticeably weaker at portion sizes.',
    selectable: true,
    recommended: false,
    pricing: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1.2 },
    minReasoningEffort: 'none',
    explicitPromptCache: true,
    fastTierMultiplier: 2,
  },
  {
    id: 'gpt-6-luna',
    vendor: 'openai',
    label: 'GPT-6 Luna',
    description: 'Cheapest and fastest. Least accurate.',
    selectable: true,
    recommended: false,
    pricing: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
    minReasoningEffort: 'none',
    explicitPromptCache: true,
    fastTierMultiplier: 2,
  },
  {
    id: 'gpt-5.6-terra',
    vendor: 'openai',
    label: 'GPT-5.6 Terra',
    description: 'Mid tier.',
    selectable: false,
    recommended: false,
    pricing: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 12 },
    minReasoningEffort: 'none',
    explicitPromptCache: true,
    fastTierMultiplier: 2,
  },
  {
    id: 'gpt-5.5',
    vendor: 'openai',
    label: 'GPT-5.5',
    description: 'Previous generation.',
    selectable: false,
    recommended: false,
    pricing: { input: 5, cachedInput: 0.5, cacheWrite: 5, output: 30 },
    minReasoningEffort: 'none',
    explicitPromptCache: false,
    fastTierMultiplier: 2.5,
  },
  {
    id: 'gpt-5.4',
    vendor: 'openai',
    label: 'GPT-5.4',
    description: 'Previous generation.',
    selectable: false,
    recommended: false,
    pricing: { input: 2.5, cachedInput: 0.25, cacheWrite: 2.5, output: 15 },
    minReasoningEffort: 'none',
    explicitPromptCache: false,
    fastTierMultiplier: 2,
  },
  {
    id: 'gpt-5.4-mini',
    vendor: 'openai',
    label: 'GPT-5.4 mini',
    description: 'Previous generation.',
    selectable: false,
    recommended: false,
    pricing: { input: 0.75, cachedInput: 0.075, cacheWrite: 0.75, output: 4.5 },
    minReasoningEffort: 'none',
    explicitPromptCache: false,
    fastTierMultiplier: 2,
  },
  {
    id: 'gpt-4.1',
    vendor: 'openai',
    label: 'GPT-4.1',
    description: 'Legacy non-reasoning model.',
    selectable: false,
    recommended: false,
    pricing: { input: 2, cachedInput: 0.5, cacheWrite: 2, output: 8 },
    minReasoningEffort: 'none',
    explicitPromptCache: false,
    fastTierMultiplier: 1.75,
  },
  {
    id: 'gpt-4.1-mini',
    vendor: 'openai',
    label: 'GPT-4.1 mini',
    description: 'Legacy non-reasoning model.',
    selectable: false,
    recommended: false,
    pricing: { input: 0.4, cachedInput: 0.1, cacheWrite: 0.4, output: 1.6 },
    minReasoningEffort: 'none',
    explicitPromptCache: false,
    fastTierMultiplier: 1.75,
  },
  {
    id: 'claude-sonnet-5-5',
    vendor: 'anthropic',
    label: 'Claude Sonnet 5.5',
    description:
      'Default for Claude. Fast and accurate with photos and labels.',
    selectable: true,
    recommended: true,
    pricing: { input: 2, cachedInput: 0.2, cacheWrite: 2.5, output: 10 },
    minReasoningEffort: 'low',
    explicitPromptCache: false,
    fastTierMultiplier: 1,
  },
  {
    id: 'claude-opus-5-5',
    vendor: 'anthropic',
    label: 'Claude Opus 5.5',
    description: 'Maximum accuracy. Slower and about twice the cost of Sonnet.',
    selectable: true,
    recommended: false,
    pricing: { input: 4, cachedInput: 0.2, cacheWrite: 5, output: 20 },
    minReasoningEffort: 'low',
    explicitPromptCache: false,
    fastTierMultiplier: 1,
  },
  {
    id: 'claude-haiku-5-5',
    vendor: 'anthropic',
    label: 'Claude Haiku 5.5',
    description: 'Cheapest and fastest Claude. Less accurate with portions.',
    selectable: true,
    recommended: false,
    pricing: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
    minReasoningEffort: 'low',
    explicitPromptCache: false,
    fastTierMultiplier: 1,
  },
];

const MODEL_ALIASES: Readonly<Record<string, string>> = {
  'gpt-5.6': 'gpt-5.6-sol',
};

const NON_REASONING_MODELS = new Set(['gpt-4.1', 'gpt-4.1-mini']);

export function canonicalModelId(model: string): string {
  const base = model.trim().replace(/-\d{4}-\d{2}-\d{2}$/, '');
  return MODEL_ALIASES[base] ?? base;
}

export function findModel(model: string): ModelCatalogEntry | undefined {
  const id = canonicalModelId(model);
  return MODEL_CATALOG.find((entry) => entry.id === id);
}

export function isSelectableModel(
  model: string,
  vendor: ModelVendor = 'openai',
): boolean {
  const entry = findModel(model);
  return entry?.selectable === true && entry.vendor === vendor;
}

export function selectableModels(vendor: ModelVendor): ModelCatalogEntry[] {
  return MODEL_CATALOG.filter(
    (entry) => entry.selectable && entry.vendor === vendor,
  );
}

export function supportsReasoning(model: string): boolean {
  return !NON_REASONING_MODELS.has(canonicalModelId(model));
}

export function estimateTypicalCostUsd(pricing: ModelPricing): number {
  const usd =
    (TYPICAL_REQUEST_TOKENS.input * pricing.input +
      TYPICAL_REQUEST_TOKENS.output * pricing.output) /
    1e6;
  return Math.round(usd * 10000) / 10000;
}

const REASONING_EFFORT_ORDER = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ReasoningEffortLevel = (typeof REASONING_EFFORT_ORDER)[number];

const CATALOG_EFFORT_REPLACEMENTS: Partial<
  Record<ReasoningEffortLevel, ReasoningEffortLevel>
> = { minimal: 'low' };

export function effectiveReasoningEffort(
  model: string,
  configured: ReasoningEffortLevel,
): ReasoningEffortLevel | null {
  if (!supportsReasoning(model)) {
    return null;
  }
  const entry = findModel(model);
  if (!entry) {
    return configured;
  }
  const requested = CATALOG_EFFORT_REPLACEMENTS[configured] ?? configured;
  const rank = (level: ReasoningEffortLevel): number =>
    REASONING_EFFORT_ORDER.indexOf(level);
  return rank(requested) < rank(entry.minReasoningEffort)
    ? entry.minReasoningEffort
    : requested;
}

export function usesExplicitPromptCache(model: string): boolean {
  return findModel(model)?.explicitPromptCache === true;
}

const FAST_SERVICE_TIERS = new Set(['fast', 'priority', 'ultrafast']);
const FLEX_SERVICE_TIER_MULTIPLIER = 0.5;

export function serviceTierMultiplier(
  model: string,
  serviceTier: string | null | undefined,
): number {
  if (serviceTier && FAST_SERVICE_TIERS.has(serviceTier)) {
    return findModel(model)?.fastTierMultiplier ?? 1;
  }
  return serviceTier === 'flex' ? FLEX_SERVICE_TIER_MULTIPLIER : 1;
}

export interface TokenUsageForCost {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
}

export function computeCostUsd(
  model: string,
  usage: TokenUsageForCost,
  tierMultiplier = 1,
): number | null {
  const entry = findModel(model);
  if (!entry) {
    return null;
  }
  const p = entry.pricing;
  const uncached = Math.max(
    0,
    usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
  );
  const usd =
    (uncached * p.input +
      usage.cachedInputTokens * p.cachedInput +
      usage.cacheWriteTokens * p.cacheWrite +
      usage.outputTokens * p.output) /
    1e6;
  return Math.round(usd * tierMultiplier * 1e6) / 1e6;
}

export interface TranscriptionModelEntry {
  id: string;
  perMinute: number;
  input: number | null;
  output: number | null;
  keywords: boolean;
}

export const TRANSCRIPTION_MODELS: readonly TranscriptionModelEntry[] = [
  {
    id: 'gpt-transcribe',
    perMinute: 0.0045,
    input: null,
    output: null,
    keywords: true,
  },
  {
    id: 'gpt-4o-transcribe',
    perMinute: 0.006,
    input: 2.5,
    output: 10,
    keywords: false,
  },
  {
    id: 'gpt-4o-mini-transcribe',
    perMinute: 0.003,
    input: 1.25,
    output: 5,
    keywords: false,
  },
  {
    id: 'whisper-1',
    perMinute: 0.006,
    input: null,
    output: null,
    keywords: false,
  },
];

export function findTranscriptionModel(
  model: string,
): TranscriptionModelEntry | undefined {
  const id = canonicalModelId(model);
  return TRANSCRIPTION_MODELS.find((entry) => entry.id === id);
}

export function supportsTranscriptionKeywords(model: string): boolean {
  return findTranscriptionModel(model)?.keywords === true;
}

export interface TranscriptionUsageForCost {
  audioSeconds: number | null;
  inputTokens: number;
  outputTokens: number;
}

export function computeTranscriptionCostUsd(
  model: string,
  usage: TranscriptionUsageForCost,
): number | null {
  const entry = findTranscriptionModel(model);
  if (!entry) {
    return null;
  }
  if (usage.audioSeconds !== null) {
    const usd = (Math.max(0, usage.audioSeconds) / 60) * entry.perMinute;
    return Math.round(usd * 1e6) / 1e6;
  }
  if (entry.input === null || entry.output === null) {
    return null;
  }
  const usd =
    (usage.inputTokens * entry.input + usage.outputTokens * entry.output) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
