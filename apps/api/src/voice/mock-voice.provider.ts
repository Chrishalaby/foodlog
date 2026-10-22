import { setTimeout as sleep } from 'node:timers/promises';
import { zeroUsage } from '../ai/providers/ai-provider.js';
import { MOCK_MODEL } from '../ai/providers/mock.provider.js';
import { buildVoicePrompt } from './voice-prompt.js';
import type {
  VoiceAiProvider,
  VoiceTranscribeRequest,
  VoiceTranscribeResult,
} from './voice-provider.js';

export const MOCK_TRANSCRIPT =
  'For breakfast I had 2 scrambled eggs with toast, and for lunch a chicken shawarma wrap with fries';
export const MOCK_VOICE_LATENCY_MS = 400;

export interface MockVoiceOptions {
  latencyMs: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export class MockVoiceProvider implements VoiceAiProvider {
  readonly name = 'mock';

  constructor(private readonly options: MockVoiceOptions) {}

  async transcribe(
    request: VoiceTranscribeRequest,
  ): Promise<VoiceTranscribeResult> {
    if (this.options.latencyMs > 0) {
      await sleep(this.options.latencyMs);
    }
    return {
      raw: { text: MOCK_TRANSCRIPT, audioSeconds: null },
      usage: {
        ...zeroUsage(),
        inputTokens: estimateTokens(buildVoicePrompt(request.vocabulary)),
        outputTokens: estimateTokens(MOCK_TRANSCRIPT),
      },
      model: MOCK_MODEL,
      requestId: null,
      latencyMs: this.options.latencyMs,
      serviceTier: null,
    };
  }
}
