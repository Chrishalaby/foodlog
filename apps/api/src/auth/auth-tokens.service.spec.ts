import { ConflictException, GoneException } from '@nestjs/common';
import type { AuthToken } from '../generated/prisma/client.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AccountsService } from './accounts.service.js';
import { AuthTokensService } from './auth-tokens.service.js';
import { createOpaqueToken } from './opaque-tokens.js';
import type { SessionsService } from './sessions.service.js';

const NOW = new Date('2026-09-28T08:00:00.000Z');

function storedToken(hash: string): AuthToken {
  return {
    id: 'token-1',
    type: 'reset',
    email: 'member@example.com',
    name: null,
    role: 'member',
    userId: 'user-1',
    tokenHash: hash,
    createdById: null,
    accessRequestId: null,
    createdAt: NOW,
    expiresAt: new Date(NOW.getTime() + 60_000),
    usedAt: null,
    revokedAt: null,
  };
}

function createService(
  stored: AuthToken,
  afterRace: Partial<AuthToken>,
  accountExists = false,
) {
  const tx = {
    authToken: {
      updateMany: vi.fn(() => Promise.resolve({ count: 0 })),
      findUnique: vi.fn(() => Promise.resolve({ ...stored, ...afterRace })),
    },
  };
  const prisma = {
    authToken: { findUnique: vi.fn(() => Promise.resolve(stored)) },
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  const sessions = { create: vi.fn(), revokeAllForUser: vi.fn() };
  const service = new AuthTokensService(
    prisma as unknown as PrismaService,
    {
      emailInUse: vi.fn(() => Promise.resolve(accountExists)),
    } as unknown as AccountsService,
    sessions as unknown as SessionsService,
  );
  return { service, sessions };
}

describe('AuthTokensService.accept', () => {
  it.each([
    [{ revokedAt: NOW }, 'This link was revoked'],
    [{ usedAt: NOW }, 'This link was already used'],
  ])(
    'reports why a link that changed during acceptance can no longer be used (%o)',
    async (afterRace, message) => {
      const { token, hash } = createOpaqueToken();
      const { service, sessions } = createService(storedToken(hash), afterRace);

      const attempt = service.accept(
        token,
        { password: 'a brand new password' },
        null,
        NOW,
      );

      await expect(attempt).rejects.toBeInstanceOf(GoneException);
      await expect(attempt).rejects.toThrow(message);
      expect(sessions.create).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    },
  );

  it.each<[string, Partial<AuthToken>]>([
    ['revoked', { revokedAt: NOW }],
    ['used', { usedAt: NOW }],
    ['expired', { expiresAt: NOW }],
  ])(
    'tells the owner of an existing account to sign in instead of reporting a %s invite',
    async (_state, lifecycle) => {
      const { token, hash } = createOpaqueToken();
      const invite = { ...storedToken(hash), type: 'invite' as const };
      const { service, sessions } = createService(
        { ...invite, ...lifecycle },
        {},
        true,
      );

      await expect(service.info(token, NOW)).resolves.toMatchObject({
        valid: false,
        reason: 'account_exists',
      });
      await expect(
        service.accept(token, { password: 'a brand new password' }, null, NOW),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(sessions.create).not.toHaveBeenCalled();
    },
  );

  it('still reports a revoked reset link as revoked for an existing account', async () => {
    const { token, hash } = createOpaqueToken();
    const { service } = createService(
      { ...storedToken(hash), revokedAt: NOW },
      {},
      true,
    );

    await expect(service.info(token, NOW)).resolves.toMatchObject({
      valid: false,
      reason: 'revoked',
    });
    await expect(
      service.accept(token, { password: 'a brand new password' }, null, NOW),
    ).rejects.toBeInstanceOf(GoneException);
  });
});
