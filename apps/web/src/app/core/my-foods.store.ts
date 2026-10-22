import { Injectable, computed, inject, signal, untracked } from '@angular/core';
import type {
  FoodMergeSuggestion,
  MergeFoodsRequest,
  MyFoodChangeResponse,
  MyFoodDto,
  SaveMyFoodRequest,
  UpdateMyFoodRequest,
} from '@food/shared';
import { ApiService } from './api.service';
import { DataEventsService, type DataTopic } from './data-events.service';
import { onSessionReset } from './session-scope';

export type MyFoodsStatus = 'idle' | 'loading' | 'ready' | 'error';

export const MY_FOODS_RETRY_MS = 30_000;

interface Loader {
  seq: number;
  loadedVersion: string | null;
  pending: Promise<void> | null;
  pendingVersion: string | null;
  failedVersion: string | null;
  failedAt: number;
}

function freshLoader(): Loader {
  return {
    seq: 0,
    loadedVersion: null,
    pending: null,
    pendingVersion: null,
    failedVersion: null,
    failedAt: 0,
  };
}

function recentlyFailed(loader: Loader, version: string): boolean {
  return loader.failedVersion === version && Date.now() - loader.failedAt < MY_FOODS_RETRY_MS;
}

function byUse(a: MyFoodDto, b: MyFoodDto): number {
  return (
    b.useCount - a.useCount ||
    (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') ||
    a.name.localeCompare(b.name)
  );
}

@Injectable({ providedIn: 'root' })
export class MyFoodsStore {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly foodsState = signal<readonly MyFoodDto[]>([]);
  private readonly statusState = signal<MyFoodsStatus>('idle');
  private readonly suggestionsState = signal<readonly FoodMergeSuggestion[]>([]);
  private readonly suggestionsStatusState = signal<MyFoodsStatus>('idle');
  private foodsLoader = freshLoader();
  private suggestionsLoader = freshLoader();

  readonly foods = this.foodsState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly suggestions = this.suggestionsState.asReadonly();
  readonly suggestionsStatus = this.suggestionsStatusState.asReadonly();
  readonly count = computed(() => this.foodsState().length);

  constructor() {
    onSessionReset(() => this.reset());
  }

  find(id: string | null | undefined): MyFoodDto | null {
    return id ? (this.foodsState().find((food) => food.id === id) ?? null) : null;
  }

  ensureLoaded(): Promise<void> {
    const version = this.version();
    const loader = this.foodsLoader;
    if (loader.loadedVersion === version && this.statusState() === 'ready') {
      return Promise.resolve();
    }
    if (loader.pending && loader.pendingVersion === version) {
      return loader.pending;
    }
    if (recentlyFailed(loader, version)) {
      return Promise.resolve();
    }
    return this.loadFoods(version);
  }

  refresh(): Promise<void> {
    return this.loadFoods(this.version());
  }

  ensureSuggestions(): Promise<void> {
    const version = this.version();
    const loader = this.suggestionsLoader;
    if (loader.loadedVersion === version && this.suggestionsStatusState() === 'ready') {
      return Promise.resolve();
    }
    if (loader.pending && loader.pendingVersion === version) {
      return loader.pending;
    }
    if (recentlyFailed(loader, version)) {
      return Promise.resolve();
    }
    return this.loadSuggestions(version);
  }

  refreshSuggestions(): Promise<void> {
    return this.loadSuggestions(this.version());
  }

  async create(body: SaveMyFoodRequest): Promise<MyFoodDto> {
    const food = await this.api.createMyFood(body);
    this.upsert(food);
    this.changed(['products']);
    return food;
  }

  async update(id: string, body: UpdateMyFoodRequest): Promise<MyFoodChangeResponse> {
    const response = await this.api.updateMyFood(id, body);
    this.upsert(response.food);
    this.changed(this.changeTopics(response));
    return response;
  }

  async remove(id: string): Promise<void> {
    await this.api.deleteMyFood(id);
    this.foodsState.update((foods) => foods.filter((food) => food.id !== id));
    this.changed(['products', 'entries']);
  }

  async merge(body: MergeFoodsRequest): Promise<MyFoodChangeResponse> {
    const response = await this.api.mergeFoods(body);
    this.suggestionsState.update((list) => list.filter((item) => item.key !== body.key));
    this.upsert(response.food);
    this.changed(['products', 'entries', 'favorites'], { stale: true });
    return response;
  }

  async dismiss(key: string): Promise<void> {
    const before = this.suggestionsState();
    const index = before.findIndex((item) => item.key === key);
    this.suggestionsState.set(before.filter((item) => item.key !== key));
    try {
      await this.api.dismissFoodMerge({ key });
    } catch (err) {
      const original = before[index];
      if (original && !this.suggestionsState().some((item) => item.key === key)) {
        const restored = [...this.suggestionsState()];
        restored.splice(Math.min(index, restored.length), 0, original);
        this.suggestionsState.set(restored);
      }
      throw err;
    }
    if (this.suggestionsLoader.pending) {
      void this.refreshSuggestions();
    }
  }

  reset(): void {
    this.foodsLoader = { ...freshLoader(), seq: this.foodsLoader.seq + 1 };
    this.suggestionsLoader = { ...freshLoader(), seq: this.suggestionsLoader.seq + 1 };
    this.foodsState.set([]);
    this.statusState.set('idle');
    this.suggestionsState.set([]);
    this.suggestionsStatusState.set('idle');
  }

  private changeTopics(response: MyFoodChangeResponse): DataTopic[] {
    const touched = response.updatedItems + response.updatedEntries + response.updatedFavorites;
    return touched > 0 ? ['products', 'entries', 'favorites'] : ['products'];
  }

  private changed(topics: readonly DataTopic[], options: { stale?: boolean } = {}): void {
    const current =
      !options.stale &&
      this.statusState() === 'ready' &&
      this.foodsLoader.loadedVersion === this.version();
    this.events.notify(...topics);
    this.foodsLoader = {
      ...freshLoader(),
      seq: this.foodsLoader.seq + 1,
      loadedVersion: current ? this.version() : null,
    };
    this.suggestionsLoader = { ...freshLoader(), seq: this.suggestionsLoader.seq + 1 };
  }

  private upsert(food: MyFoodDto): void {
    this.foodsState.update((foods) => {
      const index = foods.findIndex((item) => item.id === food.id);
      if (index < 0) {
        return [...foods, food].sort(byUse);
      }
      const copy = [...foods];
      copy[index] = food;
      return copy;
    });
  }

  private version(): string {
    return untracked(() => `${this.events.entries()}:${this.events.products()}`);
  }

  private loadFoods(version: string): Promise<void> {
    const seq = this.foodsLoader.seq + 1;
    this.foodsLoader = { ...this.foodsLoader, seq, pendingVersion: version };
    if (this.statusState() !== 'ready') {
      this.statusState.set('loading');
    }
    const run = (async () => {
      try {
        const foods = await this.api.listMyFoods();
        if (seq !== this.foodsLoader.seq) {
          return;
        }
        this.foodsState.set(foods);
        this.foodsLoader.loadedVersion = version;
        this.foodsLoader.failedVersion = null;
        this.statusState.set('ready');
      } catch {
        if (seq !== this.foodsLoader.seq) {
          return;
        }
        this.foodsLoader.failedVersion = version;
        this.foodsLoader.failedAt = Date.now();
        if (this.statusState() !== 'ready') {
          this.statusState.set('error');
        }
      } finally {
        if (seq === this.foodsLoader.seq) {
          this.foodsLoader.pending = null;
          this.foodsLoader.pendingVersion = null;
        }
      }
    })();
    if (seq === this.foodsLoader.seq && this.foodsLoader.pendingVersion === version) {
      this.foodsLoader.pending = run;
    }
    return run;
  }

  private loadSuggestions(version: string): Promise<void> {
    const seq = this.suggestionsLoader.seq + 1;
    this.suggestionsLoader = { ...this.suggestionsLoader, seq, pendingVersion: version };
    if (this.suggestionsStatusState() !== 'ready') {
      this.suggestionsStatusState.set('loading');
    }
    const run = (async () => {
      try {
        const response = await this.api.foodMergeSuggestions();
        if (seq !== this.suggestionsLoader.seq) {
          return;
        }
        this.suggestionsState.set(response.suggestions);
        this.suggestionsLoader.loadedVersion = version;
        this.suggestionsLoader.failedVersion = null;
        this.suggestionsStatusState.set('ready');
      } catch {
        if (seq !== this.suggestionsLoader.seq) {
          return;
        }
        this.suggestionsLoader.failedVersion = version;
        this.suggestionsLoader.failedAt = Date.now();
        if (this.suggestionsStatusState() !== 'ready') {
          this.suggestionsStatusState.set('error');
        }
      } finally {
        if (seq === this.suggestionsLoader.seq) {
          this.suggestionsLoader.pending = null;
          this.suggestionsLoader.pendingVersion = null;
        }
      }
    })();
    if (seq === this.suggestionsLoader.seq && this.suggestionsLoader.pendingVersion === version) {
      this.suggestionsLoader.pending = run;
    }
    return run;
  }
}
