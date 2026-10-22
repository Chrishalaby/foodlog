import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);
const TRUSTED_FETCH_SITES: ReadonlySet<string> = new Set([
  'same-origin',
  'none',
]);

export const CROSS_SITE_MESSAGE = 'Cross-site requests are not allowed';

export function isCrossSiteWrite(
  method: string,
  fetchSite: string | undefined,
): boolean {
  return (
    !SAFE_METHODS.has(method.toUpperCase()) &&
    fetchSite !== undefined &&
    !TRUSTED_FETCH_SITES.has(fetchSite.trim().toLowerCase())
  );
}

export function rejectCrossSiteWrites(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  if (isCrossSiteWrite(request.method, request.get('sec-fetch-site'))) {
    next(new ForbiddenException(CROSS_SITE_MESSAGE));
    return;
  }
  next();
}
