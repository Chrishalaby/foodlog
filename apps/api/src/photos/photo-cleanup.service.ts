import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PhotosService } from './photos.service.js';

const HOUR_MS = 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 60 * 1000;
const CLEANUP_INTERVAL_MS = HOUR_MS;
const ANALYSIS_RETENTION_MS = 7 * 24 * HOUR_MS;
const ORPHAN_PHOTO_GRACE_MS = 24 * HOUR_MS;

export interface CleanupResult {
  analyses: number;
  photos: number;
}

@Injectable()
export class PhotoCleanupService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PhotoCleanupService.name);
  private readonly timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.nodeEnv === 'test') {
      return;
    }
    const tick = (): void => void this.runScheduled();
    this.timers.push(
      setTimeout(tick, FIRST_RUN_DELAY_MS).unref(),
      setInterval(tick, CLEANUP_INTERVAL_MS).unref(),
    );
  }

  onApplicationShutdown(): void {
    for (const timer of this.timers.splice(0)) {
      clearTimeout(timer);
    }
  }

  async runCleanup(now: Date = new Date()): Promise<CleanupResult> {
    const { count: analyses } = await this.prisma.analysis.deleteMany({
      where: {
        createdAt: { lt: new Date(now.getTime() - ANALYSIS_RETENTION_MS) },
        entries: { none: {} },
        drafts: { none: {} },
      },
    });
    const photos = await this.photos.deleteOrphansCreatedBefore(
      new Date(now.getTime() - ORPHAN_PHOTO_GRACE_MS),
    );
    return { analyses, photos };
  }

  private async runScheduled(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const result = await this.runCleanup();
      if (result.analyses > 0 || result.photos > 0) {
        this.logger.log(
          `Removed ${result.analyses} stale analyses and ${result.photos} orphan photos`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Photo cleanup failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }
}
