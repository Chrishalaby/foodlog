import {
  type AnalysisMode,
  type AnalyzeResponse,
  IMAGE_DETAILS,
  type ImageDetail,
  type ImageRole,
  type MealTiming,
} from '@food/shared';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { toPhotoRef } from '../common/mappers.js';
import type { Photo, Prisma } from '../generated/prisma/client.js';
import {
  SAVED_FOOD_SELECT,
  type SavedFood,
  toSavedFood,
} from '../my-foods/saved-food.js';
import { PhotosService } from '../photos/photos.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PRODUCT_ORDER } from '../products/product-data.js';
import { USER_BUDGET_REACHED_MESSAGE } from '../usage/usage-budget.js';
import { UsageService } from '../usage/usage.service.js';
import { AiConfigService } from './ai-config.service.js';
import {
  type AttemptContext,
  AiUsageRecorder,
  type RecordedAttempt,
  summarizeUsage,
} from './ai-usage.recorder.js';
import { analyzeWithOneRetry } from './analysis-attempts.js';
import type { FoodAnalysisOutput } from './food-analysis.schema.js';
import { splitMeals } from './meal-split.js';
import {
  AI_NOT_CONFIGURED_MESSAGE,
  BUDGET_REACHED_MESSAGE,
  toAnalyzeHttpException,
  tooManyRequests,
} from './analysis-errors.js';
import {
  type AnalysisPlan,
  answeredQuestionTexts,
  carriedPhotos,
  DEFAULT_PROFILE_AI_SETTINGS,
  type DraftStart,
  type PlannedPhoto,
  planAnalysis,
  type PreviousAnalysis,
  primaryPhoto,
  type ProfileAiSettings,
  toImageRole,
} from './analysis-plan.js';
import type { AnalyzeRequestDto } from './analyze.dto.js';
import type { AnalyzeUpload } from './analyze-uploads.js';
import { canonicalModelId } from './models.js';
import { normalizeAnalysis } from './normalize.js';
import { SAVED_FOODS_PROMPT_MAX, type SavedFoodPrompt } from './prompt.js';
import {
  type AnalysisChainParent,
  collectAnsweredQuestions,
} from './previous-analysis.js';
import {
  AI_PROVIDER,
  type AiAnalyzeRequest,
  type AiMealSplitResult,
  type AiProvider,
  type AiStructuredResult,
  type MealSplitAiProvider,
} from './providers/ai-provider.js';
import {
  type AiFailureKind,
  AiProviderError,
} from './providers/ai-provider-error.js';
import {
  callWithOneRetry,
  type StructuredAttemptRecord,
} from './providers/structured-attempts.js';
import { toJpegDataUrl } from './uploaded-image.js';

const CHAIN_SELECT = {
  previousAnalysisId: true,
  followUpAnswer: true,
  result: true,
} as const satisfies Prisma.AnalysisSelect;

interface AnalysisPhotoInput {
  photo: Photo;
  role: ImageRole;
  detail: ImageDetail;
}

interface LoadedPrevious {
  analysis: PreviousAnalysis;
  photos: ReadonlyMap<string, Photo>;
}

interface LoadedDraft {
  draft: DraftStart;
  photos: ReadonlyMap<string, Photo>;
}

interface Completed<T> {
  result: AiStructuredResult<T>;
  attempts: RecordedAttempt[];
}

interface MealToStore {
  raw: FoodAnalysisOutput;
  description: string | null;
  timing?: MealTiming;
}

const NO_FAILURE_KINDS: ReadonlySet<AiFailureKind> = new Set();
const SPLIT_FALLBACK_KINDS: ReadonlySet<AiFailureKind> = new Set([
  'bad_request',
]);

interface BilledAttempts {
  model: string;
  attempts: readonly RecordedAttempt[];
}

export function usesSavedFoods(mode: AnalysisMode): boolean {
  return mode !== 'nutrition_label';
}

function toSavedFoodPrompt(food: SavedFood): SavedFoodPrompt {
  return {
    name: food.ref.name,
    brand: food.ref.brand,
    aliases: [...food.aliases],
  };
}

function toImageDetail(value: string | null | undefined): ImageDetail {
  return (IMAGE_DETAILS as readonly string[]).includes(value ?? '')
    ? (value as ImageDetail)
    : 'high';
}

function attachPhotos(
  planned: readonly PlannedPhoto[],
  existing: ReadonlyMap<string, Photo>,
  uploaded: ReadonlyMap<number, Photo>,
): AnalysisPhotoInput[] {
  return planned.map(({ source, role, detail }) => {
    const photo =
      source.kind === 'stored'
        ? existing.get(source.photoId)
        : uploaded.get(source.index);
    if (!photo) {
      throw new NotFoundException('Photo not found');
    }
    return { photo, role, detail };
  });
}

@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly photos: PhotosService,
    private readonly aiConfig: AiConfigService,
    private readonly usage: UsageService,
    private readonly recorder: AiUsageRecorder,
    @Inject(AI_PROVIDER)
    private readonly provider: AiProvider & Partial<MealSplitAiProvider>,
  ) {}

  async analyze(
    userId: string,
    request: AnalyzeRequestDto,
    uploads: readonly AnalyzeUpload[],
  ): Promise<AnalyzeResponse> {
    await this.assertAvailable(userId);
    const [profile, previous, draft] = await Promise.all([
      this.loadProfile(userId),
      this.loadPrevious(userId, request.previousAnalysisId),
      this.loadDraft(userId, request.draftId),
    ]);
    const plan = planAnalysis(
      request,
      previous?.analysis ?? null,
      uploads,
      profile,
      draft?.draft ?? null,
    );
    const stored = await this.storeUploads(userId, plan.photos, uploads);
    try {
      const photos = attachPhotos(
        plan.photos,
        new Map([...(draft?.photos ?? []), ...(previous?.photos ?? [])]),
        stored,
      );
      return await this.run(userId, plan, profile, photos);
    } catch (error) {
      await this.photos.releaseAll([...stored.values()].map(({ id }) => id));
      throw error;
    }
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

  private async loadProfile(userId: string): Promise<ProfileAiSettings> {
    const profile = await this.prisma.profile.findUnique({
      where: { userId },
      select: {
        aiModel: true,
        aiDetailFood: true,
        aiDetailLabel: true,
        location: true,
      },
    });
    if (!profile) {
      return DEFAULT_PROFILE_AI_SETTINGS;
    }
    return {
      aiModel: profile.aiModel,
      aiDetailFood: toImageDetail(profile.aiDetailFood),
      aiDetailLabel: toImageDetail(profile.aiDetailLabel),
      location: profile.location?.trim() || null,
    };
  }

  private async loadPrevious(
    userId: string,
    id: string | undefined,
  ): Promise<LoadedPrevious | null> {
    if (!id) {
      return null;
    }
    const previous = await this.prisma.analysis.findFirst({
      where: { id, userId },
      select: {
        ...CHAIN_SELECT,
        id: true,
        mode: true,
        description: true,
        photo: true,
        photos: {
          where: { photo: { userId } },
          orderBy: { position: 'asc' },
          select: { role: true, photo: true },
        },
      },
    });
    if (
      !previous ||
      previous.mode === 'menu' ||
      previous.mode === 'voice' ||
      previous.mode === 'ideas'
    ) {
      throw new NotFoundException('Previous analysis not found');
    }
    const answeredQuestions = await collectAnsweredQuestions(
      previous,
      (parentId) => this.loadChainParent(userId, parentId),
    );
    const legacyPhoto =
      previous.photo?.userId === userId ? previous.photo : null;
    const rows = [
      ...previous.photos.map(({ photo }) => photo),
      ...(legacyPhoto ? [legacyPhoto] : []),
    ];
    return {
      analysis: {
        id: previous.id,
        mode: previous.mode,
        description: previous.description,
        photos: carriedPhotos(
          previous.mode,
          previous.photos.map(({ photo, role }) => ({
            photoId: photo.id,
            role,
          })),
          legacyPhoto?.id ?? null,
        ),
        result: previous.result,
        answeredQuestions,
      },
      photos: new Map(rows.map((photo) => [photo.id, photo])),
    };
  }

  private async loadDraft(
    userId: string,
    id: string | undefined,
  ): Promise<LoadedDraft | null> {
    if (!id) {
      return null;
    }
    const draft = await this.prisma.draft.findFirst({
      where: { id, userId },
      select: {
        id: true,
        description: true,
        photos: {
          where: { photo: { userId } },
          orderBy: { position: 'asc' },
          select: { role: true, photo: true },
        },
      },
    });
    if (!draft) {
      throw new NotFoundException('Draft not found');
    }
    return {
      draft: {
        id: draft.id,
        description: draft.description,
        photos: draft.photos.map(({ photo, role }) => ({
          photoId: photo.id,
          role: toImageRole(role, 'food_photo'),
        })),
      },
      photos: new Map(draft.photos.map(({ photo }) => [photo.id, photo])),
    };
  }

  private loadChainParent(
    userId: string,
    id: string,
  ): Promise<AnalysisChainParent | null> {
    return this.prisma.analysis.findFirst({
      where: { id, userId },
      select: CHAIN_SELECT,
    });
  }

  private async storeUploads(
    userId: string,
    planned: readonly PlannedPhoto[],
    uploads: readonly AnalyzeUpload[],
  ): Promise<Map<number, Photo>> {
    const pending = planned.flatMap(({ source, role }) => {
      if (source.kind !== 'upload') {
        return [];
      }
      const upload = uploads[source.index];
      return upload
        ? [{ index: source.index, role, buffer: upload.buffer }]
        : [];
    });
    const stored = await this.photos.createManyFromUploads(userId, pending);
    return new Map(
      pending.map(({ index }, position) => [index, stored[position]]),
    );
  }

  private async run(
    userId: string,
    plan: AnalysisPlan,
    profile: ProfileAiSettings,
    photos: readonly AnalysisPhotoInput[],
  ): Promise<AnalyzeResponse> {
    const savedFoods = usesSavedFoods(plan.mode)
      ? await this.loadSavedFoods(userId)
      : [];
    const request = await this.buildRequest(plan, profile, photos, savedFoods);
    const context: AttemptContext = {
      userId,
      mode: plan.mode,
      detail: plan.detail,
      requestedModel: request.model,
    };
    const analyzeMeals = plan.split ? this.provider.analyzeMeals : undefined;
    if (analyzeMeals) {
      try {
        return await this.runSplit(userId, plan, context, savedFoods, () =>
          analyzeMeals.call(this.provider, request),
        );
      } catch (error) {
        if (!(error instanceof AiProviderError)) {
          throw error;
        }
        this.logger.warn('Meal split was rejected; analysing as one meal');
      }
    }
    const { result, attempts } = await this.callProvider((recorded) =>
      analyzeWithOneRetry(this.provider, request, {
        onAttempt: (record) => this.recordAttempt(context, record, recorded),
      }),
    );
    return this.store(
      userId,
      plan,
      { raw: result.raw, description: plan.description },
      { model: canonicalModelId(result.model || request.model), attempts },
      photos,
      savedFoods,
    );
  }

  private async runSplit(
    userId: string,
    plan: AnalysisPlan,
    context: AttemptContext,
    savedFoods: readonly SavedFood[],
    analyzeMeals: () => Promise<AiMealSplitResult>,
  ): Promise<AnalyzeResponse> {
    const { result, attempts } = await this.callProvider(
      (recorded) =>
        callWithOneRetry(analyzeMeals, {
          onAttempt: (record) => this.recordAttempt(context, record, recorded),
        }),
      SPLIT_FALLBACK_KINDS,
    );
    const model = canonicalModelId(result.model || context.requestedModel);
    const responses: AnalyzeResponse[] = [];
    for (const meal of splitMeals(result.raw, plan.description)) {
      responses.push(
        await this.store(
          userId,
          plan,
          meal,
          { model, attempts: responses.length === 0 ? attempts : [] },
          [],
          savedFoods,
        ),
      );
    }
    const [first, ...moreMeals] = responses;
    if (!first) {
      throw new ServiceUnavailableException('The analysis returned no meal');
    }
    return moreMeals.length > 0 ? { ...first, moreMeals } : first;
  }

  private async store(
    userId: string,
    plan: AnalysisPlan,
    meal: MealToStore,
    billed: BilledAttempts,
    photos: readonly AnalysisPhotoInput[],
    savedFoods: readonly SavedFood[],
  ): Promise<AnalyzeResponse> {
    const normalized = normalizeAnalysis(meal.raw, {
      mode: plan.mode,
      answeredQuestions: answeredQuestionTexts(plan),
      savedFoods,
    });
    const primary = primaryPhoto(photos);
    const analysis = await this.prisma.analysis.create({
      data: {
        userId,
        mode: plan.mode,
        description: meal.description,
        photoId: primary?.photo.id ?? null,
        previousAnalysisId: plan.previousAnalysisId,
        followUpAnswer: plan.followUpAnswer,
        model: billed.model,
        detail: plan.detail,
        precise: plan.precise,
        rawResponse: meal.raw as Prisma.InputJsonValue,
        result: normalized as unknown as Prisma.InputJsonValue,
        photos: {
          create: photos.map(({ photo, role }, position) => ({
            photoId: photo.id,
            role,
            position,
          })),
        },
        usages: { connect: billed.attempts.map(({ id }) => ({ id })) },
      },
      select: { id: true },
    });
    return {
      analysisId: analysis.id,
      mode: plan.mode,
      description: meal.description,
      result: normalized,
      photo: toPhotoRef(primary?.photo),
      photos: photos.map(({ photo, role }) => ({
        photo: toPhotoRef(photo),
        role,
      })),
      usage: summarizeUsage(billed.model, billed.attempts),
      precise: plan.precise,
      ...(meal.timing ? { timing: meal.timing } : {}),
    };
  }

  private async loadSavedFoods(userId: string): Promise<SavedFood[]> {
    const products = await this.prisma.product.findMany({
      where: { userId },
      orderBy: PRODUCT_ORDER,
      select: SAVED_FOOD_SELECT,
    });
    return products.map(toSavedFood);
  }

  private async buildRequest(
    plan: AnalysisPlan,
    profile: ProfileAiSettings,
    photos: readonly AnalysisPhotoInput[],
    savedFoods: readonly SavedFood[],
  ): Promise<AiAnalyzeRequest> {
    const images = await Promise.all(
      photos.map(async ({ photo, detail }) => ({
        dataUrl: toJpegDataUrl(await this.photos.readFull(photo)),
        detail,
      })),
    );
    return {
      model: this.aiConfig.resolveModel(profile.aiModel, plan.precise),
      images,
      prompt: {
        mode: plan.mode,
        imageRoles: photos.map(({ role }) => role),
        description: plan.description,
        localTime: plan.localTime,
        mealType: plan.mealType,
        location: profile.location,
        answeredQuestions: plan.answeredQuestions,
        followUp: plan.followUp,
        savedFoods: savedFoods
          .slice(0, SAVED_FOODS_PROMPT_MAX)
          .map(toSavedFoodPrompt),
      },
    };
  }

  private async recordAttempt<T>(
    context: AttemptContext,
    record: StructuredAttemptRecord<T>,
    attempts: RecordedAttempt[],
  ): Promise<void> {
    attempts.push(await this.recorder.record(context, record));
  }

  private async callProvider<T>(
    call: (attempts: RecordedAttempt[]) => Promise<AiStructuredResult<T>>,
    passThrough: ReadonlySet<AiFailureKind> = NO_FAILURE_KINDS,
  ): Promise<Completed<T>> {
    const attempts: RecordedAttempt[] = [];
    try {
      return { result: await call(attempts), attempts };
    } catch (error) {
      if (error instanceof AiProviderError) {
        this.logger.warn(
          `AI analysis failed after ${attempts.length} attempt(s): ${error.kind} (${error.message})`,
        );
        if (passThrough.has(error.kind)) {
          throw error;
        }
        throw toAnalyzeHttpException(error);
      }
      throw error;
    }
  }
}
