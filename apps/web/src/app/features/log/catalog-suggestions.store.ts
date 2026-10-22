import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { CatalogFoodDto } from '@food/shared';
import { ApiService } from '../../core/api.service';

export const CATALOG_SUGGESTIONS_LIMIT = 6;
export const CATALOG_DEBOUNCE_MS = 250;

@Injectable()
export class CatalogSuggestions {
  private readonly api = inject(ApiService);
  private readonly resultsState = signal<readonly CatalogFoodDto[]>([]);
  private readonly totalState = signal(0);
  private readonly shownQueryState = signal<string | null>(null);
  private readonly loadingState = signal(false);
  private readonly failedState = signal(false);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private wanted = '';

  readonly results = this.resultsState.asReadonly();
  readonly total = this.totalState.asReadonly();
  readonly shownQuery = this.shownQueryState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly failed = this.failedState.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.seq += 1;
      this.clearTimer();
    });
  }

  search(query: string): void {
    if (query === this.wanted) {
      return;
    }
    this.wanted = query;
    this.clearTimer();
    this.seq += 1;
    if (query === '') {
      this.resultsState.set([]);
      this.totalState.set(0);
      this.shownQueryState.set(null);
      this.loadingState.set(false);
      this.failedState.set(false);
      return;
    }
    this.loadingState.set(true);
    const id = this.seq;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fetch(query, id);
    }, CATALOG_DEBOUNCE_MS);
  }

  async flush(query: string): Promise<readonly CatalogFoodDto[]> {
    if (query === '') {
      return [];
    }
    if (this.shownQueryState() === query && this.timer === null && !this.loadingState()) {
      return this.resultsState();
    }
    this.clearTimer();
    this.wanted = query;
    const id = ++this.seq;
    this.loadingState.set(true);
    await this.fetch(query, id);
    return this.shownQueryState() === query ? this.resultsState() : [];
  }

  private async fetch(query: string, id: number): Promise<void> {
    try {
      const response = await this.api.searchCatalog({ q: query, limit: CATALOG_SUGGESTIONS_LIMIT });
      if (id !== this.seq) {
        return;
      }
      this.resultsState.set(response.results);
      this.totalState.set(response.total);
      this.shownQueryState.set(query);
      this.failedState.set(false);
    } catch {
      if (id === this.seq) {
        this.resultsState.set([]);
        this.totalState.set(0);
        this.shownQueryState.set(query);
        this.failedState.set(true);
      }
    } finally {
      if (id === this.seq) {
        this.loadingState.set(false);
      }
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
