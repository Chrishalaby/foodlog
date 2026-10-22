import { HttpException } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

interface ClientHttpError {
  status: number;
  message: string;
  expose: true;
}

function isClientHttpError(error: unknown): error is ClientHttpError {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const { status, message, expose } = error as Record<string, unknown>;
  return (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    typeof message === 'string' &&
    expose === true
  );
}

export function translateClientErrors(
  error: unknown,
  _request: Request,
  _response: Response,
  next: NextFunction,
): void {
  next(
    isClientHttpError(error)
      ? new HttpException(error.message, error.status)
      : error,
  );
}
