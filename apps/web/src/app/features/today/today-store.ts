import { Injectable, computed, inject, signal } from '@angular/core';
import {
  guessMealType,
  type DayDashboardResponse,
  type EntryDto,
  type FavoriteDto,
  type FoodRenameResponse,
  type FoodSearchResult,
  type Goal,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage } from '../../core/errors';
import { ProfileStore } from '../../core/profile.store';
import { onSessionReset } from '../../core/session-scope';
import { localDateOf } from '../../core/time';
import { quickLogTopics } from '../../shared/utils/data-topics';
import {
  QUICK_ADD_LIMIT,
  logMomentFor,
  orderQuickAdd,
  withEntry,
  withFoodAt,
  withFoodName,
  withTrainingDay,
  withoutEntry,
  withoutFood,
} from './today-view';

export type DayLoadStatus = 'loading' | 'ready' | 'error';
export type FoodsStatus = 'loading' | 'ready' | 'error';

export interface ProfileSnapshot {
  goal: Goal;
  weightKg: number | null;
}

export interface LoadFoodsOptions {
  stable?: boolean;
}

export const DAY_CACHE_LIMIT = 14;
export const PROFILE_STALE_MS = 5 * 60_000;
export const DAY_LOAD_ERROR = 'Could not load this day.';

@Injectable({ providedIn: 'root' })
export class TodayStore {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly profiles = inject(ProfileStore);
  private readonly cache = new Map<string, DayDashboardResponse>();
  private readonly dateState = signal<string | null>(null);
  private readonly dashboardState = signal<DayDashboardResponse | null>(null);
  private readonly statusState = signal<DayLoadStatus>('loading');
  private readonly errorState = signal<string | null>(null);
  private readonly refreshingState = signal(false);
  private readonly foodsState = signal<readonly FoodSearchResult[]>([]);
  private readonly foodsStatusState = signal<FoodsStatus>('loading');
  private readonly hidingKeys = new Set<string>();
  private version = 0;
  private inFlight = 0;
  private foodsVersion = 0;

  readonly date = this.dateState.asReadonly();
  readonly dashboard = this.dashboardState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly refreshing = this.refreshingState.asReadonly();
  readonly foods = this.foodsState.asReadonly();
  readonly foodsStatus = this.foodsStatusState.asReadonly();
  readonly targets = this.profiles.targets;
  readonly profile = computed<ProfileSnapshot | null>(() => {
    const profile = this.profiles.profile();
    return profile ? { goal: profile.goal, weightKg: profile.weightKg } : null;
  });

  constructor() {
    onSessionReset(() => this.reset());
  }

  show(date: string): Promise<void> {
    if (date !== this.dateState()) {
      this.dateState.set(date);
      const cached = this.cache.get(date) ?? null;
      this.dashboardState.set(cached);
      this.statusState.set(cached ? 'ready' : 'loading');
      this.errorState.set(null);
    }
    return this.fetch();
  }

  reset(): void {
    this.version++;
    this.foodsVersion++;
    this.cache.clear();
    this.dateState.set(null);
    this.dashboardState.set(null);
    this.statusState.set('loading');
    this.errorState.set(null);
    this.foodsState.set([]);
    this.foodsStatusState.set('loading');
    this.hidingKeys.clear();
  }

  refresh(): Promise<void> {
    return this.dateState() ? this.fetch() : Promise.resolve();
  }

  retry(): Promise<void> {
    if (!this.dashboardState()) {
      this.statusState.set('loading');
      this.errorState.set(null);
    }
    return this.refresh();
  }

  async loadExtras(): Promise<void> {
    await Promise.all([this.loadFoods(), this.loadProfile()]);
  }

  async loadFoods(options: LoadFoodsOptions = {}): Promise<void> {
    const token = ++this.foodsVersion;
    if (this.foodsStatusState() === 'error') {
      this.foodsStatusState.set('loading');
    }
    try {
      const response = await this.api.searchFoods({ limit: QUICK_ADD_LIMIT });
      if (token !== this.foodsVersion) {
        return;
      }
      const visible = response.results.filter((result) => !this.hidingKeys.has(result.key));
      this.foodsState.set(orderQuickAdd(visible, options.stable ? this.foodsState() : []));
      this.foodsStatusState.set('ready');
    } catch {
      if (token === this.foodsVersion && this.foodsStatusState() === 'loading') {
        this.foodsStatusState.set('error');
      }
    }
  }

  async loadProfile(): Promise<void> {
    await this.profiles.ensureLoaded();
  }

  refreshProfileIfStale(): void {
    if (!this.profiles.isFresh(PROFILE_STALE_MS)) {
      this.profiles.load().catch(() => undefined);
    }
  }

  async setTrainingDay(trainingDay: boolean): Promise<void> {
    const date = this.dateState();
    const current = this.dashboardState();
    if (!date || !current || current.day.trainingDay === trainingDay) {
      return;
    }
    this.apply(date, withTrainingDay(current, trainingDay, this.targets()));
    try {
      await this.api.putDay(date, { trainingDay });
    } catch (err) {
      const latest = this.dashboardState();
      if (latest && this.dateState() === date) {
        this.apply(date, withTrainingDay(latest, !trainingDay, this.targets()));
      }
      throw err;
    } finally {
      void this.refresh();
    }
  }

  async deleteEntry(entry: EntryDto): Promise<void> {
    const snapshot = entry.localDate === this.dateState() ? this.dashboardState() : null;
    const optimistic = snapshot ? withoutEntry(snapshot, entry.id) : null;
    if (optimistic && optimistic !== snapshot) {
      this.apply(entry.localDate, optimistic);
    }
    try {
      await this.api.deleteEntry(entry.id);
    } catch (err) {
      if (snapshot && optimistic !== snapshot && this.dashboardState() === optimistic) {
        this.apply(entry.localDate, snapshot);
      }
      void this.refresh();
      throw err;
    }
    if (entry.localDate !== this.dateState()) {
      this.cache.delete(entry.localDate);
    }
    this.events.notify('entries');
  }

  async logAgain(entry: EntryDto, now: Date = new Date()): Promise<EntryDto> {
    const moment = logMomentFor(localDateOf(now), now);
    const created = await this.api.duplicateEntry(entry.id, {
      timestamp: moment.timestamp,
      localDate: moment.localDate,
      mealType: guessMealType(moment.at),
    });
    this.addLogged(created);
    this.events.notify('entries');
    return created;
  }

  async quickLog(result: FoodSearchResult, now: Date = new Date()): Promise<EntryDto> {
    const moment = logMomentFor(this.dateState() ?? localDateOf(now), now);
    const created = await this.api.quickLog({
      key: result.key,
      servings: 1,
      timestamp: moment.timestamp,
      localDate: moment.localDate,
      mealType: guessMealType(moment.at),
    });
    this.addLogged(created);
    this.events.notify(...quickLogTopics(result));
    return created;
  }

  async renameFood(food: FoodSearchResult, to: string): Promise<FoodRenameResponse> {
    const response = await this.api.renameFood({ from: food.name, to });
    this.foodsState.update((foods) => withFoodName(foods, food.key, to));
    this.events.notify('entries', 'favorites');
    return response;
  }

  async hideFood(food: FoodSearchResult): Promise<number> {
    const index = this.foodsState().findIndex((result) => result.key === food.key);
    this.foodsVersion++;
    this.hidingKeys.add(food.key);
    this.foodsState.update((foods) => withoutFood(foods, food.key));
    try {
      await this.api.hideFood({ name: food.name });
    } catch (err) {
      if (index >= 0) {
        this.foodsState.update((foods) => withFoodAt(foods, food, index));
      }
      throw err;
    } finally {
      this.hidingKeys.delete(food.key);
    }
    this.events.notify('entries');
    return index;
  }

  async unhideFood(food: FoodSearchResult, index: number): Promise<void> {
    this.foodsVersion++;
    if (index >= 0) {
      this.foodsState.update((foods) => withFoodAt(foods, food, index));
    }
    try {
      await this.api.unhideFood(food.name);
    } catch (err) {
      this.foodsState.update((foods) => withoutFood(foods, food.key));
      throw err;
    }
    this.events.notify('entries');
  }

  removeFood(key: string): void {
    this.foodsVersion++;
    this.foodsState.update((foods) => withoutFood(foods, key));
  }

  async undoCreate(entry: EntryDto): Promise<void> {
    await this.deleteEntry(entry);
  }

  async saveAsFavorite(entry: EntryDto): Promise<FavoriteDto> {
    const favorite = await this.api.createFavoriteFromEntry(entry.id);
    this.events.notify('favorites');
    return favorite;
  }

  addLogged(created: EntryDto): void {
    const current = this.dashboardState();
    if (current && created.localDate === this.dateState()) {
      this.apply(created.localDate, withEntry(current, created));
    } else {
      this.cache.delete(created.localDate);
    }
  }

  private apply(date: string, dashboard: DayDashboardResponse): void {
    this.version++;
    this.remember(date, dashboard);
    if (this.dateState() === date) {
      this.dashboardState.set(dashboard);
      this.statusState.set('ready');
      this.errorState.set(null);
    }
  }

  private async fetch(): Promise<void> {
    const date = this.dateState();
    if (!date) {
      return;
    }
    const token = ++this.version;
    this.inFlight++;
    this.refreshingState.set(true);
    try {
      const dashboard = await this.api.dayDashboard(date);
      if (token === this.version) {
        this.apply(date, dashboard);
      }
    } catch (err) {
      if (token === this.version && !this.dashboardState()) {
        this.statusState.set('error');
        this.errorState.set(errorMessage(err, DAY_LOAD_ERROR));
      }
    } finally {
      this.inFlight--;
      this.refreshingState.set(this.inFlight > 0);
    }
  }

  private remember(date: string, dashboard: DayDashboardResponse): void {
    this.cache.delete(date);
    this.cache.set(date, dashboard);
    while (this.cache.size > DAY_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
  }
}
