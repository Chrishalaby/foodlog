import { API_LIMITS, type Goal, type MealIdeasResponse } from '@food/shared';
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
import { cleanText } from '../ai/normalize.js';
import {
  type AiMealIdeasRequest,
  type AiMealIdeasResult,
  MEAL_IDEAS_AI_PROVIDER,
  type MealIdeasAiProvider,
} from '../ai/providers/ai-provider.js';
import { AiProviderError } from '../ai/providers/ai-provider-error.js';
import { callWithOneRetry } from '../ai/providers/structured-attempts.js';
import { DaySummariesService } from '../dashboard/day-summaries.service.js';
import { FoodSearchService } from '../foods/food-search.service.js';
import { foldText } from '../foods/food-text.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { USER_BUDGET_REACHED_MESSAGE } from '../usage/usage-budget.js';
import { UsageService } from '../usage/usage.service.js';
import type { MealIdeasDto } from './meal-ideas.dto.js';
import { IDEA_FOODS_MAX, listFoods, toIdeaFood } from './meal-ideas-foods.js';
import { normalizeMealIdeas } from './meal-ideas-normalize.js';
import type { IdeaLoggedMeal } from './meal-ideas-prompt.js';

export const IDEA_LOGGED_MEALS_MAX = 30;
const DEFAULT_GOAL: Goal = 'maintain';

interface IdeasProfile {
  aiModel: string | null;
  location: string | null;
  goal: Goal;
}

interface CompletedIdeas {
  result: AiMealIdeasResult;
  attempts: RecordedAttempt[];
}

export function cleanExclusions(names: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of names) {
    const name = cleanText(raw, API_LIMITS.nameMax);
    const key = foldText(name);
    if (key && !seen.has(key)) {
      seen.add(key);
      kept.push(name);
    }
  }
  return kept.slice(0, API_LIMITS.mealIdeaExcludeMax);
}

@Injectable()
export class MealIdeasService {
  private readonly logger = new Logger(MealIdeasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiConfig: AiConfigService,
    private readonly usage: UsageService,
    private readonly recorder: AiUsageRecorder,
    private readonly summaries: DaySummariesService,
    private readonly foods: FoodSearchService,
    @Inject(MEAL_IDEAS_AI_PROVIDER)
    private readonly provider: MealIdeasAiProvider,
  ) {}

  async suggest(
    userId: string,
    body: MealIdeasDto,
  ): Promise<MealIdeasResponse> {
    await this.assertAvailable(userId);
    const [profile, day, logged, library] = await Promise.all([
      this.loadProfile(userId),
      this.summaries.forDay(userId, body.localDate),
      this.loadLogged(userId, body.localDate),
      this.foods.search(userId, { limit: IDEA_FOODS_MAX, scope: 'standalone' }),
    ]);
    const foods = listFoods(library.results);
    const request: AiMealIdeasRequest = {
      model: this.aiConfig.resolveModel(profile.aiModel, false),
      prompt: {
        count: API_LIMITS.mealIdeasMax,
        localTime: body.localTime,
        goal: profile.goal,
        trainingDay: day.trainingDay,
        location: profile.location,
        targets: day.targets,
        eaten: day.totals,
        logged,
        foods: foods.map(toIdeaFood),
        exclude: cleanExclusions(body.exclude),
        note: body.note?.trim() || null,
      },
    };
    const { result, attempts } = await this.callProvider(userId, request);
    const model = canonicalModelId(result.model || request.model);
    return {
      ...normalizeMealIdeas(result.raw, foods, request.prompt.count),
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

  private async loadProfile(userId: string): Promise<IdeasProfile> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: { aiModel: true, location: true, goal: true },
    });
    return {
      aiModel: profile?.aiModel ?? null,
      location: profile?.location?.trim() || null,
      goal: profile?.goal ?? DEFAULT_GOAL,
    };
  }

  private async loadLogged(
    userId: string,
    localDate: string,
  ): Promise<IdeaLoggedMeal[]> {
    return this.prisma.entry.findMany({
      where: { userId, localDate },
      select: { name: true, mealType: true, calories: true, protein: true },
      orderBy: [{ timestamp: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: IDEA_LOGGED_MEALS_MAX,
    });
  }

  private async callProvider(
    userId: string,
    request: AiMealIdeasRequest,
  ): Promise<CompletedIdeas> {
    const context: AttemptContext = {
      userId,
      mode: 'ideas',
      detail: null,
      requestedModel: request.model,
    };
    const attempts: RecordedAttempt[] = [];
    try {
      const result = await callWithOneRetry(
        () => this.provider.suggestMeals(request),
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
          `AI meal ideas failed after ${attempts.length} attempt(s): ${error.kind} (${error.message})`,
        );
        throw toAnalyzeHttpException(error);
      }
      throw error;
    }
  }
}
