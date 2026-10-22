import { Injectable, inject, signal } from '@angular/core';
import { addDays, type WeightLogDto, type WeightSummaryResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { onSessionReset } from '../../core/session-scope';
import { withWeighIn } from '../stats/weight-math';

export const WEIGHT_CARD_WINDOW_DAYS = 30;
export const WEIGHT_CARD_CACHE_LIMIT = 14;

export type WeightCardStatus = 'loading' | 'ready' | 'error';

@Injectable({ providedIn: 'root' })
export class WeightCardStore {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly cache = new Map<string, WeightSummaryResponse>();
  private readonly dateState = signal<string | null>(null);
  private readonly summaryState = signal<WeightSummaryResponse | null>(null);
  private readonly statusState = signal<WeightCardStatus>('loading');
  private version = 0;

  readonly date = this.dateState.asReadonly();
  readonly summary = this.summaryState.asReadonly();
  readonly status = this.statusState.asReadonly();

  constructor() {
    onSessionReset(() => this.reset());
  }

  show(date: string): Promise<void> {
    if (date !== this.dateState()) {
      this.dateState.set(date);
      const cached = this.cache.get(date) ?? null;
      this.summaryState.set(cached);
      this.statusState.set(cached ? 'ready' : 'loading');
    }
    return this.fetch();
  }

  refresh(): Promise<void> {
    return this.dateState() ? this.fetch() : Promise.resolve();
  }

  reset(): void {
    this.version++;
    this.cache.clear();
    this.dateState.set(null);
    this.summaryState.set(null);
    this.statusState.set('loading');
  }

  retry(): Promise<void> {
    if (!this.summaryState()) {
      this.statusState.set('loading');
    }
    return this.refresh();
  }

  async save(date: string, weightKg: number): Promise<WeightLogDto> {
    const log = await this.api.putWeight(date, { weightKg });
    const current = this.dateState();
    const summary = this.summaryState();
    for (const key of [...this.cache.keys()]) {
      if (key !== current) {
        this.cache.delete(key);
      }
    }
    if (current && summary) {
      this.apply(current, withWeighIn(summary, log));
    }
    this.events.notify('weights', 'profile');
    return log;
  }

  private apply(date: string, summary: WeightSummaryResponse): void {
    this.version++;
    this.remember(date, summary);
    if (this.dateState() === date) {
      this.summaryState.set(summary);
      this.statusState.set('ready');
    }
  }

  private async fetch(): Promise<void> {
    const date = this.dateState();
    if (!date) {
      return;
    }
    const token = ++this.version;
    try {
      const summary = await this.api.weights(addDays(date, -(WEIGHT_CARD_WINDOW_DAYS - 1)), date);
      if (token === this.version) {
        this.apply(date, summary);
      }
    } catch {
      if (token === this.version && !this.summaryState()) {
        this.statusState.set('error');
      }
    }
  }

  private remember(date: string, summary: WeightSummaryResponse): void {
    this.cache.delete(date);
    this.cache.set(date, summary);
    while (this.cache.size > WEIGHT_CARD_CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.cache.delete(oldest);
    }
  }
}
