import { Component, computed, inject, input } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { PageHeader } from '../../shared/ui/page-header';
import { SegmentedControl, type SegmentOption } from '../../shared/ui/segmented-control';
import { StatsInsights } from './stats-insights';
import { StatsState, parseStatsTab, type StatsTab } from './stats-state';
import { StatsTrends } from './stats-trends';
import { StatsWeek } from './stats-week';
import { StatsWeight } from './stats-weight';
import { currentWeekStart } from './week-range';

const TAB_OPTIONS: readonly SegmentOption<StatsTab>[] = [
  { value: 'week', label: 'Week' },
  { value: 'trends', label: 'Trends' },
  { value: 'insights', label: 'Insights' },
  { value: 'weight', label: 'Weight' },
];

export const PAST_WEEK_SUBTITLE = 'How your week went';

const TAB_SUBTITLES: Record<StatsTab, string> = {
  week: 'How this week is going',
  trends: 'Your nutrition over time',
  insights: 'Patterns in your eating',
  weight: 'Your weight trend and daily burn',
};

@Component({
  selector: 'app-stats-page',
  imports: [PageHeader, SegmentedControl, StatsInsights, StatsTrends, StatsWeek, StatsWeight],
  providers: [StatsState],
  template: `
    <app-page-header title="Stats" [subtitle]="subtitle()" />
    <div class="px-4 pb-4">
      <app-segmented-control
        ariaLabel="Stats view"
        [options]="tabs"
        [value]="activeTab()"
        (valueChange)="selectTab($event)"
      />
      <div class="mt-4">
        @switch (activeTab()) {
          @case ('week') {
            <app-stats-week />
          }
          @case ('trends') {
            <app-stats-trends />
          }
          @case ('insights') {
            <app-stats-insights />
          }
          @case ('weight') {
            <app-stats-weight />
          }
        }
      </div>
    </div>
  `,
})
export class StatsPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly state = inject(StatsState);

  readonly tab = input<string>();

  protected readonly tabs = TAB_OPTIONS;
  protected readonly activeTab = computed(() => parseStatsTab(this.tab()));
  protected readonly subtitle = computed(() => {
    const tab = this.activeTab();
    if (tab === 'week' && this.state.weekStart() !== currentWeekStart(this.state.today())) {
      return PAST_WEEK_SUBTITLE;
    }
    return TAB_SUBTITLES[tab];
  });

  protected selectTab(tab: StatsTab): void {
    if (tab === this.activeTab()) {
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { tab: tab === 'week' ? null : tab },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
