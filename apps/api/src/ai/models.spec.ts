import { describe, expect, it } from 'vitest';
import {
  canonicalModelId,
  computeCostUsd,
  computeTranscriptionCostUsd,
  effectiveReasoningEffort,
  estimateTypicalCostUsd,
  findModel,
  findTranscriptionModel,
  isSelectableModel,
  serviceTierMultiplier,
  supportsTranscriptionKeywords,
  usesExplicitPromptCache,
} from './models.js';

describe('model catalog', () => {
  it('canonicalizes dated snapshots and aliases', () => {
    expect(canonicalModelId('gpt-5.6')).toBe('gpt-5.6-sol');
    expect(canonicalModelId('gpt-5.4-mini-2026-03-17')).toBe('gpt-5.4-mini');
    expect(findModel('gpt-6-sol')?.label).toBe('GPT-6 Sol');
    expect(isSelectableModel('gpt-5.4')).toBe(false);
    expect(isSelectableModel('gpt-6-astra')).toBe(true);
  });

  it('computes cost including cached and cache-write tokens', () => {
    const cost = computeCostUsd('gpt-5.6-sol', {
      inputTokens: 2800,
      cachedInputTokens: 1000,
      cacheWriteTokens: 0,
      outputTokens: 1500,
    });
    expect(cost).toBeCloseTo((1800 * 4 + 1000 * 0.4 + 1500 * 20) / 1e6, 6);
    expect(
      computeCostUsd('unknown-model', {
        inputTokens: 1,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 1,
      }),
    ).toBeNull();
  });

  it('estimates the typical request cost', () => {
    expect(
      estimateTypicalCostUsd(findModel('gpt-5.6-sol')!.pricing),
    ).toBeCloseTo(0.0412, 4);
  });
});

describe('model request policy', () => {
  it('raises the reasoning effort to the model minimum and skips non-reasoning models', () => {
    expect(effectiveReasoningEffort('gpt-6-astra', 'none')).toBe('low');
    expect(effectiveReasoningEffort('gpt-6-astra', 'minimal')).toBe('low');
    expect(effectiveReasoningEffort('gpt-6-astra', 'high')).toBe('high');
    expect(effectiveReasoningEffort('gpt-5.6-sol', 'none')).toBe('none');
    expect(effectiveReasoningEffort('unknown-model', 'low')).toBe('low');
    expect(effectiveReasoningEffort('gpt-4.1-mini', 'low')).toBeNull();
  });

  it('replaces the minimal effort that current catalog models reject with low', () => {
    expect(effectiveReasoningEffort('gpt-5.6-sol', 'minimal')).toBe('low');
    expect(effectiveReasoningEffort('gpt-6-luna', 'minimal')).toBe('low');
    expect(effectiveReasoningEffort('gpt-5-mini', 'minimal')).toBe('minimal');
  });

  it('uses explicit prompt caching only for GPT-5.6 and GPT-6 models', () => {
    expect(usesExplicitPromptCache('gpt-5.6')).toBe(true);
    expect(usesExplicitPromptCache('gpt-6-luna')).toBe(true);
    expect(usesExplicitPromptCache('gpt-5.5-2026-04-23')).toBe(false);
    expect(usesExplicitPromptCache('unknown-model')).toBe(false);
  });

  it('prices fast, priority and flex service tiers', () => {
    expect(serviceTierMultiplier('gpt-5.6-sol', 'fast')).toBe(2);
    expect(serviceTierMultiplier('gpt-5.6-sol', 'priority')).toBe(2);
    expect(serviceTierMultiplier('gpt-5.5', 'priority')).toBe(2.5);
    expect(serviceTierMultiplier('gpt-4.1', 'fast')).toBe(1.75);
    expect(serviceTierMultiplier('gpt-6-sol', 'flex')).toBe(0.5);
    expect(serviceTierMultiplier('gpt-6-sol', 'default')).toBe(1);
    expect(serviceTierMultiplier('gpt-6-sol', null)).toBe(1);
    expect(serviceTierMultiplier('unknown-model', 'fast')).toBe(1);
  });
});

describe('transcription models', () => {
  it('prices per-minute models by audio duration', () => {
    expect(
      computeTranscriptionCostUsd('gpt-transcribe', {
        audioSeconds: 60,
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(0.0045);
    expect(
      computeTranscriptionCostUsd('whisper-1', {
        audioSeconds: 30,
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(0.003);
    expect(
      computeTranscriptionCostUsd('gpt-transcribe', {
        audioSeconds: -5,
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(0);
  });

  it('prices token models by tokens and by duration when that is all they report', () => {
    expect(
      computeTranscriptionCostUsd('gpt-4o-transcribe', {
        audioSeconds: null,
        inputTokens: 1000,
        outputTokens: 200,
      }),
    ).toBeCloseTo((1000 * 2.5 + 200 * 10) / 1e6, 6);
    expect(
      computeTranscriptionCostUsd('gpt-4o-mini-transcribe-2025-12-15', {
        audioSeconds: null,
        inputTokens: 1000,
        outputTokens: 200,
      }),
    ).toBeCloseTo((1000 * 1.25 + 200 * 5) / 1e6, 6);
    expect(
      computeTranscriptionCostUsd('gpt-4o-transcribe', {
        audioSeconds: 120,
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(0.012);
  });

  it('cannot price tokens of a per-minute model or an unknown model', () => {
    expect(
      computeTranscriptionCostUsd('gpt-transcribe', {
        audioSeconds: null,
        inputTokens: 600,
        outputTokens: 50,
      }),
    ).toBeNull();
    expect(
      computeTranscriptionCostUsd('gpt-5.6-sol', {
        audioSeconds: 60,
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBeNull();
    expect(findTranscriptionModel('gpt-9-listen')).toBeUndefined();
  });

  it('knows which models accept keyword hints', () => {
    expect(supportsTranscriptionKeywords('gpt-transcribe')).toBe(true);
    expect(supportsTranscriptionKeywords('gpt-4o-transcribe')).toBe(false);
    expect(supportsTranscriptionKeywords('whisper-1')).toBe(false);
    expect(supportsTranscriptionKeywords('unknown-model')).toBe(false);
  });
});
