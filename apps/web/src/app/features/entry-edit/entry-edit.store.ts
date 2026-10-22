import { Injectable, computed, inject, signal } from '@angular/core';
import {
  API_LIMITS,
  type EntryDto,
  type FavoriteDto,
  type FoodRenameResponse,
  type MealType,
  type Portion,
  type ProductDto,
  type UpdateEntryRequest,
  type UpsertProductRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { coverUpdateRequest, entryPhotoRefs, findPhoto } from '../../shared/utils/entry-photos';
import {
  draftFromEntryItem,
  itemsTotals,
  toEntryItemInputs,
  validateItems,
  type DraftItem,
} from '../../shared/ui/items-editor/items-math';
import {
  dateTimeInputFromIso,
  dateTimeInputParts,
  logNowTiming,
  timingFromInput,
  type EntryTiming,
} from '../log/entry-timing';
import type { StoredDay } from '../log/after-midnight-note';
import { microsPer100Field } from '../log/barcode/product-form';
import { foodNameKey, sameFoodName } from '../log/food-search';
import { deriveMealName, itemsSignature, portionSignature } from '../log/log-helpers';
import { toPortion } from '../../shared/utils/portion';

export type EntryLoadStatus = 'loading' | 'ready' | 'not_found' | 'error';
export type EntryBusyAction = 'save' | 'delete' | 'duplicate' | 'favorite' | 'rename' | 'cover';

export interface RawAiState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  text: string | null;
  error: string | null;
}

export interface RenameOffer {
  from: string;
  to: string;
  count: number;
}

export function renameOfferTitle(offer: RenameOffer): string {
  const noun = offer.count === 1 ? 'entry' : 'entries';
  return `Also rename ${offer.count} other “${offer.from}” ${noun} to “${offer.to}”?`;
}

export function renamedOthersMessage(count: number, to: string): string {
  return `Renamed ${count} other ${count === 1 ? 'entry' : 'entries'} to “${to}”`;
}

const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function brandLeadsName(name: string, brand: string | null): boolean {
  const brandKey = foodNameKey(brand ?? '');
  const nameKey = foodNameKey(name);
  return (
    brandKey !== '' &&
    nameKey.startsWith(brandKey) &&
    !WORD_CHARACTER.test(nameKey.charAt(brandKey.length))
  );
}

export function productDisplayName(product: Pick<ProductDto, 'name' | 'brand'>): string {
  const brand = product.brand?.trim() ?? '';
  return brand && !brandLeadsName(product.name, brand)
    ? `${brand} ${product.name.trim()}`
    : product.name.trim();
}

export function renamedProductRequest(product: ProductDto, name: string): UpsertProductRequest {
  const clean = name.trim().slice(0, API_LIMITS.nameMax);
  return {
    name: clean,
    brand: brandLeadsName(clean, product.brand) ? product.brand : null,
    basisUnit: product.basisUnit,
    per100: product.per100,
    ...microsPer100Field(product.microsPer100),
    servingSizeG: product.servingSizeG,
    packSizeG: product.packSizeG,
    source: product.source,
  };
}

function carriesName(product: ProductDto, name: string): boolean {
  return sameFoodName(name, product.name) || sameFoodName(name, productDisplayName(product));
}

export const SAVE_CHANGES_ERROR = 'Could not save your changes. Please try again.';
const RAW_AI_IDLE: RawAiState = { status: 'idle', text: null, error: null };

export function formatRawAi(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value) as unknown, null, 2);
    } catch {
      return value;
    }
  }
  return JSON.stringify(value, null, 2);
}

@Injectable()
export class EntryEditStore {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly entryState = signal<EntryDto | null>(null);
  private readonly statusState = signal<EntryLoadStatus>('loading');
  private readonly loadErrorState = signal<string | null>(null);
  private readonly busyState = signal<EntryBusyAction | null>(null);
  private readonly baselineState = signal('');
  private readonly initialDateTimeState = signal('');
  private readonly recountState = signal(false);
  private readonly attemptedState = signal(false);
  private readonly saveErrorState = signal<string | null>(null);
  private readonly rawAiState = signal<RawAiState>(RAW_AI_IDLE);
  private readonly formVersionState = signal(0);
  private loadSeq = 0;

  readonly name = signal('');
  readonly mealType = signal<MealType>('snack');
  readonly dateTime = signal('');
  readonly description = signal('');
  readonly items = signal<DraftItem[]>([]);
  readonly portion = signal<Portion | null>(null);

  readonly entry = this.entryState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly loadError = this.loadErrorState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly saveError = this.saveErrorState.asReadonly();
  readonly rawAi = this.rawAiState.asReadonly();
  readonly formVersion = this.formVersionState.asReadonly();
  readonly photos = computed(() => {
    const entry = this.entryState();
    return entry ? entryPhotoRefs(entry) : [];
  });
  readonly coverId = computed(
    () => this.entryState()?.photo?.id ?? this.photos()[0]?.photo.id ?? null,
  );
  readonly cover = computed(() => findPhoto(this.photos(), this.coverId()));

  readonly totals = computed(() => itemsTotals(this.items()));
  readonly storedDay = computed<StoredDay | null>(() => {
    const entry = this.entryState();
    const value = this.dateTime();
    if (!entry || value !== this.initialDateTimeState()) {
      return null;
    }
    const parts = dateTimeInputParts(value);
    return parts && parts.localDate !== entry.localDate
      ? { date: entry.localDate, moving: this.recountState() }
      : null;
  });
  readonly dirty = computed(
    () => this.entryState() !== null && this.snapshot() !== this.baselineState(),
  );
  readonly validationError = computed(() => {
    if (!this.timing()) {
      return 'Choose a valid date and time.';
    }
    const itemsError = validateItems(this.items());
    if (itemsError) {
      return itemsError;
    }
    return deriveMealName(this.name(), this.items()) ? null : 'Give this meal a name.';
  });
  readonly visibleValidationError = computed(() =>
    this.attemptedState() ? this.validationError() : null,
  );

  async load(id: string): Promise<void> {
    const seq = ++this.loadSeq;
    this.statusState.set('loading');
    this.loadErrorState.set(null);
    this.rawAiState.set(RAW_AI_IDLE);
    try {
      const entry = await this.api.getEntry(id);
      if (seq === this.loadSeq) {
        this.applyEntry(entry);
        this.statusState.set('ready');
      }
    } catch (err) {
      if (seq !== this.loadSeq) {
        return;
      }
      const status = httpStatus(err);
      if (status === 404 || status === 400) {
        this.statusState.set('not_found');
        return;
      }
      this.loadErrorState.set(errorMessage(err, 'Could not load this entry.'));
      this.statusState.set('error');
    }
  }

  buildUpdateRequest(): UpdateEntryRequest | null {
    const timing = this.timing();
    const items = this.items();
    const name = deriveMealName(this.name(), items);
    if (!this.entryState() || !timing || !name) {
      return null;
    }
    const description = this.description().trim();
    return {
      name,
      description: description ? description.slice(0, API_LIMITS.descriptionMax) : null,
      mealType: this.mealType(),
      timestamp: timing.timestamp,
      localDate: timing.localDate,
      items: toEntryItemInputs(items),
      portion: toPortion(this.portion()),
    };
  }

  async save(): Promise<EntryDto | null> {
    const entry = this.entryState();
    if (!entry || this.busyState() !== null) {
      return null;
    }
    this.attemptedState.set(true);
    const body = this.validationError() ? null : this.buildUpdateRequest();
    if (!body) {
      return null;
    }
    this.saveErrorState.set(null);
    this.busyState.set('save');
    try {
      const updated = await this.api.updateEntry(entry.id, body);
      this.applyEntry(updated);
      this.events.notify('entries');
      return updated;
    } catch (err) {
      this.saveErrorState.set(errorMessage(err, SAVE_CHANGES_ERROR));
      return null;
    } finally {
      this.busyState.set(null);
    }
  }

  async setCover(photoId: string): Promise<EntryDto> {
    const entry = this.requireEntry();
    if (photoId === this.coverId() || !this.photos().some(({ photo }) => photo.id === photoId)) {
      return entry;
    }
    const updated = await this.runBusy('cover', () =>
      this.api.updateEntry(entry.id, coverUpdateRequest(entry, photoId)),
    );
    if (this.entryState()?.id === entry.id) {
      this.entryState.set(updated);
    }
    this.events.notify('entries');
    return updated;
  }

  async findRenameOffer(from: string, to: string): Promise<RenameOffer | null> {
    const oldName = from.trim();
    const newName = to.trim();
    if (!oldName || !newName || sameFoodName(oldName, newName) || this.busyState() !== null) {
      return null;
    }
    try {
      const { matchedEntries } = await this.runBusy('save', () =>
        this.api.renameFood({ from: oldName, to: newName, dryRun: true }),
      );
      return matchedEntries > 0 ? { from: oldName, to: newName, count: matchedEntries } : null;
    } catch {
      return null;
    }
  }

  async renameOthers(offer: RenameOffer): Promise<FoodRenameResponse> {
    const response = await this.runBusy('rename', () =>
      this.api.renameFood({ from: offer.from, to: offer.to }),
    );
    this.events.notify('entries', 'favorites');
    return response;
  }

  async renameLinkedProduct(entry: EntryDto, from: string): Promise<boolean> {
    const productId = entry.productId;
    const to = entry.name.trim();
    if (productId === null || !to || sameFoodName(from, to)) {
      return false;
    }
    return this.runBusy('rename', async () => {
      const product = (await this.api.listProducts()).find((item) => item.id === productId);
      if (!product || !carriesName(product, from)) {
        return false;
      }
      if (product.barcode) {
        await this.api.upsertProduct(product.barcode, renamedProductRequest(product, to));
      } else {
        await this.api.updateMyFood(product.id, { name: to.slice(0, API_LIMITS.nameMax) });
      }
      this.events.notify('products', 'entries');
      return true;
    });
  }

  async renameLinkedFavorite(entry: EntryDto, from: string): Promise<boolean> {
    const favoriteId = entry.favoriteId;
    const to = entry.name.trim().slice(0, API_LIMITS.nameMax);
    if (favoriteId === null || !to || sameFoodName(from, to)) {
      return false;
    }
    return this.runBusy('rename', async () => {
      const favorite = (await this.api.listFavorites()).find((item) => item.id === favoriteId);
      if (!favorite || !sameFoodName(favorite.name, from)) {
        return false;
      }
      await this.api.updateFavorite(favorite.id, {
        name: to,
        mealType: favorite.mealType,
        items: favorite.items,
        portion: favorite.portion ?? null,
      });
      this.events.notify('favorites');
      return true;
    });
  }

  async remove(): Promise<void> {
    const entry = this.requireEntry();
    await this.runBusy('delete', () => this.api.deleteEntry(entry.id));
    this.events.notify('entries');
  }

  async logAgain(now: Date = new Date()): Promise<EntryDto> {
    const entry = this.requireEntry();
    const copy = await this.runBusy('duplicate', () =>
      this.api.duplicateEntry(entry.id, logNowTiming(now)),
    );
    this.events.notify('entries');
    return copy;
  }

  async saveAsFavorite(name: string): Promise<FavoriteDto> {
    const entry = this.requireEntry();
    const trimmed = name.trim().slice(0, API_LIMITS.nameMax);
    const favorite = await this.runBusy('favorite', () =>
      this.api.createFavoriteFromEntry(entry.id, trimmed ? { name: trimmed } : {}),
    );
    this.events.notify('favorites');
    return favorite;
  }

  async loadRawAi(): Promise<void> {
    const entry = this.entryState();
    const status = this.rawAiState().status;
    if (!entry || status === 'loading' || status === 'ready') {
      return;
    }
    this.rawAiState.set({ status: 'loading', text: null, error: null });
    try {
      const response = await this.api.getEntryRawAi(entry.id);
      if (this.entryState()?.id === entry.id) {
        this.rawAiState.set({
          status: 'ready',
          text: formatRawAi(response.rawAiJson),
          error: null,
        });
      }
    } catch (err) {
      if (this.entryState()?.id === entry.id) {
        this.rawAiState.set({
          status: 'error',
          text: null,
          error: errorMessage(err, 'Could not load the AI data.'),
        });
      }
    }
  }

  recount(): void {
    this.recountState.set(true);
  }

  private timing(): EntryTiming | null {
    const entry = this.entryState();
    if (entry && !this.recountState() && this.dateTime() === this.initialDateTimeState()) {
      return { timestamp: entry.timestamp, localDate: entry.localDate };
    }
    return timingFromInput(this.dateTime());
  }

  private requireEntry(): EntryDto {
    const entry = this.entryState();
    if (!entry) {
      throw new Error('The entry is not loaded yet.');
    }
    return entry;
  }

  private async runBusy<T>(action: EntryBusyAction, work: () => Promise<T>): Promise<T> {
    if (this.busyState() !== null) {
      throw new Error('Please wait for the current action to finish.');
    }
    this.busyState.set(action);
    try {
      return await work();
    } finally {
      this.busyState.set(null);
    }
  }

  private snapshot(): string {
    return JSON.stringify([
      this.name().trim(),
      this.mealType(),
      this.dateTime(),
      this.recountState(),
      this.description().trim(),
      itemsSignature(this.items()),
      portionSignature(this.portion()),
    ]);
  }

  private applyEntry(entry: EntryDto): void {
    const dateTime = dateTimeInputFromIso(entry.timestamp);
    this.entryState.set(entry);
    this.name.set(entry.name);
    this.mealType.set(entry.mealType);
    this.dateTime.set(dateTime);
    this.initialDateTimeState.set(dateTime);
    this.recountState.set(false);
    this.description.set(entry.description ?? '');
    this.items.set(entry.items.map(draftFromEntryItem));
    this.portion.set(toPortion(entry.portion));
    this.attemptedState.set(false);
    this.saveErrorState.set(null);
    this.baselineState.set(this.snapshot());
    this.formVersionState.update((version) => version + 1);
  }
}
