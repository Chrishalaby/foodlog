import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const JWT_SECRET_KEY = 'jwt_secret';

export function generateSecret(): string {
  return randomBytes(48).toString('base64url');
}

@Injectable()
export class SecretsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  async jwtSecret(): Promise<string> {
    return this.config.jwtSecret ?? this.getOrCreate(JWT_SECRET_KEY);
  }

  async getOrCreate(key: string): Promise<string> {
    const existing = await this.find(key);
    if (existing !== null) {
      return existing;
    }
    await this.prisma.appSecret.createMany({
      data: { key, value: generateSecret() },
      skipDuplicates: true,
    });
    const stored = await this.find(key);
    if (stored === null) {
      throw new Error(`Secret "${key}" could not be stored`);
    }
    return stored;
  }

  private async find(key: string): Promise<string | null> {
    const row = await this.prisma.appSecret.findUnique({
      where: { key },
      select: { value: true },
    });
    return row?.value ?? null;
  }
}
