import type { MenuScanResponse } from '@food/shared';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AiConfigService } from '../ai/ai-config.service.js';
import {
  type AttemptContext,
  AiUsageRecorder,
  type RecordedAttempt,
  summarizeUsage,
} from '../ai/ai-usage.recorder.js';
import {
  AI_NOT_CONFIGURED_MESSAGE,
  BUDGET_REACHED_MESSAGE,
  toAnalyzeHttpException,
  tooManyRequests,
} from '../ai/analysis-errors.js';
import { canonicalModelId } from '../ai/models.js';
import {
  type AiMenuRequest,
  type AiMenuResult,
  MENU_AI_PROVIDER,
  type MenuAiProvider,
} from '../ai/providers/ai-provider.js';
import { AiProviderError } from '../ai/providers/ai-provider-error.js';
import { callWithOneRetry } from '../ai/providers/structured-attempts.js';
import { toJpegDataUrl } from '../ai/uploaded-image.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { USER_BUDGET_REACHED_MESSAGE } from '../usage/usage-budget.js';
import { UsageService } from '../usage/usage.service.js';
import type { MenuScanDto } from './compare.dto.js';
import { encodeMenuImages, MENU_IMAGE_DETAIL } from './menu-images.js';
import { normalizeMenuScan } from './menu-normalize.js';

interface MenuProfile {
  aiModel: string | null;
  location: string | null;
}

interface CompletedMenuScan {
  result: AiMenuResult;
  attempts: RecordedAttempt[];
}

@Injectable()
export class CompareService {
  private readonly logger = new Logger(CompareService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiConfig: AiConfigService,
    private readonly usage: UsageService,
    private readonly recorder: AiUsageRecorder,
    @Inject(MENU_AI_PROVIDER) private readonly provider: MenuAiProvider,
  ) {}

  async scanMenu(
    userId: string,
    fields: MenuScanDto,
    images: readonly Buffer[],
  ): Promise<MenuScanResponse> {
    await this.assertAvailable(userId);
    const [profile, jpegs] = await Promise.all([
      this.loadProfile(userId),
      encodeMenuImages(images),
    ]);
    const request: AiMenuRequest = {
      model: this.aiConfig.resolveModel(profile.aiModel, false),
      images: jpegs.map((jpeg) => ({
        dataUrl: toJpegDataUrl(jpeg),
        detail: MENU_IMAGE_DETAIL,
      })),
      prompt: {
        description: fields.description?.trim() || null,
        imageCount: jpegs.length,
        location: profile.location,
      },
    };
    const { result, attempts } = await this.callProvider(userId, request);
    const model = canonicalModelId(result.model || request.model);
    return {
      ...normalizeMenuScan(result.raw),
      usage: summarizeUsage(model, attempts),
    };
  }

  private async assertAvailable(userId: string): Promise<void> {
    if (this.aiConfig.provider === 'unconfigured') {
      throw new ServiceUnavailableException(AI_NOT_CONFIGURED_MESSAGE);
    }
    const [globalReached, userReached] = await Promise.all([
      this.usage.isMonthlyBudgetReached(),
      this.usage.isUserBudgetReached(userId),
    ]);
    if (globalReached) {
      throw tooManyRequests(BUDGET_REACHED_MESSAGE);
    }
    if (userReached) {
      throw tooManyRequests(USER_BUDGET_REACHED_MESSAGE);
    }
  }

  private async loadProfile(userId: string): Promise<MenuProfile> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { aiModel: true, location: true },
    });
    return {
      aiModel: profile?.aiModel ?? null,
      location: profile?.location?.trim() || null,
    };
  }

  private async callProvider(
    userId: string,
    request: AiMenuRequest,
  ): Promise<CompletedMenuScan> {
    const context: AttemptContext = {
      userId,
      mode: 'menu',
      detail: MENU_IMAGE_DETAIL,
      requestedModel: request.model,
    };
    const attempts: RecordedAttempt[] = [];
    try {
      const result = await callWithOneRetry(
        () => this.provider.extractMenu(request),
        {
          onAttempt: async (record) => {
            attempts.push(await this.recorder.record(context, record));
          },
        },
      );
      return { result, attempts };
    } catch (error) {
      if (error instanceof AiProviderError) {
        this.logger.warn(
          `AI menu scan failed after ${attempts.length} attempt(s): ${error.kind} (${error.message})`,
        );
        throw toAnalyzeHttpException(error);
      }
      throw error;
    }
  }
}
