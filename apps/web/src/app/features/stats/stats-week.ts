import { Component, computed, inject, resource } from '@angular/core';
import { NgxEchartsDirective } from 'ngx-echarts';
import { CaptureService } from '../../core/capture.service';
import { ProfileStore } from '../../core/profile.store';
import {
  echartsThemeName,
  injectChartPalette,
  provideLazyEcharts,
} from '../../shared/charts/echarts';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { microTargetsFor, microsCoverageText } from '../../shared/ui/micros/micros-model';
import { MicrosPanel } from '../../shared/ui/micros/micros-panel';
import { NutrientBar } from '../../shared/ui/nutrient-bar';
import { Skeleton } from '../../shared/ui/skeleton';
import { formatNumber } from '../../shared/utils/format';
import { latestValue } from './latest-value';
import {
  buildMacroDonutOption,
  buildWeekCaloriesOption,
  weekCaloriesAriaLabel,
} from './stats-charts';
import { StatsError } from './stats-error';
import { StatsState, resourceErrorMessage } from './stats-state';
import {
  canShowNextWeek,
  currentWeekStart,
  formatDateRange,
  shiftWeek,
  weekRange,
  weekTitle,
} from './week-range';
import {
  averageBars,
  consistencyTiles,
  fluidWeek,
  hasMacroData,
  macroShares,
  weekMicrosLabel,
  weekRows,
  type MacroShare,
  type TileTone,
} from './week-summary';

const TILE_TONE_CLASSES: Record<TileTone, string> = {
  good: 'text-ok',
  warn: 'text-warn',
  bad: 'text-danger',
  neutral: 'text-fg',
};

const TILE_BAR_CLASSES: Record<TileTone, string> = {
  good: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-danger',
  neutral: 'bg-muted',
};

const MACRO_DOT_CLASSES: Record<MacroShare['key'], string> = {
  protein: 'bg-protein',
  carbs: 'bg-carbs',
  fat: 'bg-fat',
  alcohol: 'bg-alcohol',
};

@Component({
  selector: 'app-stats-week',
  imports: [NgxEchartsDirective, EmptyState, Icon, MicrosPanel, NutrientBar, Skeleton, StatsError],
  providers: [provideLazyEcharts()],
  host: { class: 'block' },
  templateUrl: './stats-week.html',
})
export class StatsWeek {
  private readonly state = inject(StatsState);
  private readonly capture = inject(CaptureService);
  private readonly profiles = inject(ProfileStore);
  private readonly palette = injectChartPalette();
  private readonly today = this.state.today;

  protected readonly theme = computed(() => echartsThemeName(this.palette()));
  protected readonly microTargets = computed(() => microTargetsFor(this.profiles.profile()));
  protected readonly range = computed(() => weekRange(this.state.weekStart(), this.today()));
  protected readonly title = computed(() => weekTitle(this.range().start, this.today()));
  protected readonly rangeLabel = computed(() =>
    formatDateRange(this.range().start, this.range().end, this.today()),
  );
  protected readonly canGoNext = computed(() => canShowNextWeek(this.range().start, this.today()));

  private readonly data = resource({
    params: () => ({
      from: this.range().start,
      to: this.range().to,
      revision: this.state.revision(),
    }),
    loader: ({ params }) => this.state.range(params.from, params.to),
  });
  private readonly latest = latestValue(this.data);

  protected readonly loading = computed(() => this.data.isLoading());
  protected readonly failed = computed(() => this.data.status() === 'error');
  protected readonly errorText = computed(() =>
    resourceErrorMessage(this.data.error(), 'Could not load this week.'),
  );

  protected readonly week = computed(() => {
    const data = this.latest();
    if (!data) {
      return null;
    }
    const today = this.today();
    const range = weekRange(data.from, today);
    const rows = weekRows(range.dates, data.days, today);
    const stats = data.stats;
    const shares = macroShares(stats.macroSplit, stats.loggedDays > 0 ? stats.avgTargets : null);
    return {
      stats,
      isCurrent: range.isCurrent,
      rows,
      bars: averageBars(stats),
      fluids: fluidWeek(range.dates, data.days, stats, today),
      tiles: consistencyTiles(stats).map((tile) => ({
        ...tile,
        toneClass: TILE_TONE_CLASSES[tile.tone],
        barClass: TILE_BAR_CLASSES[tile.tone],
        percent: tile.total > 0 ? Math.round((tile.hits / tile.total) * 100) : 0,
      })),
      shares: shares.map((share) => ({
        ...share,
        dotClass: MACRO_DOT_CLASSES[share.key],
        percentText: `${Math.round(share.percent)}%`,
        targetText:
          share.targetPercent === null ? '' : `target ${Math.round(share.targetPercent)}%`,
      })),
      hasMacros: hasMacroData(stats.macroSplit),
      hasMicros: (stats.microsDays ?? 0) > 0,
      microsLabel: weekMicrosLabel(stats),
      microsCoverageText: microsCoverageText(stats.microsCoverage, 'week'),
      splitLabel: `Macro split: ${shares.map((share) => `${share.label} ${Math.round(share.percent)}%`).join(', ')}`,
      loggedLabel: `${stats.loggedDays} of ${stats.totalDays} ${stats.totalDays === 1 ? 'day' : 'days'} logged`,
      avgCalories: formatNumber(stats.avgTotals.calories),
      avgTarget: formatNumber(stats.avgTargets.calories),
      trainingDays: rows.filter((row) => row.trainingDay).length,
      chartLabel: weekCaloriesAriaLabel(rows),
    };
  });

  protected readonly caloriesOption = computed(() => {
    const week = this.week();
    return week ? buildWeekCaloriesOption(week.rows, this.palette()) : null;
  });

  protected readonly donutOption = computed(() => {
    const week = this.week();
    return week ? buildMacroDonutOption(week.shares, this.palette()) : null;
  });

  protected previousWeek(): void {
    this.state.weekStart.set(shiftWeek(this.range().start, -1, this.today()));
  }

  protected nextWeek(): void {
    if (this.canGoNext()) {
      this.state.weekStart.set(shiftWeek(this.range().start, 1, this.today()));
    }
  }

  protected thisWeek(): void {
    this.state.weekStart.set(currentWeekStart(this.today()));
  }

  protected retry(): void {
    this.data.reload();
  }

  protected takePhoto(): void {
    this.capture.requestCamera('food_photo');
  }
}
