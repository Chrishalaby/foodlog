import { Component, computed, inject, resource } from '@angular/core';
import { NUTRIENT_META, addDays } from '@food/shared';
import { NgxEchartsDirective } from 'ngx-echarts';
import {
  echartsThemeName,
  injectChartPalette,
  provideLazyEcharts,
} from '../../shared/charts/echarts';
import { EmptyState } from '../../shared/ui/empty-state';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';
import { SegmentedControl, type SegmentOption } from '../../shared/ui/segmented-control';
import { Skeleton } from '../../shared/ui/skeleton';
import { formatNumber } from '../../shared/utils/format';
import { latestValue } from './latest-value';
import { buildTrendOption, buildWeekdayOption } from './stats-charts';
import { StatsError } from './stats-error';
import { StatsState, TREND_RANGES, resourceErrorMessage, type TrendRange } from './stats-state';
import {
  TARGET_KIND_LABELS,
  TREND_NUTRIENTS,
  buildTrendSeries,
  weekdayMetricFor,
  weekdayRows,
  type TargetKind,
  type TrendNutrient,
} from './trend-series';

interface NutrientChip {
  key: TrendNutrient;
  label: string;
  color: string;
  tint: string;
  ring: string;
}

const TARGET_LEGEND_CLASSES: Record<TargetKind, string> = {
  goal: 'border-muted',
  min: 'border-ok',
  max: 'border-danger',
};

const RANGE_OPTIONS: readonly SegmentOption<TrendRange>[] = TREND_RANGES.map((days) => ({
  value: days,
  label: `${days} days`,
}));

const NUTRIENT_CHIPS: readonly NutrientChip[] = TREND_NUTRIENTS.map((key) => ({
  key,
  label: key === 'satFat' ? 'Sat fat' : NUTRIENT_META[key].label,
  color: NUTRIENT_COLORS[key],
  tint: `color-mix(in srgb, ${NUTRIENT_COLORS[key]} 16%, transparent)`,
  ring: `color-mix(in srgb, ${NUTRIENT_COLORS[key]} 45%, transparent)`,
}));

@Component({
  selector: 'app-stats-trends',
  imports: [NgxEchartsDirective, EmptyState, SegmentedControl, Skeleton, StatsError],
  providers: [provideLazyEcharts()],
  host: { class: 'block' },
  templateUrl: './stats-trends.html',
})
export class StatsTrends {
  private readonly state = inject(StatsState);
  private readonly palette = injectChartPalette();

  protected readonly rangeOptions = RANGE_OPTIONS;
  protected readonly chips = NUTRIENT_CHIPS;
  protected readonly range = this.state.trendRange;
  protected readonly nutrient = this.state.trendNutrient;
  protected readonly theme = computed(() => echartsThemeName(this.palette()));

  private readonly data = resource({
    params: () => {
      const to = this.state.today();
      return { from: addDays(to, -(this.range() - 1)), to, revision: this.state.revision() };
    },
    loader: ({ params }) => this.state.trend(params.from, params.to),
  });
  private readonly latest = latestValue(this.data);

  protected readonly loading = computed(() => this.data.isLoading());
  protected readonly failed = computed(() => this.data.status() === 'error');
  protected readonly errorText = computed(() =>
    resourceErrorMessage(this.data.error(), 'Could not load your trends.'),
  );

  protected readonly series = computed(() => {
    const data = this.latest();
    return data
      ? buildTrendSeries(data.range.days, this.nutrient(), {
          leadIn: data.leadIn,
          inProgressDate: this.state.today(),
        })
      : null;
  });

  protected readonly summary = computed(() => {
    const series = this.series();
    if (!series) {
      return null;
    }
    const meta = NUTRIENT_META[series.nutrient];
    const format = (value: number | null): string =>
      value === null ? '–' : formatNumber(value, meta.decimals);
    return {
      label: meta.label,
      unit: meta.unit,
      average: format(series.average),
      target: format(series.averageTarget),
      targetLabel: TARGET_KIND_LABELS[series.targetKind].toLowerCase(),
      days: series.totalDays,
      logged: `${series.loggedDays} of ${series.totalDays} days logged`,
      empty: series.loggedDays === 0,
    };
  });

  protected readonly trendOption = computed(() => {
    const series = this.series();
    return series ? buildTrendOption(series, this.palette()) : null;
  });

  protected readonly weekdayMetric = computed(() => weekdayMetricFor(this.nutrient()));
  protected readonly weekdayNote = computed(() =>
    this.weekdayMetric() === this.nutrient()
      ? 'Logged days only, Monday to Sunday'
      : 'Weekday averages cover calories and macros',
  );
  protected readonly weekdayTitle = computed(
    () => `Average ${NUTRIENT_META[this.weekdayMetric()].label.toLowerCase()} by weekday`,
  );

  protected readonly weekdayOption = computed(() => {
    const data = this.latest();
    if (!data) {
      return null;
    }
    const metric = this.weekdayMetric();
    const stats = data.range.stats;
    const rows = weekdayRows(stats.weekdayAverages, metric);
    return buildWeekdayOption(rows, metric, stats.avgTargets[metric], this.palette());
  });

  protected readonly legendColor = computed(() => NUTRIENT_COLORS[this.nutrient()]);
  protected readonly legendTargetLabel = computed(() => {
    const series = this.series();
    return series ? TARGET_KIND_LABELS[series.targetKind] : 'Target';
  });
  protected readonly targetLegendClass = computed(
    () => TARGET_LEGEND_CLASSES[this.series()?.targetKind ?? 'goal'],
  );

  protected readonly trendAriaLabel = computed(() => {
    const summary = this.summary();
    return summary
      ? `${summary.label} over the last ${summary.days} days. Average ${summary.average} ${summary.unit}, ${summary.targetLabel} ${summary.target} ${summary.unit}, ${summary.logged}.`
      : '';
  });

  protected selectRange(range: TrendRange): void {
    this.range.set(range);
  }

  protected selectNutrient(key: TrendNutrient): void {
    this.nutrient.set(key);
  }

  protected retry(): void {
    this.data.reload();
  }
}
