import { NUTRIENT_META, roundTo } from '@food/shared';
import type { ChartOption } from '../../shared/charts/chart-types';
import {
  axisStyle,
  baseChartOption,
  withAlpha,
  type ChartPalette,
} from '../../shared/charts/echarts';
import { formatNumber } from '../../shared/utils/format';
import {
  TARGET_KIND_LABELS,
  type TargetKind,
  type TrendSeries,
  type WeekdayMetric,
  type WeekdayRow,
} from './trend-series';
import type { CalorieStatus, MacroShare, WeekDayRow } from './week-summary';

export type TooltipOption = Exclude<NonNullable<ChartOption['tooltip']>, readonly unknown[]>;
export type GridOption = Exclude<NonNullable<ChartOption['grid']>, readonly unknown[]>;

export const CALORIE_STATUS_LABELS: Record<CalorieStatus, string> = {
  empty: 'Nothing logged',
  under: 'Under target',
  on: 'On target',
  over: 'Over target',
};

export function baseTooltip(palette: ChartPalette): TooltipOption {
  const tooltip = baseChartOption(palette).tooltip;
  return (Array.isArray(tooltip) ? tooltip[0] : tooltip) ?? {};
}

export function chartGrid(overrides: Partial<GridOption> = {}): GridOption {
  return {
    left: 4,
    right: 8,
    top: 16,
    bottom: 4,
    outerBoundsMode: 'same',
    outerBoundsContain: 'axisLabel',
    ...overrides,
  };
}

export function dataIndexOf(params: unknown): number {
  const first = Array.isArray(params) ? (params[0] as unknown) : params;
  const index = (first as { dataIndex?: unknown } | null)?.dataIndex;
  return typeof index === 'number' ? index : -1;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function tooltipTitle(text: string): string {
  return `<div style="font-weight:600;margin-bottom:4px">${escapeHtml(text)}</div>`;
}

export function tooltipLine(text: string, color?: string): string {
  const style = color ? ` style="color:${color}"` : '';
  return `<div${style}>${escapeHtml(text)}</div>`;
}

export function swatchLine(color: string, label: string, value: string): string {
  return (
    `<div style="display:flex;align-items:center;gap:6px">` +
    `<span style="display:inline-block;width:8px;height:8px;border-radius:9999px;background:${color}"></span>` +
    `<span>${escapeHtml(label)}</span>` +
    `<span style="margin-left:auto;padding-left:12px;font-weight:600">${escapeHtml(value)}</span></div>`
  );
}

export function compactNumber(value: number): string {
  if (Math.abs(value) >= 1000) {
    return `${roundTo(value / 1000, 1)}k`;
  }
  return formatNumber(value);
}

export const TARGET_TICK_PLOT_WIDTH = 280;

export function targetTickWidth(points: number): number {
  const slot = TARGET_TICK_PLOT_WIDTH / Math.max(1, points);
  return Math.min(22, Math.max(2, Math.round(slot * 0.6)));
}

export function weekBarColor(row: WeekDayRow, palette: ChartPalette): string {
  const color = calorieStatusColor(row.status, palette);
  return row.inProgress && row.status === 'under' ? withAlpha(color, 0.55) : color;
}

function calorieDiffText(row: WeekDayRow): string {
  if (row.calories === null || row.target === null || row.status === 'on') {
    return 'On target';
  }
  const diff = formatNumber(Math.abs(row.calories - row.target));
  if (row.status === 'over') {
    return `${diff} kcal over`;
  }
  return row.inProgress ? `${diff} kcal to go` : `${diff} kcal under`;
}

export function calorieStatusColor(status: CalorieStatus, palette: ChartPalette): string {
  switch (status) {
    case 'over':
      return palette.danger;
    case 'on':
      return palette.ok;
    default:
      return palette.calories;
  }
}

export function targetLineColor(kind: TargetKind, palette: ChartPalette): string {
  switch (kind) {
    case 'max':
      return palette.danger;
    case 'min':
      return palette.ok;
    default:
      return palette.muted;
  }
}

function weekTooltip(row: WeekDayRow | undefined, palette: ChartPalette): string {
  if (!row) {
    return '';
  }
  const lines = [tooltipTitle(row.fullLabel)];
  if (row.future) {
    lines.push(tooltipLine('Upcoming', palette.muted));
  } else if (row.calories === null) {
    lines.push(tooltipLine('Nothing logged', palette.muted));
  } else {
    lines.push(
      swatchLine(
        weekBarColor(row, palette),
        row.inProgress ? 'Eaten so far' : 'Eaten',
        `${formatNumber(row.calories)} kcal`,
      ),
    );
  }
  if (row.target !== null) {
    lines.push(swatchLine(palette.fg, 'Target', `${formatNumber(row.target)} kcal`));
  }
  if (row.calories !== null && row.target !== null) {
    lines.push(tooltipLine(calorieDiffText(row), calorieStatusColor(row.status, palette)));
  }
  if (row.trainingDay) {
    lines.push(tooltipLine('Training day', palette.accent));
  }
  return lines.join('');
}

function weekRowDescription(row: WeekDayRow): string {
  if (row.calories === null) {
    return `${row.fullLabel}: ${row.future ? 'upcoming' : 'nothing logged'}`;
  }
  const target = row.target === null ? '' : ` of ${formatNumber(row.target)}`;
  const status =
    row.inProgress && row.status === 'under'
      ? 'so far'
      : CALORIE_STATUS_LABELS[row.status].toLowerCase();
  return `${row.fullLabel}: ${formatNumber(row.calories)} kcal${target}, ${status}`;
}

export function weekCaloriesAriaLabel(rows: readonly WeekDayRow[]): string {
  return `Daily calories. ${rows.map(weekRowDescription).join('; ')}`;
}

export function buildWeekCaloriesOption(
  rows: readonly WeekDayRow[],
  palette: ChartPalette,
): ChartOption {
  const axis = axisStyle(palette);
  return {
    ...baseChartOption(palette),
    grid: chartGrid(),
    tooltip: {
      ...baseTooltip(palette),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(palette.muted, 0.08) } },
      formatter: (params) => weekTooltip(rows[dataIndexOf(params)], palette),
    },
    xAxis: {
      type: 'category',
      data: rows.map((row) => row.weekday),
      axisLine: axis.axisLine,
      axisTick: axis.axisTick,
      axisLabel: {
        ...axis.axisLabel,
        interval: 0,
        lineHeight: 14,
        formatter: (value: string, index: number) =>
          rows[index]?.trainingDay ? `${value}\n{training|●}` : `${value}\n{spacer| }`,
        rich: {
          training: { color: palette.accent, fontSize: 9, lineHeight: 12 },
          spacer: { fontSize: 9, lineHeight: 12 },
        },
      },
    },
    yAxis: {
      type: 'value',
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: axis.axisTick,
      splitLine: axis.splitLine,
      axisLabel: { ...axis.axisLabel, formatter: (value: number) => compactNumber(value) },
    },
    series: [
      {
        type: 'bar',
        name: 'Calories',
        barMaxWidth: 26,
        barMinHeight: 2,
        data: rows.map((row) =>
          row.calories === null
            ? null
            : {
                value: row.calories,
                itemStyle: {
                  color: weekBarColor(row, palette),
                  borderRadius: [6, 6, 2, 2],
                },
              },
        ),
      },
      {
        type: 'line',
        name: 'Target',
        data: rows.map((row) => row.target),
        symbol: 'rect',
        symbolSize: [targetTickWidth(rows.length), 3],
        showSymbol: true,
        showAllSymbol: true,
        silent: true,
        z: 3,
        itemStyle: { color: palette.fg },
        lineStyle: { opacity: 0 },
        emphasis: { disabled: true },
      },
    ],
  };
}

export function buildMacroDonutOption(
  shares: readonly MacroShare[],
  palette: ChartPalette,
): ChartOption {
  const colors: Record<MacroShare['key'], string> = {
    protein: palette.protein,
    carbs: palette.carbs,
    fat: palette.fat,
    alcohol: palette.alcohol,
  };
  const visible = shares.filter((share) => share.percent > 0);
  return {
    ...baseChartOption(palette),
    tooltip: {
      ...baseTooltip(palette),
      trigger: 'item',
      formatter: (params) => {
        const share = visible[dataIndexOf(params)];
        return share
          ? swatchLine(colors[share.key], share.label, `${formatNumber(share.percent, 1)}%`)
          : '';
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['66%', '92%'],
        center: ['50%', '50%'],
        padAngle: 2,
        avoidLabelOverlap: false,
        label: { show: false },
        labelLine: { show: false },
        itemStyle: { borderRadius: 6 },
        emphasis: { scale: true, scaleSize: 4 },
        data: visible.map((share) => ({
          name: share.label,
          value: share.percent,
          itemStyle: { color: colors[share.key] },
        })),
      },
    ],
  };
}

function trendTooltip(series: TrendSeries, index: number, palette: ChartPalette): string {
  const date = series.labels[index];
  if (date === undefined) {
    return '';
  }
  const meta = NUTRIENT_META[series.nutrient];
  const format = (value: number): string => `${formatNumber(value, meta.decimals)} ${meta.unit}`;
  const color = palette[series.nutrient];
  const value = series.values[index];
  const average = series.movingAverage[index];
  const target = series.targets[index];
  const lines = [tooltipTitle(date)];
  lines.push(
    value === null
      ? tooltipLine('Not logged', palette.muted)
      : swatchLine(color, meta.label, format(value)),
  );
  if (average !== null) {
    lines.push(swatchLine(withAlpha(color, 0.6), '7-day avg', format(average)));
  }
  if (target !== null) {
    lines.push(
      swatchLine(
        targetLineColor(series.targetKind, palette),
        TARGET_KIND_LABELS[series.targetKind],
        format(target),
      ),
    );
  }
  return lines.join('');
}

export function buildTrendOption(series: TrendSeries, palette: ChartPalette): ChartOption {
  const axis = axisStyle(palette);
  const color = palette[series.nutrient];
  const dense = series.dates.length > 45;
  return {
    ...baseChartOption(palette),
    grid: chartGrid({ top: 20 }),
    tooltip: {
      ...baseTooltip(palette),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: withAlpha(palette.muted, 0.5) } },
      formatter: (params) => trendTooltip(series, dataIndexOf(params), palette),
    },
    xAxis: {
      type: 'category',
      data: series.labels,
      boundaryGap: false,
      axisLine: axis.axisLine,
      axisTick: axis.axisTick,
      axisLabel: { ...axis.axisLabel, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: axis.axisTick,
      splitLine: axis.splitLine,
      axisLabel: { ...axis.axisLabel, formatter: (value: number) => compactNumber(value) },
    },
    series: [
      {
        type: 'line',
        name: TARGET_KIND_LABELS[series.targetKind],
        data: series.targets,
        symbol: 'rect',
        symbolSize: [targetTickWidth(series.dates.length), 2],
        showSymbol: true,
        showAllSymbol: true,
        silent: true,
        z: 1,
        itemStyle: { color: withAlpha(targetLineColor(series.targetKind, palette), 0.9) },
        lineStyle: { opacity: 0 },
        emphasis: { disabled: true },
      },
      {
        type: 'line',
        name: NUTRIENT_META[series.nutrient].label,
        data: series.values,
        connectNulls: false,
        showSymbol: true,
        showAllSymbol: dense ? 'auto' : true,
        symbol: 'circle',
        symbolSize: dense ? 4 : 6,
        z: 2,
        itemStyle: { color },
        lineStyle: { width: 1.5, color: withAlpha(color, 0.45) },
        emphasis: { focus: 'none' },
      },
      {
        type: 'line',
        name: '7-day average',
        data: series.movingAverage,
        smooth: 0.35,
        connectNulls: true,
        showSymbol: false,
        z: 3,
        itemStyle: { color },
        lineStyle: { width: 3, color },
      },
    ],
  };
}

export function buildWeekdayOption(
  rows: readonly WeekdayRow[],
  metric: WeekdayMetric,
  averageTarget: number | null,
  palette: ChartPalette,
): ChartOption {
  const axis = axisStyle(palette);
  const meta = NUTRIENT_META[metric];
  const color = palette[metric];
  return {
    ...baseChartOption(palette),
    grid: chartGrid({ top: 20 }),
    tooltip: {
      ...baseTooltip(palette),
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: withAlpha(palette.muted, 0.08) } },
      formatter: (params) => {
        const row = rows[dataIndexOf(params)];
        if (!row) {
          return '';
        }
        const days = row.loggedDays === 1 ? '1 logged day' : `${row.loggedDays} logged days`;
        return [
          tooltipTitle(row.label),
          row.value === null
            ? tooltipLine('No data', palette.muted)
            : swatchLine(
                color,
                `Avg ${meta.label.toLowerCase()}`,
                `${formatNumber(row.value, meta.decimals)} ${meta.unit}`,
              ),
          tooltipLine(days, palette.muted),
        ].join('');
      },
    },
    xAxis: {
      type: 'category',
      data: rows.map((row) => row.label),
      axisLine: axis.axisLine,
      axisTick: axis.axisTick,
      axisLabel: { ...axis.axisLabel, interval: 0 },
    },
    yAxis: {
      type: 'value',
      splitNumber: 3,
      axisLine: { show: false },
      axisTick: axis.axisTick,
      splitLine: axis.splitLine,
      axisLabel: { ...axis.axisLabel, formatter: (value: number) => compactNumber(value) },
    },
    series: [
      {
        type: 'bar',
        name: meta.label,
        barMaxWidth: 26,
        data: rows.map((row) => row.value),
        itemStyle: { color, borderRadius: [6, 6, 2, 2] },
        markLine:
          averageTarget !== null && averageTarget > 0
            ? {
                silent: true,
                symbol: 'none',
                lineStyle: { type: 'dashed', color: palette.muted, width: 1.5 },
                label: {
                  formatter: 'Target',
                  position: 'insideEndTop',
                  color: palette.muted,
                  fontSize: 10,
                },
                data: [{ yAxis: averageTarget }],
              }
            : undefined,
      },
    ],
  };
}
