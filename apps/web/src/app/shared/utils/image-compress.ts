import {
  VISION_PATCH_BUDGET,
  fitToPatchBudget,
  type AnalysisMode,
  type PatchBudget,
} from '@food/shared';

export interface CompressOptions {
  budget?: PatchBudget;
  quality?: number;
  background?: string;
}

export interface CompressedImage {
  blob: Blob;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceBytes: number;
  bytes: number;
  decoder: 'image-bitmap' | 'image-element';
}

export class ImageDecodeError extends Error {
  constructor(
    readonly file: Blob,
    cause: unknown,
  ) {
    super(`Could not decode image of type "${file.type || 'unknown'}"`, { cause });
    this.name = 'ImageDecodeError';
  }
}

export type CompressPreset = Required<Omit<CompressOptions, 'background'>>;
export type CompressPresetKey = AnalysisMode | 'menu';

export const PHOTO_PRESET: CompressPreset = { budget: VISION_PATCH_BUDGET, quality: 0.88 };

export const COMPRESS_DEFAULTS = {
  ...PHOTO_PRESET,
  background: '#ffffff',
} as const;

export const COMPRESS_PRESETS: Readonly<Record<CompressPresetKey, CompressPreset>> = {
  food_photo: PHOTO_PRESET,
  nutrition_label: PHOTO_PRESET,
  menu: PHOTO_PRESET,
  text: PHOTO_PRESET,
};

type Canvas2D = HTMLCanvasElement | OffscreenCanvas;
type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  decoder: CompressedImage['decoder'];
  release: () => void;
}

export async function compressImage(
  file: Blob,
  options: CompressOptions = {},
): Promise<CompressedImage> {
  const budget = options.budget ?? COMPRESS_DEFAULTS.budget;
  const quality = options.quality ?? COMPRESS_DEFAULTS.quality;
  const background = options.background ?? COMPRESS_DEFAULTS.background;
  const decoded = await decodeImage(file);
  try {
    const target = fitToPatchBudget({ width: decoded.width, height: decoded.height }, budget);
    const canvas = drawDownscaled(decoded, target.width, target.height, background);
    const blob = await encodeJpeg(canvas, quality);
    return {
      blob,
      mimeType: 'image/jpeg',
      width: target.width,
      height: target.height,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      sourceBytes: file.size,
      bytes: blob.size,
      decoder: decoded.decoder,
    };
  } finally {
    decoded.release();
  }
}

async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        decoder: 'image-bitmap',
        release: () => bitmap.close(),
      };
    } catch {
      return decodeWithImageElement(file);
    }
  }
  return decodeWithImageElement(file);
}

async function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw new ImageDecodeError(file, error);
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    decoder: 'image-element',
    release: () => {
      img.src = '';
      URL.revokeObjectURL(url);
    },
  };
}

function createCanvas(width: number, height: number): { canvas: Canvas2D; ctx: Context2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const offscreen = new OffscreenCanvas(width, height);
    const ctx = offscreen.getContext('2d');
    if (ctx) {
      return { canvas: offscreen, ctx };
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('2D canvas context unavailable');
  }
  return { canvas, ctx };
}

function releaseCanvas(canvas: Canvas2D): void {
  canvas.width = 0;
  canvas.height = 0;
}

function drawDownscaled(
  decoded: DecodedImage,
  width: number,
  height: number,
  background: string,
): Canvas2D {
  let source: CanvasImageSource = decoded.source;
  let sourceWidth = decoded.width;
  let sourceHeight = decoded.height;
  let intermediate: Canvas2D | undefined;
  while (sourceWidth / 2 >= width * 1.5 && sourceHeight / 2 >= height * 1.5) {
    const stepWidth = Math.round(sourceWidth / 2);
    const stepHeight = Math.round(sourceHeight / 2);
    const step = createCanvas(stepWidth, stepHeight);
    step.ctx.imageSmoothingEnabled = true;
    step.ctx.imageSmoothingQuality = 'high';
    step.ctx.drawImage(source, 0, 0, stepWidth, stepHeight);
    if (intermediate) {
      releaseCanvas(intermediate);
    }
    intermediate = step.canvas;
    source = step.canvas;
    sourceWidth = stepWidth;
    sourceHeight = stepHeight;
  }
  const output = createCanvas(width, height);
  output.ctx.fillStyle = background;
  output.ctx.fillRect(0, 0, width, height);
  output.ctx.imageSmoothingEnabled = true;
  output.ctx.imageSmoothingQuality = 'high';
  output.ctx.drawImage(source, 0, 0, width, height);
  if (intermediate) {
    releaseCanvas(intermediate);
  }
  return output.canvas;
}

async function encodeJpeg(canvas: Canvas2D, quality: number): Promise<Blob> {
  try {
    if ('convertToBlob' in canvas) {
      return await canvas.convertToBlob({ type: 'image/jpeg', quality });
    }
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
        'image/jpeg',
        quality,
      ),
    );
  } finally {
    releaseCanvas(canvas);
  }
}
