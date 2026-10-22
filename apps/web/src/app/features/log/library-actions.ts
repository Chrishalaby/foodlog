import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  API_LIMITS,
  formatPortion,
  roundTo,
  type CreateEntryRequest,
  type EntryDto,
  type FavoriteDto,
  type FoodRenameResponse,
  type FoodSearchResult,
  type Portion,
  type QuickLogRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { onSessionReset } from '../../core/session-scope';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { entryUpdateRequest } from '../../shared/utils/entry-photos';
import { quickLogTopics } from '../../shared/utils/data-topics';
import { canRenameResult, renamedMessage } from '../../shared/utils/food-library';
import { formatNutrientValue } from '../../shared/utils/format';
import { foodNameKey } from './food-search';
import { FoodSearchStore } from './food-search.store';
import { TODAY_PATH } from './log-helpers';

export interface LoggedEntry {
  id: string;
  identity: string;
  name: string;
  calories: number;
}

function isSingleFood(result: FoodSearchResult): boolean {
  return result.kind === 'food' || result.kind === 'product';
}

export function libraryIdentity(result: FoodSearchResult): string {
  return result.kind === 'favorite' ? result.key : `${result.kind}:${foodNameKey(result.name)}`;
}

export function canHideResult(result: Pick<FoodSearchResult, 'kind'>): boolean {
  return result.kind === 'meal' || result.kind === 'food';
}

export function canSavePortion(
  result: Pick<FoodSearchResult, 'kind' | 'entryId' | 'favoriteId' | 'portion'>,
): boolean {
  if (result.portion) {
    return false;
  }
  return result.kind === 'favorite'
    ? result.favoriteId !== null
    : (result.kind === 'meal' || result.kind === 'food') && result.entryId !== null;
}

const FOOD_KEY_PREFIX = 'food:';

export function favoriteLibraryResult(favorite: FavoriteDto): FoodSearchResult {
  const grams = favorite.items.reduce((sum, item) => sum + item.grams, 0);
  return {
    key: `favorite:${favorite.id}`,
    kind: 'favorite',
    name: favorite.name,
    detail: null,
    items: [...favorite.items],
    totals: favorite.totals,
    grams: roundTo(grams, 1),
    portion: favorite.portion ?? null,
    mealType: favorite.mealType,
    photo: favorite.photo,
    favoriteId: favorite.id,
    entryId: null,
    productId: null,
    useCount: favorite.useCount,
    lastUsedAt: favorite.lastUsedAt,
    starred: true,
  };
}

@Injectable()
export class LibraryActions {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly router = inject(Router);
  private readonly search = inject(FoodSearchStore, { optional: true });
  private readonly busyState = signal<string | null>(null);
  private readonly loggedState = signal<readonly LoggedEntry[]>([]);

  readonly busyKey = this.busyState.asReadonly();
  readonly logged = this.loggedState.asReadonly();
  readonly loggedCalories = computed(() =>
    this.loggedState().reduce((sum, entry) => sum + entry.calories, 0),
  );

  constructor() {
    onSessionReset(() => this.loggedState.set([]));
  }

  async log(result: FoodSearchResult, body: QuickLogRequest): Promise<EntryDto | null> {
    if (this.busyState() !== null) {
      return null;
    }
    this.busyState.set(result.key);
    try {
      const entry = await this.api.quickLog(body);
      this.events.notify(...quickLogTopics(result));
      this.remember(result, entry);
      const amount = entry.portion ? `${formatPortion(entry.portion)} · ` : '';
      this.toast.success(
        `Logged ${entry.name} · ${amount}${formatNutrientValue('calories', entry.totals.calories)} kcal`,
        {
          actions: [
            { label: 'Undo', run: () => void this.undo(entry) },
            { label: 'View', run: () => this.viewToday() },
          ],
        },
      );
      return entry;
    } catch (err) {
      if (httpStatus(err) === 404) {
        this.toast.error(`${result.name} is no longer in your library.`);
        void this.search?.refresh();
        return null;
      }
      this.toast.error(errorMessage(err, `Couldn't log ${result.name}. Please try again.`));
      return null;
    } finally {
      this.busyState.set(null);
    }
  }

  async undo(entry: EntryDto): Promise<void> {
    try {
      await this.api.deleteEntry(entry.id);
      this.loggedState.update((list) => list.filter((logged) => logged.id !== entry.id));
      this.events.notify('entries');
      this.toast.info(`Removed ${entry.name} from your log`);
    } catch (err) {
      this.toast.error(errorMessage(err, "Couldn't undo. Delete the entry from your log instead."));
    }
  }

  viewToday(): void {
    void this.router.navigateByUrl(TODAY_PATH);
  }

  async star(result: FoodSearchResult): Promise<FavoriteDto | null> {
    if (this.busyState() !== null || result.starred) {
      return null;
    }
    this.busyState.set(result.key);
    try {
      const favorite =
        result.kind === 'meal' && result.entryId
          ? await this.api.createFavoriteFromEntry(result.entryId)
          : await this.api.createFavorite({
              name: result.name.trim().slice(0, API_LIMITS.nameMax),
              mealType: null,
              items: result.items,
              ...(result.portion ? { portion: result.portion } : {}),
              photoId: isSingleFood(result) ? null : (result.photo?.id ?? null),
            });
      this.events.notify('favorites');
      this.toast.success(`Starred ${favorite.name}`);
      return favorite;
    } catch (err) {
      this.toast.error(errorMessage(err, `Couldn't star ${result.name}. Please try again.`));
      return null;
    } finally {
      this.busyState.set(null);
    }
  }

  async savePortion(result: FoodSearchResult, portion: Portion): Promise<FoodSearchResult | null> {
    if (this.busyState() !== null || !canSavePortion(result)) {
      return null;
    }
    this.busyState.set(result.key);
    try {
      const updated = await this.storePortion(result, portion);
      this.events.notify(result.kind === 'favorite' ? 'favorites' : 'entries');
      this.toast.success(`Saved: ${result.name} was ${formatPortion(portion)}`);
      return updated;
    } catch (err) {
      this.toast.error(errorMessage(err, `Couldn't save the count. Please try again.`));
      return null;
    } finally {
      this.busyState.set(null);
    }
  }

  async unstar(result: FoodSearchResult): Promise<boolean> {
    const favoriteId = result.favoriteId;
    if (this.busyState() !== null || !favoriteId) {
      return false;
    }
    const confirmed = await this.confirm.confirm({
      title: `Remove ${result.name} from favorites?`,
      message: 'The favorite is deleted. Everything you logged stays in your log and in search.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!confirmed) {
      return false;
    }
    this.busyState.set(result.key);
    try {
      await this.api.deleteFavorite(favoriteId);
      this.events.notify('favorites');
      this.toast.info(`Removed ${result.name} from favorites`);
      return true;
    } catch (err) {
      this.toast.error(errorMessage(err, `Couldn't unstar ${result.name}. Please try again.`));
      return false;
    } finally {
      this.busyState.set(null);
    }
  }

  async rename(result: FoodSearchResult, to: string): Promise<FoodRenameResponse | null> {
    const name = to.trim().slice(0, API_LIMITS.nameMax);
    if (this.busyState() !== null || !canRenameResult(result) || !name || name === result.name) {
      return null;
    }
    this.busyState.set(result.key);
    try {
      const response = await this.api.renameFood({ from: result.name, to: name });
      this.events.notify('entries', 'favorites');
      if (response.renamedEntries > 0) {
        this.toast.success(renamedMessage(response.renamedEntries, name));
      } else {
        this.toast.info(`Nothing named “${result.name}” was left to rename.`);
      }
      return response;
    } catch (err) {
      this.toast.error(errorMessage(err, `Couldn't rename ${result.name}. Please try again.`));
      return null;
    } finally {
      this.busyState.set(null);
    }
  }

  async hide(result: FoodSearchResult): Promise<boolean> {
    if (!canHideResult(result)) {
      return false;
    }
    const name = result.name;
    this.search?.forget(name);
    try {
      await this.api.hideFood({ name });
    } catch (err) {
      void this.search?.refresh();
      this.toast.error(errorMessage(err, `Couldn't remove ${name} from suggestions.`));
      return false;
    }
    this.events.notify('entries');
    this.toast.info(`Removed “${name}” from suggestions. Your logs are kept.`, {
      action: { label: 'Undo', run: () => void this.unhide(name) },
    });
    return true;
  }

  async unhide(name: string): Promise<boolean> {
    try {
      await this.api.unhideFood(name);
    } catch (err) {
      this.toast.error(errorMessage(err, `Couldn't bring back ${name}. Please try again.`));
      return false;
    }
    this.events.notify('entries');
    this.toast.info(`“${name}” is back in suggestions`);
    return true;
  }

  isLogged(result: FoodSearchResult): boolean {
    const identity = libraryIdentity(result);
    return this.loggedState().some((entry) => entry.identity === identity);
  }

  private async storePortion(
    result: FoodSearchResult,
    portion: Portion,
  ): Promise<FoodSearchResult> {
    if (result.kind === 'favorite') {
      const favorite = (await this.api.listFavorites()).find(
        (candidate) => candidate.id === result.favoriteId,
      );
      if (!favorite) {
        throw new Error(`${result.name} is no longer in your favorites.`);
      }
      const saved = await this.api.updateFavorite(favorite.id, {
        name: favorite.name,
        mealType: favorite.mealType,
        items: favorite.items,
        portion,
      });
      return { ...result, portion: saved.portion ?? portion };
    }
    const entry = await this.api.getEntry(result.entryId ?? '');
    const body = entryUpdateRequest(entry);
    if (result.kind === 'meal') {
      const saved = await this.api.updateEntry(entry.id, { ...body, portion });
      return { ...result, portion: saved.portion ?? portion };
    }
    const itemId = result.key.slice(FOOD_KEY_PREFIX.length);
    const index = entry.items.findIndex((item) => item.id === itemId);
    if (index < 0) {
      throw new Error(`${result.name} is no longer in your library.`);
    }
    const counted = { count: portion.count, unit: portion.unit, unitPlural: portion.unitPlural };
    const items = body.items.map((item, position) =>
      position === index ? { ...item, ...counted } : item,
    );
    const saved = await this.api.updateEntry(entry.id, {
      ...body,
      items,
      ...(entry.items.length === 1 ? { portion } : {}),
    });
    const item = saved.items[index];
    return {
      ...result,
      key: item ? `${FOOD_KEY_PREFIX}${item.id}` : result.key,
      items: result.items.map((food) => ({ ...food, ...counted })),
      portion,
    };
  }

  async logEntry(identity: string, request: CreateEntryRequest): Promise<EntryDto | null> {
    if (this.busyState() !== null) {
      return null;
    }
    this.busyState.set(identity);
    try {
      const entry = await this.api.createEntry(request);
      this.events.notify('entries');
      this.loggedState.update((list) => [
        ...list,
        { id: entry.id, identity, name: entry.name, calories: entry.totals.calories },
      ]);
      this.toast.success(
        `Logged ${entry.name} · ${formatNutrientValue('calories', entry.totals.calories)} kcal`,
        {
          actions: [
            { label: 'Undo', run: () => void this.undo(entry) },
            { label: 'View', run: () => this.viewToday() },
          ],
        },
      );
      return entry;
    } catch (err) {
      this.toast.error(errorMessage(err, `Couldn't log ${request.name}. Please try again.`));
      return null;
    } finally {
      this.busyState.set(null);
    }
  }

  isIdentityLogged(identity: string): boolean {
    return this.loggedState().some((entry) => entry.identity === identity);
  }

  private remember(result: FoodSearchResult, entry: EntryDto): void {
    this.loggedState.update((list) => [
      ...list,
      {
        id: entry.id,
        identity: libraryIdentity(result),
        name: entry.name,
        calories: entry.totals.calories,
      },
    ]);
  }
}
