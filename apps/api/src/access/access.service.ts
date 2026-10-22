import type {
  AccessRequestStatusResponse,
  CreateAccessRequestResponse,
} from '@food/shared';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountsService } from '../auth/accounts.service.js';
import type { SessionResult } from '../auth/auth.types.js';
import {
  lockEmail,
  pendingTokens,
  revokePendingTokens,
} from '../auth/auth-token-queries.js';
import { ACCOUNT_EXISTS_MESSAGE } from '../auth/auth-tokens.service.js';
import { createOpaqueToken, opaqueTokenHash } from '../auth/opaque-tokens.js';
import { hashPassword } from '../auth/passwords.js';
import { SessionsService } from '../auth/sessions.service.js';
import type { AccessRequest } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  AcceptAccessRequestDto,
  CreateAccessRequestDto,
} from './access.dto.js';
import { toAccessStatus, UNKNOWN_ACCESS_STATUS } from './access-status.js';

const ACCESS_LOCK_NAMESPACE = 462_011_732;
const REQUEST_USED_MESSAGE =
  'This request can no longer be used to create an account';

@Injectable()
export class AccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
  ) {}

  async create(
    request: CreateAccessRequestDto,
  ): Promise<CreateAccessRequestResponse> {
    const { token, hash } = createOpaqueToken();
    if (request.website) {
      return { statusToken: token };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ACCESS_LOCK_NAMESPACE}::int, hashtext(${request.email}))`;
      const pending = await tx.accessRequest.findFirst({
        where: { email: request.email, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (pending) {
        await tx.accessRequest.update({
          where: { id: pending.id },
          data: { statusTokenHash: hash },
          select: { id: true },
        });
        return;
      }
      await tx.accessRequest.create({
        data: {
          email: request.email,
          name: request.name,
          message: request.message ?? null,
          statusTokenHash: hash,
        },
        select: { id: true },
      });
    });
    return { statusToken: token };
  }

  async status(statusToken: string): Promise<AccessRequestStatusResponse> {
    const request = await this.findByToken(statusToken);
    if (!request) {
      return UNKNOWN_ACCESS_STATUS;
    }
    return toAccessStatus(
      request,
      await this.accounts.emailInUse(request.email),
    );
  }

  async accept(
    body: AcceptAccessRequestDto,
    userAgent: string | null,
    now: Date = new Date(),
  ): Promise<SessionResult> {
    const request = await this.findByToken(body.statusToken);
    if (!request) {
      throw new NotFoundException('Access request not found');
    }
    if (request.status !== 'approved') {
      throw new ForbiddenException('This request has not been approved yet');
    }
    if (request.acceptedAt) {
      throw new ConflictException(ACCOUNT_EXISTS_MESSAGE);
    }
    const passwordHash = await hashPassword(body.password);
    const user = await this.prisma.$transaction(async (tx) => {
      await lockEmail(tx, request.email);
      const { count } = await tx.accessRequest.updateMany({
        where: { id: request.id, status: 'approved', acceptedAt: null },
        data: { acceptedAt: now },
      });
      if (count === 0) {
        throw new ConflictException(REQUEST_USED_MESSAGE);
      }
      if (await this.accounts.emailInUse(request.email, tx)) {
        throw new ConflictException(ACCOUNT_EXISTS_MESSAGE);
      }
      const created = await this.accounts.create(tx, {
        email: request.email,
        passwordHash,
        name: request.name,
        role: 'member',
      });
      await tx.authToken.updateMany({
        where: pendingTokens({
          accessRequestId: request.id,
          expiresAt: { gt: now },
        }),
        data: { usedAt: now },
      });
      await revokePendingTokens(
        tx,
        {
          OR: [
            { accessRequestId: request.id },
            { type: 'invite', email: request.email },
          ],
        },
        now,
      );
      return created;
    });
    const token = await this.sessions.create(user.id, userAgent, now);
    return { user, token };
  }

  private findByToken(statusToken: string): Promise<AccessRequest | null> {
    const statusTokenHash = opaqueTokenHash(statusToken);
    if (statusTokenHash === null) {
      return Promise.resolve(null);
    }
    return this.prisma.accessRequest.findUnique({ where: { statusTokenHash } });
  }
}
