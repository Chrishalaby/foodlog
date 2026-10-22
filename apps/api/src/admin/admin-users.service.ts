import type { AdminUserDto, InviteLinkResponse } from '@food/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ADMIN_LOCK_KEY } from '../auth/auth.constants.js';
import type { AuthUser } from '../auth/auth.types.js';
import { authTokenLink } from '../auth/auth-links.js';
import { lockEmail, revokePendingTokens } from '../auth/auth-token-queries.js';
import { AuthTokensService } from '../auth/auth-tokens.service.js';
import { staleSessionCutoff } from '../auth/session-policy.js';
import { SessionsService } from '../auth/sessions.service.js';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';
import { roundUsd, utcMonthOf, utcMonthRange } from '../usage/usage-period.js';
import { UsageService } from '../usage/usage.service.js';
import type { UpdateAdminUserDto } from './admin.dto.js';
import {
  ADMIN_USER_SELECT,
  type AdminUserRow,
  EMPTY_AGGREGATES,
  toAdminInviteDto,
  toAdminUserDto,
  type UserAggregates,
} from './admin.mappers.js';
import {
  budgetUpdate,
  changesRoleOrStatus,
  demotesListedAdmin,
  isActiveAdmin,
  removesActiveAdmin,
} from './admin-rules.js';

const LAST_ADMIN_MESSAGE = 'There must always be at least one active admin';
const PHOTO_DELETE_CONCURRENCY = 8;
const USER_DELETE_TIMEOUT_MS = 60_000;
const PHOTO_DELETE_FAILED_MESSAGE =
  'Could not delete all photos. Please try again.';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AdminUsersService {
  private readonly logger = new Logger(AdminUsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly tokens: AuthTokensService,
    private readonly usage: UsageService,
    private readonly storage: StorageService,
  ) {}

  async list(actor: AuthUser, now: Date = new Date()): Promise<AdminUserDto[]> {
    const rows = await this.prisma.user.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: ADMIN_USER_SELECT,
    });
    const aggregates = await this.aggregates(undefined, now);
    return rows.map((row) => this.toDto(row, aggregates, actor));
  }

  async get(
    actor: AuthUser,
    id: string,
    now: Date = new Date(),
  ): Promise<AdminUserDto> {
    const row = await this.findOrThrow(this.prisma, id);
    const aggregates = await this.aggregates([id], now);
    return this.toDto(row, aggregates, actor);
  }

  async update(
    actor: AuthUser,
    id: string,
    body: UpdateAdminUserDto,
  ): Promise<AdminUserDto> {
    const now = new Date();
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      await this.lockAdmins(tx);
      const target = await this.findOrThrow(tx, id);
      await this.assertAllowedChange(tx, actor, target, body);
      const updated = await tx.user.update({
        where: { id },
        data: {
          role: body.role,
          status: body.status,
          ...budgetUpdate(body),
          name: body.name,
        },
        select: ADMIN_USER_SELECT,
      });
      if (updated.status === 'disabled' && target.status !== 'disabled') {
        await this.sessions.revokeAllForUser(id, { now }, tx);
        await revokePendingTokens(tx, { type: 'reset', userId: id }, now);
      }
      return { before: target, after: updated };
    });
    this.sessions.forgetUser(id);
    if (before.status !== after.status || before.role !== after.role) {
      this.logger.log(
        `Admin ${actor.id} set user ${id} to ${after.role}/${after.status}`,
      );
    }
    return this.get(actor, id, now);
  }

  async resetLink(
    actor: AuthUser,
    id: string,
    baseUrl: string,
  ): Promise<InviteLinkResponse> {
    const now = new Date();
    const { row, token } = await this.prisma.$transaction(async (tx) => {
      await lockEmail(tx, (await this.findOrThrow(tx, id)).email);
      const target = await this.findOrThrow(tx, id);
      if (target.status !== 'active') {
        throw new ConflictException(
          'Enable this account before creating a reset link',
        );
      }
      await revokePendingTokens(tx, { type: 'reset', userId: id }, now);
      return this.tokens.issue(
        tx,
        {
          type: 'reset',
          email: target.email,
          name: target.name,
          role: target.role,
          userId: id,
          createdById: actor.id,
        },
        now,
      );
    });
    return {
      invite: toAdminInviteDto(row, now),
      url: authTokenLink(baseUrl, 'reset', token),
    };
  }

  async revokeSessions(id: string): Promise<void> {
    await this.findOrThrow(this.prisma, id);
    await this.sessions.revokeAllForUser(id);
  }

  async remove(actor: AuthUser, id: string): Promise<void> {
    if (id === actor.id) {
      throw new ForbiddenException('You cannot delete your own account');
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockAdmins(tx);
      await this.assertRemovable(tx, await this.findOrThrow(tx, id));
    });
    await this.sessions.revokeAllForUser(id);
    const firstPass = await this.photoKeys(this.prisma, id);
    const failed = await this.deletePhotoFiles(id, firstPass);
    if (failed.length > 0) {
      this.logger.warn(
        `Kept user ${id} because ${failed.length} photo files could not be deleted`,
      );
      throw new ServiceUnavailableException(PHOTO_DELETE_FAILED_MESSAGE);
    }
    const remaining = await this.prisma.$transaction(
      async (tx) => {
        await this.lockAdmins(tx);
        const target = await tx.user.findUnique({
          where: { id },
          select: ADMIN_USER_SELECT,
        });
        if (!target) {
          return [];
        }
        await this.assertRemovable(tx, target);
        const keys = await this.photoKeys(tx, id);
        await tx.user.delete({ where: { id }, select: { id: true } });
        return keys;
      },
      { timeout: USER_DELETE_TIMEOUT_MS },
    );
    const deleted = new Set(firstPass);
    const stragglers = await this.deletePhotoFiles(
      id,
      remaining.filter((key) => !deleted.has(key)),
    );
    if (stragglers.length > 0) {
      this.logger.error(
        `Deleted user ${id} but could not delete ${stragglers.length} of their photo files: ${stragglers.join(', ')}`,
      );
    }
    this.sessions.forgetUser(id);
    this.logger.log(`Admin ${actor.id} deleted user ${id}`);
  }

  private async assertAllowedChange(
    tx: Tx,
    actor: AuthUser,
    target: AdminUserRow,
    body: UpdateAdminUserDto,
  ): Promise<void> {
    if (target.id === actor.id && changesRoleOrStatus(target, body)) {
      throw new ForbiddenException('You cannot change your own role or status');
    }
    if (
      demotesListedAdmin(target, body, this.config.isAdminEmail(target.email))
    ) {
      throw new ConflictException(
        'This person is listed in ADMIN_EMAILS and always stays an admin',
      );
    }
    if (
      removesActiveAdmin(target, body) &&
      (await this.otherActiveAdmins(tx, target.id)) === 0
    ) {
      throw new ConflictException(LAST_ADMIN_MESSAGE);
    }
  }

  private async assertRemovable(tx: Tx, target: AdminUserRow): Promise<void> {
    if (
      isActiveAdmin(target) &&
      (await this.otherActiveAdmins(tx, target.id)) === 0
    ) {
      throw new ConflictException(LAST_ADMIN_MESSAGE);
    }
  }

  private otherActiveAdmins(tx: Tx, excludeId: string): Promise<number> {
    return tx.user.count({
      where: { role: 'admin', status: 'active', id: { not: excludeId } },
    });
  }

  private async lockAdmins(tx: Tx): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMIN_LOCK_KEY})`;
  }

  private async findOrThrow(
    client: Tx | PrismaService,
    id: string,
  ): Promise<AdminUserRow> {
    const row = await client.user.findUnique({
      where: { id },
      select: ADMIN_USER_SELECT,
    });
    if (!row) {
      throw new NotFoundException('User not found');
    }
    return row;
  }

  private toDto(
    row: AdminUserRow,
    aggregates: Map<string, UserAggregates>,
    actor: AuthUser,
  ): AdminUserDto {
    return toAdminUserDto(
      row,
      aggregates.get(row.id) ?? EMPTY_AGGREGATES,
      this.usage.effectiveBudgetUsd(row),
      row.id === actor.id,
    );
  }

  private async aggregates(
    userIds: string[] | undefined,
    now: Date,
  ): Promise<Map<string, UserAggregates>> {
    const scope = userIds ? { userId: { in: userIds } } : {};
    const { start } = utcMonthRange(utcMonthOf(now));
    const [entries, usage, sessions] = await Promise.all([
      this.prisma.entry.groupBy({
        by: ['userId'],
        where: scope,
        _count: { _all: true },
      }),
      this.prisma.aiUsage.groupBy({
        by: ['userId'],
        where: { ...scope, createdAt: { gte: start } },
        _count: { _all: true },
        _sum: { costUsd: true },
      }),
      this.prisma.session.groupBy({
        by: ['userId'],
        where: {
          ...scope,
          revokedAt: null,
          lastSeenAt: { gte: staleSessionCutoff(now) },
        },
        _count: { _all: true },
      }),
    ]);
    const result = new Map<string, UserAggregates>();
    const slot = (userId: string): UserAggregates => {
      let value = result.get(userId);
      if (!value) {
        value = { ...EMPTY_AGGREGATES };
        result.set(userId, value);
      }
      return value;
    };
    for (const row of entries) {
      slot(row.userId).entryCount = row._count._all;
    }
    for (const row of usage) {
      const value = slot(row.userId);
      value.aiRequestsMonth = row._count._all;
      value.aiCostMonthUsd = roundUsd(row._sum.costUsd ?? 0);
    }
    for (const row of sessions) {
      slot(row.userId).activeSessions = row._count._all;
    }
    return result;
  }

  private async photoKeys(
    client: Tx | PrismaService,
    userId: string,
  ): Promise<string[]> {
    const photos = await client.photo.findMany({
      where: { userId },
      select: { storageKey: true, thumbKey: true },
    });
    return photos.flatMap((photo) => [photo.storageKey, photo.thumbKey]);
  }

  private async deletePhotoFiles(
    userId: string,
    keys: readonly string[],
  ): Promise<string[]> {
    const failed: string[] = [];
    for (
      let index = 0;
      index < keys.length;
      index += PHOTO_DELETE_CONCURRENCY
    ) {
      const batch = keys.slice(index, index + PHOTO_DELETE_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((key) => this.storage.delete(key)),
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          this.logger.warn(
            `Failed to delete a photo file of user ${userId}: ${String(result.reason)}`,
          );
        }
      }
      failed.push(
        ...batch.filter(
          (_key, position) => results[position]?.status === 'rejected',
        ),
      );
    }
    return failed;
  }
}
