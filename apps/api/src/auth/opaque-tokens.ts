import { createHash, randomBytes } from 'node:crypto';

const OPAQUE_TOKEN_BYTES = 32;
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface OpaqueToken {
  token: string;
  hash: string;
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createOpaqueToken(): OpaqueToken {
  const token = randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
  return { token, hash: hashOpaqueToken(token) };
}

export function isOpaqueToken(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_TOKEN_PATTERN.test(value);
}

export function opaqueTokenHash(value: unknown): string | null {
  return isOpaqueToken(value) ? hashOpaqueToken(value) : null;
}
