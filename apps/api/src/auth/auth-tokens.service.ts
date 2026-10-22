import type {
  AcceptAuthTokenRequest,
  AuthTokenInfoResponse,
  AuthTokenType,
  UserDto,
  UserRole,
} from '@food/shared';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthToken, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from './accounts.service.js';
import { INVITE_TTL_MS, RESET_TTL_MS } from './auth.constants.js';
import type { SessionResult } from './auth.types.js';
import {
  AUTH_TOKEN_INCLUDE,
  type AuthTokenWithCreator,
  lockEmail,
  pendingTokens,
  revokePendingTokens,
} from './auth-token-queries.js';
import {
  type AuthTokenState,
  authTokenState,
  tokenExpiry,
} from './auth-token-state.js';
import { createOpaqueToken, opaqueTokenHash } from './opaque-tokens.js';
import { hashPassword } from './passwords.js';
import { SessionsService } from './sessions.service.js';
import { USER_DTO_SELECT } from './user-mapper.js';

type Client = Prisma.TransactionClient | PrismaService;
type TokenReason = NonNullable<AuthTokenInfoResponse['reason']>;

export interface IssueAuthToken {
  type: AuthTokenType;
  email: string;
  name: string | null;
  role: UserRole;
  userId?: string | null;
  createdById?: string | null;
  accessRequestId?: string | null;
}

export interface IssuedAuthToken {
  row: AuthTokenWithCreator;
  token: string;
}

const TOKEN_TTL_MS: Record<AuthTokenType, number> = {
  invite: INVITE_TTL_MS,
  reset: RESET_TTL_MS,
};

const NOT_FOUND_INFO: AuthTokenInfoResponse = {
  type: null,
  email: null,
  name: null,
  valid: false,
  reason: 'not_found',
  expiresAt: null,
};

const UNUSABLE_MESSAGES: Record<Exclude<AuthTokenState, 'valid'>, string> = {
  used: 'This link was already used',
  revoked: 'This link was revoked',
  expired: 'This link has expired',
};

export const ACCOUNT_EXISTS_MESSAGE =
  'An account already exists for this email';
const INVALID_LINK_MESSAGE = 'This link is not valid';

@Injectable()
export class AuthTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: AccountsService,
    private readonly sessions: SessionsService,
  ) {}

  async issue(
    client: Client,
    input: IssueAuthToken,
    now: Date = new Date(),
  ): Promise<IssuedAuthToken> {
    const { token, hash } = createOpaqueToken();
    const row = await client.authToken.create({
      data: {
        type: input.type,
        email: input.email,
        name: input.name,
        role: input.role,
        userId: input.userId ?? null,
        createdById: input.createdById ?? null,
        accessRequestId: input.accessRequestId ?? null,
        tokenHash: hash,
        createdAt: now,
        expiresAt: tokenExpiry(now, TOKEN_TTL_MS[input.type]),
      },
      include: AUTH_TOKEN_INCLUDE,
    });
    return { row, token };
  }

  async info(
    rawToken: string,
    now: Date = new Date(),
  ): Promise<AuthTokenInfoResponse> {
    const token = await this.find(rawToken);
    if (!token) {
      return NOT_FOUND_INFO;
    }
    const reason = await this.unusableReason(token, now);
    return {
      type: token.type,
      email: token.email,
      name: token.name,
      valid: reason === null,
      reason,
      expiresAt: token.expiresAt.toISOString(),
    };
  }

  async accept(
    rawToken: string,
    request: AcceptAuthTokenRequest,
    userAgent: string | null,
    now: Date = new Date(),
  ): Promise<SessionResult> {
    const token = await this.find(rawToken);
    if (!token) {
      throw new NotFoundException(INVALID_LINK_MESSAGE);
    }
    this.assertUsable(await this.unusableReason(token, now));
    const passwordHash = await hashPassword(request.password);
    const user =
      token.type === 'invite'
        ? await this.acceptInvite(token, request, passwordHash, now)
        : await this.acceptReset(token, passwordHash, now);
    const sessionToken = await this.sessions.create(user.id, userAgent, now);
    return { user, token: sessionToken };
  }

  private find(rawToken: string): Promise<AuthToken | null> {
    const tokenHash = opaqueTokenHash(rawToken);
    if (tokenHash === null) {
      return Promise.resolve(null);
    }
    return this.prisma.authToken.findUnique({ where: { tokenHash } });
  }

  private async unusableReason(
    token: AuthToken,
    now: Date,
  ): Promise<TokenReason | null> {
    const state = authTokenState(token, now);
    if (
      token.type === 'invite' &&
      (await this.accounts.emailInUse(token.email))
    ) {
      return 'account_exists';
    }
    return state === 'valid' ? null : state;
  }

  private assertUsable(reason: TokenReason | null): void {
    switch (reason) {
      case null:
        return;
      case 'not_found':
        throw new NotFoundException(INVALID_LINK_MESSAGE);
      case 'account_exists':
        throw new ConflictException(ACCOUNT_EXISTS_MESSAGE);
      default:
        throw new GoneException(UNUSABLE_MESSAGES[reason]);
    }
  }

  private async claim(
    tx: Prisma.TransactionClient,
    token: AuthToken,
    now: Date,
  ): Promise<void> {
    const { count } = await tx.authToken.updateMany({
      where: pendingTokens({ id: token.id, expiresAt: { gt: now } }),
      data: { usedAt: now },
    });
    if (count === 0) {
      const current = await tx.authToken.findUnique({
        where: { id: token.id },
        select: { expiresAt: true, usedAt: true, revokedAt: true },
      });
      const state = current ? authTokenState(current, now) : 'revoked';
      throw new GoneException(
        UNUSABLE_MESSAGES[state === 'valid' ? 'used' : state],
      );
    }
  }

  private async acceptInvite(
    token: AuthToken,
    request: AcceptAuthTokenRequest,
    passwordHash: string,
    now: Date,
  ): Promise<UserDto> {
    return this.prisma.$transaction(async (tx) => {
      await lockEmail(tx, token.email);
      await this.claim(tx, token, now);
      if (await this.accounts.emailInUse(token.email, tx)) {
        throw new ConflictException(ACCOUNT_EXISTS_MESSAGE);
      }
      const user = await this.accounts.create(tx, {
        email: token.email,
        passwordHash,
        name: request.name ?? token.name,
        role: token.role,
      });
      if (token.accessRequestId) {
        await tx.accessRequest.updateMany({
          where: { id: token.accessRequestId, acceptedAt: null },
          data: { acceptedAt: now },
        });
      }
      await revokePendingTokens(
        tx,
        { type: 'invite', email: token.email },
        now,
      );
      return user;
    });
  }

  private async acceptReset(
    token: AuthToken,
    passwordHash: string,
    now: Date,
  ): Promise<UserDto> {
    const userId = token.userId;
    if (!userId) {
      throw new NotFoundException(INVALID_LINK_MESSAGE);
    }
    const user = await this.prisma.$transaction(async (tx) => {
      await this.claim(tx, token, now);
      const account = await tx.user.findUnique({
        where: { id: userId },
        select: { status: true },
      });
      if (!account) {
        throw new NotFoundException(INVALID_LINK_MESSAGE);
      }
      if (account.status !== 'active') {
        throw new ForbiddenException('This account is disabled');
      }
      await revokePendingTokens(tx, { type: 'reset', userId }, now);
      await this.sessions.revokeAllForUser(userId, { now }, tx);
      return tx.user.update({
        where: { id: userId },
        data: { passwordHash },
        select: USER_DTO_SELECT,
      });
    });
    this.sessions.forgetUser(userId);
    return this.accounts.applyAdminEmails(user);
  }
}
