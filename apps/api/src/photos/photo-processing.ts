import {
  fitToPatchBudget,
  type ImageRole,
  type ImageSize,
  type PatchBudget,
  VISION_PATCH_BUDGET,
} from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';

export type PhotoRole = ImageRole | 'menu';

export type ChromaSubsampling = '4:2:0' | '4:4:4';

export interface PhotoEncoding {
  budget: PatchBudget;
  chroma: ChromaSubsampling;
}

export type PhotoEncodingOptions =
  { role: PhotoRole } | { maxDimension: number; chroma?: ChromaSubsampling };

export interface EncodedJpeg {
  data: Buffer;
  width: number;
  height: number;
}

export const MAX_INPUT_PIXELS = 50_000_000;
export const THUMB_MAX_DIMENSION = 320;
export const JPEG_QUALITY = 85;
export const THUMB_QUALITY = 70;

export const PHOTO_ENCODINGS: Readonly<Record<PhotoRole, PhotoEncoding>> = {
  food: { budget: VISION_PATCH_BUDGET, chroma: '4:2:0' },
  label: { budget: VISION_PATCH_BUDGET, chroma: '4:4:4' },
  menu: { budget: VISION_PATCH_BUDGET, chroma: '4:4:4' },
};

const SUPPORTED_FORMATS = new Set([
  'jpeg',
  'png',
  'webp',
  'heif',
  'gif',
  'tiff',
]);

export interface ProcessedPhoto {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
}

export function resolvePhotoEncoding(
  options: PhotoEncodingOptions,
): PhotoEncoding {
  if ('role' in options) {
    return PHOTO_ENCODINGS[options.role];
  }
  return {
    budget: {
      ...VISION_PATCH_BUDGET,
      maxPatches: Number.POSITIVE_INFINITY,
      maxSidePx: options.maxDimension,
    },
    chroma: options.chroma ?? PHOTO_ENCODINGS.food.chroma,
  };
}

export function orientedSize(metadata: Metadata): ImageSize {
  return {
    width: metadata.autoOrient.width,
    height: metadata.autoOrient.height,
  };
}

export function encodedSize(
  size: ImageSize,
  encoding: PhotoEncoding,
): ImageSize {
  return fitToPatchBudget(size, encoding.budget);
}

async function readMetadata(input: Buffer): Promise<Metadata> {
  try {
    return await sharp(input).metadata();
  } catch {
    throw new BadRequestException('The uploaded file is not a supported image');
  }
}

function assertAcceptable(metadata: Metadata): void {
  if (!metadata.format || !SUPPORTED_FORMATS.has(metadata.format)) {
    throw new BadRequestException('The uploaded file is not a supported image');
  }
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    throw new BadRequestException(
      `The image is too large (max ${MAX_INPUT_PIXELS / 1_000_000} megapixels)`,
    );
  }
}

export async function encodeJpeg(
  input: Buffer,
  metadata: Metadata,
  encoding: PhotoEncoding,
): Promise<EncodedJpeg> {
  const target = encodedSize(orientedSize(metadata), encoding);
  try {
    const { data, info } = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: 'error',
    })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({
        width: target.width,
        height: target.height,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: JPEG_QUALITY,
        mozjpeg: true,
        chromaSubsampling: encoding.chroma,
      })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch {
    throw new BadRequestException('The uploaded image could not be processed');
  }
}

function encodeThumb(full: Buffer): Promise<Buffer> {
  return sharp(full)
    .resize({
      width: THUMB_MAX_DIMENSION,
      height: THUMB_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
}

export async function processPhoto(
  input: Buffer,
  options: PhotoEncodingOptions,
): Promise<ProcessedPhoto> {
  const metadata = await readMetadata(input);
  assertAcceptable(metadata);
  const full = await encodeJpeg(input, metadata, resolvePhotoEncoding(options));
  const thumb = await encodeThumb(full.data);
  return { full: full.data, thumb, width: full.width, height: full.height };
}
