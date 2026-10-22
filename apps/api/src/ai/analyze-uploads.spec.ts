import { BadRequestException } from '@nestjs/common';
import {
  type AnalyzeUploadFiles,
  collectAnalyzeUploads,
  parseImageRoles,
} from './analyze-uploads.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF = Buffer.from('GIF89a');

function file(buffer: Buffer) {
  return { buffer, size: buffer.length };
}

function rolesOf(files: AnalyzeUploadFiles, imageRoles?: string) {
  return collectAnalyzeUploads(files, imageRoles).map(({ field, role }) => [
    field,
    role,
  ]);
}

describe('parseImageRoles', () => {
  it('parses a comma list of food and label, ignoring spaces', () => {
    expect(parseImageRoles('food,label')).toEqual(['food', 'label']);
    expect(parseImageRoles(' label , food ')).toEqual(['label', 'food']);
    expect(parseImageRoles('   ')).toEqual([]);
  });

  it.each([['menu'], ['food,'], ['food;label'], ['FOOD'], [42], [null]])(
    'rejects %s',
    (value) => {
      expect(parseImageRoles(value)).toBeNull();
    },
  );

  it('rejects oversized values', () => {
    expect(parseImageRoles(Array(20).fill('food').join(','))).toBeNull();
  });
});

describe('collectAnalyzeUploads', () => {
  it('returns nothing without files', () => {
    expect(collectAnalyzeUploads(undefined, undefined)).toEqual([]);
    expect(collectAnalyzeUploads({}, '')).toEqual([]);
  });

  it('puts the legacy image first and leaves unspecified roles to the plan', () => {
    const uploads = collectAnalyzeUploads(
      { image: [file(JPEG)], images: [file(PNG)] },
      undefined,
    );
    expect(uploads).toEqual([
      { field: 'image', role: null, buffer: JPEG },
      { field: 'images', role: null, buffer: PNG },
    ]);
  });

  it('aligns the requested roles with the images list', () => {
    expect(
      rolesOf(
        { images: [file(JPEG), file(PNG), file(JPEG)] },
        'food,label,label',
      ),
    ).toEqual([
      ['images', 'food'],
      ['images', 'label'],
      ['images', 'label'],
    ]);
    expect(
      rolesOf({ image: [file(JPEG)], images: [file(PNG)] }, 'label'),
    ).toEqual([
      ['image', null],
      ['images', 'label'],
    ]);
  });

  it('rejects roles that do not match the number of images', () => {
    expect(() =>
      collectAnalyzeUploads({ images: [file(JPEG)] }, 'food,label'),
    ).toThrow('imageRoles lists 2 role(s) for 1 image(s)');
    expect(() =>
      collectAnalyzeUploads({ image: [file(JPEG)] }, 'label'),
    ).toThrow(BadRequestException);
    expect(() => collectAnalyzeUploads(undefined, 'food')).toThrow(
      BadRequestException,
    );
    expect(() =>
      collectAnalyzeUploads({ images: [file(JPEG)] }, 'drink'),
    ).toThrow('imageRoles must be a comma-separated list of food or label');
  });

  it('rejects unsupported files and more than three photos', () => {
    expect(() =>
      collectAnalyzeUploads({ images: [file(JPEG), file(GIF)] }, undefined),
    ).toThrow('Unsupported image type');
    expect(() =>
      collectAnalyzeUploads(
        { image: [file(JPEG)], images: [file(JPEG), file(PNG), file(JPEG)] },
        undefined,
      ),
    ).toThrow('Attach at most 3 photos per analysis');
  });
});
