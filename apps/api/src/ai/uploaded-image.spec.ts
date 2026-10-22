import { BadRequestException } from '@nestjs/common';
import {
  acceptUploadedImage,
  detectImageType,
  toJpegDataUrl,
} from './uploaded-image.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x24, 0x00, 0x00, 0x00]),
  Buffer.from('WEBPVP8 '),
]);
const GIF = Buffer.from('GIF89a');

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their magic bytes', () => {
    expect(detectImageType(JPEG)).toBe('jpeg');
    expect(detectImageType(PNG)).toBe('png');
    expect(detectImageType(WEBP)).toBe('webp');
  });

  it('rejects anything else', () => {
    expect(detectImageType(GIF)).toBeNull();
    expect(detectImageType(Buffer.from('RIFF1234WAVE'))).toBeNull();
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('acceptUploadedImage', () => {
  it('passes through supported images', () => {
    expect(acceptUploadedImage({ buffer: JPEG, size: JPEG.length })).toBe(JPEG);
    expect(acceptUploadedImage({ buffer: PNG, size: PNG.length })).toBe(PNG);
  });

  it('rejects empty and unsupported uploads with 400', () => {
    expect(() =>
      acceptUploadedImage({ buffer: Buffer.alloc(0), size: 0 }),
    ).toThrow(BadRequestException);
    expect(() =>
      acceptUploadedImage({ buffer: GIF, size: GIF.length }),
    ).toThrow('Unsupported image type — upload a JPEG, PNG or WebP photo');
  });
});

describe('toJpegDataUrl', () => {
  it('encodes the stored JPEG as a base64 data URL', () => {
    expect(toJpegDataUrl(JPEG)).toBe('data:image/jpeg;base64,/9j/4AAQ');
  });
});
