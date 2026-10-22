import type { SessionDto } from '@food/shared';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from './accounts.service.js';
import { SESSION_LIST_LIMIT } from './auth.constants.js';
import type { AuthenticatedSession } from './auth.types.js';
import { type CachedSession, SessionCache } from './session-cache.js';
import {
  isSessionStale,
  normalizeUserAgent,
  shouldRecordActivity,
  shouldRenewToken,
  staleSessionCutoff,
} from './session-policy.js';
import { SessionTokens } from './session-tokens.service.js';

type Client = Prisma.TransactionClient | PrismaService;

export interface RevokeOptions {
  exceptSessionId?: string;
  now?: Date;
}

const SESSION_SELECT = {
  id: true,
  revokedAt: true,
  lastSeenAt: true,
  user: {
    select: { id: true, email: true, name: true, role: true, status: true },
  },
} as const satisfies Prisma.SessionSelect;

type SessionRow = Prisma.SessionGetPayload<{ select: typeof SESSION_SELECT }>;

function toCachedSession(row: SessionRow): CachedSession {
  const { id, email, name, role } = row.user;
  return {
    sessionId: row.id,
    user: { id, email, name, role },
    lastSeenAt: row.lastSeenAt,
  };
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);
  private readonly cache = new SessionCache();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: SessionTokens,
    private readonly accounts: AccountsService,
  ) {}

  async create(
    userId: string,
    userAgent: unknown,
    now: Date = new Date(),
  ): Promise<string> {
    const [session] = await this.prisma.$transaction([
      this.prisma.session.create({
        data: {
          userId,
          userAgent: normalizeUserAgent(userAgent),
          createdAt: now,
          lastSeenAt: now,
        },
        select: { id: true },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt: now },
        select: { id: true },
      }),
    ]);
    return this.tokens.sign(userId, session.id);
  }

  async authenticate(
    token: unknown,
    now: Date = new Date(),
  ): Promise<AuthenticatedSession | null> {
    const claims = await this.tokens.verify(token);
    if (!claims) {
      return null;
    }
    const session = await this.load(claims.sessionId, now);
    if (!session || session.user.id !== claims.userId) {
      return null;
    }
    await this.recordActivity(session, now);
    const renewedToken = shouldRenewToken(claims.issuedAt, now)
      ? await this.tokens.sign(claims.userId, claims.sessionId)
      : null;
    return {
      user: { ...session.user, sessionId: session.sessionId },
      renewedToken,
    };
  }

  async list(
    userId: string,
    currentSessionId: string,
    now: Date = new Date(),
  ): Promise<SessionDto[]> {
    const rows = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        lastSeenAt: { gte: staleSessionCutoff(now) },
      },
      orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
      take: SESSION_LIST_LIMIT,
      select: { id: true, userAgent: true, createdAt: true, lastSeenAt: true },
    });
    return rows.map((row) => ({
      id: row.id,
      userAgent: row.userAgent,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      current: row.id === currentSessionId,
    }));
  }

  async revokeOwn(userId: string, sessionId: string): Promise<void> {
    const { count } = await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      throw new NotFoundException('Session not found');
    }
    this.cache.delete(sessionId);
  }

  async revokeToken(token: unknown): Promise<void> {
    const claims = await this.tokens.verify(token);
    if (!claims) {
      return;
    }
    await this.prisma.session.updateMany({
      where: { id: claims.sessionId, userId: claims.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.cache.delete(claims.sessionId);
  }

  async revokeAllForUser(
    userId: string,
    options: RevokeOptions = {},
    client: Client = this.prisma,
  ): Promise<number> {
    const { count } = await client.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(options.exceptSessionId
          ? { id: { not: options.exceptSessionId } }
          : {}),
      },
      data: { revokedAt: options.now ?? new Date() },
    });
    this.forgetUser(userId);
    return count;
  }

  forgetUser(userId: string): void {
    this.cache.deleteUser(userId);
  }

  private async load(
    sessionId: string,
    now: Date,
  ): Promise<CachedSession | null> {
    const cached = this.cache.get(sessionId, now.getTime());
    if (cached) {
      return cached;
    }
    const row = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: SESSION_SELECT,
    });
    if (
      !row ||
      row.revokedAt !== null ||
      row.user.status !== 'active' ||
      isSessionStale(row.lastSeenAt, now)
    ) {
      return null;
    }
    const session = toCachedSession(row);
    session.user = await this.accounts.applyAdminEmails(session.user);
    this.cache.set(session, now.getTime());
    return session;
  }

  private async recordActivity(
    session: CachedSession,
    now: Date,
  ): Promise<void> {
    if (!shouldRecordActivity(session.lastSeenAt, now)) {
      return;
    }
    session.lastSeenAt = now;
    try {
      await this.prisma.$transaction([
        this.prisma.session.updateMany({
          where: { id: session.sessionId, revokedAt: null },
          data: { lastSeenAt: now },
        }),
        this.prisma.user.updateMany({
          where: { id: session.user.id },
          data: { lastSeenAt: now },
        }),
      ]);
    } catch (error) {
      this.logger.warn(`Could not record session activity: ${String(error)}`);
    }
  }
}
