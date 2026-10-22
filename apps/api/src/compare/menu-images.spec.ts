import { VISION_PATCH_BUDGET } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import sharp, { type Sharp } from 'sharp';
import {
  encodeMenuImage,
  encodeMenuImages,
  MENU_IMAGE_ENCODING,
} from './menu-images.js';

function solidImage(width: number, height: number): Sharp {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 240, g: 236, b: 220 },
    },
  });
}

describe('encodeMenuImage', () => {
  it('uses the stored-photo encoding for menus: the vision patch budget with 4:4:4 chroma', () => {
    expect(MENU_IMAGE_ENCODING).toEqual({
      budget: VISION_PATCH_BUDGET,
      chroma: '4:4:4',
    });
  });

  it('fits a large menu photo to the patch budget as a 4:4:4 JPEG', async () => {
    const input = await solidImage(3000, 4000).png().toBuffer();

    const jpeg = await encodeMenuImage(input);

    const meta = await sharp(jpeg).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual([
      'jpeg',
      1344,
      1792,
    ]);
    expect(meta.chromaSubsampling).toBe('4:4:4');
  });

  it('caps a tall 9:16 menu photo at 2048 px', async () => {
    const input = await solidImage(1440, 2560).jpeg().toBuffer();

    const meta = await sharp(await encodeMenuImage(input)).metadata();

    expect([meta.width, meta.height]).toEqual([1152, 2048]);
  });

  it('keeps small photos at their size', async () => {
    const input = await solidImage(900, 600).webp().toBuffer();

    const meta = await sharp(await encodeMenuImage(input)).metadata();

    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 900, 600]);
  });

  it('applies EXIF orientation and strips all metadata', async () => {
    const input = await solidImage(400, 200)
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { Copyright: 'secret-gps-owner' } },
      })
      .toBuffer();

    const jpeg = await encodeMenuImage(input);

    const meta = await sharp(jpeg).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
    expect(jpeg.includes(Buffer.from('secret-gps-owner'))).toBe(false);
  });

  it('encodes several photos in order', async () => {
    const inputs = await Promise.all([
      solidImage(300, 100).jpeg().toBuffer(),
      solidImage(100, 300).png().toBuffer(),
    ]);

    const encoded = await encodeMenuImages(inputs);

    const sizes = await Promise.all(
      encoded.map(async (jpeg) => {
        const meta = await sharp(jpeg).metadata();
        return [meta.width, meta.height];
      }),
    );
    expect(sizes).toEqual([
      [300, 100],
      [100, 300],
    ]);
  });

  it('rejects data that is not an image', async () => {
    await expect(
      encodeMenuImage(Buffer.from('definitely not an image')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects formats other than JPEG, PNG and WebP', async () => {
    const gif = await solidImage(10, 10).gif().toBuffer();

    await expect(encodeMenuImage(gif)).rejects.toThrow(
      'The uploaded file is not a supported image',
    );
  });

  it('rejects images above 50 megapixels', async () => {
    const input = await solidImage(8000, 6300).jpeg({ quality: 10 }).toBuffer();

    await expect(encodeMenuImage(input)).rejects.toThrow('too large');
  });

  it('rejects a truncated JPEG', async () => {
    const input = await solidImage(600, 400).jpeg().toBuffer();

    await expect(
      encodeMenuImage(input.subarray(0, Math.floor(input.length / 2))),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
