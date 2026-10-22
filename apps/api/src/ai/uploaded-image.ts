import { BadRequestException } from '@nestjs/common';

export type ImageType = 'jpeg' | 'png' | 'webp';

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIGNATURE = [0x52, 0x49, 0x46, 0x46];
const WEBP_SIGNATURE = [0x57, 0x45, 0x42, 0x50];
const WEBP_SIGNATURE_OFFSET = 8;

function startsWith(buffer: Buffer, signature: number[], offset = 0): boolean {
  return (
    buffer.length >= offset + signature.length &&
    signature.every((byte, index) => buffer[offset + index] === byte)
  );
}

export function detectImageType(buffer: Buffer): ImageType | null {
  if (startsWith(buffer, JPEG_SIGNATURE)) {
    return 'jpeg';
  }
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return 'png';
  }
  if (
    startsWith(buffer, RIFF_SIGNATURE) &&
    startsWith(buffer, WEBP_SIGNATURE, WEBP_SIGNATURE_OFFSET)
  ) {
    return 'webp';
  }
  return null;
}

export function acceptUploadedImage(
  file: Pick<Express.Multer.File, 'buffer' | 'size'>,
): Buffer {
  if (file.size === 0 || file.buffer.length === 0) {
    throw new BadRequestException('The uploaded image is empty');
  }
  if (!detectImageType(file.buffer)) {
    throw new BadRequestException(
      'Unsupported image type — upload a JPEG, PNG or WebP photo',
    );
  }
  return file.buffer;
}

export function toJpegDataUrl(jpeg: Buffer): string {
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}
