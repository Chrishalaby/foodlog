import { BadRequestException } from '@nestjs/common';
import {
  acceptVoiceUpload,
  type UploadedAudio,
  VOICE_AUDIO_REQUIRED_MESSAGE,
  VOICE_AUDIO_TYPE_MESSAGE,
  voiceFilename,
  voiceMimeType,
} from './voice-upload.js';

function upload(mimetype: string, bytes = 2048): UploadedAudio {
  return { buffer: Buffer.alloc(bytes, 1), size: bytes, mimetype };
}

describe('voiceMimeType', () => {
  it.each([
    ['audio/webm;codecs=opus', 'audio/webm'],
    ['audio/webm', 'audio/webm'],
    ['audio/mp4', 'audio/mp4'],
    ['AUDIO/MP4; codecs=mp4a.40.2', 'audio/mp4'],
    ['audio/x-m4a', 'audio/x-m4a'],
    ['audio/ogg; codecs=opus', 'audio/ogg'],
    ['audio/wav', 'audio/wav'],
    ['video/mp4', 'audio/mp4'],
    ['video/webm;codecs=opus', 'audio/webm'],
  ])('accepts %s as %s', (mimetype, expected) => {
    expect(voiceMimeType(mimetype)).toBe(expected);
  });

  it.each([
    'image/jpeg',
    'video/quicktime',
    'application/octet-stream',
    'text/plain',
    'audio/',
    'audio',
    'constructor',
    '__proto__',
    '',
  ])('rejects %s', (mimetype) => {
    expect(voiceMimeType(mimetype)).toBeNull();
  });

  it('rejects a missing type', () => {
    expect(voiceMimeType(undefined)).toBeNull();
  });
});

describe('voiceFilename', () => {
  it.each([
    ['audio/mp4', 'voice.m4a'],
    ['audio/x-m4a', 'voice.m4a'],
    ['audio/aac', 'voice.m4a'],
    ['audio/webm', 'voice.webm'],
    ['audio/ogg', 'voice.ogg'],
    ['audio/wav', 'voice.wav'],
    ['audio/mpeg', 'voice.mp3'],
    ['audio/flac', 'voice.flac'],
    ['audio/unknown', 'voice.webm'],
  ])('names %s %s', (mimeType, filename) => {
    expect(voiceFilename(mimeType)).toBe(filename);
  });
});

describe('acceptVoiceUpload', () => {
  it('returns the audio with a server-chosen filename and a normalized type', () => {
    const file = upload('video/mp4');

    expect(acceptVoiceUpload(file)).toEqual({
      buffer: file.buffer,
      filename: 'voice.m4a',
      mimeType: 'audio/mp4',
    });
    expect(acceptVoiceUpload(upload('audio/webm;codecs=opus'))).toMatchObject({
      filename: 'voice.webm',
      mimeType: 'audio/webm',
    });
  });

  it('rejects a missing or empty recording', () => {
    for (const file of [undefined, upload('audio/webm', 0)]) {
      const error = (() => {
        try {
          acceptVoiceUpload(file);
          return null;
        } catch (caught) {
          return caught;
        }
      })();
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).message).toBe(
        VOICE_AUDIO_REQUIRED_MESSAGE,
      );
    }
  });

  it('rejects files that are not audio', () => {
    expect(() => acceptVoiceUpload(upload('image/jpeg'))).toThrow(
      VOICE_AUDIO_TYPE_MESSAGE,
    );
    expect(() => acceptVoiceUpload(upload('video/quicktime'))).toThrow(
      BadRequestException,
    );
  });
});
