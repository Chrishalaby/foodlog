import type { WeightTrendPointDto } from '@food/shared';
import { shortDateLabel } from '../../core/time';
import type { ChartOption } from '../../shared/charts/chart-types';
import {
  axisStyle,
  baseChartOption,
  withAlpha,
  type ChartPalette,
} from '../../shared/charts/echarts';
import {
  baseTooltip,
  chartGrid,
  dataIndexOf,
  swatchLine,
  tooltipLine,
  tooltipTitle,
} from './stats-charts';
import { dayMonthLabel } from './week-range';
import { firstTrendPoint, formatKg, lastTrendPoint } from './weight-math';

export const WEIGHT_AXIS_PADDING_KG = 0.3;
export const WEIGHT_AXIS_STEP_KG = 0.5;
export const WEIGHT_CHART_MIN_DAYS = 14;

export interface WeightChartData {
  dates: string[];
  labels: string[];
  weights: (number | null)[];
  trend: (number | null)[];
  weighIns: number;
}

export interface WeightAxisBounds {
  min: number;
  max: number;
}

export function trimLeadingGap(
  points: readonly WeightTrendPointDto[],
  minDays: number = WEIGHT_CHART_MIN_DAYS,
): WeightTrendPointDto[] {
  const first = points.findIndex((point) => point.weightKg !== null || point.trendKg !== null);
  if (first <= 0) {
    return [...points];
  }
  return points.slice(Math.max(0, Math.min(first, points.length - minDays)));
}

export function weightChartData(points: readonly WeightTrendPointDto[]): WeightChartData {
  return {
    dates: points.map((point) => point.date),
    labels: points.map((point) => dayMonthLabel(point.date)),
    weights: points.map((point) => point.weightKg),
    trend: points.map((point) => point.trendKg),
    weighIns: points.filter((point) => point.weightKg !== null).length,
  };
}

export function weightAxisBounds(data: WeightChartData): WeightAxisBounds | null {
  const values = [...data.weights, ...data.trend].filter(
    (value): value is number => value !== null && Number.isFinite(value),
  );
  if (values.length === 0) {
    return null;
  }
  const low = Math.min(...values) - WEIGHT_AXIS_PADDING_KG;
  const high = Math.max(...values) + WEIGHT_AXIS_PADDING_KG;
  return {
    min: Math.floor(low / WEIGHT_AXIS_STEP_KG) * WEIGHT_AXIS_STEP_KG,
    max: Math.ceil(high / WEIGHT_AXIS_STEP_KG) * WEIGHT_AXIS_STEP_KG,
  };
}

export function weightSymbolSize(points: number): number {
  if (points > 120) {
    return 3;
  }
  return points > 45 ? 4 : 6;
}

function weightTooltip(
  data: WeightChartData,
  index: number,
  palette: ChartPalette,
  today: string,
): string {
  const date = data.dates[index];
  if (date === undefined) {
    return '';
  }
  const weight = data.weights[index] ?? null;
  const trend = data.trend[index] ?? null;
  const lines = [tooltipTitle(shortDateLabel(date, today))];
  lines.push(
    weight === null
      ? tooltipLine('No weigh-in', palette.muted)
      : swatchLine(palette.muted, 'Weigh-in', `${formatKg(weight)} kg`),
  );
  if (trend !== null) {
    lines.push(swatchLine(palette.accent, 'Trend', `${formatKg(trend)} kg`));
  }
  return lines.join('');
}

export function buildWeightChartOption(
  data: WeightChartData,
  palette: ChartPalette,
  today: string,
): ChartOption {
  const axis = axisStyle(palette);
  const bounds = weightAxisBounds(data);
  const symbolSize = weightSymbolSize(data.dates.length);
  return {
    ...baseChartOption(palette),
    grid: chartGrid({ top: 16 }),
    tooltip: {
      ...baseTooltip(palette),
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: withAlpha(palette.muted, 0.5) } },
      formatter: (params) => weightTooltip(data, dataIndexOf(params), palette, today),
    },
    xAxis: {
      type: 'category',
      data: data.labels,
      boundaryGap: false,
      axisLine: axis.axisLine,
      axisTick: axis.axisTick,
      axisLabel: { ...axis.axisLabel, hideOverlap: true },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitNumber: 3,
      min: bounds?.min,
      max: bounds?.max,
      axisLine: { show: false },
      axisTick: axis.axisTick,
      splitLine: axis.splitLine,
      axisLabel: { ...axis.axisLabel, formatter: (value: number) => formatKg(value) },
    },
    series: [
      {
        type: 'line',
        name: 'Trend',
        data: data.trend,
        smooth: 0.3,
        connectNulls: true,
        showSymbol: false,
        z: 2,
        itemStyle: { color: palette.accent },
        lineStyle: { width: 3, color: palette.accent },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: withAlpha(palette.accent, 0.22) },
              { offset: 1, color: withAlpha(palette.accent, 0) },
            ],
          },
        },
        emphasis: { disabled: true },
      },
      {
        type: 'line',
        name: 'Weigh-in',
        data: data.weights,
        connectNulls: false,
        showSymbol: true,
        showAllSymbol: true,
        symbol: 'circle',
        symbolSize,
        z: 3,
        itemStyle: { color: palette.muted, borderColor: palette.surface, borderWidth: 1 },
        lineStyle: { opacity: 0 },
        emphasis: { scale: 1.6 },
      },
    ],
  };
}

export function weightChartAriaLabel(data: WeightChartData, days: number): string {
  const points = data.dates.map((date, i) => ({
    date,
    weightKg: data.weights[i] ?? null,
    trendKg: data.trend[i] ?? null,
  }));
  const first = firstTrendPoint(points);
  const last = lastTrendPoint(points);
  const count = data.weighIns === 1 ? '1 weigh-in' : `${data.weighIns} weigh-ins`;
  if (!first || !last) {
    return `Weight over the last ${days} days. ${count}.`;
  }
  return `Weight over the last ${days} days. Trend from ${formatKg(first.trendKg)} to ${formatKg(last.trendKg)} kg, ${count}.`;
}
