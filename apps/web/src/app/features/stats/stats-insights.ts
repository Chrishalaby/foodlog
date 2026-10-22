import { Component, computed, inject, resource } from '@angular/core';
import type { InsightSeverity } from '@food/shared';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon, type IconName } from '../../shared/ui/icon';
import { SegmentedControl, type SegmentOption } from '../../shared/ui/segmented-control';
import { Skeleton } from '../../shared/ui/skeleton';
import { groupInsights } from './insights-view';
import { latestValue } from './latest-value';
import { StatsError } from './stats-error';
import {
  INSIGHT_WINDOWS,
  StatsState,
  resourceErrorMessage,
  type InsightWindow,
} from './stats-state';
import { formatDateRange } from './week-range';

interface SeverityStyle {
  icon: IconName;
  badge: string;
  label: string;
}

const SEVERITY_STYLES: Record<InsightSeverity, SeverityStyle> = {
  warning: { icon: 'alert', badge: 'bg-warn/15 text-warn ring-warn/25', label: 'Warning' },
  good: { icon: 'check', badge: 'bg-ok/15 text-ok ring-ok/25', label: 'Good' },
  info: { icon: 'info', badge: 'bg-accent/15 text-accent ring-accent/25', label: 'Info' },
};

const WINDOW_OPTIONS: readonly SegmentOption<InsightWindow>[] = INSIGHT_WINDOWS.map((days) => ({
  value: days,
  label: `Last ${days} days`,
}));

@Component({
  selector: 'app-stats-insights',
  imports: [EmptyState, Icon, SegmentedControl, Skeleton, StatsError],
  host: { class: 'block' },
  template: `
    <app-segmented-control
      ariaLabel="Insights period"
      [options]="windowOptions"
      [value]="window()"
      (valueChange)="selectWindow($event)"
    />

    @if (failed()) {
      <app-stats-error class="mt-3" [message]="errorText()" (retry)="retry()" />
    } @else if (view(); as view) {
      <div
        class="mt-3 transition-opacity duration-200"
        [class.opacity-60]="loading()"
        [attr.aria-busy]="loading()"
      >
        @if (view.groups.length === 0) {
          <div class="card">
            <app-empty-state
              icon="sparkles"
              title="Not enough data yet"
              text="Log your meals for a few days and personalised insights will show up here."
            />
          </div>
        } @else {
          <p class="px-1 text-xs text-muted tabular-nums">
            {{ view.period }}
            @if (view.excludesToday) {
              <span class="text-muted/80"> · today not included</span>
            }
          </p>
          <div class="mt-2 space-y-5">
            @for (group of view.groups; track group.severity) {
              <section [attr.aria-labelledby]="'insights-' + group.severity">
                <h2 class="section-title px-1" [id]="'insights-' + group.severity">
                  {{ group.title }}
                </h2>
                <ul class="mt-2 space-y-2">
                  @for (insight of group.insights; track insight.id) {
                    <li class="card flex gap-3.5 p-4 animate-fade-in">
                      <span
                        class="flex size-10 shrink-0 items-center justify-center rounded-xl ring-1"
                        [class]="styles[insight.severity].badge"
                      >
                        <app-icon [name]="styles[insight.severity].icon" [size]="20" />
                        <span class="sr-only">{{ styles[insight.severity].label }}</span>
                      </span>
                      <div class="min-w-0 flex-1">
                        <h3 class="text-[15px] leading-5 font-semibold text-fg">
                          {{ insight.title }}
                        </h3>
                        <p class="mt-1 text-sm leading-relaxed text-muted">{{ insight.detail }}</p>
                      </div>
                    </li>
                  }
                </ul>
              </section>
            }
          </div>
        }
      </div>
    } @else {
      <div class="mt-3 space-y-2" role="status" aria-label="Loading insights">
        @for (row of skeletonRows; track row) {
          <div class="card flex gap-3.5 p-4">
            <app-skeleton class="size-10 shrink-0" />
            <div class="flex-1 space-y-2 pt-1">
              <app-skeleton shape="text" class="w-2/3" />
              <app-skeleton shape="text" class="w-full" />
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class StatsInsights {
  private readonly state = inject(StatsState);

  protected readonly windowOptions = WINDOW_OPTIONS;
  protected readonly styles = SEVERITY_STYLES;
  protected readonly skeletonRows = [0, 1, 2];
  protected readonly window = this.state.insightWindow;

  private readonly data = resource({
    params: () => ({
      days: this.window(),
      today: this.state.today(),
      revision: this.state.revision(),
    }),
    loader: ({ params }) => this.state.insights(params.days),
  });
  private readonly latest = latestValue(this.data);

  protected readonly loading = computed(() => this.data.isLoading());
  protected readonly failed = computed(() => this.data.status() === 'error');
  protected readonly errorText = computed(() =>
    resourceErrorMessage(this.data.error(), 'Could not load your insights.'),
  );

  protected readonly view = computed(() => {
    const data = this.latest();
    if (!data) {
      return null;
    }
    const today = this.state.today();
    return {
      groups: groupInsights(data.insights),
      period: formatDateRange(data.from, data.to, today),
      excludesToday: data.to < today,
    };
  });

  protected selectWindow(days: InsightWindow): void {
    this.window.set(days);
  }

  protected retry(): void {
    this.data.reload();
  }
}
