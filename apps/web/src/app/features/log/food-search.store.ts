import {
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { FoodSearchQuery, FoodSearchResult, FoodSearchScope } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage } from '../../core/errors';
import { onSessionReset } from '../../core/session-scope';
import { foodNameKey, matchQuality, normalizeQuery, splitSections } from './food-search';

export const SEARCH_DEBOUNCE_MS = 200;
export const BROWSE_LIMIT = 20;
export const SEARCH_ERROR = "Couldn't load your foods.";

export const FOOD_SEARCH_SCOPE = new InjectionToken<FoodSearchScope>('FOOD_SEARCH_SCOPE', {
  providedIn: 'root',
  factory: () => 'all',
});

@Injectable()
export class FoodSearchStore {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly scope = inject(FOOD_SEARCH_SCOPE);
  private readonly activeState = signal(false);
  private readonly resultsState = signal<readonly FoodSearchResult[]>([]);
  private readonly shownQueryState = signal<string | null>(null);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly pendingState = signal(false);
  private browseCache: readonly FoodSearchResult[] | null = null;
  private dataVersion: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private inFlight: Promise<void> | null = null;

  readonly text = signal('');
  readonly query = computed(() => normalizeQuery(this.text()));
  readonly results = this.resultsState.asReadonly();
  readonly shownQuery = this.shownQueryState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly loaded = computed(() => this.shownQueryState() !== null);
  readonly browsing = computed(() => this.query() === '');
  readonly busy = computed(() => this.loadingState() || this.pendingState());
  readonly settled = computed(() => !this.busy() && this.shownQueryState() === this.query());
  readonly sections = computed(() => splitSections(this.resultsState()));
  readonly quality = computed(() =>
    matchQuality(this.resultsState(), this.shownQueryState() ?? ''),
  );

  constructor() {
    effect(() => {
      const version = `${this.events.entries()}:${this.events.favorites()}:${this.events.products()}`;
      if (this.activeState()) {
        untracked(() => this.syncWithData(version));
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.seq += 1;
      this.clearTimer();
    });
    onSessionReset(() => this.reset());
  }

  reset(): void {
    this.seq += 1;
    this.clearTimer();
    this.browseCache = null;
    this.dataVersion = null;
    this.inFlight = null;
    this.text.set('');
    this.resultsState.set([]);
    this.shownQueryState.set(null);
    this.errorState.set(null);
    this.loadingState.set(false);
  }

  activate(): void {
    this.activeState.set(true);
  }

  deactivate(): void {
    this.activeState.set(false);
  }

  setText(text: string): void {
    const before = this.query();
    this.text.set(text);
    const query = this.query();
    if (query === before && !this.pendingState()) {
      return;
    }
    this.clearTimer();
    if (query === '') {
      this.showBrowseCache();
      void this.run('');
      return;
    }
    this.pendingState.set(true);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pendingState.set(false);
      void this.run(this.query());
    }, SEARCH_DEBOUNCE_MS);
  }

  clear(): void {
    this.setText('');
  }

  refresh(): Promise<void> {
    this.clearTimer();
    return this.run(this.query());
  }

  forget(name: string): void {
    const key = foodNameKey(name);
    const keep = (result: FoodSearchResult): boolean =>
      result.kind === 'favorite' || result.kind === 'product' || foodNameKey(result.name) !== key;
    this.resultsState.update((results) => results.filter(keep));
    if (this.browseCache) {
      this.browseCache = this.browseCache.filter(keep);
    }
  }

  async flush(): Promise<readonly FoodSearchResult[]> {
    if (this.pendingState() || this.shownQueryState() !== this.query()) {
      await this.refresh();
    } else if (this.inFlight) {
      await this.inFlight;
    }
    return this.shownQueryState() === this.query() ? this.resultsState() : [];
  }

  private syncWithData(version: string): void {
    if (version === this.dataVersion && this.errorState() === null) {
      return;
    }
    this.dataVersion = version;
    void this.refresh();
  }

  private showBrowseCache(): void {
    if (this.browseCache) {
      this.resultsState.set(this.browseCache);
      this.shownQueryState.set('');
    }
  }

  private run(query: string): Promise<void> {
    const id = ++this.seq;
    this.loadingState.set(true);
    const request = this.fetch(query, id);
    this.inFlight = request;
    return request;
  }

  private async fetch(query: string, id: number): Promise<void> {
    try {
      const response = await this.api.searchFoods(this.request(query));
      if (id !== this.seq) {
        return;
      }
      if (query === '') {
        this.browseCache = response.results;
      }
      this.resultsState.set(response.results);
      this.shownQueryState.set(query);
      this.errorState.set(null);
    } catch (err) {
      if (id === this.seq) {
        this.errorState.set(errorMessage(err, SEARCH_ERROR));
      }
    } finally {
      if (id === this.seq) {
        this.loadingState.set(false);
        this.inFlight = null;
      }
    }
  }

  private request(query: string): FoodSearchQuery {
    return {
      ...(query ? { q: query } : { limit: BROWSE_LIMIT }),
      ...(this.scope === 'all' ? {} : { scope: this.scope }),
    };
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pendingState.set(false);
  }
}
