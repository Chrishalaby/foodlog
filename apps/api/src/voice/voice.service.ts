import type { TranscribeResponse } from '@food/shared';
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
} from '../ai/ai-usage.recorder.js';
import {
  AI_NOT_CONFIGURED_MESSAGE,
  BUDGET_REACHED_MESSAGE,
  toAnalyzeHttpException,
  tooManyRequests,
} from '../ai/analysis-errors.js';
import { AiProviderError } from '../ai/providers/ai-provider-error.js';
import { callWithOneRetry } from '../ai/providers/structured-attempts.js';
import { AppConfig } from '../config/app-config.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PRODUCT_ORDER } from '../products/product-data.js';
import { USER_BUDGET_REACHED_MESSAGE } from '../usage/usage-budget.js';
import { UsageService } from '../usage/usage.service.js';
import {
  buildVoiceVocabulary,
  VOICE_MEAL_NAMES_DAYS,
  VOICE_MEAL_NAMES_MAX,
  VOICE_SAVED_FOODS_MAX,
} from './voice-prompt.js';
import {
  VOICE_AI_PROVIDER,
  type VoiceAiProvider,
  type VoiceAudio,
  type VoiceTranscribeRequest,
  type VoiceTranscribeResult,
} from './voice-provider.js';
import { voiceAttemptCostUsd } from './voice-usage.js';

export const VOICE_NOT_CONFIGURED_MESSAGE =
  'Voice dictation is not configured on this server';

const DAY_MS = 86_400_000;

@Injectable()
export class VoiceService {
  private readonly logger = new Logger(VoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
    private readonly aiConfig: AiConfigService,
    private readonly usage: UsageService,
    private readonly recorder: AiUsageRecorder,
    @Inject(VOICE_AI_PROVIDER) private readonly provider: VoiceAiProvider,
  ) {}

  async transcribe(
    userId: string,
    audio: VoiceAudio,
  ): Promise<TranscribeResponse> {
    await this.assertAvailable(userId);
    const request: VoiceTranscribeRequest = {
      model: this.config.ai.transcribeModel.trim(),
      audio,
      vocabulary: await this.loadVocabulary(userId),
      location: await this.loadLocation(userId),
    };
    const result = await this.callProvider(userId, request);
    return { text: result.raw.text.trim() };
  }

  private async assertAvailable(userId: string): Promise<void> {
    if (this.aiConfig.provider === 'unconfigured') {
      throw new ServiceUnavailableException(AI_NOT_CONFIGURED_MESSAGE);
    }
    if (!this.aiConfig.voiceEnabled) {
      throw new ServiceUnavailableException(VOICE_NOT_CONFIGURED_MESSAGE);
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

  private async loadLocation(userId: string): Promise<string | null> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { location: true },
    });
    return profile?.location ?? null;
  }

  private async loadVocabulary(userId: string): Promise<string[]> {
    const since = new Date(Date.now() - VOICE_MEAL_NAMES_DAYS * DAY_MS);
    const [savedFoods, meals] = await Promise.all([
      this.prisma.product.findMany({
        where: { userId },
        orderBy: PRODUCT_ORDER,
        take: VOICE_SAVED_FOODS_MAX,
        select: { name: true, brand: true },
      }),
      this.prisma.entry.groupBy({
        by: ['name'],
        where: { userId, timestamp: { gte: since } },
        _count: { name: true },
        orderBy: [{ _count: { name: 'desc' } }, { name: 'asc' }],
        take: VOICE_MEAL_NAMES_MAX,
      }),
    ]);
    return buildVoiceVocabulary(
      savedFoods,
      meals.map(({ name }) => name),
    );
  }

  private async callProvider(
    userId: string,
    request: VoiceTranscribeRequest,
  ): Promise<VoiceTranscribeResult> {
    const context: AttemptContext = {
      userId,
      mode: 'voice',
      detail: null,
      requestedModel: request.model,
    };
    let attempts = 0;
    try {
      return await callWithOneRetry(() => this.provider.transcribe(request), {
        onAttempt: async (record) => {
          attempts += 1;
          const costUsd = voiceAttemptCostUsd(record, request.model, (model) =>
            this.logger.warn(
              `No transcription price known for model "${model}"; recording its cost as 0`,
            ),
          );
          await this.recorder.record(context, record, costUsd);
        },
      });
    } catch (error) {
      if (error instanceof AiProviderError) {
        this.logger.warn(
          `Voice transcription failed after ${attempts} attempt(s): ${error.kind} (${error.message})`,
        );
        throw toAnalyzeHttpException(error);
      }
      throw error;
    }
  }
}
