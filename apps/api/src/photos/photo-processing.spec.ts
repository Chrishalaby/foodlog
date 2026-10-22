import {
  fitToPatchBudget,
  patchCount,
  VISION_MAX_PATCHES,
  VISION_PATCH_BUDGET,
} from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import sharp, { type Sharp } from 'sharp';
import {
  type ChromaSubsampling,
  encodedSize,
  JPEG_QUALITY,
  PHOTO_ENCODINGS,
  processPhoto,
  resolvePhotoEncoding,
} from './photo-processing.js';

function solidImage(width: number, height: number): Sharp {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  });
}

function noisyImage(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 128, g: 128, b: 128 },
      noise: { type: 'gaussian', mean: 128, sigma: 40 },
    },
  })
    .png()
    .toBuffer();
}

function referenceJpeg(
  input: Buffer,
  width: number,
  height: number,
  quality: number,
  chroma: ChromaSubsampling,
): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: chroma })
    .toBuffer();
}

async function jpegInfo(buffer: Buffer) {
  const meta = await sharp(buffer).metadata();
  return {
    format: meta.format,
    width: meta.width,
    height: meta.height,
    chroma: meta.chromaSubsampling,
  };
}

describe('photo encodings', () => {
  it('sizes food, labels and menus to the vision patch budget, with full chroma for text', () => {
    expect(PHOTO_ENCODINGS).toEqual({
      food: { budget: VISION_PATCH_BUDGET, chroma: '4:2:0' },
      label: { budget: VISION_PATCH_BUDGET, chroma: '4:4:4' },
      menu: { budget: VISION_PATCH_BUDGET, chroma: '4:4:4' },
    });
    expect(JPEG_QUALITY).toBe(85);
  });

  it('resolves a role or an explicit size', () => {
    expect(resolvePhotoEncoding({ role: 'label' })).toEqual({
      budget: VISION_PATCH_BUDGET,
      chroma: '4:4:4',
    });
    expect(resolvePhotoEncoding({ maxDimension: 640 })).toEqual({
      budget: {
        patchPx: 32,
        maxPatches: Number.POSITIVE_INFINITY,
        maxSidePx: 640,
      },
      chroma: '4:2:0',
    });
    expect(
      resolvePhotoEncoding({ maxDimension: 900, chroma: '4:4:4' }).chroma,
    ).toBe('4:4:4');
  });

  it.each([
    ['12 MP 3:4 portrait', 3024, 4032, 1344, 1792],
    ['12 MP 4:3 landscape', 4032, 3024, 1792, 1344],
    ['9:16 portrait', 1440, 2560, 1152, 2048],
    ['3:2 landscape', 3000, 2000, 1920, 1280],
    ['panorama', 5000, 1000, 2048, 410],
    ['photo already inside the budget', 1080, 1920, 1080, 1920],
  ] as const)(
    'fits a %s photo to the patch budget',
    (_name, width, height, fittedWidth, fittedHeight) => {
      const size = encodedSize({ width, height }, PHOTO_ENCODINGS.food);

      expect(size).toEqual({ width: fittedWidth, height: fittedHeight });
      expect(size).toEqual(fitToPatchBudget({ width, height }));
      expect(patchCount(size)).toBeLessThanOrEqual(VISION_MAX_PATCHES);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(2048);
    },
  );

  it('caps only the long side for an explicit size', () => {
    expect(
      encodedSize(
        { width: 3000, height: 2000 },
        resolvePhotoEncoding({ maxDimension: 1024 }),
      ),
    ).toEqual({ width: 1024, height: 683 });
  });
});

describe('processPhoto', () => {
  it.each([
    ['portrait food', 3024, 4032, 'food', [1344, 1792], '4:2:0'],
    ['landscape food', 4032, 3024, 'food', [1792, 1344], '4:2:0'],
    ['portrait label', 3024, 4032, 'label', [1344, 1792], '4:4:4'],
    ['landscape label', 4032, 3024, 'label', [1792, 1344], '4:4:4'],
    ['9:16 food', 1440, 2560, 'food', [1152, 2048], '4:2:0'],
    ['landscape menu', 4000, 2000, 'menu', [2048, 1024], '4:4:4'],
  ] as const)(
    'fits a %s photo to the vision patch budget',
    async (_name, width, height, role, size, chroma) => {
      const input = await solidImage(width, height).jpeg().toBuffer();

      const result = await processPhoto(input, { role });

      expect([result.width, result.height]).toEqual(size);
      expect(
        patchCount({ width: result.width, height: result.height }),
      ).toBeLessThanOrEqual(VISION_MAX_PATCHES);
      await expect(jpegInfo(result.full)).resolves.toEqual({
        format: 'jpeg',
        width: size[0],
        height: size[1],
        chroma,
      });
      const thumb = await sharp(result.thumb).metadata();
      expect(thumb.format).toBe('webp');
      expect(Math.max(thumb.width, thumb.height)).toBe(320);
    },
  );

  it('keeps a portrait phone photo that already fits the budget at full size', async () => {
    const input = await solidImage(1080, 1920).jpeg().toBuffer();

    const result = await processPhoto(input, { role: 'food' });

    expect([result.width, result.height]).toEqual([1080, 1920]);
  });

  it('leaves a photo that the device already fitted to the budget at its size', async () => {
    const input = await solidImage(1344, 1792).jpeg({ quality: 88 }).toBuffer();

    const result = await processPhoto(input, { role: 'label' });

    expect([result.width, result.height]).toEqual([1344, 1792]);
  });

  it('encodes with mozjpeg at quality 85', async () => {
    const input = await noisyImage(900, 1400);

    const food = await processPhoto(input, { role: 'food' });
    const label = await processPhoto(input, { role: 'label' });

    expect(
      food.full.equals(await referenceJpeg(input, 900, 1400, 85, '4:2:0')),
    ).toBe(true);
    expect(
      food.full.equals(await referenceJpeg(input, 900, 1400, 80, '4:2:0')),
    ).toBe(false);
    expect(
      label.full.equals(await referenceJpeg(input, 900, 1400, 85, '4:4:4')),
    ).toBe(true);
    expect(label.full.length).toBeGreaterThan(food.full.length);
  });

  it('still honours an explicit maximum dimension', async () => {
    const input = await solidImage(3000, 2000).png().toBuffer();

    const result = await processPhoto(input, { maxDimension: 1024 });

    expect([result.width, result.height]).toEqual([1024, 683]);
    const full = await sharp(result.full).metadata();
    expect([full.format, full.width, full.height]).toEqual(['jpeg', 1024, 683]);
    const thumb = await sharp(result.thumb).metadata();
    expect([thumb.format, thumb.width, thumb.height]).toEqual([
      'webp',
      320,
      213,
    ]);
  });

  it('does not enlarge small images', async () => {
    const input = await solidImage(200, 100).jpeg().toBuffer();

    const result = await processPhoto(input, { role: 'label' });

    expect([result.width, result.height]).toEqual([200, 100]);
    const thumb = await sharp(result.thumb).metadata();
    expect([thumb.width, thumb.height]).toEqual([200, 100]);
  });

  it('applies EXIF orientation and strips metadata', async () => {
    const input = await solidImage(400, 200)
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { Copyright: 'secret-gps-owner' } },
      })
      .toBuffer();

    const result = await processPhoto(input, { role: 'food' });

    expect([result.width, result.height]).toEqual([200, 400]);
    const full = await sharp(result.full).metadata();
    expect(full.exif).toBeUndefined();
    expect(full.orientation).toBeUndefined();
    expect(result.full.includes(Buffer.from('secret-gps-owner'))).toBe(false);
  });

  it('rotates a sideways portrait before fitting it', async () => {
    const input = await solidImage(4032, 3024)
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();

    const result = await processPhoto(input, { role: 'food' });

    expect([result.width, result.height]).toEqual([1344, 1792]);
  });

  it('rejects data that is not an image', async () => {
    await expect(
      processPhoto(Buffer.from('definitely not an image'), { role: 'food' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unsupported formats such as SVG', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
    );
    await expect(processPhoto(svg, { role: 'food' })).rejects.toThrow(
      'not a supported image',
    );
  });

  it('rejects images above 50 megapixels', async () => {
    const input = await solidImage(8000, 6300).jpeg({ quality: 10 }).toBuffer();

    await expect(processPhoto(input, { role: 'label' })).rejects.toThrow(
      'too large',
    );
  });
});
