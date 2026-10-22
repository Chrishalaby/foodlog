import { createHash } from 'node:crypto';
import {
  createOpaqueToken,
  hashOpaqueToken,
  isOpaqueToken,
  opaqueTokenHash,
} from './opaque-tokens.js';

describe('opaque tokens', () => {
  it('creates 32 random bytes as base64url and stores only a SHA-256 hash', () => {
    const { token, hash } = createOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token);
    expect(createOpaqueToken().token).not.toBe(token);
  });

  it('only hashes values shaped like a token', () => {
    const { token } = createOpaqueToken();

    expect(isOpaqueToken(token)).toBe(true);
    expect(opaqueTokenHash(token)).toBe(hashOpaqueToken(token));
    expect(opaqueTokenHash('short')).toBeNull();
    expect(opaqueTokenHash(`${token}x`)).toBeNull();
    expect(opaqueTokenHash('a'.repeat(42) + '/')).toBeNull();
    expect(opaqueTokenHash(42)).toBeNull();
  });
});
