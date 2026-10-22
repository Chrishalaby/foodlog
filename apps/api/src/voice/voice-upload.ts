import { BadRequestException } from '@nestjs/common';
import type { VoiceAudio } from './voice-provider.js';

export const VOICE_AUDIO_FIELD = 'audio';
export const VOICE_AUDIO_REQUIRED_MESSAGE = 'Record something to transcribe';
export const VOICE_AUDIO_TYPE_MESSAGE =
  'Unsupported audio type — record again or type your description';

export type UploadedAudio = Pick<
  Express.Multer.File,
  'buffer' | 'size' | 'mimetype'
>;

const VIDEO_CONTAINER_TYPES: ReadonlyMap<string, string> = new Map([
  ['video/mp4', 'audio/mp4'],
  ['video/webm', 'audio/webm'],
]);

const EXTENSIONS: readonly (readonly [string, string])[] = [
  ['mp4', 'm4a'],
  ['m4a', 'm4a'],
  ['aac', 'm4a'],
  ['webm', 'webm'],
  ['ogg', 'ogg'],
  ['wav', 'wav'],
  ['mpeg', 'mp3'],
  ['mp3', 'mp3'],
  ['flac', 'flac'],
];

const DEFAULT_EXTENSION = 'webm';

export function voiceMimeType(value: string | undefined): string | null {
  const base = (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return (
    VIDEO_CONTAINER_TYPES.get(base) ??
    (/^audio\/[a-z0-9.+-]+$/.test(base) ? base : null)
  );
}

export function voiceFilename(mimeType: string): string {
  const match = EXTENSIONS.find(([token]) => mimeType.includes(token));
  return `voice.${match?.[1] ?? DEFAULT_EXTENSION}`;
}

export function acceptVoiceUpload(file: UploadedAudio | undefined): VoiceAudio {
  if (!file || file.size === 0 || file.buffer.length === 0) {
    throw new BadRequestException(VOICE_AUDIO_REQUIRED_MESSAGE);
  }
  const mimeType = voiceMimeType(file.mimetype);
  if (!mimeType) {
    throw new BadRequestException(VOICE_AUDIO_TYPE_MESSAGE);
  }
  return {
    buffer: file.buffer,
    filename: voiceFilename(mimeType),
    mimeType,
  };
}
