import type { UserDto, UserRole } from '@food/shared';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { USER_DTO_SELECT } from './user-mapper.js';

export interface NewAccount {
  email: string;
  passwordHash: string;
  name: string | null;
  role: UserRole;
}

type Client = Prisma.TransactionClient | PrismaService;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  roleFor(email: string, requested: UserRole): UserRole {
    return this.config.isAdminEmail(email) ? 'admin' : requested;
  }

  create(client: Client, account: NewAccount): Promise<UserDto> {
    return client.user.create({
      data: {
        email: account.email,
        passwordHash: account.passwordHash,
        name: account.name,
        role: this.roleFor(account.email, account.role),
        profile: { create: {} },
      },
      select: USER_DTO_SELECT,
    });
  }

  async emailInUse(
    email: string,
    client: Client = this.prisma,
  ): Promise<boolean> {
    const user = await client.user.findUnique({
      where: { email },
      select: { id: true },
    });
    return user !== null;
  }

  async applyAdminEmails(user: UserDto): Promise<UserDto> {
    if (user.role === 'admin' || !this.config.isAdminEmail(user.email)) {
      return user;
    }
    return this.prisma.user.update({
      where: { id: user.id },
      data: { role: 'admin' },
      select: USER_DTO_SELECT,
    });
  }
}
