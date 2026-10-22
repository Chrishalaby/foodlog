import { API_LIMITS, IMAGE_ROLES, type ImageRole } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import { type ImageUploadSpec, isImageRole } from './analysis-plan.js';
import { acceptUploadedImage } from './uploaded-image.js';

export const IMAGE_ROLES_MAX_LENGTH = 64;

export type UploadedFile = Pick<Express.Multer.File, 'buffer' | 'size'>;

export interface AnalyzeUploadFiles {
  image?: UploadedFile[];
  images?: UploadedFile[];
}

export interface AnalyzeUpload extends ImageUploadSpec {
  buffer: Buffer;
}

export function parseImageRoles(value: unknown): ImageRole[] | null {
  if (typeof value !== 'string' || value.length > IMAGE_ROLES_MAX_LENGTH) {
    return null;
  }
  if (!value.trim()) {
    return [];
  }
  const roles = value.split(',').map((role) => role.trim());
  return roles.every(isImageRole) ? roles : null;
}

function requestedRoles(
  imageRoles: string | undefined,
  imageCount: number,
): (ImageRole | null)[] {
  const roles = parseImageRoles(imageRoles ?? '');
  if (!roles) {
    throw new BadRequestException(
      `imageRoles must be a comma-separated list of ${IMAGE_ROLES.join(' or ')}`,
    );
  }
  if (roles.length === 0) {
    return Array.from({ length: imageCount }, () => null);
  }
  if (roles.length !== imageCount) {
    throw new BadRequestException(
      `imageRoles lists ${roles.length} role(s) for ${imageCount} image(s) — give one role per image`,
    );
  }
  return roles;
}

export function collectAnalyzeUploads(
  files: AnalyzeUploadFiles | undefined,
  imageRoles: string | undefined,
): AnalyzeUpload[] {
  const legacy = files?.image ?? [];
  const images = files?.images ?? [];
  const roles = requestedRoles(imageRoles, images.length);
  const uploads: AnalyzeUpload[] = [
    ...legacy.map((file) => ({
      field: 'image' as const,
      role: null,
      buffer: acceptUploadedImage(file),
    })),
    ...images.map((file, index) => ({
      field: 'images' as const,
      role: roles[index] ?? null,
      buffer: acceptUploadedImage(file),
    })),
  ];
  if (uploads.length > API_LIMITS.analyzeImagesMax) {
    throw new BadRequestException(
      `Attach at most ${API_LIMITS.analyzeImagesMax} photos per analysis`,
    );
  }
  return uploads;
}
