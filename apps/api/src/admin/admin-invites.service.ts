import type { AdminInviteDto, InviteLinkResponse } from '@food/shared';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountsService } from '../auth/accounts.service.js';
import type { AuthUser } from '../auth/auth.types.js';
import { authTokenLink } from '../auth/auth-links.js';
import {
  AUTH_TOKEN_INCLUDE,
  type AuthTokenWithCreator,
  lockEmail,
  revokePendingTokens,
  sameRecipientTokens,
} from '../auth/auth-token-queries.js';
import {
  ACCOUNT_EXISTS_MESSAGE,
  AuthTokensService,
  type IssuedAuthToken,
} from '../auth/auth-tokens.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { CreateInviteDto } from './admin.dto.js';
import { toAdminInviteDto } from './admin.mappers.js';

const INVITE_LIST_LIMIT = 200;
const ALREADY_USED_MESSAGE = 'This link was already used';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AdminInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly tokens: AuthTokensService,
  ) {}

  async list(now: Date = new Date()): Promise<AdminInviteDto[]> {
    const rows = await this.prisma.authToken.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: INVITE_LIST_LIMIT,
      include: AUTH_TOKEN_INCLUDE,
    });
    return rows.map((row) => toAdminInviteDto(row, now));
  }

  async create(
    actor: AuthUser,
    body: CreateInviteDto,
    baseUrl: string,
  ): Promise<InviteLinkResponse> {
    const now = new Date();
    const issued = await this.prisma.$transaction(async (tx) => {
      await lockEmail(tx, body.email);
      if (await this.accounts.emailInUse(body.email, tx)) {
        throw new ConflictException(ACCOUNT_EXISTS_MESSAGE);
      }
      await revokePendingTokens(tx, { type: 'invite', email: body.email }, now);
      return this.tokens.issue(
        tx,
        {
          type: 'invite',
          email: body.email,
          name: body.name ?? null,
          role: body.role ?? 'member',
          createdById: actor.id,
        },
        now,
      );
    });
    return this.toLink(issued, baseUrl, now);
  }

  async regenerate(
    actor: AuthUser,
    id: string,
    baseUrl: string,
  ): Promise<InviteLinkResponse> {
    const now = new Date();
    const issued = await this.prisma.$transaction(async (tx) => {
      const current = await this.findLocked(tx, id);
      if (current.usedAt) {
        throw new ConflictException(ALREADY_USED_MESSAGE);
      }
      await this.assertStillApplicable(tx, current);
      await revokePendingTokens(tx, sameRecipientTokens(current), now);
      return this.tokens.issue(
        tx,
        {
          type: current.type,
          email: current.email,
          name: current.name,
          role: current.role,
          userId: current.userId,
          createdById: actor.id,
          accessRequestId: current.accessRequestId,
        },
        now,
      );
    });
    return this.toLink(issued, baseUrl, now);
  }

  async revoke(id: string): Promise<void> {
    const current = await this.findOrThrow(this.prisma, id);
    if (current.usedAt) {
      throw new ConflictException(ALREADY_USED_MESSAGE);
    }
    await revokePendingTokens(this.prisma, { id }, new Date());
  }

  private async assertStillApplicable(
    tx: Tx,
    token: AuthTokenWithCreator,
  ): Promise<void> {
    if (token.type === 'invite') {
      if (await this.accounts.emailInUse(token.email, tx)) {
        throw new ConflictException(ACCOUNT_EXISTS_MESSAGE);
      }
      return;
    }
    const user = token.userId
      ? await tx.user.findUnique({
          where: { id: token.userId },
          select: { status: true },
        })
      : null;
    if (user?.status !== 'active') {
      throw new ConflictException(
        'Enable this account before creating a reset link',
      );
    }
  }

  private async findLocked(tx: Tx, id: string): Promise<AuthTokenWithCreator> {
    await lockEmail(tx, (await this.findOrThrow(tx, id)).email);
    return this.findOrThrow(tx, id);
  }

  private async findOrThrow(
    client: Tx | PrismaService,
    id: string,
  ): Promise<AuthTokenWithCreator> {
    const token = await client.authToken.findUnique({
      where: { id },
      include: AUTH_TOKEN_INCLUDE,
    });
    if (!token) {
      throw new NotFoundException('Invite not found');
    }
    return token;
  }

  private toLink(
    issued: IssuedAuthToken,
    baseUrl: string,
    now: Date,
  ): InviteLinkResponse {
    return {
      invite: toAdminInviteDto(issued.row, now),
      url: authTokenLink(baseUrl, issued.row.type, issued.token),
    };
  }
}
