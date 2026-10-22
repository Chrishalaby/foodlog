import { HttpErrorResponse } from '@angular/common/http';
import type { ApiError } from '@food/shared';
import { ImageDecodeError } from '../shared/utils/image-compress';

export const OFFLINE_MESSAGE = 'You appear to be offline. Check your connection and try again.';
export const RATE_LIMIT_MESSAGE =
  'Too many requests right now. Please wait a minute and try again.';
export const SERVER_UNAVAILABLE_MESSAGE = 'The server is not responding. Please try again shortly.';
export const IMAGE_UNSUPPORTED_MESSAGE =
  'This image format is not supported on this device. Try a JPEG or PNG photo.';
export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.';

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' || Array.isArray(message);
}

function parseBody(body: unknown): unknown {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function capitalize(text: string): string {
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

export function apiErrorMessage(body: unknown): string | null {
  const parsed = parseBody(body);
  if (!isApiError(parsed)) {
    return null;
  }
  const parts = (Array.isArray(parsed.message) ? parsed.message : [parsed.message])
    .filter((part): part is string => typeof part === 'string')
    .map((part) => capitalize(part.trim()))
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }
  return parts.map((part) => (/[.!?]$/.test(part) ? part : `${part}.`)).join(' ');
}

export function httpStatus(err: unknown): number | null {
  return err instanceof HttpErrorResponse ? err.status : null;
}

function httpErrorMessage(err: HttpErrorResponse, fallback: string): string {
  if (err.status === 0) {
    return OFFLINE_MESSAGE;
  }
  const serverMessage = apiErrorMessage(err.error);
  if (err.status === 429) {
    return serverMessage && /budget/i.test(serverMessage) ? serverMessage : RATE_LIMIT_MESSAGE;
  }
  if (serverMessage) {
    return serverMessage;
  }
  if (err.status === 502 || err.status === 503 || err.status === 504) {
    return SERVER_UNAVAILABLE_MESSAGE;
  }
  return fallback;
}

export function errorMessage(err: unknown, fallback: string = GENERIC_ERROR_MESSAGE): string {
  if (err instanceof HttpErrorResponse) {
    return httpErrorMessage(err, fallback);
  }
  if (err instanceof ImageDecodeError) {
    return IMAGE_UNSUPPORTED_MESSAGE;
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  if (typeof err === 'string' && err.trim().length > 0) {
    return err;
  }
  return fallback;
}
