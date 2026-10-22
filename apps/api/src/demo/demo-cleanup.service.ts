import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SessionsService } from '../auth/sessions.service.js';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from '../storage/storage.service.js';

export const DEMO_CLEANUP_INTERVAL_MS = 15 * 60_000;
export const DEMO_CLEANUP_BATCH = 50;

@Injectable()
export class DemoCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(DemoCleanupService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly sessions: SessionsService,
    private readonly storage: StorageService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.demo.enabled || this.config.nodeEnv === 'test') {
      return;
    }
    this.timer = setInterval(
      () => void this.runScheduled(),
      DEMO_CLEANUP_INTERVAL_MS,
    ).unref();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async removeExpired(now: Date = new Date()): Promise<number> {
    const expired = await this.prisma.user.findMany({
      where: { demoExpiresAt: { lte: now } },
      select: { id: true },
      orderBy: { demoExpiresAt: 'asc' },
      take: DEMO_CLEANUP_BATCH,
    });
    let removed = 0;
    for (const { id } of expired) {
      if (await this.removeUser(id)) {
        removed += 1;
      }
    }
    return removed;
  }

  private async runScheduled(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const removed = await this.removeExpired();
      if (removed > 0) {
        this.logger.log(`Removed ${removed} expired demo accounts`);
      }
    } catch (error) {
      this.logger.error(
        `Demo cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async removeUser(id: string): Promise<boolean> {
    await this.sessions.revokeAllForUser(id);
    const photos = await this.prisma.photo.findMany({
      where: { userId: id },
      select: { storageKey: true, thumbKey: true },
    });
    const results = await Promise.allSettled(
      photos
        .flatMap((photo) => [photo.storageKey, photo.thumbKey])
        .map((key) => this.storage.delete(key)),
    );
    if (results.some((result) => result.status === 'rejected')) {
      this.logger.warn(
        `Kept expired demo account ${id} because some photo files could not be deleted`,
      );
      return false;
    }
    await this.prisma.user.deleteMany({
      where: { id, demoExpiresAt: { not: null } },
    });
    this.sessions.forgetUser(id);
    return true;
  }
}
