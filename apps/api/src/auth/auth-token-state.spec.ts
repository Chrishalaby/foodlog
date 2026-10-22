import {
  authTokenState,
  inviteStatus,
  tokenExpiry,
} from './auth-token-state.js';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const LATER = new Date('2026-10-01T00:00:00.000Z');

describe('auth token state', () => {
  it('is valid while unused, not revoked and not expired', () => {
    const token = { expiresAt: LATER, usedAt: null, revokedAt: null };
    expect(authTokenState(token, NOW)).toBe('valid');
    expect(inviteStatus(token, NOW)).toBe('pending');
  });

  it('reports used, revoked and expired tokens in that order', () => {
    expect(
      authTokenState({ expiresAt: NOW, usedAt: NOW, revokedAt: NOW }, NOW),
    ).toBe('used');
    expect(
      authTokenState({ expiresAt: LATER, usedAt: null, revokedAt: NOW }, NOW),
    ).toBe('revoked');
    expect(
      authTokenState({ expiresAt: NOW, usedAt: null, revokedAt: null }, NOW),
    ).toBe('expired');
    expect(
      inviteStatus({ expiresAt: NOW, usedAt: null, revokedAt: null }, NOW),
    ).toBe('expired');
  });

  it('computes expiry from a time-to-live', () => {
    expect(tokenExpiry(NOW, 60_000)).toEqual(
      new Date('2026-09-28T12:01:00.000Z'),
    );
  });
});
