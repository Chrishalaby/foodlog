import {
  NUTRIENT_META,
  TARGET_META,
  WEEKDAY_SHORT,
  roundTo,
  type DaySummary,
  type NutrientKey,
  type TargetKey,
  type WeekdayAverage,
} from '@food/shared';
import { dayMonthLabel } from './week-range';

export const TREND_NUTRIENTS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'satFat',
  'sugar',
  'sodium',
] as const satisfies readonly NutrientKey[];

export type TrendNutrient = (typeof TREND_NUTRIENTS)[number];

export const TREND_TARGET_KEYS: Record<TrendNutrient, TargetKey> = {
  calories: 'calories',
  protein: 'protein',
  carbs: 'carbs',
  fat: 'fat',
  fiber: 'fiberMin',
  satFat: 'satFatMax',
  sugar: 'sugarMax',
  sodium: 'sodiumMax',
};

export const WEEKDAY_METRICS = ['calories', 'protein', 'carbs', 'fat'] as const;
export type WeekdayMetric = (typeof WEEKDAY_METRICS)[number];

export const MONDAY_FIRST_WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;
export const MOVING_AVERAGE_WINDOW = 7;

export type TargetKind = 'goal' | 'min' | 'max';

export const TARGET_KIND_LABELS: Record<TargetKind, string> = {
  goal: 'Target',
  min: 'Minimum',
  max: 'Limit',
};

export interface TrendSeries {
  nutrient: TrendNutrient;
  dates: string[];
  labels: string[];
  values: (number | null)[];
  movingAverage: (number | null)[];
  targets: (number | null)[];
  targetKind: TargetKind;
  loggedDays: number;
  totalDays: number;
  average: number | null;
  averageTarget: number | null;
}

export interface WeekdayRow {
  weekday: number;
  label: string;
  value: number | null;
  loggedDays: number;
}

export function isTrendNutrient(value: unknown): value is TrendNutrient {
  return typeof value === 'string' && (TREND_NUTRIENTS as readonly string[]).includes(value);
}

export function weekdayMetricFor(nutrient: TrendNutrient): WeekdayMetric {
  return (WEEKDAY_METRICS as readonly string[]).includes(nutrient)
    ? (nutrient as WeekdayMetric)
    : 'calories';
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function movingAverage(
  values: readonly (number | null)[],
  window = MOVING_AVERAGE_WINDOW,
  decimals = 1,
): (number | null)[] {
  const size = Math.max(1, Math.floor(window));
  return values.map((_, index) => {
    const slice = values
      .slice(Math.max(0, index - size + 1), index + 1)
      .filter((value): value is number => value !== null && Number.isFinite(value));
    const avg = mean(slice);
    return avg === null ? null : roundTo(avg, decimals);
  });
}

function sortByDate(days: readonly DaySummary[]): DaySummary[] {
  return [...days].sort((a, b) => a.date.localeCompare(b.date));
}

export interface TrendSeriesOptions {
  leadIn?: readonly DaySummary[];
  inProgressDate?: string | null;
}

export function buildTrendSeries(
  days: readonly DaySummary[],
  nutrient: TrendNutrient,
  options: TrendSeriesOptions = {},
): TrendSeries {
  const sorted = sortByDate(days);
  const first = sorted[0]?.date;
  const lead = sortByDate(options.leadIn ?? []).filter(
    (day) => first !== undefined && day.date < first,
  );
  const decimals = NUTRIENT_META[nutrient].decimals;
  const targetKey = TREND_TARGET_KEYS[nutrient];
  const valueOf = (day: DaySummary): number | null =>
    day.entryCount > 0 ? roundTo(day.totals[nutrient], decimals) : null;
  const values = sorted.map(valueOf);
  const leadValues = lead.map(valueOf);
  const settledValues = values.map((value, index) =>
    sorted[index].date === options.inProgressDate ? null : value,
  );
  const targets = sorted.map((day) => {
    const target = day.targets[targetKey];
    return Number.isFinite(target) && target > 0 ? target : null;
  });
  const logged = values.filter((value): value is number => value !== null);
  const loggedTargets = sorted
    .filter((day) => day.entryCount > 0)
    .map((day) => day.targets[targetKey])
    .filter((value) => Number.isFinite(value) && value > 0);
  const average = mean(logged);
  const averageTarget = mean(loggedTargets.length > 0 ? loggedTargets : targets.filter(isNumber));
  return {
    nutrient,
    dates: sorted.map((day) => day.date),
    labels: sorted.map((day) => dayMonthLabel(day.date)),
    values,
    movingAverage: movingAverage(
      [...leadValues, ...settledValues],
      MOVING_AVERAGE_WINDOW,
      decimals,
    ).slice(leadValues.length),
    targets,
    targetKind: TARGET_META[targetKey].kind,
    loggedDays: logged.length,
    totalDays: sorted.length,
    average: average === null ? null : roundTo(average, decimals),
    averageTarget: averageTarget === null ? null : roundTo(averageTarget, decimals),
  };
}

function isNumber(value: number | null): value is number {
  return value !== null;
}

export function weekdayRows(
  averages: readonly WeekdayAverage[],
  metric: WeekdayMetric,
): WeekdayRow[] {
  const decimals = NUTRIENT_META[metric].decimals;
  return MONDAY_FIRST_WEEKDAYS.map((weekday) => {
    const found = averages.find((avg) => avg.weekday === weekday);
    const loggedDays = found?.loggedDays ?? 0;
    return {
      weekday,
      label: WEEKDAY_SHORT[weekday],
      value: found && loggedDays > 0 ? roundTo(found[metric], decimals) : null,
      loggedDays,
    };
  });
}
