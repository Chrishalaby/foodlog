import { API_LIMITS } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import {
  collectNoteUploads,
  TOO_MANY_NOTE_PHOTOS_MESSAGE,
} from './note-uploads.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const WEBP = Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1');
const GIF = Buffer.from('GIF89a');

function file(buffer: Buffer) {
  return { buffer, size: buffer.length };
}

describe('collectNoteUploads', () => {
  it('returns nothing without files', () => {
    expect(collectNoteUploads(undefined)).toEqual([]);
    expect(collectNoteUploads({})).toEqual([]);
    expect(collectNoteUploads({ images: [] })).toEqual([]);
  });

  it('keeps the images in upload order', () => {
    expect(
      collectNoteUploads({ images: [file(PNG), file(JPEG), file(WEBP)] }),
    ).toEqual([PNG, JPEG, WEBP]);
  });

  it('accepts as many photos as a note may hold', () => {
    const images = Array.from({ length: API_LIMITS.notePhotosMax }, () =>
      file(JPEG),
    );

    expect(collectNoteUploads({ images })).toHaveLength(
      API_LIMITS.notePhotosMax,
    );
  });

  it('rejects more photos than a note may hold', () => {
    const images = Array.from({ length: API_LIMITS.notePhotosMax + 1 }, () =>
      file(JPEG),
    );

    expect(() => collectNoteUploads({ images })).toThrow(
      new BadRequestException(TOO_MANY_NOTE_PHOTOS_MESSAGE),
    );
  });

  it('rejects an empty upload', () => {
    expect(() =>
      collectNoteUploads({ images: [file(Buffer.alloc(0))] }),
    ).toThrow(new BadRequestException('The uploaded image is empty'));
  });

  it('rejects files that are not a JPEG, PNG or WebP image', () => {
    expect(() =>
      collectNoteUploads({ images: [file(JPEG), file(GIF)] }),
    ).toThrow(
      new BadRequestException(
        'Unsupported image type — upload a JPEG, PNG or WebP photo',
      ),
    );
  });
});
