import {
  VISION_MAX_PATCHES,
  VISION_MAX_SIDE_PX,
  VISION_PATCH_BUDGET,
  patchCount,
} from '@food/shared';
import { COMPRESS_DEFAULTS, COMPRESS_PRESETS, PHOTO_PRESET, compressImage } from './image-compress';

describe('COMPRESS_PRESETS', () => {
  it('sizes food, label and menu photos to the vision patch budget at quality 0.88', () => {
    for (const preset of [
      COMPRESS_PRESETS.food_photo,
      COMPRESS_PRESETS.nutrition_label,
      COMPRESS_PRESETS.menu,
    ]) {
      expect(preset).toBe(PHOTO_PRESET);
    }
    expect(PHOTO_PRESET).toEqual({ budget: VISION_PATCH_BUDGET, quality: 0.88 });
  });

  it('defaults to the shared photo preset when no options are given', () => {
    expect(COMPRESS_DEFAULTS.budget).toBe(VISION_PATCH_BUDGET);
    expect(COMPRESS_DEFAULTS.quality).toBe(0.88);
  });
});

describe('compressImage', () => {
  interface Drawn {
    width: number;
    height: number;
  }

  const drawn: Drawn[] = [];
  const encoded: { type: string; quality: number; width: number; height: number }[] = [];
  const bitmapOptions: unknown[] = [];
  let closed = 0;
  let decodedSize = { width: 3024, height: 4032 };

  class FakeOffscreenCanvas {
    constructor(
      public width: number,
      public height: number,
    ) {}

    getContext(): unknown {
      return {
        fillStyle: '',
        imageSmoothingEnabled: false,
        imageSmoothingQuality: 'low',
        fillRect: () => undefined,
        drawImage: (_source: unknown, _x: number, _y: number, width: number, height: number) =>
          drawn.push({ width, height }),
      };
    }

    async convertToBlob(options: { type: string; quality: number }): Promise<Blob> {
      encoded.push({ ...options, width: this.width, height: this.height });
      return new Blob(['x'.repeat(10)], { type: options.type });
    }
  }

  beforeEach(() => {
    drawn.length = 0;
    encoded.length = 0;
    bitmapOptions.length = 0;
    closed = 0;
    decodedSize = { width: 3024, height: 4032 };
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async (_file: Blob, options: unknown) => {
        bitmapOptions.push(options);
        return {
          ...decodedSize,
          close: () => {
            closed += 1;
          },
        };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sizes a 12 MP portrait photo to the full patch budget and encodes it at 0.88', async () => {
    const source = new Blob(['raw photo bytes'], { type: 'image/heic' });
    const result = await compressImage(source, COMPRESS_PRESETS.food_photo);

    expect(bitmapOptions).toEqual([{ imageOrientation: 'from-image' }]);
    expect(result).toMatchObject({
      mimeType: 'image/jpeg',
      width: 1344,
      height: 1792,
      sourceWidth: 3024,
      sourceHeight: 4032,
      sourceBytes: source.size,
      decoder: 'image-bitmap',
    });
    expect(patchCount(result)).toBeLessThanOrEqual(VISION_MAX_PATCHES);
    expect(encoded).toEqual([{ type: 'image/jpeg', quality: 0.88, width: 1344, height: 1792 }]);
    expect(drawn.at(-1)).toEqual({ width: 1344, height: 1792 });
    expect(closed).toBe(1);
  });

  it('gives labels and menus exactly the same detail as food photos', async () => {
    decodedSize = { width: 4032, height: 3024 };
    const label = await compressImage(new Blob(['label']), COMPRESS_PRESETS.nutrition_label);
    const menu = await compressImage(new Blob(['menu']), COMPRESS_PRESETS.menu);

    expect([label.width, label.height]).toEqual([1792, 1344]);
    expect([menu.width, menu.height]).toEqual([1792, 1344]);
    expect(encoded.map(({ quality }) => quality)).toEqual([0.88, 0.88]);
  });

  it('keeps a 1080×1920 screenshot untouched because it already fits the budget', async () => {
    decodedSize = { width: 1080, height: 1920 };
    const result = await compressImage(new Blob(['story']), COMPRESS_PRESETS.food_photo);

    expect([result.width, result.height]).toEqual([1080, 1920]);
    expect(drawn).toEqual([{ width: 1080, height: 1920 }]);
  });

  it('caps a very tall photo at the long-side limit', async () => {
    decodedSize = { width: 1200, height: 4000 };
    const result = await compressImage(new Blob(['receipt']), COMPRESS_PRESETS.nutrition_label);

    expect(result.height).toBe(VISION_MAX_SIDE_PX);
    expect(result.width).toBe(614);
    expect(patchCount(result)).toBeLessThanOrEqual(VISION_MAX_PATCHES);
  });

  it('uses the shared preset when called without options', async () => {
    const result = await compressImage(new Blob(['photo']));

    expect([result.width, result.height]).toEqual([1344, 1792]);
    expect(encoded.at(-1)?.quality).toBe(0.88);
  });

  it('honours a custom patch budget', async () => {
    const result = await compressImage(new Blob(['photo']), {
      budget: { patchPx: 32, maxPatches: 100, maxSidePx: 2048 },
      quality: 0.5,
    });

    expect(patchCount(result)).toBeLessThanOrEqual(100);
    expect(encoded.at(-1)?.quality).toBe(0.5);
  });
});
