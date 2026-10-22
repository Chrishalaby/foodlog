import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  guessMealType,
  type AiConfigDto,
  type AnalysisMode,
  type AnalysisPhotoRef,
  type AnalyzeRequestFields,
  type AnalyzeResponse,
  type CreateDraftFields,
  type CreateEntryRequest,
  type DraftDto,
  type EntryDto,
  type EntryItemInput,
  type EntrySource,
  type FavoriteDto,
  type ImageRole,
  type LogDraftRequest,
  type MealType,
  type PhotoRef,
  type Portion,
  type ProductDto,
  type SavedFoodRef,
  type UpdateDraftRequest,
  type UpsertProductRequest,
} from '@food/shared';
import { ApiService, analyzeImageFilename, type AnalyzeImage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import type { CaptureRequest, CaptureSource, ImageCaptureSource } from '../../core/capture.service';
import { DataEventsService, type DataTopic } from '../../core/data-events.service';
import {
  DraftSyncService,
  isNetworkFailure,
  isServerUnreachable,
} from '../../core/draft-sync.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { NetworkService } from '../../core/network.service';
import type { LocalDraftImage } from '../../core/offline-drafts.store';
import { onSessionReset } from '../../core/session-scope';
import {
  createDraftItem,
  draftFromEntryItem,
  itemsTotals,
  linkSavedFood,
  toEntryItemInputs,
  validateItems,
  type DraftItem,
} from '../../shared/ui/items-editor/items-math';
import { coverUpdateRequest, findPhoto } from '../../shared/utils/entry-photos';
import { toPortion } from '../../shared/utils/portion';
import { readPhotoTakenAt } from '../../shared/utils/exif';
import {
  COMPRESS_PRESETS,
  compressImage,
  type CompressOptions,
  type CompressPreset,
  type CompressedImage,
} from '../../shared/utils/image-compress';
import { describeAnalyzeError, offlineFailure, type AnalyzeFailure } from './analyze-errors';
import {
  per100InRange,
  productRequestFromItem,
  productRequestFromLabel,
} from './barcode/product-form';
import { PRODUCT_GRAMS_MIN } from './barcode/product-portion';
import { draftFacts, type DraftSource } from './drafts/draft-rows';
import { DraftsStore } from './drafts/drafts.store';
import {
  aiLocalTime,
  analysisLocalTime,
  currentDateTimeInput,
  dateTimeInputFromIso,
  logNowTiming,
  mealTypeAt,
  parseDateTimeInput,
  timingFromInput,
  usablePhotoTime,
  type EntryTiming,
} from './entry-timing';
import { applyLabelPortion } from './label-portion';
import {
  hasTimingHint,
  mealPlacement,
  mealTitle,
  pendingMeal,
  pendingMealRequest,
  sortMeals,
  withMealDay,
  withMealTime,
  type PendingMeal,
} from './meal-batch';
import {
  analysisPhotoRefs,
  deriveMealName,
  draftUploadPhotos,
  draftsFromResult,
  entrySourceFor,
  labelItemKey,
  labelPhotoHint,
  modeForRole,
  modeForRoles,
  primaryPhoto,
  reviewSnapshot,
  roleForMode,
  type AnalyzeRunKind,
} from './log-helpers';

export type LogPhase = 'idle' | 'compose' | 'analyzing' | 'meals' | 'review' | 'saving' | 'saved';
export type LogView = 'idle' | 'compose' | 'analyzing' | 'meals' | 'review';
export type AnalyzeKind = AnalyzeRunKind;
export type PhotoMode = Exclude<AnalysisMode, 'text'>;
type ReturnPhase = 'compose' | 'review';
export type CaptureTimeSource = 'now' | 'photo' | 'user';

export type ImageCompressor = (file: Blob, options: CompressOptions) => Promise<CompressedImage>;

export const IMAGE_COMPRESSOR = new InjectionToken<ImageCompressor>('IMAGE_COMPRESSOR', {
  providedIn: 'root',
  factory: () => compressImage,
});

export type PhotoTimeReader = (file: Blob) => Promise<Date | null>;

export const PHOTO_TIME_READER = new InjectionToken<PhotoTimeReader>('PHOTO_TIME_READER', {
  providedIn: 'root',
  factory: () => readPhotoTakenAt,
});

export const SAVE_ERROR_FALLBACK = 'Could not save this meal. Please try again.';
export const DRAFT_SAVE_FALLBACK = 'Could not save this draft. Please try again.';
export const MEALS_SAVE_FALLBACK = 'Could not save these meals. Please try again.';

export function mealNeedsLook(name: string): string {
  return `“${name}” needs a look before it can be saved. Tap it to fix it.`;
}

export const MAX_PHOTOS = API_LIMITS.analyzeImagesMax;

export interface DraftPhoto {
  readonly id: number;
  readonly file: File;
  readonly role: ImageRole;
  readonly source: ImageCaptureSource;
  readonly previewUrl: string;
  readonly stored?: LocalDraftImage;
}

interface AttachedDraftBase {
  readonly mode: AnalysisMode;
  readonly description: string;
  readonly analysisId: string | null;
}

export interface ServerAttachedDraft extends AttachedDraftBase {
  readonly kind: 'server';
  readonly id: string;
  readonly photos: readonly AnalysisPhotoRef[];
}

export interface LocalAttachedDraft extends AttachedDraftBase {
  readonly kind: 'local';
  readonly localId: string;
  readonly photoId: string | null;
}

export type AttachedDraft = ServerAttachedDraft | LocalAttachedDraft;

export type DraftSaveOutcome =
  | { readonly kind: 'created' | 'updated'; readonly draft: DraftDto }
  | { readonly kind: 'local'; readonly persisted: boolean; readonly offline: boolean };

interface AnalyzeRun {
  kind: AnalyzeKind;
  fields: AnalyzeRequestFields;
  images: readonly DraftPhoto[];
  returnTo: ReturnPhase;
}

interface MealContext {
  localTime: string;
  mealType: MealType;
}

interface CompressionJob {
  preset: CompressPreset;
  promise: Promise<CompressedImage>;
}

interface ReviewDrafts {
  correction: string;
  correctionOpen: boolean;
  followUpAnswer: string;
  followUpQuestion: string | null;
}

export type ProductOutcome = 'saved' | 'failed' | 'skipped' | null;

export interface SaveOutcome {
  entry: EntryDto;
  coverFailed: boolean;
  favoriteFailed: boolean;
  favoriteName: string | null;
  product: ProductOutcome;
  current: boolean;
  remaining: number;
}

export interface MealsSaveOutcome {
  entries: EntryDto[];
  failed: boolean;
  current: boolean;
}

export type ProductPlan =
  | { readonly kind: 'log'; readonly body: UpsertProductRequest; readonly grams: number }
  | { readonly kind: 'save'; readonly body: UpsertProductRequest }
  | { readonly kind: 'skip'; readonly reason: 'values' | 'items' };

interface CreatedEntry {
  entry: EntryDto;
  product: ProductOutcome;
}

const PRODUCT_LOG_FALLBACK_STATUSES = new Set([400, 404]);

export interface LibraryDraft {
  name: string;
  items: EntryItemInput[];
  mealType: MealType;
  mealTypeAuto: boolean;
  dateTime: string;
  photo: PhotoRef | null;
  portion: Portion | null;
}

function loggedFrom(entry: EntryDto, request: LogDraftRequest): boolean {
  return (
    entry.localDate === request.localDate &&
    Date.parse(entry.timestamp) === Date.parse(request.timestamp) &&
    entry.name === request.name.trim()
  );
}

@Injectable()
export class LogStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly events = inject(DataEventsService);
  private readonly network = inject(NetworkService);
  private readonly sync = inject(DraftSyncService);
  private readonly drafts = inject(DraftsStore);
  private readonly compress = inject(IMAGE_COMPRESSOR);
  private readonly readTakenAt = inject(PHOTO_TIME_READER);

  private readonly phaseState = signal<LogPhase>('idle');
  private readonly modeState = signal<AnalysisMode>('food_photo');
  private readonly sourceState = signal<CaptureSource>('camera');
  private readonly photosState = signal<readonly DraftPhoto[]>([]);
  private readonly failedPhotosState = signal<ReadonlySet<number>>(new Set());
  private readonly pendingPhotoState = signal<DraftPhoto | null>(null);
  private readonly errorState = signal<AnalyzeFailure | null>(null);
  private readonly analysisState = signal<AnalyzeResponse | null>(null);
  private readonly runKindState = signal<AnalyzeKind>('initial');
  private readonly startedAtState = signal(0);
  private readonly seedState = signal(reviewSnapshot('', []));
  private readonly seedNameState = signal('');
  private readonly labelItemKeyState = signal<string | null>(null);
  private readonly attemptedSaveState = signal(false);
  private readonly saveErrorState = signal<string | null>(null);
  private readonly aiConfigState = signal<AiConfigDto | null>(null);
  private readonly sessionState = signal(0);
  private readonly seedVersionState = signal(0);
  private readonly baseSourceState = signal<EntrySource>('manual');
  private readonly libraryPhotoState = signal<PhotoRef | null>(null);
  private readonly prefillState = signal('');
  private readonly barcodeState = signal<string | null>(null);
  private readonly photoTimeState = signal<string | null>(null);
  private readonly timeSourceState = signal<CaptureTimeSource>('now');
  private readonly attachedState = signal<AttachedDraft | null>(null);
  private readonly composeSeedState = signal<string | null>(null);
  private readonly timingSeedState = signal<string | null>(null);
  private readonly extraPhotosState = signal<readonly DraftPhoto[]>([]);
  private readonly draftSavingState = signal(false);
  private readonly draftSavedState = signal(false);
  private readonly draftErrorState = signal<string | null>(null);
  private readonly coverChoiceState = signal<string | null>(null);
  private readonly mealsState = signal<readonly PendingMeal[]>([]);
  private readonly activeMealState = signal<number | null>(null);
  private readonly mealsSavingState = signal(false);
  private readonly mealsErrorState = signal<string | null>(null);
  private readonly compressions = new Map<number, CompressionJob>();
  private readonly unconfirmedDraftLogs = new Map<string, LogDraftRequest[]>();
  private photoSeq = 0;
  private mealSeq = 0;
  private autoDateTime = '';
  private lastRun: AnalyzeRun | null = null;
  private runSeq = 0;
  private aiConfigRequested = false;

  readonly description = signal('');
  readonly precise = signal(false);
  readonly name = signal('');
  readonly mealType = signal<MealType>(guessMealType(new Date()));
  readonly mealTypeAuto = signal(true);
  readonly dateTime = signal(currentDateTimeInput());
  readonly items = signal<DraftItem[]>([]);
  readonly portion = signal<Portion | null>(null);
  readonly followUpAnswer = signal('');
  readonly correction = signal('');
  readonly correctionOpen = signal(false);
  readonly saveAsFavorite = signal(false);
  readonly favoriteName = signal('');

  readonly phase = this.phaseState.asReadonly();
  readonly mode = this.modeState.asReadonly();
  readonly captureSource = this.sourceState.asReadonly();
  readonly photos = this.photosState.asReadonly();
  readonly failedPhotos = this.failedPhotosState.asReadonly();
  readonly file = computed(() => this.photosState()[0]?.file ?? null);
  readonly previewUrl = computed(() => primaryPhoto(this.photosState())?.previewUrl ?? null);
  readonly error = this.errorState.asReadonly();
  readonly analysis = this.analysisState.asReadonly();
  readonly runKind = this.runKindState.asReadonly();
  readonly analyzeStartedAt = this.startedAtState.asReadonly();
  readonly saveError = this.saveErrorState.asReadonly();
  readonly aiConfig = this.aiConfigState.asReadonly();
  readonly session = this.sessionState.asReadonly();
  readonly seedVersion = this.seedVersionState.asReadonly();
  readonly barcode = this.barcodeState.asReadonly();
  readonly photoTime = this.photoTimeState.asReadonly();
  readonly timeSource = this.timeSourceState.asReadonly();
  readonly fromLibrary = computed(
    () => this.analysisState() === null && this.baseSourceState() === 'copy',
  );
  readonly attachedDraft = this.attachedState.asReadonly();
  readonly draftSaving = this.draftSavingState.asReadonly();
  readonly draftError = this.draftErrorState.asReadonly();
  readonly meals = this.mealsState.asReadonly();
  readonly mealsSaving = this.mealsSavingState.asReadonly();
  readonly mealsError = this.mealsErrorState.asReadonly();
  readonly activeMeal = computed(() => {
    const id = this.activeMealState();
    return id === null ? null : (this.mealsState().find((meal) => meal.id === id) ?? null);
  });
  readonly activeMealPosition = computed(() => {
    const id = this.activeMealState();
    const index = this.mealsState().findIndex((meal) => meal.id === id);
    return index < 0 ? null : { index: index + 1, total: this.mealsState().length };
  });
  readonly remotePhotos = computed<readonly AnalysisPhotoRef[]>(() => {
    const attached = this.attachedState();
    return attached?.kind === 'server' && this.analysisState() === null ? attached.photos : [];
  });

  readonly view = computed<LogView>(() => {
    const phase = this.phaseState();
    if (phase !== 'saving' && phase !== 'saved') {
      return phase;
    }
    return this.activeMealState() === null && this.mealsState().length > 0 ? 'meals' : 'review';
  });
  readonly result = computed(() => this.analysisState()?.result ?? null);
  readonly label = computed(() => this.result()?.label ?? null);
  readonly labelItem = computed(() => {
    const key = this.labelItemKeyState();
    return key ? (this.items().find((item) => item.key === key) ?? null) : null;
  });
  readonly source = computed<EntrySource>(() => {
    const analysis = this.analysisState();
    return analysis ? entrySourceFor(analysis.mode) : this.baseSourceState();
  });
  readonly photo = computed(() => this.analysisState()?.photo ?? this.libraryPhotoState() ?? null);
  readonly reviewPhotos = computed<readonly AnalysisPhotoRef[]>(() => {
    const analysis = this.analysisState();
    return analysis ? analysisPhotoRefs(analysis) : this.remotePhotos();
  });
  private readonly chosenCover = computed(() =>
    findPhoto(this.reviewPhotos(), this.coverChoiceState()),
  );
  readonly coverPhoto = computed(
    () => this.chosenCover() ?? primaryPhoto(this.reviewPhotos())?.photo ?? null,
  );
  readonly photoUrl = computed(
    () => this.chosenCover()?.url ?? this.previewUrl() ?? this.photo()?.url ?? null,
  );
  readonly thumbUrl = computed(
    () => this.chosenCover()?.thumbUrl ?? this.previewUrl() ?? this.photo()?.thumbUrl ?? null,
  );
  readonly analyzingPhotoUrl = computed(() => {
    const pending = this.runKindState() === 'label' ? this.pendingPhotoState() : null;
    return pending?.previewUrl ?? this.photoUrl();
  });
  readonly analyzingPhotoCount = computed(() => {
    if (this.runKindState() === 'label') {
      return 1;
    }
    const drafts = this.photosState().length;
    if (drafts > 0) {
      return drafts;
    }
    const remote = this.remotePhotos().length;
    return remote > 0 ? remote : analysisPhotoRefs(this.analysisState()).length;
  });
  readonly analysisPhotos = computed(() => analysisPhotoRefs(this.analysisState()));
  readonly labelHint = computed(() => {
    const analysis = this.analysisState();
    return analysis ? labelPhotoHint(analysis) : null;
  });
  readonly canAddPhoto = computed(
    () =>
      this.phaseState() === 'compose' &&
      this.modeState() !== 'text' &&
      this.remotePhotos().length === 0 &&
      this.photosState().length < MAX_PHOTOS,
  );
  readonly totals = computed(() => itemsTotals(this.items()));
  readonly edited = computed(
    () => reviewSnapshot(this.name(), this.items(), this.portion()) !== this.seedState(),
  );
  readonly canAnalyze = computed(() => {
    if (this.phaseState() !== 'compose') {
      return false;
    }
    return this.modeState() === 'text'
      ? this.description().trim().length > 0
      : this.photosState().length > 0 || this.remotePhotos().length > 0;
  });
  readonly canCorrect = computed(
    () => this.analysisState() !== null || (this.attachedState()?.analysisId ?? null) !== null,
  );
  private readonly attachedReviewChanged = computed(() => {
    const attached = this.attachedState();
    if (!attached) {
      return false;
    }
    const analysis = this.analysisState();
    return (
      this.edited() ||
      (analysis !== null && analysis.analysisId !== attached.analysisId) ||
      this.timingSnapshot() !== this.timingSeedState()
    );
  });
  readonly canSaveDraft = computed(() => {
    if (this.draftSavingState() || this.barcodeState() !== null) {
      return false;
    }
    switch (this.phaseState()) {
      case 'compose':
        if (this.attachedState()) {
          return this.composeSnapshot() !== this.composeSeedState();
        }
        return (
          this.photosState().length > 0 ||
          this.remotePhotos().length > 0 ||
          this.description().trim().length > 0
        );
      case 'review':
        return (
          !this.fromLibrary() &&
          this.activeMealState() === null &&
          this.items().length > 0 &&
          (this.attachedState() === null || this.attachedReviewChanged())
        );
      default:
        return false;
    }
  });
  readonly canRecheckPrecise = computed(() => {
    const analysis = this.analysisState();
    if (analysis === null || analysis.precise) {
      return false;
    }
    const preciseModel = this.aiConfigState()?.preciseModel;
    return !preciseModel || analysis.usage.model !== preciseModel;
  });
  readonly validationError = computed(() => {
    if (!timingFromInput(this.dateTime())) {
      return 'Choose a valid date and time.';
    }
    const itemsError = validateItems(this.items());
    if (itemsError) {
      return itemsError;
    }
    return deriveMealName(this.name(), this.items()) ? null : 'Give this meal a name.';
  });
  readonly productPlan = computed<ProductPlan | null>(() =>
    this.barcodeState() ? this.planProduct() : null,
  );
  readonly visibleValidationError = computed(() =>
    this.attemptedSaveState() ? this.validationError() : null,
  );
  readonly hasUnsavedWork = computed(() => {
    if (this.draftSavedState()) {
      return false;
    }
    const attached = this.attachedState();
    switch (this.phaseState()) {
      case 'compose': {
        if (attached) {
          return this.composeSnapshot() !== this.composeSeedState();
        }
        const description = this.description().trim();
        return (
          this.photosState().length > 0 ||
          (description.length > 0 && description !== this.prefillState())
        );
      }
      case 'analyzing':
      case 'saving':
        return true;
      case 'meals':
        return this.mealsState().length > 0;
      case 'review':
        return attached
          ? this.attachedReviewChanged()
          : this.analysisState() !== null || this.edited();
      default:
        return false;
    }
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.runSeq += 1;
      this.releasePhotos();
      this.releaseAttached();
    });
    onSessionReset(() => {
      this.unconfirmedDraftLogs.clear();
      this.resetState();
    });
  }

  start(request: CaptureRequest): void {
    const keepDraft = this.phaseState() === 'compose' && this.attachedState() === null;
    const description =
      request.description?.slice(0, API_LIMITS.descriptionMax) ??
      (keepDraft ? this.description() : '');
    const precise = keepDraft ? this.precise() : false;
    const keepBarcode =
      keepDraft && (request.mode === this.modeState() || request.mode === 'nutrition_label');
    const barcode = request.barcode ?? (keepBarcode ? this.barcodeState() : null);
    this.resetState();
    this.barcodeState.set(barcode);
    this.description.set(description);
    this.prefillState.set(request.description ? description.trim() : '');
    this.precise.set(precise);
    this.modeState.set(request.mode);
    this.sourceState.set(request.source);
    this.phaseState.set('compose');
    if (request.mode !== 'text' && request.file) {
      const source = request.source === 'library' ? 'library' : 'camera';
      this.appendPhotos([this.createPhoto(request.file, roleForMode(request.mode), source)]);
    }
    this.loadAiConfig();
  }

  startManual(): void {
    const fromCompose = this.phaseState() === 'compose';
    const description = fromCompose ? this.description().trim() : '';
    const barcode = fromCompose ? this.barcodeState() : null;
    const attached = fromCompose ? this.attachedState() : null;
    const kept =
      attached?.kind === 'server'
        ? {
            attached,
            dateTime: this.dateTime(),
            mealType: this.mealType(),
            mealTypeAuto: this.mealTypeAuto(),
          }
        : null;
    this.resetState();
    this.barcodeState.set(barcode);
    this.description.set(description);
    if (kept) {
      this.attachedState.set(kept.attached);
      this.libraryPhotoState.set(primaryPhoto(kept.attached.photos)?.photo ?? null);
      this.baseSourceState.set(entrySourceFor(kept.attached.mode));
      this.dateTime.set(kept.dateTime);
      this.timeSourceState.set('user');
      this.mealType.set(kept.mealType);
      this.mealTypeAuto.set(kept.mealTypeAuto);
      this.timingSeedState.set(this.timingSnapshot());
    }
    this.seedReview([createDraftItem()], '');
    this.phaseState.set('review');
  }

  startFromLibrary(draft: LibraryDraft): void {
    this.resetState();
    this.baseSourceState.set('copy');
    this.libraryPhotoState.set(draft.photo);
    this.mealType.set(draft.mealType);
    this.mealTypeAuto.set(draft.mealTypeAuto);
    this.dateTime.set(draft.dateTime);
    const items = draft.items.slice(0, API_LIMITS.itemsMax).map(draftFromEntryItem);
    this.seedReview(
      items.length > 0 ? items : [createDraftItem()],
      draft.name,
      draft.name,
      toPortion(draft.portion),
    );
    this.phaseState.set('review');
  }

  resumeDraft(source: DraftSource): boolean {
    if (source.kind === 'local' && this.sync.isUploading(source.draft.localId)) {
      return false;
    }
    this.resetState();
    if (source.kind === 'local' && !this.sync.claim(source.draft.localId)) {
      return false;
    }
    const facts = draftFacts(source);
    this.modeState.set(facts.mode);
    this.sourceState.set(facts.mode === 'text' ? 'text' : 'camera');
    this.baseSourceState.set(entrySourceFor(facts.mode));
    this.description.set((facts.description ?? '').slice(0, API_LIMITS.descriptionMax));
    this.restoreTiming(facts.timestamp, facts.mealType);
    this.timingSeedState.set(this.timingSnapshot());
    const base = {
      mode: facts.mode,
      description: facts.description ?? '',
      analysisId: facts.analysisId,
    };
    if (source.kind === 'server') {
      const { draft } = source;
      this.attachedState.set({ ...base, kind: 'server', id: draft.id, photos: draft.photos });
      this.libraryPhotoState.set(primaryPhoto(draft.photos)?.photo ?? null);
    } else {
      const { draft } = source;
      this.attachedState.set({
        ...base,
        kind: 'local',
        localId: draft.localId,
        photoId: draft.photoId,
      });
      this.restoreStoredPhotos(draft.images);
    }
    if (facts.items) {
      const name = facts.name ?? '';
      this.seedReview(facts.items.map(draftFromEntryItem), name, name, facts.portion);
      this.phaseState.set('review');
    } else {
      this.name.set(facts.name ?? '');
      this.phaseState.set('compose');
      this.composeSeedState.set(this.composeSnapshot());
      this.loadAiConfig();
    }
    return true;
  }

  setMode(mode: PhotoMode): void {
    const photos = this.photosState();
    if (
      this.phaseState() !== 'compose' ||
      this.modeState() === mode ||
      photos.length > 1 ||
      this.remotePhotos().length > 0
    ) {
      return;
    }
    this.errorState.set(null);
    const [only] = photos;
    if (only) {
      this.changeRole(only, roleForMode(mode));
      return;
    }
    this.modeState.set(mode);
  }

  addPhotos(
    files: readonly File[],
    source: ImageCaptureSource,
    role: ImageRole | null = null,
  ): number {
    if (this.phaseState() !== 'compose' || this.modeState() === 'text') {
      return 0;
    }
    const count = this.photosState().length;
    const room = Math.max(0, MAX_PHOTOS - count);
    const added = files
      .slice(0, room)
      .map((file, index) =>
        this.createPhoto(file, role ?? this.defaultRole(count + index), source),
      );
    this.appendPhotos(added);
    return added.length;
  }

  removePhoto(id: number): void {
    const photos = this.photosState();
    const photo = photos.find((candidate) => candidate.id === id);
    if (this.phaseState() !== 'compose' || !photo) {
      return;
    }
    URL.revokeObjectURL(photo.previewUrl);
    this.compressions.delete(id);
    this.markFailed(id, false);
    this.errorState.set(null);
    this.setPhotos(photos.filter((candidate) => candidate.id !== id));
    this.syncPhotoTime(photos[0]);
  }

  setPhotoRole(id: number, role: ImageRole): void {
    const photo = this.photosState().find((candidate) => candidate.id === id);
    if (this.phaseState() !== 'compose' || !photo || photo.role === role) {
      return;
    }
    this.errorState.set(null);
    this.changeRole(photo, role);
  }

  async analyze(): Promise<void> {
    if (!this.canAnalyze()) {
      return;
    }
    const mode = this.modeState();
    const at = this.captureTime();
    const attached = this.attachedState();
    const fields = this.fields(mode, this.description(), this.precise(), {
      localTime: aiLocalTime(at),
      mealType: this.mealTypeAuto() ? guessMealType(at) : this.mealType(),
    });
    await this.run({
      kind: 'initial',
      returnTo: 'compose',
      images: mode === 'text' ? [] : this.photosState(),
      fields: this.initialFields(fields, attached),
    });
  }

  openMeal(id: number): void {
    const meal = this.mealsState().find((candidate) => candidate.id === id);
    if (this.phaseState() !== 'meals' || !meal || this.mealsSavingState()) {
      return;
    }
    this.activeMealState.set(id);
    this.mealsErrorState.set(null);
    this.errorState.set(null);
    this.analysisState.set(meal.analysis);
    this.precise.set(meal.analysis.precise);
    this.dateTime.set(meal.dateTime);
    this.autoDateTime = '';
    this.timeSourceState.set('user');
    this.mealType.set(meal.mealType);
    this.mealTypeAuto.set(meal.mealTypeAuto);
    this.saveAsFavorite.set(false);
    this.favoriteName.set('');
    this.seedReview(meal.items, meal.name, meal.seedName, meal.portion);
    this.labelItemKeyState.set(null);
    this.phaseState.set('review');
  }

  closeMeal(): void {
    const id = this.activeMealState();
    if (id === null || this.phaseState() !== 'review') {
      return;
    }
    const analysis = this.analysisState();
    const edits = {
      name: this.name(),
      seedName: this.seedNameState(),
      items: this.items(),
      portion: this.portion(),
      mealType: this.mealType(),
      mealTypeAuto: this.mealTypeAuto(),
      dateTime: this.dateTime(),
    };
    this.mealsState.update((meals) =>
      sortMeals(
        meals.map((meal) =>
          meal.id === id ? { ...meal, ...edits, analysis: analysis ?? meal.analysis } : meal,
        ),
      ),
    );
    this.showMeals();
  }

  removeMeal(id: number): void {
    if (this.phaseState() !== 'meals' || this.mealsSavingState()) {
      return;
    }
    const left = this.mealsState().filter((meal) => meal.id !== id);
    if (left.length === 0) {
      this.resetState();
      return;
    }
    this.mealsErrorState.set(null);
    this.mealsState.set(left);
  }

  setMealTime(id: number, time: string): void {
    this.changeMeals((meal) => (meal.id === id ? withMealTime(meal, time) : meal));
  }

  setMealsDay(localDate: string): void {
    this.changeMeals((meal) => withMealDay(meal, localDate));
  }

  async saveMeals(): Promise<MealsSaveOutcome | null> {
    const meals = this.mealsState();
    if (this.phaseState() !== 'meals' || this.mealsSavingState() || meals.length === 0) {
      return null;
    }
    const blocked = meals.find((meal) => pendingMealRequest(meal) === null);
    if (blocked) {
      this.mealsErrorState.set(mealNeedsLook(mealTitle(blocked)));
      return null;
    }
    const session = this.sessionState();
    const entries: EntryDto[] = [];
    const saved = new Set<number>();
    let failure: string | null = null;
    this.mealsErrorState.set(null);
    this.mealsSavingState.set(true);
    try {
      for (const meal of meals) {
        const body = pendingMealRequest(meal);
        if (body) {
          entries.push(await this.createEntryWithFallback(body));
          saved.add(meal.id);
        }
      }
    } catch (err) {
      failure = errorMessage(err, MEALS_SAVE_FALLBACK);
    }
    if (entries.length > 0) {
      this.events.notify('entries');
    }
    const current = session === this.sessionState();
    if (current) {
      this.mealsSavingState.set(false);
      if (failure === null) {
        this.phaseState.set('saved');
      } else {
        this.mealsErrorState.set(failure);
        this.mealsState.update((pending) => pending.filter((meal) => !saved.has(meal.id)));
      }
    }
    return { entries, failed: failure !== null, current };
  }

  async addLabelPhoto(file: File, source: ImageCaptureSource): Promise<void> {
    const analysis = this.analysisState();
    if (this.phaseState() !== 'review' || !analysis) {
      return;
    }
    const photo = this.createPhoto(file, 'label', source);
    this.replacePendingPhoto(photo);
    this.startCompression(photo);
    await this.run({
      kind: 'label',
      returnTo: 'review',
      images: [photo],
      fields: this.labelFields(analysis),
    });
  }

  setCaptureTime(value: string): void {
    if (this.phaseState() !== 'compose') {
      return;
    }
    this.dateTime.set(value);
    this.timeSourceState.set(value === this.photoTimeState() ? 'photo' : 'user');
    const guess = this.mealTypeAuto() ? mealTypeAt(value) : null;
    if (guess) {
      this.mealType.set(guess);
    }
  }

  useCurrentTime(): void {
    if (this.phaseState() !== 'compose') {
      return;
    }
    this.timeSourceState.set('now');
    this.setAutoTiming(new Date());
  }

  async answerFollowUp(answer: string): Promise<void> {
    const analysis = this.analysisState();
    const text = answer.trim().slice(0, API_LIMITS.followUpAnswerMax);
    if (this.phaseState() !== 'review' || !analysis || !text) {
      return;
    }
    this.followUpAnswer.set(text);
    await this.run({
      kind: 'follow_up',
      returnTo: 'review',
      images: [],
      fields: {
        ...this.rerunFields(analysis, this.precise()),
        followUpAnswer: text,
      },
    });
  }

  async correct(text: string): Promise<void> {
    const analysis = this.analysisState();
    const correction = text.trim().slice(0, API_LIMITS.followUpAnswerMax);
    const base = analysis
      ? this.rerunFields(analysis, this.precise())
      : this.attachedRerunFields(this.precise());
    if (this.phaseState() !== 'review' || !base || !correction) {
      return;
    }
    this.correction.set(correction);
    await this.run({
      kind: 'correction',
      returnTo: 'review',
      images: [],
      fields: { ...base, followUpAnswer: correction },
    });
  }

  async recheckPrecise(): Promise<void> {
    const analysis = this.analysisState();
    if (this.phaseState() !== 'review' || !analysis || !this.canRecheckPrecise()) {
      return;
    }
    await this.run({
      kind: 'recheck',
      returnTo: 'review',
      images: [],
      fields: this.rerunFields(analysis, true),
    });
  }

  async retry(): Promise<void> {
    if (this.phaseState() === 'compose') {
      await this.analyze();
      return;
    }
    const run = this.lastRun;
    if (this.phaseState() !== 'review' || run?.returnTo !== 'review') {
      return;
    }
    await this.run({ ...run, fields: { ...run.fields, ...this.reviewContext() } });
  }

  cancelAnalysis(): void {
    if (this.phaseState() !== 'analyzing') {
      return;
    }
    this.runSeq += 1;
    this.phaseState.set(this.lastRun?.returnTo ?? 'compose');
  }

  dismissError(): void {
    this.errorState.set(null);
  }

  applyLabelAmount(amount: number): void {
    const label = this.label();
    const key = this.labelItemKeyState();
    if (!label || !key) {
      return;
    }
    this.items.update((items) =>
      items.map((item) => (item.key === key ? applyLabelPortion(item, label, amount) : item)),
    );
  }

  clearBarcode(): void {
    this.barcodeState.set(null);
  }

  labelFoodRequest(): UpsertProductRequest | null {
    const label = this.label();
    const item = this.labelItem();
    if (!label || !item) {
      return null;
    }
    const [input] = toEntryItemInputs([item]);
    const name = label.productName?.trim() || item.name.trim();
    return input ? productRequestFromLabel(label, name, input) : null;
  }

  linkLabelItem(food: SavedFoodRef): void {
    const key = this.labelItemKeyState();
    if (!key) {
      return;
    }
    this.items.update((items) =>
      items.map((item) => (item.key === key ? linkSavedFood(item, food) : item)),
    );
  }

  pickMealType(mealType: MealType): void {
    this.mealType.set(mealType);
    this.mealTypeAuto.set(false);
  }

  chooseCover(photoId: string): void {
    if (this.phaseState() === 'review' && findPhoto(this.reviewPhotos(), photoId)) {
      this.coverChoiceState.set(photoId);
    }
  }

  buildEntryRequest(): CreateEntryRequest | null {
    const timing = timingFromInput(this.dateTime());
    const items = this.items();
    const name = deriveMealName(this.name(), items);
    if (!timing || !name) {
      return null;
    }
    const analysis = this.analysisState();
    const attached = this.attachedState();
    const description = (analysis?.description ?? this.description()).trim();
    const cover = analysis ? this.coverPhoto() : null;
    return {
      name,
      description: description ? description.slice(0, API_LIMITS.descriptionMax) : null,
      mealType: this.mealType(),
      source: this.source(),
      timestamp: timing.timestamp,
      localDate: timing.localDate,
      items: toEntryItemInputs(items),
      analysisId: analysis?.analysisId ?? attached?.analysisId ?? null,
      photoId:
        cover?.id ?? this.photo()?.id ?? (attached?.kind === 'local' ? attached.photoId : null),
      ...(cover ? { coverPhotoId: cover.id } : {}),
      ...this.portionField(),
    };
  }

  async save(): Promise<SaveOutcome | null> {
    if (this.phaseState() !== 'review') {
      return null;
    }
    this.attemptedSaveState.set(true);
    const body = this.validationError() ? null : this.buildEntryRequest();
    if (!body) {
      return null;
    }
    const session = this.sessionState();
    const favorite = this.saveAsFavorite() ? this.favoriteName().trim() : null;
    const barcode = this.barcodeState();
    const plan = barcode ? this.productPlan() : null;
    const attached = this.attachedState();
    const cover = this.chosenCover();
    this.saveErrorState.set(null);
    this.draftErrorState.set(null);
    this.phaseState.set('saving');
    let created: CreatedEntry;
    try {
      if (attached) {
        created = { entry: await this.logAttached(attached, body), product: null };
      } else {
        created =
          barcode && plan?.kind === 'log'
            ? await this.logThroughProduct(barcode, plan, body)
            : { entry: await this.api.createEntry(body), product: null };
      }
    } catch (err) {
      if (session === this.sessionState()) {
        this.saveErrorState.set(errorMessage(err, SAVE_ERROR_FALLBACK));
        this.phaseState.set('review');
      }
      return null;
    }
    const covered = await this.withCover(created.entry, cover);
    const entry = covered ?? created.entry;
    this.forgetAttached(attached);
    const product = await this.afterEntryProduct(barcode, plan, created.product);
    const topics: DataTopic[] = product === 'saved' ? ['entries', 'products'] : ['entries'];
    this.events.notify(...topics);
    const savedFavorite = favorite === null ? null : await this.createFavorite(entry, favorite);
    const favoriteFailed = favorite !== null && savedFavorite === null;
    if (savedFavorite) {
      this.events.notify('favorites');
    }
    const current = session === this.sessionState();
    const remaining = current ? this.finishMeal() : 0;
    if (current && remaining === 0) {
      this.phaseState.set('saved');
    }
    return {
      entry,
      coverFailed: covered === null,
      favoriteFailed,
      favoriteName: savedFavorite?.name ?? null,
      product,
      current,
      remaining,
    };
  }

  async saveDraft(): Promise<DraftSaveOutcome | null> {
    if (!this.canSaveDraft()) {
      return null;
    }
    if (this.phaseState() === 'review') {
      this.attemptedSaveState.set(true);
      if (this.validationError()) {
        return null;
      }
    }
    const attached = this.attachedState();
    const session = this.sessionState();
    this.draftSavingState.set(true);
    this.draftErrorState.set(null);
    this.saveErrorState.set(null);
    try {
      const outcome =
        attached?.kind === 'server'
          ? await this.updateAttachedDraft(attached)
          : await this.createDraft(attached);
      if (session === this.sessionState()) {
        this.draftSavedState.set(true);
      }
      return outcome;
    } catch (err) {
      if (session === this.sessionState()) {
        this.draftErrorState.set(errorMessage(err, DRAFT_SAVE_FALLBACK));
      }
      return null;
    } finally {
      if (session === this.sessionState()) {
        this.draftSavingState.set(false);
      }
    }
  }

  discard(): void {
    this.resetState();
  }

  private async logAttached(attached: AttachedDraft, body: CreateEntryRequest): Promise<EntryDto> {
    if (attached.kind === 'local') {
      return this.createEntryWithFallback(body);
    }
    const analysisId = this.analysisState()?.analysisId ?? null;
    const request: LogDraftRequest = {
      name: body.name,
      description: body.description ?? null,
      mealType: body.mealType,
      timestamp: body.timestamp,
      localDate: body.localDate,
      items: body.items,
      portion: body.portion ?? null,
    };
    try {
      if (analysisId && analysisId !== attached.analysisId) {
        await this.api.updateDraft(attached.id, { analysisId });
      }
      return await this.sendDraftLog(attached.id, request);
    } catch (err) {
      if (httpStatus(err) === 404) {
        return (
          (await this.findUnconfirmedDraftLog(attached.id)) ?? this.createEntryWithFallback(body)
        );
      }
      throw err;
    }
  }

  private async sendDraftLog(id: string, request: LogDraftRequest): Promise<EntryDto> {
    try {
      const entry = await this.api.logDraft(id, request);
      this.unconfirmedDraftLogs.delete(id);
      return entry;
    } catch (err) {
      if (isServerUnreachable(err)) {
        this.unconfirmedDraftLogs.set(id, [...(this.unconfirmedDraftLogs.get(id) ?? []), request]);
      }
      throw err;
    }
  }

  private async findUnconfirmedDraftLog(id: string): Promise<EntryDto | null> {
    const requests = this.unconfirmedDraftLogs.get(id);
    if (!requests) {
      return null;
    }
    const days = [...new Set(requests.map((request) => request.localDate))].sort();
    const { items } = await this.api.listEntries({
      from: days[0],
      to: days[days.length - 1],
      limit: API_LIMITS.historyPageMax,
    });
    this.unconfirmedDraftLogs.delete(id);
    return items.find((entry) => requests.some((request) => loggedFrom(entry, request))) ?? null;
  }

  private async createEntryWithFallback(body: CreateEntryRequest): Promise<EntryDto> {
    try {
      return await this.api.createEntry(body);
    } catch (err) {
      if (httpStatus(err) !== 404 || (body.analysisId === null && body.photoId === null)) {
        throw err;
      }
      return this.api.createEntry({ ...body, analysisId: null, photoId: null, coverPhotoId: null });
    }
  }

  private async withCover(entry: EntryDto, cover: PhotoRef | null): Promise<EntryDto | null> {
    if (
      !cover ||
      entry.photo?.id === cover.id ||
      !entry.photos.some(({ photo }) => photo.id === cover.id)
    ) {
      return entry;
    }
    try {
      return await this.api.updateEntry(entry.id, coverUpdateRequest(entry, cover.id));
    } catch {
      return null;
    }
  }

  private forgetAttached(attached: AttachedDraft | null): void {
    if (attached?.kind === 'server') {
      this.drafts.forget(attached.id);
    } else if (attached?.kind === 'local') {
      void this.sync.discardLocal(attached.localId);
    }
  }

  private async updateAttachedDraft(attached: ServerAttachedDraft): Promise<DraftSaveOutcome> {
    const fields = this.draftFields();
    if (!fields) {
      throw new Error('Choose a valid date and time.');
    }
    const body: UpdateDraftRequest = {
      name: fields.name ?? null,
      description: fields.description ?? null,
      mealType: fields.mealType ?? null,
      timestamp: fields.timestamp,
      localDate: fields.localDate,
      ...(this.phaseState() === 'review'
        ? {
            items: toEntryItemInputs(this.items()),
            analysisId: fields.analysisId ?? null,
            portion: toPortion(this.portion()),
          }
        : {}),
    };
    const draft = await this.api.updateDraft(attached.id, body);
    this.drafts.upsert(draft);
    return { kind: 'updated', draft };
  }

  private async createDraft(attached: LocalAttachedDraft | null): Promise<DraftSaveOutcome> {
    const fields = this.draftFields();
    if (!fields) {
      throw new Error('Choose a valid date and time.');
    }
    const images = await this.compressedImages(this.draftPhotos());
    const photoId = this.analysisState()?.photo?.id ?? attached?.photoId ?? null;
    let outcome: DraftSaveOutcome;
    if (this.network.online()) {
      try {
        const draft = await this.sync.createRemote(fields, images);
        this.drafts.upsert(draft);
        outcome = { kind: 'created', draft };
      } catch (err) {
        if (!isServerUnreachable(err)) {
          throw err;
        }
        outcome = await this.keepDraftLocally(fields, images, photoId, Date.now(), {
          offline: isNetworkFailure(err),
        });
      }
    } else {
      outcome = await this.keepDraftLocally(fields, images, photoId, null, { offline: true });
    }
    if (attached) {
      await this.sync.discardLocal(attached.localId);
    }
    return outcome;
  }

  private async keepDraftLocally(
    fields: CreateDraftFields,
    images: readonly AnalyzeImage[],
    photoId: string | null,
    attemptedAt: number | null,
    { offline }: { offline: boolean },
  ): Promise<DraftSaveOutcome> {
    const saved = await this.sync.keepLocally(
      { fields, images: images.map(({ blob, role }) => ({ blob, role })), photoId },
      attemptedAt,
    );
    if (!saved) {
      throw new Error(DRAFT_SAVE_FALLBACK);
    }
    return { kind: 'local', persisted: saved.persisted, offline };
  }

  private draftFields(): CreateDraftFields | null {
    const review = this.phaseState() === 'review';
    const timing: EntryTiming | null = review
      ? timingFromInput(this.dateTime())
      : logNowTiming(this.captureTime());
    if (!timing) {
      return null;
    }
    const analysis = this.analysisState();
    const attached = this.attachedState();
    const items = this.items();
    const name = review
      ? deriveMealName(this.name(), items)
      : this.name().trim().slice(0, API_LIMITS.nameMax);
    const description = (analysis?.description ?? this.description())
      .trim()
      .slice(0, API_LIMITS.descriptionMax);
    const analysisId = analysis?.analysisId ?? attached?.analysisId ?? null;
    return {
      mode: this.draftMode(),
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
      mealType: this.mealType(),
      timestamp: timing.timestamp,
      localDate: timing.localDate,
      ...(analysisId ? { analysisId } : {}),
      ...(review ? { items: JSON.stringify(toEntryItemInputs(items)) } : {}),
      ...(review ? this.draftPortionField() : {}),
    };
  }

  private portionField(): { portion?: Portion } {
    const portion = toPortion(this.portion());
    return portion ? { portion } : {};
  }

  private draftPortionField(): { portion?: string } {
    const portion = toPortion(this.portion());
    return portion ? { portion: JSON.stringify(portion) } : {};
  }

  private draftMode(): AnalysisMode {
    const analysis = this.analysisState();
    if (analysis) {
      return analysis.mode;
    }
    const photos = this.draftPhotos();
    if (photos.length > 0) {
      return modeForRoles(photos.map((photo) => photo.role));
    }
    const attached = this.attachedState();
    if (attached?.kind === 'server' && attached.photos.length > 0) {
      return attached.mode;
    }
    return 'text';
  }

  private draftPhotos(): DraftPhoto[] {
    return draftUploadPhotos([...this.photosState(), ...this.extraPhotosState()], MAX_PHOTOS);
  }

  private timingSnapshot(): string {
    return JSON.stringify([this.dateTime(), this.mealType()]);
  }

  private composeSnapshot(): string {
    return JSON.stringify([
      this.description().trim(),
      this.photosState().map((photo) => [photo.id, photo.role]),
      this.dateTime(),
    ]);
  }

  private restoreTiming(timestamp: string, mealType: MealType | null): void {
    const value = dateTimeInputFromIso(timestamp);
    this.dateTime.set(value);
    this.autoDateTime = '';
    this.timeSourceState.set('user');
    if (mealType) {
      this.mealType.set(mealType);
      this.mealTypeAuto.set(false);
      return;
    }
    this.mealTypeAuto.set(true);
    const guess = mealTypeAt(value);
    if (guess) {
      this.mealType.set(guess);
    }
  }

  private restoreStoredPhotos(images: readonly LocalDraftImage[]): void {
    const photos = images.slice(0, MAX_PHOTOS).map((image, index) =>
      this.createPhoto(
        new File([image.blob], analyzeImageFilename(index), {
          type: image.blob.type || 'image/jpeg',
        }),
        image.role,
        'camera',
        image,
      ),
    );
    this.photosState.set(photos);
    photos.forEach((photo) => this.startCompression(photo));
  }

  private attachedRerunFields(precise: boolean): AnalyzeRequestFields | null {
    const attached = this.attachedState();
    if (!attached?.analysisId) {
      return null;
    }
    return {
      ...this.fields(attached.mode, attached.description, precise, this.reviewContext()),
      previousAnalysisId: attached.analysisId,
    };
  }

  private pushAnalysisToDraft(response: AnalyzeResponse): void {
    const attached = this.attachedState();
    if (attached?.kind !== 'server' || attached.analysisId === response.analysisId) {
      return;
    }
    const session = this.sessionState();
    const items = this.items();
    const timing = timingFromInput(this.dateTime());
    const pushedTiming = this.timingSnapshot();
    const description = (response.description ?? '').trim().slice(0, API_LIMITS.descriptionMax);
    const body: UpdateDraftRequest = {
      analysisId: response.analysisId,
      items: toEntryItemInputs(items),
      portion: toPortion(this.portion()),
      name: deriveMealName(this.name(), items) || null,
      description: description || null,
      mealType: this.mealType(),
      ...(timing ? { timestamp: timing.timestamp, localDate: timing.localDate } : {}),
    };
    this.api.updateDraft(attached.id, body).then(
      (draft) => {
        this.drafts.upsert(draft);
        const current = this.attachedState();
        if (
          session === this.sessionState() &&
          current?.kind === 'server' &&
          current.id === draft.id
        ) {
          this.attachedState.set({
            ...current,
            analysisId: draft.analysisId,
            photos: draft.photos,
          });
          this.timingSeedState.set(pushedTiming);
        }
      },
      () => undefined,
    );
  }

  private planProduct(): ProductPlan {
    const drafts = this.items();
    const items = toEntryItemInputs(drafts);
    const label = this.label();
    const labelKey = this.labelItem()?.key ?? null;
    const single = items.length === 1 ? (items[0] ?? null) : null;
    const labelItem = single && labelKey !== null && drafts[0]?.key === labelKey ? single : null;
    const body = label
      ? labelItem
        ? productRequestFromLabel(
            label,
            deriveMealName(this.name(), drafts) || (label.productName ?? ''),
            labelItem,
          )
        : productRequestFromLabel(
            label,
            label.productName?.trim() || (this.labelItem()?.name ?? items[0]?.name ?? ''),
          )
      : single &&
        productRequestFromItem(single, deriveMealName(this.name(), drafts) || single.name);
    if (!body) {
      return { kind: 'skip', reason: 'items' };
    }
    if (!per100InRange(body.per100, body.basisUnit)) {
      return { kind: 'skip', reason: 'values' };
    }
    return labelItem && labelItem.grams >= PRODUCT_GRAMS_MIN && labelItem.grams <= MAX_ITEM_GRAMS
      ? { kind: 'log', body, grams: labelItem.grams }
      : { kind: 'save', body };
  }

  private async logThroughProduct(
    barcode: string,
    plan: Extract<ProductPlan, { kind: 'log' }>,
    body: CreateEntryRequest,
  ): Promise<CreatedEntry> {
    let product: ProductDto;
    try {
      product = await this.api.upsertProduct(barcode, plan.body);
    } catch {
      return { entry: await this.api.createEntry(body), product: 'failed' };
    }
    try {
      const entry = await this.api.logProduct(product.id, {
        grams: plan.grams,
        timestamp: body.timestamp,
        localDate: body.localDate,
        mealType: body.mealType,
      });
      return { entry, product: 'saved' };
    } catch (err) {
      const status = httpStatus(err);
      if (status !== null && PRODUCT_LOG_FALLBACK_STATUSES.has(status)) {
        return { entry: await this.api.createEntry(body), product: 'saved' };
      }
      this.events.notify('products');
      throw err;
    }
  }

  private async afterEntryProduct(
    barcode: string | null,
    plan: ProductPlan | null,
    outcome: ProductOutcome,
  ): Promise<ProductOutcome> {
    if (!barcode || !plan || plan.kind === 'log') {
      return outcome;
    }
    if (plan.kind === 'skip') {
      return plan.reason === 'values' ? 'skipped' : null;
    }
    try {
      await this.api.upsertProduct(barcode, plan.body);
      return 'saved';
    } catch {
      return 'failed';
    }
  }

  private async createFavorite(entry: EntryDto, name: string): Promise<FavoriteDto | null> {
    try {
      return await this.api.createFavoriteFromEntry(
        entry.id,
        name ? { name: name.slice(0, API_LIMITS.nameMax) } : {},
      );
    } catch {
      return null;
    }
  }

  private async run(run: AnalyzeRun): Promise<void> {
    const id = ++this.runSeq;
    this.lastRun = run;
    this.errorState.set(null);
    if (!this.network.online()) {
      this.errorState.set(offlineFailure());
      this.phaseState.set(run.returnTo);
      return;
    }
    this.runKindState.set(run.kind);
    this.startedAtState.set(Date.now());
    this.phaseState.set('analyzing');
    try {
      const images = await this.compressedImages(run.images);
      if (id !== this.runSeq) {
        return;
      }
      const response = await this.api.analyze(run.fields, images);
      if (id !== this.runSeq) {
        return;
      }
      this.applyAnalysis(response, run.kind);
    } catch (err) {
      if (id !== this.runSeq) {
        return;
      }
      this.errorState.set(this.describeFailure(err));
      this.phaseState.set(run.returnTo);
    }
  }

  private initialFields(
    fields: AnalyzeRequestFields,
    attached: AttachedDraft | null,
  ): AnalyzeRequestFields {
    if (attached?.kind === 'server') {
      return { ...fields, draftId: attached.id };
    }
    return fields.mode === 'text' && attached === null && this.barcodeState() === null
      ? { ...fields, split: 'true' }
      : fields;
  }

  private startMeals(response: AnalyzeResponse): void {
    const now = new Date();
    const meals = [response, ...(response.moreMeals ?? [])].map((analysis) =>
      pendingMeal(++this.mealSeq, analysis, now),
    );
    this.activeMealState.set(null);
    this.mealsErrorState.set(null);
    this.mealsState.set(sortMeals(meals));
    this.showMeals();
  }

  private showMeals(): void {
    this.activeMealState.set(null);
    this.analysisState.set(null);
    this.errorState.set(null);
    this.labelItemKeyState.set(null);
    this.seedReview([], '');
    this.phaseState.set('meals');
  }

  private finishMeal(): number {
    const id = this.activeMealState();
    if (id === null) {
      return 0;
    }
    const left = this.mealsState().filter((meal) => meal.id !== id);
    this.mealsState.set(left);
    if (left.length === 0) {
      this.activeMealState.set(null);
      return 0;
    }
    this.showMeals();
    return left.length;
  }

  private changeMeals(change: (meal: PendingMeal) => PendingMeal): void {
    if (this.phaseState() !== 'meals' || this.mealsSavingState()) {
      return;
    }
    this.mealsErrorState.set(null);
    this.mealsState.update((meals) => sortMeals(meals.map(change)));
  }

  private applyTimingHint(response: AnalyzeResponse): void {
    if (!hasTimingHint(response.timing) || this.timeSourceState() !== 'now') {
      return;
    }
    const placement = mealPlacement(response.timing);
    this.dateTime.set(placement.dateTime);
    this.autoDateTime = placement.dateTime;
    this.timeSourceState.set('user');
    if (this.mealTypeAuto()) {
      this.mealType.set(placement.mealType);
      this.mealTypeAuto.set(placement.mealTypeAuto);
    }
  }

  private applyAnalysis(response: AnalyzeResponse, kind: AnalyzeKind): void {
    if (kind === 'initial' && (response.moreMeals?.length ?? 0) > 0) {
      this.startMeals(response);
      return;
    }
    const keepName = kind !== 'initial' && this.name().trim() !== this.seedNameState().trim();
    const aiName = response.result.mealName.trim().slice(0, API_LIMITS.nameMax);
    const items = draftsFromResult(response.result);
    const drafts = kind === 'label' ? this.reviewDrafts() : null;
    this.analysisState.set(response);
    this.precise.set(response.precise);
    if (kind === 'initial') {
      this.mealTypeAuto.set(this.mealTypeAuto() || this.attachedState() === null);
      this.setAutoTiming(this.captureTime());
      this.applyTimingHint(response);
      this.saveAsFavorite.set(false);
      this.favoriteName.set('');
    }
    this.seedReview(
      items,
      keepName ? this.name() : aiName,
      aiName,
      toPortion(response.result.portion),
    );
    if (drafts) {
      this.restoreReviewDrafts(drafts, response.result.followUpQuestion);
      this.keepPendingPhoto();
    }
    this.labelItemKeyState.set(response.result.label ? labelItemKey(items) : null);
    this.phaseState.set('review');
    this.pushAnalysisToDraft(response);
  }

  private reviewDrafts(): ReviewDrafts {
    return {
      correction: this.correction(),
      correctionOpen: this.correctionOpen(),
      followUpAnswer: this.followUpAnswer(),
      followUpQuestion: this.result()?.followUpQuestion ?? null,
    };
  }

  private restoreReviewDrafts(drafts: ReviewDrafts, question: string | null): void {
    this.correction.set(drafts.correction);
    this.correctionOpen.set(drafts.correctionOpen);
    if (question !== null && question === drafts.followUpQuestion) {
      this.followUpAnswer.set(drafts.followUpAnswer);
    }
  }

  private captureTime(): Date {
    return this.timeSourceState() === 'now'
      ? new Date()
      : (parseDateTimeInput(this.dateTime()) ?? new Date());
  }

  private setAutoTiming(at: Date): void {
    const value = currentDateTimeInput(at);
    this.dateTime.set(value);
    this.autoDateTime = value;
    if (this.mealTypeAuto()) {
      this.mealType.set(guessMealType(at));
    }
  }

  private readPhotoTime(file: File): void {
    const session = this.sessionState();
    this.readTakenAt(file).then(
      (takenAt) => {
        const usable = usablePhotoTime(takenAt);
        if (usable && session === this.sessionState() && this.photosState()[0]?.file === file) {
          this.applyPhotoTime(usable);
        }
      },
      () => undefined,
    );
  }

  private syncPhotoTime(previousFirst: DraftPhoto | undefined): void {
    const first = this.photosState()[0];
    if (first?.id === previousFirst?.id) {
      return;
    }
    this.photoTimeState.set(null);
    if (this.timeSourceState() === 'photo') {
      this.timeSourceState.set('now');
      this.setAutoTiming(new Date());
    }
    if (first?.source === 'library') {
      this.readPhotoTime(first.file);
    }
  }

  private applyPhotoTime(takenAt: Date): void {
    const phase = this.phaseState();
    const untouched =
      this.timeSourceState() === 'now' &&
      (phase === 'compose' ||
        phase === 'analyzing' ||
        (phase === 'review' && this.dateTime() === this.autoDateTime));
    this.photoTimeState.set(currentDateTimeInput(takenAt));
    if (untouched) {
      this.timeSourceState.set('photo');
      this.setAutoTiming(takenAt);
    }
  }

  private seedReview(
    items: DraftItem[],
    name: string,
    seedName: string = name,
    portion: Portion | null = null,
  ): void {
    this.items.set(items);
    this.name.set(name);
    this.portion.set(portion);
    this.seedNameState.set(seedName);
    this.seedState.set(reviewSnapshot(name, items, portion));
    this.followUpAnswer.set('');
    this.correction.set('');
    this.correctionOpen.set(false);
    this.attemptedSaveState.set(false);
    this.saveErrorState.set(null);
    this.seedVersionState.update((value) => value + 1);
  }

  private fields(
    mode: AnalysisMode,
    description: string,
    precise: boolean,
    context: MealContext,
  ): AnalyzeRequestFields {
    const text = description.trim().slice(0, API_LIMITS.descriptionMax);
    return {
      mode,
      ...(text ? { description: text } : {}),
      ...(precise ? { precise: 'true' as const } : {}),
      ...context,
    };
  }

  private rerunFields(analysis: AnalyzeResponse, precise: boolean): AnalyzeRequestFields {
    return {
      ...this.fields(analysis.mode, analysis.description ?? '', precise, this.reviewContext()),
      previousAnalysisId: analysis.analysisId,
    };
  }

  private reviewContext(): MealContext {
    return { localTime: analysisLocalTime(this.dateTime()), mealType: this.mealType() };
  }

  private labelFields(analysis: AnalyzeResponse): AnalyzeRequestFields {
    return this.rerunFields(analysis, this.precise());
  }

  private defaultRole(position: number): ImageRole {
    const mode = this.modeState();
    return position === 0 && mode !== 'text' ? roleForMode(mode) : 'label';
  }

  private createPhoto(
    file: File,
    role: ImageRole,
    source: ImageCaptureSource,
    stored?: LocalDraftImage,
  ): DraftPhoto {
    const photo: DraftPhoto = {
      id: ++this.photoSeq,
      file,
      role,
      source,
      previewUrl: URL.createObjectURL(file),
    };
    return stored ? { ...photo, stored } : photo;
  }

  private appendPhotos(added: readonly DraftPhoto[]): void {
    if (added.length === 0) {
      return;
    }
    const before = this.photosState();
    this.setPhotos([...before, ...added]);
    added.forEach((photo) => this.startCompression(photo));
    this.syncPhotoTime(before[0]);
  }

  private setPhotos(photos: readonly DraftPhoto[]): void {
    this.photosState.set(photos);
    if (photos.length > 0) {
      this.modeState.set(modeForRoles(photos.map((photo) => photo.role)));
    }
  }

  private changeRole(photo: DraftPhoto, role: ImageRole): void {
    const updated: DraftPhoto = { ...photo, role };
    this.setPhotos(
      this.photosState().map((candidate) => (candidate.id === photo.id ? updated : candidate)),
    );
    this.startCompression(updated);
  }

  private keepPendingPhoto(): void {
    const pending = this.pendingPhotoState();
    if (pending) {
      this.extraPhotosState.update((photos) => [...photos, pending]);
      this.pendingPhotoState.set(null);
    }
  }

  private replacePendingPhoto(photo: DraftPhoto | null): void {
    const previous = this.pendingPhotoState();
    if (previous) {
      URL.revokeObjectURL(previous.previewUrl);
      this.compressions.delete(previous.id);
    }
    this.pendingPhotoState.set(photo);
  }

  private markFailed(id: number, failed: boolean): void {
    const current = this.failedPhotosState();
    if (current.has(id) === failed) {
      return;
    }
    const next = new Set(current);
    if (failed) {
      next.add(id);
    } else {
      next.delete(id);
    }
    this.failedPhotosState.set(next);
  }

  private startCompression(photo: DraftPhoto): CompressionJob {
    const preset = COMPRESS_PRESETS[modeForRole(photo.role)];
    const current = this.compressions.get(photo.id);
    if (current?.preset === preset) {
      return current;
    }
    const stored = photo.stored?.role === photo.role ? photo.stored : null;
    const promise = stored
      ? Promise.resolve(storedImage(stored.blob))
      : this.compress(photo.file, preset);
    const job: CompressionJob = { preset, promise };
    this.compressions.set(photo.id, job);
    this.markFailed(photo.id, false);
    promise.catch((err: unknown) => {
      if (this.compressions.get(photo.id) !== job) {
        return;
      }
      this.compressions.delete(photo.id);
      if (this.photosState().some((candidate) => candidate.id === photo.id)) {
        this.markFailed(photo.id, true);
      }
      if (this.phaseState() === 'compose') {
        this.errorState.set(this.describeFailure(err));
      }
    });
    return job;
  }

  private compressedImages(photos: readonly DraftPhoto[]): Promise<AnalyzeImage[]> {
    return Promise.all(
      photos.map(async (photo) => ({
        blob: (await this.startCompression(photo).promise).blob,
        role: photo.role,
      })),
    );
  }

  private describeFailure(err: unknown): AnalyzeFailure {
    return describeAnalyzeError(err, { admin: this.auth.isAdmin() });
  }

  private loadAiConfig(): void {
    if (this.aiConfigRequested) {
      return;
    }
    this.aiConfigRequested = true;
    this.api.getProfile().then(
      (profile) => this.aiConfigState.set(profile.ai),
      () => {
        this.aiConfigRequested = false;
      },
    );
  }

  private releasePhotos(): void {
    this.photosState().forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    this.extraPhotosState().forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    this.replacePendingPhoto(null);
    this.compressions.clear();
  }

  private releaseAttached(): void {
    const attached = this.attachedState();
    if (attached?.kind === 'local') {
      this.sync.release(attached.localId);
    }
    this.attachedState.set(null);
  }

  private resetState(): void {
    this.runSeq += 1;
    this.lastRun = null;
    this.releasePhotos();
    this.releaseAttached();
    this.composeSeedState.set(null);
    this.timingSeedState.set(null);
    this.extraPhotosState.set([]);
    this.draftSavingState.set(false);
    this.draftSavedState.set(false);
    this.draftErrorState.set(null);
    this.coverChoiceState.set(null);
    this.mealsState.set([]);
    this.activeMealState.set(null);
    this.mealsSavingState.set(false);
    this.mealsErrorState.set(null);
    this.photosState.set([]);
    this.failedPhotosState.set(new Set());
    this.modeState.set('food_photo');
    this.sourceState.set('camera');
    this.errorState.set(null);
    this.analysisState.set(null);
    this.runKindState.set('initial');
    this.labelItemKeyState.set(null);
    this.baseSourceState.set('manual');
    this.libraryPhotoState.set(null);
    this.prefillState.set('');
    this.barcodeState.set(null);
    this.photoTimeState.set(null);
    this.timeSourceState.set('now');
    this.description.set('');
    this.precise.set(false);
    this.mealTypeAuto.set(true);
    this.setAutoTiming(new Date());
    this.saveAsFavorite.set(false);
    this.favoriteName.set('');
    this.seedReview([], '');
    this.sessionState.update((value) => value + 1);
    this.phaseState.set('idle');
  }
}

function storedImage(blob: Blob): CompressedImage {
  return {
    blob,
    mimeType: 'image/jpeg',
    width: 0,
    height: 0,
    sourceWidth: 0,
    sourceHeight: 0,
    sourceBytes: blob.size,
    bytes: blob.size,
    decoder: 'image-bitmap',
  };
}
