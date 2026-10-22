import type { AiStructuredResult } from '../ai/providers/ai-provider.js';

export const VOICE_AI_PROVIDER = Symbol('VOICE_AI_PROVIDER');

export interface VoiceAudio {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export interface VoiceTranscript {
  text: string;
  audioSeconds: number | null;
}

export interface VoiceTranscribeRequest {
  model: string;
  audio: VoiceAudio;
  vocabulary: readonly string[];
  location?: string | null;
}

export type VoiceTranscribeResult = AiStructuredResult<VoiceTranscript>;

export interface VoiceAiProvider {
  readonly name: 'openai' | 'mock';
  transcribe(request: VoiceTranscribeRequest): Promise<VoiceTranscribeResult>;
}
