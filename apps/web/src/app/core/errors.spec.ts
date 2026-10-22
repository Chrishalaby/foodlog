import { HttpErrorResponse } from '@angular/common/http';
import { ImageDecodeError } from '../shared/utils/image-compress';
import {
  GENERIC_ERROR_MESSAGE,
  IMAGE_UNSUPPORTED_MESSAGE,
  OFFLINE_MESSAGE,
  RATE_LIMIT_MESSAGE,
  SERVER_UNAVAILABLE_MESSAGE,
  errorMessage,
} from './errors';

const httpError = (status: number, error: unknown = null): HttpErrorResponse =>
  new HttpErrorResponse({ status, error });

describe('errorMessage', () => {
  it('joins validation messages from the API error body', () => {
    const err = httpError(400, {
      statusCode: 400,
      message: ['email must be an email', 'password is too short'],
    });
    expect(errorMessage(err)).toBe('Email must be an email. Password is too short.');
  });

  it('uses a single API message as-is', () => {
    expect(errorMessage(httpError(404, { statusCode: 404, message: 'Entry not found' }))).toBe(
      'Entry not found.',
    );
  });

  it('parses JSON error bodies delivered as text', () => {
    expect(errorMessage(httpError(409, '{"statusCode":409,"message":"Already exists"}'))).toBe(
      'Already exists.',
    );
  });

  it('reports offline for status 0', () => {
    expect(errorMessage(httpError(0))).toBe(OFFLINE_MESSAGE);
  });

  it('reports rate limits but keeps budget messages', () => {
    expect(errorMessage(httpError(429, { statusCode: 429, message: 'ThrottlerException' }))).toBe(
      RATE_LIMIT_MESSAGE,
    );
    expect(
      errorMessage(httpError(429, { statusCode: 429, message: 'Monthly AI budget reached' })),
    ).toBe('Monthly AI budget reached.');
  });

  it('reports gateway failures without a body as server unavailable', () => {
    expect(errorMessage(httpError(504))).toBe(SERVER_UNAVAILABLE_MESSAGE);
  });

  it('handles image decode errors and plain errors', () => {
    expect(errorMessage(new ImageDecodeError(new Blob(), 'bad'))).toBe(IMAGE_UNSUPPORTED_MESSAGE);
    expect(errorMessage(new Error('Boom'))).toBe('Boom');
    expect(errorMessage(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(errorMessage(httpError(500), 'Could not save')).toBe('Could not save');
  });
});
