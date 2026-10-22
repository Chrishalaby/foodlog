import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  CROSS_SITE_MESSAGE,
  isCrossSiteWrite,
  rejectCrossSiteWrites,
} from './cross-site-guard.middleware.js';

function requestWith(method: string, fetchSite?: string): Request {
  return {
    method,
    get: (name: string) =>
      name.toLowerCase() === 'sec-fetch-site' ? fetchSite : undefined,
  } as unknown as Request;
}

describe('isCrossSiteWrite', () => {
  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])(
    'lets safe %s requests through from anywhere',
    (method) => {
      expect(isCrossSiteWrite(method, 'cross-site')).toBe(false);
    },
  );

  it.each([undefined, 'same-origin', 'none', ' Same-Origin '])(
    'lets writes through with Sec-Fetch-Site %j',
    (site) => {
      expect(isCrossSiteWrite('POST', site)).toBe(false);
    },
  );

  it.each(['cross-site', 'same-site', 'CROSS-SITE', 'unexpected'])(
    'blocks writes with Sec-Fetch-Site %j',
    (site) => {
      expect(isCrossSiteWrite('POST', site)).toBe(true);
      expect(isCrossSiteWrite('DELETE', site)).toBe(true);
      expect(isCrossSiteWrite('PUT', site)).toBe(true);
    },
  );
});

describe('rejectCrossSiteWrites', () => {
  it('passes allowed requests on unchanged', () => {
    const next = vi.fn<(error?: unknown) => void>();

    rejectCrossSiteWrites(
      requestWith('POST', 'same-origin'),
      {} as Response,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('hands a 403 to the error handler for cross-site writes', () => {
    const next = vi.fn<(error?: unknown) => void>();

    rejectCrossSiteWrites(
      requestWith('POST', 'cross-site'),
      {} as Response,
      next as unknown as NextFunction,
    );

    expect(next).toHaveBeenCalledTimes(1);
    const [error] = next.mock.calls[0] as [unknown];
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).message).toBe(CROSS_SITE_MESSAGE);
  });
});
