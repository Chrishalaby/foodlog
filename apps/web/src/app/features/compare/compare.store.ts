import { HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  API_LIMITS,
  guessMealType,
  toLocalDateTimeInput,
  type AnalysisMode,
  type AnalyzeRequestFields,
  type CreateEntryRequest,
  type DaySummary,
  type EntryDto,
  type FoodSearchResult,
  type MealType,
  type MenuDish,
  type MenuScanFields,
  type Portion,
  type ProductDto,
} from '@food/shared';
import { ApiService, type AnalyzeImage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DataEventsService, type DataTopic } from '../../core/data-events.service';
import { OFFLINE_MESSAGE, errorMessage, httpStatus } from '../../core/errors';
import { NetworkService } from '../../core/network.service';
import { onSessionReset } from '../../core/session-scope';
import { localDateOf } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { quickLogTopics } from '../../shared/utils/data-topics';
import { amountSummary } from '../../shared/utils/portion';
import {
  COMPRESS_PRESETS,
  compressImage,
  type CompressOptions,
} from '../../shared/utils/image-compress';
import { describeAnalyzeError, offlineFailure } from '../log/analyze-errors';
import { formatBarcode } from '../log/barcode/gs1';
import { TODAY_PATH } from '../log/log-helpers';
import {
  COMPARE_MAX_AGE_MS,
  COMPARE_STORAGE_KEY,
  MAX_OPTIONS,
  logAmount,
  optionPortion,
  nextOptionId,
  optionFromAnalysis,
  optionFromDish,
  optionFromLibrary,
  optionFromProduct,
  optionItems,
  productLogAmount,
  parsePersisted,
  reviveDish,
  withPortion,
  type CompareOption,
  type OptionPortion,
  type PersistedCompare,
  type SavedMenu,
} from './compare-model';
import { budgetFromDay, type DayBudget } from './compare-ranking';

export type PhotoMode = Exclude<AnalysisMode, 'text'>;

export interface SlotFailure {
  readonly title: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly offline: boolean;
  readonly labelScan: boolean;
}

export type SlotJob =
  | {
      readonly kind: 'analyze';
      readonly mode: AnalysisMode;
      readonly description: string | null;
      readonly image: Blob | null;
    }
  | { readonly kind: 'barcode'; readonly code: string };

export type CompareSlot =
  | { readonly id: string; readonly status: 'ready'; readonly option: CompareOption }
  | {
      readonly id: string;
      readonly status: 'loading';
      readonly job: SlotJob;
      readonly startedAt: number;
    }
  | {
      readonly id: string;
      readonly status: 'failed';
      readonly job: SlotJob;
      readonly failure: SlotFailure;
    };

export interface MenuPhoto {
  readonly id: number;
  readonly file: Blob;
}

export type MenuScan =
  | { readonly status: 'idle'; readonly photos: readonly MenuPhoto[] }
  | {
      readonly status: 'scanning';
      readonly photos: readonly MenuPhoto[];
      readonly startedAt: number;
    }
  | {
      readonly status: 'failed';
      readonly photos: readonly MenuPhoto[];
      readonly failure: SlotFailure;
    };

export type CompareCompressor = (file: Blob, options: CompressOptions) => Promise<{ blob: Blob }>;

export const COMPARE_COMPRESSOR = new InjectionToken<CompareCompressor>('COMPARE_COMPRESSOR', {
  providedIn: 'root',
  factory: () => compressImage,
});

export const COMPARE_CLOCK = new InjectionToken<() => Date>('COMPARE_CLOCK', {
  providedIn: 'root',
  factory: () => () => new Date(),
});

export const COMPARE_STORAGE = new InjectionToken<Storage | null>('COMPARE_STORAGE', {
  providedIn: 'root',
  factory: () => {
    try {
      return inject(DOCUMENT).defaultView?.sessionStorage ?? null;
    } catch {
      return null;
    }
  },
});

export const MENU_PHOTOS_MAX = API_LIMITS.analyzeImagesMax;
export const DAY_LOAD_ERROR = "Couldn't load what you've eaten today.";
export const UNDO_FAILED = "Couldn't undo. Delete the entry from your log instead.";

interface Snapshot {
  readonly options: readonly CompareOption[];
  readonly menu: SavedMenu | null;
}

interface LoggedWith {
  readonly entry: EntryDto;
  readonly topics: DataTopic[];
}

interface LogTiming {
  readonly timestamp: string;
  readonly localDate: string;
  readonly mealType: MealType;
}

class SlotError extends Error {
  constructor(readonly failure: SlotFailure) {
    super(failure.message);
    this.name = 'SlotError';
  }
}

function failure(
  title: string,
  message: string,
  extra: Partial<Pick<SlotFailure, 'retryable' | 'offline' | 'labelScan'>> = {},
): SlotFailure {
  return {
    title,
    message,
    retryable: extra.retryable ?? true,
    offline: extra.offline ?? false,
    labelScan: extra.labelScan ?? false,
  };
}

export function productNotFound(code: string): SlotFailure {
  return failure(
    'Product not found',
    `Nothing is saved for ${formatBarcode(code)} yet. Snap its nutrition label instead.`,
    { retryable: false, labelScan: true },
  );
}

export const NO_FOOD_FOUND = failure(
  "Couldn't find any food",
  'The AI did not recognise food here. Try again, or describe it in words.',
);

export const NO_DISHES_FOUND = failure(
  'No dishes found',
  'Try a sharper photo with the dish names in the frame, one page per photo.',
);

export function slotLabel(job: SlotJob): string {
  if (job.kind === 'barcode') {
    return `Barcode ${formatBarcode(job.code)}`;
  }
  switch (job.mode) {
    case 'text':
      return job.description ?? 'Description';
    case 'nutrition_label':
      return 'Nutrition label';
    default:
      return 'Food photo';
  }
}

export function menuStage(seconds: number): string {
  if (seconds < 4) {
    return 'Uploading the menu…';
  }
  if (seconds < 12) {
    return 'Reading the dishes…';
  }
  if (seconds < 28) {
    return 'Estimating each dish…';
  }
  return 'Taking a little longer than usual…';
}

@Injectable({ providedIn: 'root' })
export class CompareStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly events = inject(DataEventsService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly network = inject(NetworkService);
  private readonly storage = inject(COMPARE_STORAGE);
  private readonly compress = inject(COMPARE_COMPRESSOR);
  private readonly clock = inject(COMPARE_CLOCK);
  private readonly slotsState = signal<readonly CompareSlot[]>([]);
  private readonly menuState = signal<MenuScan>({ status: 'idle', photos: [] });
  private readonly lastMenuState = signal<SavedMenu | null>(null);
  private readonly menuReadyState = signal(false);
  private readonly loggingState = signal<string | null>(null);
  private readonly dayState = signal<DaySummary | null>(null);
  private readonly dayLoadingState = signal(false);
  private readonly dayErrorState = signal<string | null>(null);
  private readonly runs = new Map<string, number>();
  private runSeq = 0;
  private menuSeq = 0;
  private daySeq = 0;
  private photoSeq = 0;
  private session = 0;
  private touchedAt: number | null = null;

  readonly slots = this.slotsState.asReadonly();
  readonly menu = this.menuState.asReadonly();
  readonly lastMenu = this.lastMenuState.asReadonly();
  readonly menuReady = this.menuReadyState.asReadonly();
  readonly loggingId = this.loggingState.asReadonly();
  readonly day = this.dayState.asReadonly();
  readonly dayLoading = this.dayLoadingState.asReadonly();
  readonly dayError = this.dayErrorState.asReadonly();
  readonly options = computed(() =>
    this.slotsState().flatMap((slot) => (slot.status === 'ready' ? [slot.option] : [])),
  );
  readonly freeSlots = computed(() => Math.max(0, MAX_OPTIONS - this.slotsState().length));
  readonly busy = computed(
    () =>
      this.slotsState().some((slot) => slot.status === 'loading') ||
      this.menuState().status === 'scanning',
  );
  readonly budget = computed<DayBudget | null>(() => {
    const day = this.dayState();
    return day ? budgetFromDay(day) : null;
  });

  constructor() {
    this.hydrate();
    onSessionReset(() => this.reset());
  }

  async loadDay(): Promise<void> {
    const id = ++this.daySeq;
    this.dayLoadingState.set(true);
    try {
      const response = await this.api.dayDashboard(localDateOf(this.clock()));
      if (id === this.daySeq) {
        this.dayState.set(response.day);
        this.dayErrorState.set(null);
      }
    } catch (err) {
      if (id === this.daySeq) {
        this.dayErrorState.set(errorMessage(err, DAY_LOAD_ERROR));
      }
    } finally {
      if (id === this.daySeq) {
        this.dayLoadingState.set(false);
      }
    }
  }

  addFromLibrary(result: FoodSearchResult): boolean {
    if (this.freeSlots() <= 0) {
      return false;
    }
    const id = nextOptionId();
    this.setSlots([
      ...this.slotsState(),
      { id, status: 'ready', option: optionFromLibrary(result, id) },
    ]);
    return true;
  }

  describe(text: string): boolean {
    const description = text.replace(/\s+/g, ' ').trim().slice(0, API_LIMITS.descriptionMax);
    if (!description) {
      return false;
    }
    return this.startJob({ kind: 'analyze', mode: 'text', description, image: null });
  }

  addPhoto(file: Blob, mode: PhotoMode, replaceId?: string): boolean {
    return this.startJob({ kind: 'analyze', mode, description: null, image: file }, replaceId);
  }

  lookupBarcode(code: string): boolean {
    return this.startJob({ kind: 'barcode', code });
  }

  retry(id: string): void {
    const slot = this.slotsState().find((candidate) => candidate.id === id);
    if (slot?.status === 'failed' && slot.failure.retryable) {
      this.startJob(slot.job, id);
    }
  }

  remove(id: string): void {
    const slots = this.slotsState();
    const index = slots.findIndex((slot) => slot.id === id);
    const slot = slots[index];
    if (!slot) {
      return;
    }
    this.runs.delete(id);
    this.setSlots(slots.filter((candidate) => candidate.id !== id));
    if (slot.status === 'ready') {
      this.toast.info(`Removed ${slot.option.name}`, {
        action: { label: 'Undo', run: () => this.reinsert(slot, index) },
      });
    }
  }

  setPortion(id: string, portion: OptionPortion): void {
    this.updateOption(id, (option) => withPortion(option, portion));
  }

  clear(): void {
    const snapshot: Snapshot = { options: this.options(), menu: this.lastMenuState() };
    const hadAnything =
      this.slotsState().length > 0 || snapshot.menu !== null || this.menuState().photos.length > 0;
    this.runs.clear();
    this.menuSeq += 1;
    this.menuState.set({ status: 'idle', photos: [] });
    this.lastMenuState.set(null);
    this.menuReadyState.set(false);
    this.setSlots([]);
    if (hadAnything) {
      this.toast.info('Comparison cleared', {
        action: { label: 'Undo', run: () => this.restore(snapshot) },
      });
    }
  }

  addMenuPhotos(files: readonly Blob[]): number {
    const current = this.menuState();
    if (current.status === 'scanning') {
      return files.length;
    }
    const room = Math.max(0, MENU_PHOTOS_MAX - current.photos.length);
    const added = files.slice(0, room).map((file) => ({ id: ++this.photoSeq, file }));
    this.menuState.set({ status: 'idle', photos: [...current.photos, ...added] });
    return files.length - added.length;
  }

  removeMenuPhoto(photoId: number): void {
    const current = this.menuState();
    if (current.status === 'scanning') {
      return;
    }
    this.menuState.set({
      status: 'idle',
      photos: current.photos.filter((photo) => photo.id !== photoId),
    });
  }

  cancelMenuScan(): void {
    const current = this.menuState();
    if (current.status === 'scanning') {
      this.menuSeq += 1;
      this.menuState.set({ status: 'idle', photos: current.photos });
    }
  }

  async scanMenu(note = ''): Promise<boolean> {
    const current = this.menuState();
    if (current.status === 'scanning' || current.photos.length === 0) {
      return false;
    }
    const photos = current.photos;
    if (!this.network.online()) {
      this.menuState.set({
        status: 'failed',
        photos,
        failure: this.fromAnalyzeFailure(offlineFailure()),
      });
      return false;
    }
    const id = ++this.menuSeq;
    this.menuState.set({ status: 'scanning', photos, startedAt: this.clock().getTime() });
    try {
      const images = await Promise.all(
        photos.map(async (photo): Promise<AnalyzeImage> => ({
          blob: (await this.compress(photo.file, COMPRESS_PRESETS.menu)).blob,
          role: 'label',
        })),
      );
      if (id !== this.menuSeq) {
        return false;
      }
      const description = note.replace(/\s+/g, ' ').trim().slice(0, API_LIMITS.descriptionMax);
      const fields: MenuScanFields = description ? { description } : {};
      const response = await this.api.scanMenu(fields, images);
      if (id !== this.menuSeq) {
        return false;
      }
      const dishes = response.dishes
        .map(reviveDish)
        .filter((dish): dish is MenuDish => dish !== null && dish.name.trim().length > 0)
        .slice(0, API_LIMITS.menuDishesMax);
      if (dishes.length === 0) {
        throw new SlotError(NO_DISHES_FOUND);
      }
      this.lastMenuState.set({
        restaurant: response.restaurant?.trim() || null,
        dishes,
        warnings: response.warnings,
        scannedAt: this.clock().getTime(),
      });
      this.menuState.set({ status: 'idle', photos: [] });
      this.menuReadyState.set(true);
      this.persist();
      return true;
    } catch (err) {
      if (id === this.menuSeq) {
        this.menuState.set({ status: 'failed', photos, failure: this.analyzeFailure(err) });
      }
      return false;
    }
  }

  addDishes(dishes: readonly MenuDish[]): number {
    const menu = this.lastMenuState();
    const picked = dishes.slice(0, this.freeSlots());
    if (picked.length === 0) {
      return 0;
    }
    const added = picked.map<CompareSlot>((dish) => {
      const id = nextOptionId();
      return { id, status: 'ready', option: optionFromDish(dish, menu?.restaurant ?? null, id) };
    });
    this.menuReadyState.set(false);
    this.setSlots([...this.slotsState(), ...added]);
    return added.length;
  }

  dismissMenuReady(): void {
    this.menuReadyState.set(false);
  }

  async log(id: string): Promise<EntryDto | null> {
    const option = this.options().find((candidate) => candidate.id === id);
    if (!option || option.loggedEntryId !== null || this.loggingState() !== null) {
      return null;
    }
    const session = this.session;
    this.loggingState.set(id);
    try {
      const { entry, topics } = await this.send(option, this.timing(option));
      if (session !== this.session) {
        return null;
      }
      this.updateOption(id, (current) => ({ ...current, loggedEntryId: entry.id }));
      this.events.notify(...topics);
      this.toast.success(
        `Logged ${entry.name} · ${amountSummary(entry.portion, 0, entry.totals.calories)}`,
        { action: { label: 'Undo', run: () => void this.undo(id, entry, topics) } },
      );
      void this.router.navigateByUrl(TODAY_PATH);
      return entry;
    } catch (err) {
      if (session === this.session) {
        this.toast.error(this.logErrorMessage(option, err));
      }
      return null;
    } finally {
      if (session === this.session) {
        this.loggingState.set(null);
      }
    }
  }

  async undo(id: string, entry: EntryDto, topics: DataTopic[] = ['entries']): Promise<void> {
    const session = this.session;
    try {
      await this.api.deleteEntry(entry.id);
    } catch (err) {
      if (session !== this.session) {
        return;
      }
      if (httpStatus(err) !== 404) {
        this.toast.error(UNDO_FAILED);
        return;
      }
    }
    if (session !== this.session) {
      return;
    }
    this.updateOption(id, (option) =>
      option.loggedEntryId === entry.id ? { ...option, loggedEntryId: null } : option,
    );
    this.events.notify(...topics);
    this.toast.info(`Removed ${entry.name} from your log`);
  }

  expireStale(): boolean {
    const touched = this.touchedAt;
    if (
      touched === null ||
      this.busy() ||
      this.loggingState() !== null ||
      Math.abs(this.clock().getTime() - touched) <= COMPARE_MAX_AGE_MS
    ) {
      return false;
    }
    this.runs.clear();
    this.menuSeq += 1;
    this.slotsState.set([]);
    this.menuState.set({ status: 'idle', photos: [] });
    this.lastMenuState.set(null);
    this.menuReadyState.set(false);
    this.touchedAt = null;
    this.removeStored();
    return true;
  }

  reset(): void {
    this.session += 1;
    this.touchedAt = null;
    this.runs.clear();
    this.menuSeq += 1;
    this.daySeq += 1;
    this.slotsState.set([]);
    this.menuState.set({ status: 'idle', photos: [] });
    this.lastMenuState.set(null);
    this.menuReadyState.set(false);
    this.loggingState.set(null);
    this.dayState.set(null);
    this.dayLoadingState.set(false);
    this.dayErrorState.set(null);
    this.removeStored();
  }

  private reinsert(slot: CompareSlot, index: number): void {
    const slots = this.slotsState();
    if (this.freeSlots() <= 0 || slots.some((candidate) => candidate.id === slot.id)) {
      return;
    }
    const at = Math.min(Math.max(0, index), slots.length);
    this.setSlots([...slots.slice(0, at), slot, ...slots.slice(at)]);
  }

  private restore(snapshot: Snapshot): void {
    if (this.slotsState().length > 0 || this.lastMenuState() !== null) {
      return;
    }
    this.lastMenuState.set(snapshot.menu);
    this.setSlots(
      snapshot.options.map<CompareSlot>((option) => ({ id: option.id, status: 'ready', option })),
    );
  }

  private startJob(job: SlotJob, replaceId?: string): boolean {
    const slots = this.slotsState();
    const id = replaceId ?? nextOptionId();
    const slot: CompareSlot = { id, status: 'loading', job, startedAt: this.clock().getTime() };
    if (replaceId !== undefined) {
      if (!slots.some((candidate) => candidate.id === replaceId)) {
        return false;
      }
      this.setSlots(slots.map((candidate) => (candidate.id === replaceId ? slot : candidate)));
    } else {
      if (this.freeSlots() <= 0) {
        return false;
      }
      this.setSlots([...slots, slot]);
    }
    void this.run(id, job);
    return true;
  }

  private async run(id: string, job: SlotJob): Promise<void> {
    const token = ++this.runSeq;
    this.runs.set(id, token);
    const current = (): boolean => this.runs.get(id) === token;
    try {
      if (!this.network.online()) {
        throw new SlotError(this.offline(job));
      }
      const option =
        job.kind === 'barcode'
          ? await this.fetchProduct(id, job.code)
          : await this.fetchAnalysis(id, job);
      if (!current()) {
        return;
      }
      this.runs.delete(id);
      this.replaceSlot(id, { id, status: 'ready', option });
    } catch (err) {
      if (!current()) {
        return;
      }
      this.runs.delete(id);
      const reason =
        job.kind === 'barcode' ? this.lookupFailure(err, job.code) : this.analyzeFailure(err);
      this.replaceSlot(id, { id, status: 'failed', job, failure: reason });
    }
  }

  private async fetchAnalysis(
    id: string,
    job: Extract<SlotJob, { kind: 'analyze' }>,
  ): Promise<CompareOption> {
    const images: AnalyzeImage[] = [];
    if (job.image) {
      const compressed = await this.compress(job.image, COMPRESS_PRESETS[job.mode]);
      images.push({
        blob: compressed.blob,
        role: job.mode === 'nutrition_label' ? 'label' : 'food',
      });
    }
    const at = this.clock();
    const fields: AnalyzeRequestFields = {
      mode: job.mode,
      ...(job.description ? { description: job.description } : {}),
      localTime: toLocalDateTimeInput(at),
      mealType: guessMealType(at),
    };
    const response = await this.api.analyze(fields, images);
    if (response.result.items.length === 0) {
      throw new SlotError(NO_FOOD_FOUND);
    }
    return optionFromAnalysis(response, id);
  }

  private async fetchProduct(id: string, code: string): Promise<CompareOption> {
    let product: ProductDto | null;
    try {
      const response = await this.api.lookupBarcode(code);
      if (response.source === 'openfoodfacts') {
        this.events.notify('products');
      }
      product = response.product;
    } catch (err) {
      if (httpStatus(err) === 404) {
        throw new SlotError(productNotFound(code));
      }
      throw err;
    }
    if (!product) {
      throw new SlotError(productNotFound(code));
    }
    return optionFromProduct(product, id);
  }

  private offline(job: SlotJob): SlotFailure {
    return job.kind === 'barcode'
      ? failure("You're offline", OFFLINE_MESSAGE, { offline: true })
      : this.fromAnalyzeFailure(offlineFailure());
  }

  private analyzeFailure(err: unknown): SlotFailure {
    if (err instanceof SlotError) {
      return err.failure;
    }
    return this.fromAnalyzeFailure(describeAnalyzeError(err, { admin: this.auth.isAdmin() }));
  }

  private fromAnalyzeFailure(source: ReturnType<typeof offlineFailure>): SlotFailure {
    return failure(source.title, source.message, {
      retryable: source.retryable,
      offline: source.kind === 'offline',
    });
  }

  private lookupFailure(err: unknown, code: string): SlotFailure {
    if (err instanceof SlotError) {
      return err.failure;
    }
    if (err instanceof HttpErrorResponse && err.status === 0) {
      return failure("You're offline", OFFLINE_MESSAGE, { offline: true });
    }
    return failure(
      "Couldn't look up this barcode",
      errorMessage(err, `Looking up ${formatBarcode(code)} failed. Try again.`),
    );
  }

  private timing(option: CompareOption): LogTiming {
    const at = this.clock();
    const favoriteMeal =
      option.log.kind === 'library' && option.log.resultKind === 'favorite'
        ? option.log.mealType
        : null;
    return {
      timestamp: at.toISOString(),
      localDate: localDateOf(at),
      mealType: favoriteMeal ?? guessMealType(at),
    };
  }

  private async send(option: CompareOption, when: LogTiming): Promise<LoggedWith> {
    const log = option.log;
    switch (log.kind) {
      case 'analysis':
        return {
          entry: await this.createAnalysedEntry({
            name: option.name,
            description: log.description,
            mealType: when.mealType,
            source: log.mode,
            timestamp: when.timestamp,
            localDate: when.localDate,
            items: optionItems(option),
            ...this.portionField(option),
            analysisId: log.analysisId,
            photoId: log.photoId,
          }),
          topics: ['entries'],
        };
      case 'library':
        return {
          entry: await this.api.quickLog({ key: log.key, ...logAmount(option), ...when }),
          topics: quickLogTopics({ kind: log.resultKind }),
        };
      case 'product':
        return {
          entry: await this.api.logProduct(log.productId, {
            ...productLogAmount(option),
            ...when,
          }),
          topics: ['entries', 'products'],
        };
      case 'menu':
        return {
          entry: await this.api.createEntry({
            name: option.name,
            description: log.description,
            mealType: when.mealType,
            source: 'text',
            timestamp: when.timestamp,
            localDate: when.localDate,
            items: optionItems(option),
            ...this.portionField(option),
          }),
          topics: ['entries'],
        };
    }
  }

  private portionField(option: CompareOption): { portion?: Portion } {
    const portion = optionPortion(option);
    return portion ? { portion } : {};
  }

  private async createAnalysedEntry(body: CreateEntryRequest): Promise<EntryDto> {
    try {
      return await this.api.createEntry(body);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        throw err;
      }
      return this.api.createEntry({ ...body, analysisId: null, photoId: null });
    }
  }

  private logErrorMessage(option: CompareOption, err: unknown): string {
    if (httpStatus(err) === 404) {
      if (option.log.kind === 'library') {
        return `${option.name} is no longer in your library.`;
      }
      if (option.log.kind === 'product') {
        return `${option.name} was removed from your products. Scan it again.`;
      }
    }
    return errorMessage(err, `Couldn't log ${option.name}. Please try again.`);
  }

  private updateOption(id: string, update: (option: CompareOption) => CompareOption): void {
    const slots = this.slotsState();
    const index = slots.findIndex((slot) => slot.id === id && slot.status === 'ready');
    const slot = slots[index];
    if (!slot || slot.status !== 'ready') {
      return;
    }
    const option = update(slot.option);
    if (option === slot.option) {
      return;
    }
    this.setSlots(slots.map((candidate, at) => (at === index ? { ...slot, option } : candidate)));
  }

  private replaceSlot(id: string, next: CompareSlot): void {
    const slots = this.slotsState();
    if (!slots.some((slot) => slot.id === id)) {
      return;
    }
    this.setSlots(slots.map((slot) => (slot.id === id ? next : slot)));
  }

  private setSlots(slots: readonly CompareSlot[]): void {
    this.slotsState.set(slots);
    this.persist();
  }

  private hydrate(): void {
    const stored = this.readStored();
    if (!stored) {
      return;
    }
    this.slotsState.set(
      stored.options.map<CompareSlot>((option) => ({ id: option.id, status: 'ready', option })),
    );
    this.lastMenuState.set(stored.menu);
    this.touchedAt = stored.savedAt;
  }

  private readStored(): PersistedCompare | null {
    try {
      const text = this.storage?.getItem(COMPARE_STORAGE_KEY) ?? null;
      const parsed = parsePersisted(text, this.auth.user()?.id ?? null, this.clock().getTime());
      if (!parsed && text !== null) {
        this.removeStored();
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private persist(): void {
    const userId = this.auth.user()?.id ?? null;
    const options = this.options();
    const menu = this.lastMenuState();
    const savedAt = this.clock().getTime();
    this.touchedAt = savedAt;
    if (!this.storage || !userId) {
      return;
    }
    if (options.length === 0 && menu === null) {
      this.removeStored();
      return;
    }
    const payload: PersistedCompare = {
      v: 1,
      userId,
      savedAt,
      options,
      menu,
    };
    try {
      this.storage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      return;
    }
  }

  private removeStored(): void {
    try {
      this.storage?.removeItem(COMPARE_STORAGE_KEY);
    } catch {
      return;
    }
  }
}
