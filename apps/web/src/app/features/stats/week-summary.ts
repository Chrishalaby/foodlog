import {
  NUTRIENT_META,
  WEEKDAY_SHORT,
  macroSplit,
  roundTo,
  weekdayOf,
  type DaySummary,
  type MacroSplit,
  type NutrientKey,
  type RangeStats,
  type TargetKey,
  type TargetValues,
} from '@food/shared';
import { shortDateLabel } from '../../core/time';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';

export const CALORIE_TOLERANCE = 0.1;

export type CalorieStatus = 'empty' | 'under' | 'on' | 'over';
export type TileTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface WeekDayRow {
  date: string;
  weekday: string;
  fullLabel: string;
  calories: number | null;
  target: number | null;
  trainingDay: boolean;
  status: CalorieStatus;
  future: boolean;
  inProgress: boolean;
}

export interface ConsistencyTile {
  id: string;
  label: string;
  hits: number;
  total: number;
  tone: TileTone;
  kind: 'goal' | 'limit';
}

export type AverageBarKind = 'goal' | 'min' | 'max';

export interface AverageBar {
  key: NutrientKey;
  label: string;
  value: number;
  target: number;
  kind: AverageBarKind;
  unit: string;
  color: string;
  decimals: number;
}

const AVERAGE_BARS = [
  { key: 'calories', target: 'calories', kind: 'goal' },
  { key: 'protein', target: 'protein', kind: 'goal' },
  { key: 'carbs', target: 'carbs', kind: 'goal' },
  { key: 'fat', target: 'fat', kind: 'goal' },
  { key: 'fiber', target: 'fiberMin', kind: 'min' },
  { key: 'satFat', target: 'satFatMax', kind: 'max' },
  { key: 'sugar', target: 'sugarMax', kind: 'max' },
  { key: 'sodium', target: 'sodiumMax', kind: 'max' },
] as const satisfies readonly { key: NutrientKey; target: TargetKey; kind: AverageBarKind }[];

export function averageBars(stats: Pick<RangeStats, 'avgTotals' | 'avgTargets'>): AverageBar[] {
  return AVERAGE_BARS.map(({ key, target, kind }) => {
    const meta = NUTRIENT_META[key];
    return {
      key,
      label: meta.label,
      value: roundTo(stats.avgTotals[key], meta.decimals),
      target: stats.avgTargets[target],
      kind,
      unit: meta.unit,
      color: NUTRIENT_COLORS[key],
      decimals: meta.decimals,
    };
  });
}

export interface MacroShare {
  key: keyof MacroSplit;
  label: string;
  percent: number;
  targetPercent: number | null;
}

export function calorieStatus(calories: number | null, target: number | null): CalorieStatus {
  if (calories === null) {
    return 'empty';
  }
  if (target === null || target <= 0) {
    return 'on';
  }
  if (calories > target * (1 + CALORIE_TOLERANCE)) {
    return 'over';
  }
  if (calories < target * (1 - CALORIE_TOLERANCE)) {
    return 'under';
  }
  return 'on';
}

export function weekRows(
  dates: readonly string[],
  days: readonly DaySummary[],
  today: string,
): WeekDayRow[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return dates.map((date) => {
    const day = byDate.get(date);
    const calories = day && day.entryCount > 0 ? roundTo(day.totals.calories, 0) : null;
    const target = day && day.targets.calories > 0 ? day.targets.calories : null;
    return {
      date,
      weekday: WEEKDAY_SHORT[weekdayOf(date)],
      fullLabel: shortDateLabel(date, today),
      calories,
      target,
      trainingDay: day?.trainingDay ?? false,
      status: calorieStatus(calories, target),
      future: date > today,
      inProgress: date === today,
    };
  });
}

function goalTone(hits: number, total: number): TileTone {
  if (total <= 0) {
    return 'neutral';
  }
  const ratio = hits / total;
  return ratio >= 0.7 ? 'good' : ratio >= 0.4 ? 'warn' : 'bad';
}

function limitTone(hits: number, total: number): TileTone {
  if (total <= 0) {
    return 'neutral';
  }
  const ratio = hits / total;
  return ratio === 0 ? 'good' : ratio <= 0.3 ? 'warn' : 'bad';
}

export function consistencyTiles(stats: RangeStats): ConsistencyTile[] {
  const total = stats.loggedDays;
  const goal = (id: string, label: string, hits: number): ConsistencyTile => ({
    id,
    label,
    hits,
    total,
    tone: goalTone(hits, total),
    kind: 'goal',
  });
  const limit = (id: string, label: string, hits: number): ConsistencyTile => ({
    id,
    label,
    hits,
    total,
    tone: limitTone(hits, total),
    kind: 'limit',
  });
  return [
    goal('protein', 'Protein target hit', stats.proteinHitDays),
    goal('calories', 'Calories on target', stats.calorieOnTargetDays),
    goal('fiber', 'Fiber minimum reached', stats.fiberHitDays),
    limit('satFat', 'Sat fat over limit', stats.satFatOverDays),
    limit('sodium', 'Sodium over limit', stats.sodiumOverDays),
  ];
}

export function macroShares(split: MacroSplit, targets: TargetValues | null): MacroShare[] {
  const target = targets
    ? macroSplit({ protein: targets.protein, carbs: targets.carbs, fat: targets.fat, alcohol: 0 })
    : null;
  const shares: MacroShare[] = [
    {
      key: 'protein',
      label: 'Protein',
      percent: split.protein,
      targetPercent: target?.protein ?? null,
    },
    { key: 'carbs', label: 'Carbs', percent: split.carbs, targetPercent: target?.carbs ?? null },
    { key: 'fat', label: 'Fat', percent: split.fat, targetPercent: target?.fat ?? null },
  ];
  if (split.alcohol > 0) {
    shares.push({ key: 'alcohol', label: 'Alcohol', percent: split.alcohol, targetPercent: null });
  }
  return shares;
}

export function hasMacroData(split: MacroSplit): boolean {
  return split.protein + split.carbs + split.fat + split.alcohol > 0;
}

export function weekMicrosLabel(stats: Partial<Pick<RangeStats, 'microsDays'>>): string {
  const days = Math.max(0, Math.round(stats.microsDays ?? 0));
  if (days === 0) {
    return 'Not enough vitamin data this week yet';
  }
  return `Averaged over ${days} ${days === 1 ? 'day' : 'days'} with enough data`;
}

export interface FluidDayBar {
  date: string;
  weekday: string;
  ml: number;
  target: number;
  fillPercent: number;
  targetPercent: number;
  hit: boolean;
  future: boolean;
  inProgress: boolean;
  value: string;
  label: string;
}

export interface FluidWeek {
  bars: FluidDayBar[];
  hasData: boolean;
  average: string;
  averageTarget: string;
  summary: string;
  chartLabel: string;
}

const FLUID_SCALE_STEP_ML = 500;

function litres(ml: number): string {
  const value = Math.round(Math.max(0, ml) / 100) / 10;
  return value.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

function percentOf(value: number, scale: number): number {
  return scale > 0 ? Math.min(100, Math.round((Math.max(0, value) / scale) * 1000) / 10) : 0;
}

export function fluidWeek(
  dates: readonly string[],
  days: readonly DaySummary[],
  stats: Partial<Pick<RangeStats, 'avgFluidsMl' | 'fluidDays' | 'fluidHitDays' | 'totalDays'>>,
  today: string,
): FluidWeek {
  const byDate = new Map(days.map((day) => [day.date, day]));
  const rows = dates.map((date) => {
    const day = byDate.get(date);
    return {
      date,
      ml: Math.max(0, day?.fluidsMl ?? 0),
      target: Math.max(0, day?.fluidTargetMl ?? 0),
    };
  });
  const peak = Math.max(1, ...rows.map((row) => Math.max(row.ml, row.target)));
  const scale = (Math.floor(peak / FLUID_SCALE_STEP_ML) + 1) * FLUID_SCALE_STEP_ML;
  const bars = rows.map((row): FluidDayBar => {
    const future = row.date > today;
    const hit = row.target > 0 && row.ml >= row.target;
    const fullLabel = shortDateLabel(row.date, today);
    return {
      date: row.date,
      weekday: WEEKDAY_SHORT[weekdayOf(row.date)],
      ml: row.ml,
      target: row.target,
      fillPercent: future ? 0 : percentOf(row.ml, scale),
      targetPercent: percentOf(row.target, scale),
      hit,
      future,
      inProgress: row.date === today,
      value: future ? '' : row.ml > 0 ? litres(row.ml) : '–',
      label: future
        ? `${fullLabel}: upcoming`
        : `${fullLabel}: ${litres(row.ml)} of ${litres(row.target)} L${hit ? ', target reached' : ''}`,
    };
  });
  const fluidDays = Math.max(0, Math.round(stats.fluidDays ?? 0));
  const hitDays = Math.max(0, Math.round(stats.fluidHitDays ?? 0));
  const past = bars.filter((bar) => !bar.future);
  const targets = past.map((bar) => bar.target).filter((target) => target > 0);
  const averageTarget =
    targets.length > 0 ? targets.reduce((sum, target) => sum + target, 0) / targets.length : 0;
  return {
    bars,
    hasData: fluidDays > 0,
    average: litres(stats.avgFluidsMl ?? 0),
    averageTarget: litres(averageTarget),
    summary:
      fluidDays === 0
        ? 'No drinks logged this week yet'
        : `Target reached ${hitDays} of ${fluidDays} ${fluidDays === 1 ? 'day' : 'days'} with drinks logged`,
    chartLabel: `Fluids per day: ${past.map((bar) => bar.label).join('; ')}`,
  };
}
