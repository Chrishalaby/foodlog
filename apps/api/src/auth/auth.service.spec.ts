import type { UserRole } from '@food/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { buildConfig } from '../../test/support/config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from './accounts.service.js';
import { AuthService } from './auth.service.js';
import type { AuthUser } from './auth.types.js';
import { hashPassword, verifyPassword } from './passwords.js';
import type { SessionsService } from './sessions.service.js';
import { SetupCodeService } from './setup-code.service.js';

const SETUP_CODE = 'unit-setup-code';
const PASSWORD = 'correct horse battery';
const LISTED_ADMIN = 'admin@example.com';

interface StoredUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: 'active' | 'disabled';
  passwordHash: string;
}

function pick(user: StoredUser, select?: Record<string, boolean>) {
  if (!select) {
    return user;
  }
  return Object.fromEntries(
    Object.keys(select).map((key) => [key, user[key as keyof StoredUser]]),
  );
}

function createPrismaFake() {
  const users: StoredUser[] = [];
  const find = (where: { id?: string; email?: string }) =>
    users.find((u) => u.id === where.id || u.email === where.email);
  const user = {
    count: vi.fn(() => Promise.resolve(users.length)),
    findFirst: vi.fn(() =>
      Promise.resolve(users[0] ? { id: users[0].id } : null),
    ),
    findUnique: vi.fn(
      ({
        where,
        select,
      }: {
        where: { id?: string; email?: string };
        select?: Record<string, boolean>;
      }) => {
        const found = find(where);
        return Promise.resolve(found ? pick(found, select) : null);
      },
    ),
    create: vi.fn(
      ({
        data,
        select,
      }: {
        data: Omit<StoredUser, 'id' | 'status'> & { profile: object };
        select?: Record<string, boolean>;
      }) => {
        const created: StoredUser = {
          id: `user-${users.length + 1}`,
          email: data.email,
          name: data.name,
          role: data.role,
          status: 'active',
          passwordHash: data.passwordHash,
        };
        users.push(created);
        return Promise.resolve(pick(created, select));
      },
    ),
    update: vi.fn(
      ({
        where,
        data,
        select,
      }: {
        where: { id: string };
        data: Partial<StoredUser>;
        select?: Record<string, boolean>;
      }) => {
        const found = find(where);
        if (found) {
          Object.assign(found, data);
        }
        return Promise.resolve(found ? pick(found, select) : null);
      },
    ),
  };
  const authToken = { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) };
  const tx = {
    user,
    authToken,
    $executeRaw: vi.fn(() => Promise.resolve(1)),
  };
  const prisma = {
    user,
    authToken,
    $transaction: vi.fn((fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
  };
  return {
    users,
    user,
    tx,
    authToken,
    prisma: prisma as unknown as PrismaService,
  };
}

function createSessionsFake() {
  return {
    create: vi.fn((userId: string) => Promise.resolve(`token-for-${userId}`)),
    authenticate: vi.fn(() => Promise.resolve(null)),
    revokeAllForUser: vi.fn(() => Promise.resolve(1)),
    forgetUser: vi.fn(),
  };
}

function createService(env: Record<string, string> = {}) {
  const fake = createPrismaFake();
  const sessions = createSessionsFake();
  const config = buildConfig({ SETUP_CODE, ...env });
  const service = new AuthService(
    fake.prisma,
    sessions as unknown as SessionsService,
    new SetupCodeService(config, fake.prisma),
    new AccountsService(fake.prisma, config),
    config,
  );
  return { ...fake, sessions, service };
}

async function seedUser(
  users: StoredUser[],
  overrides: Partial<StoredUser> = {},
): Promise<StoredUser> {
  const user: StoredUser = {
    id: `user-${users.length + 1}`,
    email: 'me@example.com',
    name: null,
    role: 'member',
    status: 'active',
    passwordHash: await hashPassword(PASSWORD),
    ...overrides,
  };
  users.push(user);
  return user;
}

function asAuthUser(user: StoredUser, sessionId = 'session-1'): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    sessionId,
  };
}

describe('AuthService', () => {
  describe('setup', () => {
    it('creates the first account as an admin with a default profile and a session', async () => {
      const { user, users, tx, sessions, service } = createService();

      const result = await service.setup(
        { email: 'me@example.com', password: PASSWORD, setupCode: SETUP_CODE },
        'Firefox',
      );

      expect(result).toEqual({
        user: {
          id: 'user-1',
          email: 'me@example.com',
          name: null,
          role: 'admin',
        },
        token: 'token-for-user-1',
      });
      expect(sessions.create).toHaveBeenCalledWith('user-1', 'Firefox');
      expect(tx.$executeRaw).toHaveBeenCalledOnce();
      expect(user.create.mock.calls[0]?.[0].data.profile).toEqual({
        create: {},
      });
      await expect(
        verifyPassword(users[0]!.passwordHash, PASSWORD),
      ).resolves.toBe(true);
    });

    it('rejects a wrong setup code with 403', async () => {
      const { user, service } = createService();

      await expect(
        service.setup(
          { email: 'me@example.com', password: PASSWORD, setupCode: 'nope' },
          null,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(user.create).not.toHaveBeenCalled();
    });

    it('rejects setup with 409 once an account exists', async () => {
      const { users, service } = createService();
      await seedUser(users);

      await expect(
        service.setup(
          { email: 'b@example.com', password: PASSWORD, setupCode: SETUP_CODE },
          null,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rechecks inside the locked transaction to stop a concurrent second setup', async () => {
      const { user, service } = createService();
      user.count.mockResolvedValueOnce(1);

      await expect(
        service.setup(
          { email: 'b@example.com', password: PASSWORD, setupCode: SETUP_CODE },
          null,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns the user and a new session for valid credentials', async () => {
      const { users, sessions, service } = createService();
      await seedUser(users, { name: 'Me' });

      const result = await service.login(
        { email: 'me@example.com', password: PASSWORD },
        'Safari',
      );

      expect(result).toEqual({
        user: {
          id: 'user-1',
          email: 'me@example.com',
          name: 'Me',
          role: 'member',
        },
        token: 'token-for-user-1',
      });
      expect(sessions.create).toHaveBeenCalledWith('user-1', 'Safari');
      expect(sessions.forgetUser).not.toHaveBeenCalled();
    });

    it.each([
      ['a wrong password', 'me@example.com', 'wrong password', 'active'],
      ['an unknown email', 'other@example.com', PASSWORD, 'active'],
      ['a disabled account', 'me@example.com', PASSWORD, 'disabled'],
    ] as const)(
      'rejects %s with the same generic 401',
      async (_label, email, password, status) => {
        const { users, sessions, service } = createService();
        await seedUser(users, { status });

        const attempt = service.login({ email, password }, null);

        await expect(attempt).rejects.toBeInstanceOf(UnauthorizedException);
        await expect(attempt).rejects.toThrow('Invalid email or password');
        expect(sessions.create).not.toHaveBeenCalled();
      },
    );

    it('promotes emails listed in ADMIN_EMAILS when they sign in and refreshes their other sessions', async () => {
      const { users, sessions, service } = createService({
        ADMIN_EMAILS: `other@example.com, ${LISTED_ADMIN.toUpperCase()}`,
      });
      await seedUser(users, { email: LISTED_ADMIN });

      const result = await service.login(
        { email: LISTED_ADMIN, password: PASSWORD },
        null,
      );

      expect(result.user.role).toBe('admin');
      expect(users[0]!.role).toBe('admin');
      expect(sessions.forgetUser).toHaveBeenCalledWith(users[0]!.id);
    });
  });

  describe('changePassword', () => {
    it('replaces the hash and signs out every other session and reset link', async () => {
      const { users, authToken, sessions, service } = createService();
      const stored = await seedUser(users);

      await service.changePassword(asAuthUser(stored, 'current'), {
        currentPassword: PASSWORD,
        newPassword: 'a brand new password',
      });

      await expect(
        verifyPassword(stored.passwordHash, 'a brand new password'),
      ).resolves.toBe(true);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(
        stored.id,
        expect.objectContaining({ exceptSessionId: 'current' }),
        expect.anything(),
      );
      expect(authToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: 'reset',
            userId: stored.id,
            usedAt: null,
            revokedAt: null,
          },
        }),
      );
      expect(sessions.forgetUser).toHaveBeenCalledWith(stored.id);
    });

    it('rejects a wrong current password with 400', async () => {
      const { users, user, sessions, service } = createService();
      const stored = await seedUser(users);

      await expect(
        service.changePassword(asAuthUser(stored), {
          currentPassword: 'not it',
          newPassword: 'a brand new password',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(user.update).not.toHaveBeenCalled();
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('status', () => {
    it('reports that setup is required before any account exists', async () => {
      const { service } = createService();

      await expect(service.status(null)).resolves.toEqual({
        status: { setupRequired: true, authenticated: false, user: null },
        renewedToken: null,
      });
    });

    it('returns the signed-in user without the session id and passes on a renewed token', async () => {
      const { users, sessions, service } = createService();
      const stored = await seedUser(users, { name: 'Me' });
      sessions.authenticate.mockResolvedValueOnce({
        user: asAuthUser(stored),
        renewedToken: 'fresh',
      } as never);

      await expect(service.status('token')).resolves.toEqual({
        status: {
          setupRequired: false,
          authenticated: true,
          user: {
            id: stored.id,
            email: stored.email,
            name: 'Me',
            role: 'member',
          },
        },
        renewedToken: 'fresh',
      });
    });
  });

  describe('updateAccount', () => {
    it('stores the display name and refreshes cached sessions', async () => {
      const { users, sessions, service } = createService();
      const stored = await seedUser(users);

      const updated = await service.updateAccount(asAuthUser(stored), {
        name: 'Chris',
      });

      expect(updated).toEqual({
        id: stored.id,
        email: stored.email,
        name: 'Chris',
        role: 'member',
      });
      expect(sessions.forgetUser).toHaveBeenCalledWith(stored.id);
    });
  });
});
