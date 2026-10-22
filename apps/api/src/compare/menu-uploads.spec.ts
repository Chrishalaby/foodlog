import { BadRequestException } from '@nestjs/common';
import {
  collectMenuImages,
  MENU_PHOTO_REQUIRED_MESSAGE,
} from './menu-uploads.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

function file(buffer: Buffer): { buffer: Buffer; size: number } {
  return { buffer, size: buffer.length };
}

function messageOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).message;
  }
  throw new Error('expected a BadRequestException');
}

describe('collectMenuImages', () => {
  it('returns the buffers of one to three images in order', () => {
    expect(collectMenuImages([file(JPEG)])).toEqual([JPEG]);
    expect(collectMenuImages([file(JPEG), file(PNG), file(JPEG)])).toEqual([
      JPEG,
      PNG,
      JPEG,
    ]);
  });

  it('requires at least one photo', () => {
    expect(messageOf(() => collectMenuImages(undefined))).toBe(
      MENU_PHOTO_REQUIRED_MESSAGE,
    );
    expect(messageOf(() => collectMenuImages([]))).toBe(
      MENU_PHOTO_REQUIRED_MESSAGE,
    );
  });

  it('accepts at most three photos', () => {
    expect(
      messageOf(() =>
        collectMenuImages([file(JPEG), file(JPEG), file(JPEG), file(JPEG)]),
      ),
    ).toBe('Attach at most 3 photos of the menu');
  });

  it('rejects empty files and unsupported types by their bytes', () => {
    expect(messageOf(() => collectMenuImages([file(Buffer.alloc(0))]))).toBe(
      'The uploaded image is empty',
    );
    expect(
      messageOf(() =>
        collectMenuImages([file(JPEG), file(Buffer.from('GIF89a-not-really'))]),
      ),
    ).toBe('Unsupported image type — upload a JPEG, PNG or WebP photo');
  });
});
