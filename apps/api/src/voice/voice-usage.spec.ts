import { API_LIMITS } from '@food/shared';
import { AiProviderError } from '../ai/providers/ai-provider-error.js';
import { zeroUsage } from '../ai/providers/ai-provider.js';
import type { StructuredAttemptRecord } from '../ai/providers/structured-attempts.js';
import type { VoiceTranscript } from './voice-provider.js';
import {
  normalizeTranscriptionUsage,
  voiceAttemptCostUsd,
} from './voice-usage.js';

type VoiceRecord = StructuredAttemptRecord<VoiceTranscript>;

const noWarning = (): void => {
  throw new Error('unexpected warning');
};

function success(
  model: string,
  audioSeconds: number | null,
  tokens: { inputTokens: number; outputTokens: number } = {
    inputTokens: 0,
    outputTokens: 0,
  },
): VoiceRecord {
  return {
    attempt: 1,
    durationMs: 1200,
    ok: true,
    result: {
      raw: { text: '2 eggs', audioSeconds },
      usage: { ...zeroUsage(), ...tokens },
      model,
      requestId: 'req_1',
      latencyMs: 1200,
      serviceTier: null,
    },
  };
}

function failure(
  kind: 'timeout' | 'server_error',
  model?: string,
): VoiceRecord {
  return {
    attempt: 1,
    durationMs: 90_000,
    ok: false,
    error: new AiProviderError(kind, 'failed', false, model ? { model } : {}),
  };
}

describe('normalizeTranscriptionUsage', () => {
  it('maps token usage to input and output tokens', () => {
    expect(
      normalizeTranscriptionUsage({
        type: 'tokens',
        input_tokens: 640,
        output_tokens: 52,
        total_tokens: 692,
        input_token_details: { audio_tokens: 600, text_tokens: 40 },
      }),
    ).toEqual({
      tokens: { ...zeroUsage(), inputTokens: 640, outputTokens: 52 },
      audioSeconds: null,
    });
  });

  it('maps duration usage to audio seconds without tokens', () => {
    expect(
      normalizeTranscriptionUsage({ type: 'duration', seconds: 42.4 }),
    ).toEqual({ tokens: zeroUsage(), audioSeconds: 42.4 });
    expect(
      normalizeTranscriptionUsage({ type: 'duration', seconds: -3 }),
    ).toEqual({ tokens: zeroUsage(), audioSeconds: 0 });
  });

  it('treats missing or malformed usage as unknown', () => {
    expect(normalizeTranscriptionUsage(undefined)).toEqual({
      tokens: zeroUsage(),
      audioSeconds: null,
    });
    expect(normalizeTranscriptionUsage(null)).toEqual({
      tokens: zeroUsage(),
      audioSeconds: null,
    });
    expect(
      normalizeTranscriptionUsage({ type: 'duration', seconds: Number.NaN }),
    ).toEqual({ tokens: zeroUsage(), audioSeconds: null });
  });
});

describe('voiceAttemptCostUsd', () => {
  it('prices a per-minute model from the audio duration', () => {
    expect(
      voiceAttemptCostUsd(
        success('gpt-transcribe', 40),
        'gpt-transcribe',
        noWarning,
      ),
    ).toBeCloseTo((40 / 60) * 0.0045, 6);
  });

  it('prices a token model from its tokens', () => {
    expect(
      voiceAttemptCostUsd(
        success('gpt-4o-transcribe', null, {
          inputTokens: 640,
          outputTokens: 52,
        }),
        'gpt-4o-transcribe',
        noWarning,
      ),
    ).toBeCloseTo((640 * 2.5 + 52 * 10) / 1e6, 6);
  });

  it('charges nothing for the mock provider', () => {
    expect(
      voiceAttemptCostUsd(success('mock', null), 'gpt-transcribe', noWarning),
    ).toBe(0);
  });

  it('records usage it cannot price as free and warns', () => {
    const warnings: string[] = [];
    const warn = (model: string): number => warnings.push(model);

    expect(
      voiceAttemptCostUsd(
        success('gpt-transcribe', null, { inputTokens: 600, outputTokens: 50 }),
        'gpt-transcribe',
        warn,
      ),
    ).toBe(0);
    expect(
      voiceAttemptCostUsd(success('gpt-9-listen', 30), 'gpt-9-listen', warn),
    ).toBe(0);
    expect(warnings).toEqual(['gpt-transcribe', 'gpt-9-listen']);
  });

  it('charges a timeout for the longest allowed recording and other failures nothing', () => {
    expect(
      voiceAttemptCostUsd(failure('timeout'), 'gpt-transcribe', noWarning),
    ).toBeCloseTo((API_LIMITS.voiceMaxSeconds / 60) * 0.0045, 6);
    expect(
      voiceAttemptCostUsd(
        failure('timeout', 'gpt-4o-mini-transcribe'),
        'gpt-transcribe',
        noWarning,
      ),
    ).toBeCloseTo((API_LIMITS.voiceMaxSeconds / 60) * 0.003, 6);
    expect(
      voiceAttemptCostUsd(failure('server_error'), 'gpt-transcribe', noWarning),
    ).toBe(0);
    expect(
      voiceAttemptCostUsd(failure('timeout', 'mock'), 'mock', noWarning),
    ).toBe(0);
  });
});
