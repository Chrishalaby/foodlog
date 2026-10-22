import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { generateSetupCode, setupCodesMatch } from './setup-code.js';

@Injectable()
export class SetupCodeService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Setup');
  private generatedCode: string | null = null;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (
      this.config.setupCode === null &&
      (await this.prisma.user.count()) === 0
    ) {
      this.expectedCode();
    }
  }

  matches(candidate: string): boolean {
    return setupCodesMatch(candidate, this.expectedCode());
  }

  private expectedCode(): string {
    if (this.config.setupCode !== null) {
      return this.config.setupCode;
    }
    if (this.generatedCode === null) {
      this.generatedCode = generateSetupCode();
      this.logger.warn(
        `No account yet — create it in the app with setup code: ${this.generatedCode}`,
      );
    }
    return this.generatedCode;
  }
}
