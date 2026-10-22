import type { ImageDetail } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import sharp, { type Metadata } from 'sharp';
import {
  encodeJpeg,
  MAX_INPUT_PIXELS,
  PHOTO_ENCODINGS,
} from '../photos/photo-processing.js';

export const MENU_IMAGE_ENCODING = PHOTO_ENCODINGS.menu;
export const MENU_IMAGE_DETAIL: ImageDetail = 'high';

const SUPPORTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

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

export async function encodeMenuImage(input: Buffer): Promise<Buffer> {
  const metadata = await readMetadata(input);
  assertAcceptable(metadata);
  const { data } = await encodeJpeg(input, metadata, MENU_IMAGE_ENCODING);
  return data;
}

export function encodeMenuImages(inputs: readonly Buffer[]): Promise<Buffer[]> {
  return Promise.all(inputs.map((input) => encodeMenuImage(input)));
}
