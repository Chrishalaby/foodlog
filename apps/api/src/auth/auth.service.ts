import { randomBytes } from 'node:crypto';
import type {
  AuthStatusResponse,
  ChangePasswordRequest,
  DemoStatusDto,
  LoginRequest,
  SetupRequest,
  UpdateAccountRequest,
  UserDto,
} from '@food/shared';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountsService } from './accounts.service.js';
import { INVALID_CREDENTIALS_MESSAGE } from './auth.constants.js';
import type { AuthUser, SessionResult } from './auth.types.js';
import { revokePendingTokens } from './auth-token-queries.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { SessionsService } from './sessions.service.js';
import { SetupCodeService } from './setup-code.service.js';
import { toUserDto, USER_DTO_SELECT } from './user-mapper.js';

const SETUP_LOCK_KEY = 462_011_730;

export const DEMO_ACCOUNT_MESSAGE =
  'Demo accounts cannot change their password';

export interface StatusResult {
  status: AuthStatusResponse;
  renewedToken: string | null;
}

@Injectable()
export class AuthService {
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly setupCodes: SetupCodeService,
    private readonly accounts: AccountsService,
    private readonly config: AppConfig,
  ) {}

  async status(token: string | null): Promise<StatusResult> {
    const [setupRequired, session] = await Promise.all([
      this.isSetupRequired(),
      this.sessions.authenticate(token),
    ]);
    const demo = this.config.demo.enabled
      ? await this.demoStatus(session?.user.id ?? null)
      : null;
    return {
      status: {
        setupRequired: demo ? false : setupRequired,
        authenticated: session !== null,
        user: session ? toUserDto(session.user) : null,
        ...(demo ? { demo } : {}),
        ...(this.config.notesEnabled ? { notes: true } : {}),
      },
      renewedToken: session?.renewedToken ?? null,
    };
  }

  async setup(
    request: SetupRequest,
    userAgent: string | null,
  ): Promise<SessionResult> {
    if (!(await this.isSetupRequired())) {
      throw new ConflictException('An account already exists');
    }
    if (!this.setupCodes.matches(request.setupCode)) {
      throw new ForbiddenException('Invalid setup code');
    }
    const passwordHash = await hashPassword(request.password);
    const user = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK_KEY})`;
      if ((await tx.user.count()) > 0) {
        throw new ConflictException('An account already exists');
      }
      return this.accounts.create(tx, {
        email: request.email,
        passwordHash,
        name: null,
        role: 'admin',
      });
    });
    return this.startSession(user, userAgent);
  }

  async login(
    request: LoginRequest,
    userAgent: string | null,
  ): Promise<SessionResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: request.email },
      select: { ...USER_DTO_SELECT, passwordHash: true, status: true },
    });
    const passwordHash = user?.passwordHash ?? (await this.getDummyHash());
    const valid = await verifyPassword(passwordHash, request.password);
    if (!user || !valid || user.status !== 'active') {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }
    const account = await this.accounts.applyAdminEmails(toUserDto(user));
    if (account.role !== user.role) {
      this.sessions.forgetUser(account.id);
    }
    return this.startSession(account, userAgent);
  }

  async changePassword(
    user: AuthUser,
    request: ChangePasswordRequest,
  ): Promise<void> {
    const stored = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true, demoExpiresAt: true },
    });
    if (!stored) {
      throw new UnauthorizedException();
    }
    if (stored.demoExpiresAt) {
      throw new ForbiddenException(DEMO_ACCOUNT_MESSAGE);
    }
    if (!(await verifyPassword(stored.passwordHash, request.currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(request.newPassword);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash },
        select: { id: true },
      });
      await revokePendingTokens(tx, { type: 'reset', userId: user.id }, now);
      await this.sessions.revokeAllForUser(
        user.id,
        { exceptSessionId: user.sessionId, now },
        tx,
      );
    });
    this.sessions.forgetUser(user.id);
  }

  async updateAccount(
    user: AuthUser,
    request: UpdateAccountRequest,
  ): Promise<UserDto> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { name: request.name },
      select: USER_DTO_SELECT,
    });
    this.sessions.forgetUser(user.id);
    return updated;
  }

  private async demoStatus(userId: string | null): Promise<DemoStatusDto> {
    if (!userId) {
      return { enabled: true, expiresAt: null };
    }
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { demoExpiresAt: true },
    });
    return {
      enabled: true,
      expiresAt: user?.demoExpiresAt?.toISOString() ?? null,
    };
  }

  private async isSetupRequired(): Promise<boolean> {
    const anyUser = await this.prisma.user.findFirst({ select: { id: true } });
    return anyUser === null;
  }

  private async startSession(
    user: UserDto,
    userAgent: string | null,
  ): Promise<SessionResult> {
    return { user, token: await this.sessions.create(user.id, userAgent) };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword(randomBytes(32).toString('base64url'));
    return this.dummyHash;
  }
}
