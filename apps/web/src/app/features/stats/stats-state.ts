import { DOCUMENT, DestroyRef, Injectable, inject, signal } from '@angular/core';
import {
  addDays,
  type DaySummary,
  type InsightsResponse,
  type RangeDashboardResponse,
  type WeightSummaryResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import { onSessionReset } from '../../core/session-scope';
import { todayLocalDate } from '../../core/time';
import { watchData } from '../today/data-watch';
import { MOVING_AVERAGE_WINDOW, type TrendNutrient } from './trend-series';
import { currentWeekStart } from './week-range';

export const STATS_TABS = ['week', 'trends', 'insights', 'weight'] as const;
export type StatsTab = (typeof STATS_TABS)[number];

export const TREND_RANGES = [30, 90] as const;
export type TrendRange = (typeof TREND_RANGES)[number];

export const WEIGHT_RANGES = [30, 90, 365] as const;
export type WeightRange = (typeof WEIGHT_RANGES)[number];

export const INSIGHT_WINDOWS = [7, 30] as const;
export type InsightWindow = (typeof INSIGHT_WINDOWS)[number];

export const STATS_CACHE_LIMIT = 12;
export const STATS_STALE_MS = 5 * 60_000;
export const TREND_LEAD_IN_DAYS = MOVING_AVERAGE_WINDOW - 1;

export interface TrendData {
  range: RangeDashboardResponse;
  leadIn: readonly DaySummary[];
}

export function parseStatsTab(value: string | null | undefined): StatsTab {
  return (STATS_TABS as readonly string[]).includes(value ?? '') ? (value as StatsTab) : 'week';
}

export function resourceErrorMessage(error: unknown, fallback: string): string {
  const cause = error instanceof Error && error.cause !== undefined ? error.cause : error;
  return errorMessage(cause, fallback);
}

class BoundedCache<T> {
  private readonly entries = new Map<string, Promise<T>>();

  constructor(private readonly limit: number) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const existing = this.entries.get(key);
    if (existing) {
      return existing;
    }
    const pending = load();
    this.entries.set(key, pending);
    pending.catch(() => {
      if (this.entries.get(key) === pending) {
        this.entries.delete(key);
      }
    });
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      this.entries.delete(oldest);
    }
    return pending;
  }

  clear(): void {
    this.entries.clear();
  }
}

@Injectable()
export class StatsState {
  private readonly api = inject(ApiService);
  private readonly ranges = new BoundedCache<RangeDashboardResponse>(STATS_CACHE_LIMIT);
  private readonly insightsCache = new BoundedCache<InsightsResponse>(STATS_CACHE_LIMIT);
  private readonly weightsCache = new BoundedCache<WeightSummaryResponse>(STATS_CACHE_LIMIT);
  private refreshedAt = Date.now();

  readonly today = signal(todayLocalDate(new Date(this.refreshedAt)));
  readonly revision = signal(0);
  readonly weekStart = signal(currentWeekStart(this.today()));
  readonly trendRange = signal<TrendRange>(30);
  readonly trendNutrient = signal<TrendNutrient>('calories');
  readonly insightWindow = signal<InsightWindow>(7);
  readonly weightRange = signal<WeightRange>(30);

  constructor() {
    watchData(['entries', 'weights', 'profile', 'fluids'], () => this.invalidate());
    onSessionReset(() => this.clearCaches());
    const doc = inject(DOCUMENT);
    const onVisibility = (): void => {
      if (doc.visibilityState === 'visible') {
        this.refreshIfStale();
      }
    };
    doc.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => doc.removeEventListener('visibilitychange', onVisibility));
  }

  refreshIfStale(now: Date = new Date()): boolean {
    const today = todayLocalDate(now);
    const previous = this.today();
    if (today === previous && now.getTime() - this.refreshedAt < STATS_STALE_MS) {
      return false;
    }
    if (today !== previous) {
      if (this.weekStart() === currentWeekStart(previous)) {
        this.weekStart.set(currentWeekStart(today));
      }
      this.today.set(today);
    }
    this.refreshedAt = now.getTime();
    this.invalidate();
    return true;
  }

  invalidate(): void {
    this.clearCaches();
    this.revision.update((value) => value + 1);
  }

  range(from: string, to: string): Promise<RangeDashboardResponse> {
    return this.ranges.get(`${from}|${to}`, () => this.api.rangeDashboard(from, to));
  }

  async trend(from: string, to: string): Promise<TrendData> {
    const range = this.range(from, to);
    const leadIn = this.range(addDays(from, -TREND_LEAD_IN_DAYS), addDays(from, -1)).then(
      (response) => response.days,
      (): DaySummary[] => [],
    );
    const [response, days] = await Promise.all([range, leadIn]);
    return { range: response, leadIn: days };
  }

  insights(days: InsightWindow): Promise<InsightsResponse> {
    const to = addDays(this.today(), -1);
    return this.insightsCache.get(`${to}|${days}`, () => this.api.insights({ to, days }));
  }

  weights(from: string, to: string): Promise<WeightSummaryResponse> {
    return this.weightsCache.get(`${from}|${to}`, () => this.api.weights(from, to));
  }

  private clearCaches(): void {
    this.ranges.clear();
    this.insightsCache.clear();
    this.weightsCache.clear();
  }
}
