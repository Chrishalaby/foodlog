import type {
  AccessRequestStatus,
  AdminAccessRequestDto,
  InviteLinkResponse,
} from '@food/shared';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types.js';
import { authTokenLink } from '../auth/auth-links.js';
import { lockEmail, revokePendingTokens } from '../auth/auth-token-queries.js';
import {
  ACCOUNT_EXISTS_MESSAGE,
  AuthTokensService,
} from '../auth/auth-tokens.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ACCESS_REQUEST_INCLUDE,
  type AccessRequestWithDecider,
  toAdminAccessRequestDto,
  toAdminInviteDto,
} from './admin.mappers.js';

const ACCESS_REQUEST_LIST_LIMIT = 200;
const ALREADY_ACCEPTED_MESSAGE =
  'This request was already used to create an account';

type Tx = Prisma.TransactionClient;

@Injectable()
export class AdminAccessRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: AuthTokensService,
  ) {}

  async list(status?: AccessRequestStatus): Promise<AdminAccessRequestDto[]> {
    const rows = await this.prisma.accessRequest.findMany({
      where: status ? { status } : {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: ACCESS_REQUEST_LIST_LIMIT,
      include: ACCESS_REQUEST_INCLUDE,
    });
    const accounts = await this.prisma.user.findMany({
      where: { email: { in: [...new Set(rows.map((row) => row.email))] } },
      select: { email: true },
    });
    const withAccount = new Set(accounts.map((account) => account.email));
    return rows.map((row) =>
      toAdminAccessRequestDto(row, withAccount.has(row.email)),
    );
  }

  async approve(
    actor: AuthUser,
    id: string,
    baseUrl: string,
  ): Promise<InviteLinkResponse> {
    const now = new Date();
    const { row, token } = await this.prisma.$transaction(async (tx) => {
      const request = await this.findLocked(tx, id);
      if (request.acceptedAt) {
        throw new ConflictException(ALREADY_ACCEPTED_MESSAGE);
      }
      if (await this.hasAccount(tx, request.email)) {
        throw new ConflictException(ACCOUNT_EXISTS_MESSAGE);
      }
      if (request.status !== 'approved') {
        await tx.accessRequest.update({
          where: { id },
          data: { status: 'approved', decidedAt: now, decidedById: actor.id },
          select: { id: true },
        });
      }
      await revokePendingTokens(
        tx,
        { type: 'invite', email: request.email },
        now,
      );
      return this.tokens.issue(
        tx,
        {
          type: 'invite',
          email: request.email,
          name: request.name,
          role: 'member',
          createdById: actor.id,
          accessRequestId: id,
        },
        now,
      );
    });
    return {
      invite: toAdminInviteDto(row, now),
      url: authTokenLink(baseUrl, 'invite', token),
    };
  }

  async reject(actor: AuthUser, id: string): Promise<AdminAccessRequestDto> {
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const request = await this.findLocked(tx, id);
      if (request.acceptedAt) {
        throw new ConflictException(ALREADY_ACCEPTED_MESSAGE);
      }
      await revokePendingTokens(tx, { accessRequestId: id }, now);
      if (request.status === 'rejected') {
        return request;
      }
      return tx.accessRequest.update({
        where: { id },
        data: { status: 'rejected', decidedAt: now, decidedById: actor.id },
        include: ACCESS_REQUEST_INCLUDE,
      });
    });
    return toAdminAccessRequestDto(
      updated,
      await this.hasAccount(this.prisma, updated.email),
    );
  }

  private async findLocked(
    tx: Tx,
    id: string,
  ): Promise<AccessRequestWithDecider> {
    await lockEmail(tx, (await this.findOrThrow(tx, id)).email);
    return this.findOrThrow(tx, id);
  }

  private async findOrThrow(
    tx: Tx,
    id: string,
  ): Promise<AccessRequestWithDecider> {
    const request = await tx.accessRequest.findUnique({
      where: { id },
      include: ACCESS_REQUEST_INCLUDE,
    });
    if (!request) {
      throw new NotFoundException('Access request not found');
    }
    return request;
  }

  private async hasAccount(
    client: Tx | PrismaService,
    email: string,
  ): Promise<boolean> {
    const user = await client.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return user !== null;
  }
}
