import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { BodyMetricsDto, Goal, WeightSummaryResponse } from '@food/shared';
import { todayLocalDate } from '../../../core/time';
import { Icon } from '../../../shared/ui/icon';
import { Skeleton } from '../../../shared/ui/skeleton';
import {
  TONE_TEXT_CLASSES,
  daysAgoLabel,
  oneDecimal,
  signedKg,
  weeklyChangeTone,
} from '../body-metrics';
import { BodyMetricsView } from './body-metrics-view';
import { SettingsSection } from './settings-section';

export type WeightsState = 'loading' | 'ready' | 'error';

export const WEIGHT_STATS_QUERY = { tab: 'weight' } as const;

interface WeightView {
  latest: string;
  when: string;
  trend: string;
  change: string;
  changeHint: string;
  changeClass: string;
}

export function latestTrendKg(summary: WeightSummaryResponse): number | null {
  for (let i = summary.trend.length - 1; i >= 0; i--) {
    const value = summary.trend[i]?.trendKg;
    if (value !== null && value !== undefined) {
      return value;
    }
  }
  return null;
}

export function weightView(
  summary: WeightSummaryResponse,
  goal: Goal,
  today: string,
): WeightView | null {
  const latest = summary.latest;
  if (!latest) {
    return null;
  }
  const trend = latestTrendKg(summary);
  const change = summary.weeklyChangeKg;
  const tone = weeklyChangeTone(change, goal);
  return {
    latest: `${oneDecimal(latest.weightKg)} kg`,
    when: daysAgoLabel(latest.date, today),
    trend: trend === null ? '—' : `${oneDecimal(trend)} kg`,
    change: change === null ? '—' : Math.abs(change) < 0.05 ? 'Stable' : signedKg(change),
    changeHint: change === null ? 'needs more data' : 'per week',
    changeClass: tone === 'neutral' ? 'text-fg' : TONE_TEXT_CLASSES[tone],
  };
}

@Component({
  selector: 'app-body-section',
  imports: [SettingsSection, BodyMetricsView, RouterLink, Icon, Skeleton],
  template: `
    <app-settings-section
      sectionId="settings-body"
      heading="Body"
      icon="scale"
      tone="protein"
      description="Body metrics from your profile and your latest weigh-ins."
    >
      <app-body-metrics-view
        missingBmiText="Add your height and weight in Profile to see your BMI."
        missingBodyFatText="Add your body fat % in Profile to see your lean mass and FFMI."
        [metrics]="metrics()"
      />

      <div class="mt-3 rounded-2xl border border-line/60 px-3.5 pt-2 pb-3.5">
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-fg">Weight log</h3>
          <a
            class="btn btn-ghost -mr-2 min-h-11 gap-1 px-2.5 text-sm text-accent"
            routerLink="/stats"
            [queryParams]="statsQuery"
          >
            Weight stats
            <app-icon name="chevron-right" [size]="16" />
          </a>
        </div>
        @switch (state()) {
          @case ('loading') {
            <div class="mt-1 grid grid-cols-3 gap-2" aria-hidden="true">
              @for (i of [0, 1, 2]; track i) {
                <app-skeleton class="h-14" />
              }
            </div>
            <span class="sr-only" role="status">Loading weigh-ins…</span>
          }
          @case ('error') {
            <div class="mt-1 flex items-center justify-between gap-3">
              <p class="text-sm leading-snug text-muted">Weigh-ins are unavailable right now.</p>
              <button
                type="button"
                class="btn btn-secondary shrink-0 px-3 text-sm"
                (click)="retry.emit()"
              >
                <app-icon name="refresh" [size]="16" />
                Retry
              </button>
            </div>
          }
          @default {
            @if (view(); as w) {
              <dl class="mt-1 grid grid-cols-3 gap-2">
                <div class="rounded-xl bg-surface-2/60 px-2.5 py-2">
                  <dt class="text-[11px] font-medium text-muted">Latest</dt>
                  <dd class="text-base leading-6 font-bold text-fg tabular-nums">{{ w.latest }}</dd>
                  <dd class="text-[11px] text-muted">{{ w.when }}</dd>
                </div>
                <div class="rounded-xl bg-surface-2/60 px-2.5 py-2">
                  <dt class="text-[11px] font-medium text-muted">Trend</dt>
                  <dd class="text-base leading-6 font-bold text-fg tabular-nums">{{ w.trend }}</dd>
                  <dd class="text-[11px] text-muted">smoothed</dd>
                </div>
                <div class="rounded-xl bg-surface-2/60 px-2.5 py-2">
                  <dt class="text-[11px] font-medium text-muted">Change</dt>
                  <dd class="text-base leading-6 font-bold tabular-nums" [class]="w.changeClass">
                    {{ w.change }}
                  </dd>
                  <dd class="text-[11px] text-muted">{{ w.changeHint }}</dd>
                </div>
              </dl>
            } @else {
              <p class="mt-1 text-sm leading-snug text-muted">
                No weigh-ins yet. Log your weight in the morning a few times a week to see your
                trend.
              </p>
            }
          }
        }
      </div>
    </app-settings-section>
  `,
})
export class BodySection {
  readonly metrics = input.required<BodyMetricsDto>();
  readonly weights = input<WeightSummaryResponse | null>(null);
  readonly state = input<WeightsState>('loading');
  readonly goal = input<Goal>('maintain');
  readonly retry = output<void>();

  protected readonly statsQuery = WEIGHT_STATS_QUERY;
  protected readonly view = computed(() => {
    const summary = this.weights();
    return summary ? weightView(summary, this.goal(), todayLocalDate()) : null;
  });
}
