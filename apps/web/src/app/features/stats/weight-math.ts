import {
  ADAPTIVE_TDEE_WINDOW_DAYS,
  BODY_BOUNDS,
  WEIGHT_TREND_ALPHA,
  addDays,
  diffDays,
  roundTo,
  type Goal,
  type WeightLogDto,
  type WeightSummaryResponse,
  type WeightTrendPointDto,
} from '@food/shared';
import { relativeDayLabel } from '../../core/time';
import { parseDecimal } from '../../shared/utils/format';

export const WEIGHT_STEP_KG = 0.1;
export const WEIGHT_DECIMALS = 1;
export const BODY_FAT_DECIMALS = 1;
export const RECENT_WEIGH_INS_LIMIT = 14;
export const TARGET_WEIGH_INS_PER_WEEK = 3;
export const MINUS_SIGN = '−';

export type ChangeTone = 'good' | 'caution' | 'neutral';

export interface TrendPoint {
  date: string;
  trendKg: number;
}

export interface RangeChange {
  fromDate: string;
  toDate: string;
  fromKg: number;
  toKg: number;
  changeKg: number;
  days: number;
}

export interface WeighInRow {
  date: string;
  weightKg: number;
  bodyFatPct: number | null;
  deltaKg: number | null;
}

export interface WeighInInput {
  date: string;
  weightKg: number;
  bodyFatPct?: number | null;
}

export interface BurnComparison {
  currentKcal: number;
  diffKcal: number;
  diffPercent: number;
}

const fixedFormats = new Map<number, Intl.NumberFormat>();

function fixedFormat(decimals: number): Intl.NumberFormat {
  let format = fixedFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    fixedFormats.set(decimals, format);
  }
  return format;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function roundWeight(kg: number): number {
  return roundTo(kg, WEIGHT_DECIMALS);
}

export function formatKg(kg: number, decimals: number = WEIGHT_DECIMALS): string {
  const rounded = roundTo(kg, decimals);
  return fixedFormat(decimals).format(rounded === 0 ? 0 : rounded);
}

export function formatSigned(value: number, decimals: number): string {
  const rounded = roundTo(value, decimals);
  const body = fixedFormat(decimals).format(Math.abs(rounded));
  if (rounded > 0) {
    return `+${body}`;
  }
  return rounded < 0 ? `${MINUS_SIGN}${body}` : body;
}

export function formatSignedKg(kg: number): string {
  return formatSigned(kg, WEIGHT_DECIMALS);
}

export function percentDecimals(percent: number): number {
  return Math.abs(percent) < 0.1 ? 2 : 1;
}

export function parseWeightText(text: string): number | null {
  if (text.trim() === '') {
    return null;
  }
  const value = parseDecimal(text);
  return value === null ? null : roundWeight(value);
}

export function weightError(value: number | null): string | null {
  const { min, max } = BODY_BOUNDS.weightKg;
  if (value === null || !Number.isFinite(value)) {
    return 'Enter your weight in kg.';
  }
  if (value < min || value > max) {
    return `Enter a weight between ${min} and ${max} kg.`;
  }
  return null;
}

export function parseBodyFatText(text: string): number | null | undefined {
  if (text.trim() === '') {
    return null;
  }
  const value = parseDecimal(text);
  return value === null ? undefined : roundTo(value, BODY_FAT_DECIMALS);
}

export function bodyFatError(value: number | null | undefined): string | null {
  const { min, max } = BODY_BOUNDS.bodyFatPct;
  if (value === null) {
    return null;
  }
  if (value === undefined || value < min || value > max) {
    return `Body fat must be between ${min} and ${max} %.`;
  }
  return null;
}

export function stepWeight(
  value: number | null,
  direction: 1 | -1,
  fallback: number | null = null,
): number | null {
  const base = value ?? fallback;
  if (base === null || !Number.isFinite(base)) {
    return null;
  }
  const { min, max } = BODY_BOUNDS.weightKg;
  const next = value === null ? base : base + direction * WEIGHT_STEP_KG;
  return roundWeight(clamp(next, min, max));
}

export function lastTrendPoint(trend: readonly WeightTrendPointDto[]): TrendPoint | null {
  for (let i = trend.length - 1; i >= 0; i--) {
    const point = trend[i];
    if (point && point.trendKg !== null) {
      return { date: point.date, trendKg: point.trendKg };
    }
  }
  return null;
}

export function firstTrendPoint(trend: readonly WeightTrendPointDto[]): TrendPoint | null {
  for (const point of trend) {
    if (point.trendKg !== null) {
      return { date: point.date, trendKg: point.trendKg };
    }
  }
  return null;
}

export function trendRangeChange(trend: readonly WeightTrendPointDto[]): RangeChange | null {
  const first = firstTrendPoint(trend);
  const last = lastTrendPoint(trend);
  if (!first || !last || first.date >= last.date) {
    return null;
  }
  return {
    fromDate: first.date,
    toDate: last.date,
    fromKg: first.trendKg,
    toKg: last.trendKg,
    changeKg: roundTo(last.trendKg - first.trendKg, 2),
    days: diffDays(first.date, last.date),
  };
}

export function weeklyPercent(weeklyKg: number | null, bodyKg: number | null): number | null {
  if (weeklyKg === null || bodyKg === null || !(bodyKg > 0)) {
    return null;
  }
  return roundTo((weeklyKg / bodyKg) * 100, 2);
}

export function weightChangeTone(
  weeklyKg: number | null,
  goal: Goal | null,
  bodyKg: number | null = null,
): ChangeTone {
  if (weeklyKg === null || goal === null) {
    return 'neutral';
  }
  const percent = weeklyPercent(weeklyKg, bodyKg);
  const deadband = 0.1;
  switch (goal) {
    case 'cut':
      if (weeklyKg > deadband) {
        return 'caution';
      }
      if (percent !== null && percent < -1) {
        return 'caution';
      }
      return weeklyKg < -deadband ? 'good' : 'neutral';
    case 'bulk':
      if (weeklyKg < -deadband) {
        return 'caution';
      }
      if (percent !== null && percent > 0.5) {
        return 'caution';
      }
      return weeklyKg > deadband ? 'good' : 'neutral';
    default: {
      const magnitude = Math.abs(weeklyKg);
      if (magnitude <= 0.2) {
        return 'good';
      }
      return magnitude <= 0.4 ? 'neutral' : 'caution';
    }
  }
}

function byDateAsc(a: WeightLogDto, b: WeightLogDto): number {
  return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
}

export function recentWeighIns(
  logs: readonly WeightLogDto[],
  limit: number = RECENT_WEIGH_INS_LIMIT,
): WeighInRow[] {
  const sorted = [...logs].sort(byDateAsc);
  const rows = sorted.map((log, index) => {
    const previous = index > 0 ? sorted[index - 1] : undefined;
    return {
      date: log.date,
      weightKg: log.weightKg,
      bodyFatPct: log.bodyFatPct,
      deltaKg: previous ? roundWeight(log.weightKg - previous.weightKg) : null,
    };
  });
  return rows.reverse().slice(0, Math.max(0, limit));
}

export function weighInsPerWeek(
  logs: readonly WeightLogDto[],
  to: string,
  days: number = ADAPTIVE_TDEE_WINDOW_DAYS,
): number {
  const from = addDays(to, -(days - 1));
  const count = logs.filter((log) => log.date >= from && log.date <= to).length;
  return roundTo(count / (days / 7), 1);
}

export function compareBurn(
  measuredKcal: number,
  currentKcal: number | null,
): BurnComparison | null {
  if (currentKcal === null || !(currentKcal > 0)) {
    return null;
  }
  const diffKcal = measuredKcal - currentKcal;
  return {
    currentKcal,
    diffKcal,
    diffPercent: Math.round((diffKcal / currentKcal) * 100),
  };
}

function trendBefore(trend: readonly WeightTrendPointDto[], index: number): number | null {
  if (index > 0) {
    return trend[index - 1]?.trendKg ?? null;
  }
  const point = trend[0];
  if (!point || point.trendKg === null) {
    return null;
  }
  if (point.weightKg === null) {
    return point.trendKg;
  }
  return (point.trendKg - WEIGHT_TREND_ALPHA * point.weightKg) / (1 - WEIGHT_TREND_ALPHA);
}

export function retrend(
  trend: readonly WeightTrendPointDto[],
  date: string,
  weightKg: number | null,
): WeightTrendPointDto[] {
  const index = trend.findIndex((point) => point.date === date);
  if (index < 0) {
    return [...trend];
  }
  let previous = trendBefore(trend, index);
  return trend.map((point, i) => {
    if (i < index) {
      return point;
    }
    const weight = i === index ? weightKg : point.weightKg;
    const next =
      weight === null
        ? previous
        : previous === null
          ? weight
          : previous + WEIGHT_TREND_ALPHA * (weight - previous);
    previous = next;
    return { date: point.date, weightKg: weight, trendKg: next === null ? null : roundTo(next, 2) };
  });
}

export function withWeighIn(
  summary: WeightSummaryResponse,
  log: WeightLogDto,
): WeightSummaryResponse {
  const inRange = log.date >= summary.from && log.date <= summary.to;
  const logs = inRange
    ? [...summary.logs.filter((item) => item.date !== log.date), log].sort(byDateAsc)
    : summary.logs;
  const latest =
    log.date <= summary.to && (!summary.latest || log.date >= summary.latest.date)
      ? log
      : summary.latest;
  return {
    ...summary,
    logs,
    latest,
    trend: inRange ? retrend(summary.trend, log.date, log.weightKg) : summary.trend,
  };
}

export function withoutWeighIn(
  summary: WeightSummaryResponse,
  date: string,
): WeightSummaryResponse {
  const logs = summary.logs.filter((log) => log.date !== date);
  const latest = summary.latest?.date === date ? (logs.at(-1) ?? null) : summary.latest;
  return { ...summary, logs, latest, trend: retrend(summary.trend, date, null) };
}

export interface WeighInDraft {
  weightKg: number | null;
  bodyFatPct: number | null;
  weightError: string | null;
  bodyFatError: string | null;
}

export function weightText(kg: number | null | undefined): string {
  return kg === null || kg === undefined || !Number.isFinite(kg)
    ? ''
    : formatKg(kg).replace(/,/g, '');
}

export function bodyFatText(percent: number | null | undefined): string {
  return percent === null || percent === undefined || !Number.isFinite(percent)
    ? ''
    : String(roundTo(percent, BODY_FAT_DECIMALS));
}

export function readWeighInDraft(weight: string, bodyFat = ''): WeighInDraft {
  const weightKg = parseWeightText(weight);
  const fat = parseBodyFatText(bodyFat);
  return {
    weightKg,
    bodyFatPct: fat ?? null,
    weightError: weightError(weightKg),
    bodyFatError: bodyFatError(fat),
  };
}

function storedBodyFat(percent: number | null): number | null {
  return percent === null ? null : roundTo(percent, BODY_FAT_DECIMALS);
}

export function weighInEdit(
  row: Pick<WeighInRow, 'date' | 'weightKg' | 'bodyFatPct'>,
  draft: { weightKg: number; bodyFatPct: number | null },
): WeighInInput {
  const edit: WeighInInput = { date: row.date, weightKg: draft.weightKg };
  if (draft.bodyFatPct !== storedBodyFat(row.bodyFatPct)) {
    edit.bodyFatPct = draft.bodyFatPct;
  }
  return edit;
}

export function dayPhrase(date: string, today: string): string {
  const label = relativeDayLabel(date, today);
  return label === 'Today' || label === 'Yesterday' || label === 'Tomorrow'
    ? label.toLowerCase()
    : label;
}

export function firstMissingDate(
  logs: readonly WeightLogDto[],
  today: string,
  lookbackDays = 60,
): string {
  const logged = new Set(logs.map((log) => log.date));
  for (let offset = 0; offset < lookbackDays; offset++) {
    const date = addDays(today, -offset);
    if (!logged.has(date)) {
      return date;
    }
  }
  return today;
}
