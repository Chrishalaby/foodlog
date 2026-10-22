import { API_LIMITS } from '@food/shared';
import type { Transcription } from 'openai/resources/audio/transcriptions';
import type { UnknownModelWarning } from '../ai/ai-usage.recorder.js';
import { computeTranscriptionCostUsd } from '../ai/models.js';
import { type AiTokenUsage, zeroUsage } from '../ai/providers/ai-provider.js';
import { MOCK_MODEL } from '../ai/providers/mock.provider.js';
import type { StructuredAttemptRecord } from '../ai/providers/structured-attempts.js';
import type { VoiceTranscript } from './voice-provider.js';

export const VOICE_TIMEOUT_BILLED_SECONDS = API_LIMITS.voiceMaxSeconds;

export interface VoiceUsage {
  tokens: AiTokenUsage;
  audioSeconds: number | null;
}

function count(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

export function normalizeTranscriptionUsage(
  usage: Transcription['usage'] | null,
): VoiceUsage {
  if (usage?.type === 'tokens') {
    return {
      tokens: {
        ...zeroUsage(),
        inputTokens: count(usage.input_tokens),
        outputTokens: count(usage.output_tokens),
      },
      audioSeconds: null,
    };
  }
  if (usage?.type === 'duration' && Number.isFinite(usage.seconds)) {
    return { tokens: zeroUsage(), audioSeconds: Math.max(0, usage.seconds) };
  }
  return { tokens: zeroUsage(), audioSeconds: null };
}

function pricedOrFree(
  model: string,
  cost: number | null,
  onUnknownModel: UnknownModelWarning,
): number {
  if (cost === null) {
    onUnknownModel(model);
    return 0;
  }
  return cost;
}

export function voiceAttemptCostUsd(
  record: StructuredAttemptRecord<VoiceTranscript>,
  requestedModel: string,
  onUnknownModel: UnknownModelWarning,
): number {
  if (!record.ok) {
    const model = record.error.details.model || requestedModel;
    if (record.error.kind !== 'timeout' || model === MOCK_MODEL) {
      return 0;
    }
    return pricedOrFree(
      model,
      computeTranscriptionCostUsd(model, {
        audioSeconds: VOICE_TIMEOUT_BILLED_SECONDS,
        inputTokens: 0,
        outputTokens: 0,
      }),
      onUnknownModel,
    );
  }
  const model = record.result.model || requestedModel;
  if (model === MOCK_MODEL) {
    return 0;
  }
  return pricedOrFree(
    model,
    computeTranscriptionCostUsd(model, {
      audioSeconds: record.result.raw.audioSeconds,
      inputTokens: record.result.usage.inputTokens,
      outputTokens: record.result.usage.outputTokens,
    }),
    onUnknownModel,
  );
}
