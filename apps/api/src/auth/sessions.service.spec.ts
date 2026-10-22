import type { UserDto } from '@food/shared';
import { NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { AccountsService } from './accounts.service.js';
import { SessionTokens } from './session-tokens.service.js';
import { SessionsService } from './sessions.service.js';

const HOUR_MS = 60 * 60 * 1000;
const T0 = new Date('2026-09-28T08:00:00.000Z');

interface FakeSession {
  id: string;
  userId: string;
  revokedAt: Date | null;
  lastSeenAt: Date;
  status: 'active' | 'disabled';
}

function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

function createPrismaFake(sessions: FakeSession[]) {
  const toRow = (session: FakeSession) => ({
    id: session.id,
    revokedAt: session.revokedAt,
    lastSeenAt: session.lastSeenAt,
    user: {
      id: session.userId,
      email: `${session.userId}@example.com`,
      name: null,
      role: 'member',
      status: session.status,
    },
  });
  const session = {
    create: vi.fn(
      ({ data }: { data: { userId: string; lastSeenAt: Date } }) => {
        const created: FakeSession = {
          id: `session-${sessions.length + 1}`,
          userId: data.userId,
          revokedAt: null,
          lastSeenAt: data.lastSeenAt,
          status: 'active',
        };
        sessions.push(created);
        return Promise.resolve({ id: created.id });
      },
    ),
    findUnique: vi.fn(({ where }: { where: { id: string } }) => {
      const found = sessions.find((s) => s.id === where.id);
      return Promise.resolve(found ? toRow(found) : null);
    }),
    updateMany: vi.fn(
      ({
        where,
        data,
      }: {
        where: { id?: string | { not: string }; userId?: string };
        data: { revokedAt?: Date; lastSeenAt?: Date };
      }) => {
        const matches = sessions.filter(
          (s) =>
            s.revokedAt === null &&
            (where.userId === undefined || s.userId === where.userId) &&
            (where.id === undefined ||
              (typeof where.id === 'string'
                ? s.id === where.id
                : s.id !== where.id.not)),
        );
        for (const match of matches) {
          Object.assign(match, data);
        }
        return Promise.resolve({ count: matches.length });
      },
    ),
  };
  const user = {
    update: vi.fn(() => Promise.resolve({ id: 'user-1' })),
    updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
  };
  const prisma = {
    session,
    user,
    $transaction: vi.fn((operations: Promise<unknown>[]) =>
      Promise.all(operations),
    ),
  };
  return { session, user, prisma: prisma as unknown as PrismaService };
}

function createAccountsFake(listedEmails: readonly string[]) {
  const applyAdminEmails = vi.fn((user: UserDto) =>
    Promise.resolve(
      user.role !== 'admin' && listedEmails.includes(user.email)
        ? { ...user, role: 'admin' as const }
        : user,
    ),
  );
  return {
    applyAdminEmails,
    accounts: { applyAdminEmails } as unknown as AccountsService,
  };
}

function createService(
  sessions: FakeSession[] = [],
  listedEmails: readonly string[] = [],
) {
  const fake = createPrismaFake(sessions);
  const tokens = new SessionTokens(new JwtService({ secret: 's'.repeat(48) }));
  const { accounts, applyAdminEmails } = createAccountsFake(listedEmails);
  return {
    ...fake,
    tokens,
    applyAdminEmails,
    service: new SessionsService(fake.prisma, tokens, accounts),
  };
}

describe('SessionsService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a session row with a cleaned user agent and signs a token for it', async () => {
    const sessions: FakeSession[] = [];
    const { service, tokens, session, user } = createService(sessions);

    const token = await service.create('user-1', ' Safari\n ', T0);

    expect(session.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          userId: 'user-1',
          userAgent: 'Safari',
          createdAt: T0,
          lastSeenAt: T0,
        },
      }),
    );
    expect(user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { lastSeenAt: T0 } }),
    );
    await expect(tokens.verify(token)).resolves.toMatchObject({
      userId: 'user-1',
      sessionId: 'session-1',
    });
  });

  it('authenticates an active session and caches it for 30 seconds', async () => {
    const { service, session } = createService();
    const token = await service.create('user-1', null, T0);

    const first = await service.authenticate(token, at(1_000));
    const second = await service.authenticate(token, at(20_000));
    await service.authenticate(token, at(40_000));

    expect(first).toEqual({
      user: {
        id: 'user-1',
        email: 'user-1@example.com',
        name: null,
        role: 'member',
        sessionId: 'session-1',
      },
      renewedToken: null,
    });
    expect(second?.user.id).toBe('user-1');
    expect(session.findUnique).toHaveBeenCalledTimes(2);
  });

  it('rejects revoked sessions, disabled users, mismatched users and stale sessions', async () => {
    const sessions: FakeSession[] = [];
    const { service, tokens } = createService(sessions);
    const token = await service.create('user-1', null, T0);
    const mismatched = await tokens.sign('user-2', 'session-1');
    const missing = await tokens.sign('user-1', 'session-404');
    const afterCache = (step: number): Date => at(step * 31_000);

    await expect(service.authenticate(mismatched, T0)).resolves.toBeNull();
    await expect(service.authenticate(missing, T0)).resolves.toBeNull();

    sessions[0]!.status = 'disabled';
    await expect(
      service.authenticate(token, afterCache(1)),
    ).resolves.toBeNull();

    sessions[0]!.status = 'active';
    sessions[0]!.revokedAt = T0;
    await expect(
      service.authenticate(token, afterCache(2)),
    ).resolves.toBeNull();

    sessions[0]!.revokedAt = null;
    await expect(
      service.authenticate(token, at(401 * 24 * HOUR_MS)),
    ).resolves.toBeNull();
    await expect(
      service.authenticate(token, afterCache(3)),
    ).resolves.not.toBeNull();
  });

  it('re-issues the token once it is older than 24 hours', async () => {
    const { service, tokens } = createService();
    const token = await service.create('user-1', null, T0);

    const early = await service.authenticate(token, at(23 * HOUR_MS));
    vi.setSystemTime(at(25 * HOUR_MS));
    const late = await service.authenticate(token, at(25 * HOUR_MS));

    expect(early?.renewedToken).toBeNull();
    expect(late?.renewedToken).toEqual(expect.any(String));
    await expect(tokens.verify(late?.renewedToken)).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      issuedAt: at(25 * HOUR_MS).getTime(),
    });
    const renewed = await service.authenticate(
      late?.renewedToken,
      at(25 * HOUR_MS + 1_000),
    );
    expect(renewed?.renewedToken).toBeNull();
  });

  it('records last-seen activity at most once per hour', async () => {
    const sessions: FakeSession[] = [];
    const { service, session, user } = createService(sessions);
    const token = await service.create('user-1', null, T0);

    await service.authenticate(token, at(10 * 60 * 1000));
    expect(user.updateMany).not.toHaveBeenCalled();

    await service.authenticate(token, at(HOUR_MS));
    await service.authenticate(token, at(HOUR_MS + 1_000));
    expect(user.updateMany).toHaveBeenCalledOnce();
    expect(sessions[0]!.lastSeenAt).toEqual(at(HOUR_MS));
    expect(session.updateMany).toHaveBeenCalledOnce();
  });

  it('drops cached sessions as soon as they are revoked in this process', async () => {
    const { service } = createService();
    const token = await service.create('user-1', null, T0);
    const other = await service.create('user-1', null, T0);
    await service.authenticate(token, T0);
    await service.authenticate(other, T0);

    await service.revokeAllForUser('user-1', { exceptSessionId: 'session-2' });

    await expect(service.authenticate(token, T0)).resolves.toBeNull();
    await expect(service.authenticate(other, T0)).resolves.not.toBeNull();

    await service.revokeToken(other);
    await expect(service.authenticate(other, T0)).resolves.toBeNull();
  });

  it('revokes only the current user’s own sessions', async () => {
    const { service } = createService();
    const token = await service.create('user-1', null, T0);
    await service.authenticate(token, T0);

    await expect(
      service.revokeOwn('user-2', 'session-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.authenticate(token, T0)).resolves.not.toBeNull();

    await service.revokeOwn('user-1', 'session-1');
    await expect(service.authenticate(token, T0)).resolves.toBeNull();
  });

  it('promotes a listed admin email when a live session is revalidated', async () => {
    const { service, applyAdminEmails } = createService(
      [],
      ['user-1@example.com'],
    );
    const token = await service.create('user-1', null, T0);

    const first = await service.authenticate(token, T0);
    await service.authenticate(token, at(1_000));

    expect(first?.user.role).toBe('admin');
    expect(applyAdminEmails).toHaveBeenCalledOnce();
  });
});
