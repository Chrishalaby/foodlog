import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import type { AuthTokensService } from '../auth/auth-tokens.service.js';
import type { SessionsService } from '../auth/sessions.service.js';
import type { AppConfig } from '../config/app-config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { StorageService } from '../storage/storage.service.js';
import type { UsageService } from '../usage/usage.service.js';
import { AdminUsersService } from './admin-users.service.js';

const ACTOR = {
  id: '019a0000-0000-7000-8000-000000000001',
  email: 'owner@example.com',
} as AuthUser;
const TARGET_ID = '019a0000-0000-7000-8000-000000000002';

const MEMBER_ROW = {
  id: TARGET_ID,
  email: 'member@example.com',
  name: 'Member',
  role: 'member',
  status: 'active',
  createdAt: new Date('2026-09-01T00:00:00.000Z'),
  lastSeenAt: null,
  aiMonthlyBudgetUsd: null,
  aiBudgetUnlimited: false,
};

function photoRows(...ids: string[]) {
  return ids.map((id) => ({
    storageKey: `photos/${id}.jpg`,
    thumbKey: `photos/${id}_thumb.webp`,
  }));
}

function setup() {
  const calls: string[] = [];
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue(MEMBER_ROW),
      count: vi.fn().mockResolvedValue(1),
      delete: vi.fn(() => {
        calls.push('user.delete');
        return Promise.resolve({ id: TARGET_ID });
      }),
    },
    photo: {
      findMany: vi
        .fn()
        .mockResolvedValueOnce(photoRows('a', 'b'))
        .mockResolvedValue(photoRows('a', 'b', 'late')),
    },
    $executeRaw: vi.fn().mockResolvedValue(0),
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    (run: (tx: typeof prisma) => Promise<unknown>) => run(prisma),
  );
  const storage = {
    delete: vi.fn((key: string) => {
      calls.push(`delete ${key}`);
      return Promise.resolve();
    }),
  };
  const sessions = { revokeAllForUser: vi.fn(), forgetUser: vi.fn() };
  const service = new AdminUsersService(
    prisma as unknown as PrismaService,
    {} as AppConfig,
    sessions as unknown as SessionsService,
    {} as AuthTokensService,
    {} as UsageService,
    storage as unknown as StorageService,
  );
  return { calls, prisma, service, sessions, storage };
}

describe('AdminUsersService.remove', () => {
  let loggedErrors: string[];

  beforeEach(() => {
    loggedErrors = [];
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(
      (message: unknown) => {
        loggedErrors.push(String(message));
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('deletes the photo files first and the user in a transaction with a long timeout', async () => {
    const { calls, prisma, service, sessions } = setup();

    await service.remove(ACTOR, TARGET_ID);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.$transaction.mock.calls[1]?.[1]).toEqual({
      timeout: 60_000,
    });
    expect(calls).toEqual([
      'delete photos/a.jpg',
      'delete photos/a_thumb.webp',
      'delete photos/b.jpg',
      'delete photos/b_thumb.webp',
      'user.delete',
      'delete photos/late.jpg',
      'delete photos/late_thumb.webp',
    ]);
    expect(sessions.forgetUser).toHaveBeenCalledWith(TARGET_ID);
  });

  it('keeps the user and their data when a photo file cannot be deleted', async () => {
    const { prisma, service, sessions, storage } = setup();
    storage.delete.mockImplementation((key: string) =>
      key === 'photos/b.jpg'
        ? Promise.reject(new Error('R2 unavailable'))
        : Promise.resolve(),
    );

    await expect(service.remove(ACTOR, TARGET_ID)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(sessions.forgetUser).not.toHaveBeenCalled();
  });

  it('still finishes the deletion when a file added meanwhile cannot be deleted', async () => {
    const { prisma, service, sessions, storage } = setup();
    storage.delete.mockImplementation((key: string) =>
      key.startsWith('photos/late')
        ? Promise.reject(new Error('R2 unavailable'))
        : Promise.resolve(),
    );

    await service.remove(ACTOR, TARGET_ID);

    expect(prisma.user.delete).toHaveBeenCalledTimes(1);
    expect(sessions.forgetUser).toHaveBeenCalledWith(TARGET_ID);
    expect(loggedErrors).toEqual([
      expect.stringContaining('could not delete 2 of their photo files'),
    ]);
  });
});
