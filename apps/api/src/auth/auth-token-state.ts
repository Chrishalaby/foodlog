import type { AdminInviteStatus } from '@food/shared';

export type AuthTokenState = 'valid' | 'revoked' | 'used' | 'expired';

export interface AuthTokenLifecycle {
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

export function authTokenState(
  token: AuthTokenLifecycle,
  now: Date,
): AuthTokenState {
  if (token.usedAt) {
    return 'used';
  }
  if (token.revokedAt) {
    return 'revoked';
  }
  if (token.expiresAt.getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'valid';
}

export function inviteStatus(
  token: AuthTokenLifecycle,
  now: Date,
): AdminInviteStatus {
  const state = authTokenState(token, now);
  return state === 'valid' ? 'pending' : state;
}

export function tokenExpiry(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() + ttlMs);
}
