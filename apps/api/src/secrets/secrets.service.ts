import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  deriveSecretKey,
  openSecret,
  sealedKeySource,
  sealSecret,
} from './secret-box.js';

export const JWT_SECRET_KEY = 'jwt_secret';
export const ENCRYPTION_SECRET_KEY = 'encryption_key';

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

  async seal(plaintext: string, purpose: string): Promise<string> {
    if (this.config.secretsKey) {
      return sealSecret(
        plaintext,
        deriveSecretKey(this.config.secretsKey),
        'env',
        purpose,
      );
    }
    const material = await this.getOrCreate(ENCRYPTION_SECRET_KEY);
    return sealSecret(plaintext, deriveSecretKey(material), 'db', purpose);
  }

  async open(sealed: string, purpose: string): Promise<string | null> {
    const source = sealedKeySource(sealed);
    const material =
      source === 'env'
        ? this.config.secretsKey
        : source === 'db'
          ? await this.find(ENCRYPTION_SECRET_KEY)
          : null;
    if (source === null || material === null) {
      return null;
    }
    return openSecret(sealed, { [source]: deriveSecretKey(material) }, purpose);
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
