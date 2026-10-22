import {
  ADAPTIVE_TDEE_WINDOW_DAYS,
  adaptiveTdee,
  addDays,
  type DailyIntake,
  eachDate,
  weeklyWeightChange,
  type WeightLogDto,
  type WeightSummaryResponse,
  weightTrendSeries,
} from '@food/shared';
import { toWeightPoint } from './weight-log.mapper.js';

export const WEIGHT_TREND_WARMUP_DAYS = 60;

export interface DateWindow {
  from: string;
  to: string;
}

export interface DailyCalories {
  date: string;
  calories: number | null;
  entryCount: number;
}

export interface WeightSummaryInput {
  from: string;
  to: string;
  logs: readonly WeightLogDto[];
  latest: WeightLogDto | null;
  intake: readonly DailyIntake[];
}

export function trendWarmupStart(from: string): string {
  return addDays(from, -WEIGHT_TREND_WARMUP_DAYS);
}

export function adaptiveTdeeWindow(to: string): DateWindow {
  return {
    from: addDays(to, -ADAPTIVE_TDEE_WINDOW_DAYS),
    to: addDays(to, -1),
  };
}

export function dailyIntake(
  window: DateWindow,
  days: readonly DailyCalories[],
): DailyIntake[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return eachDate(window.from, window.to).map((date) => {
    const day = byDate.get(date);
    return {
      date,
      calories: day?.calories ?? 0,
      logged: (day?.entryCount ?? 0) > 0,
    };
  });
}

export function buildWeightSummary(
  input: WeightSummaryInput,
): WeightSummaryResponse {
  const { from, to } = input;
  const known = input.logs.filter((log) => log.date <= to);
  const points = known.map(toWeightPoint);
  return {
    from,
    to,
    logs: known.filter((log) => log.date >= from),
    trend: weightTrendSeries(
      points.filter((point) => point.date >= trendWarmupStart(from)),
      from,
      to,
    ),
    latest: input.latest,
    weeklyChangeKg: weeklyWeightChange(points, to),
    adaptiveTdee: adaptiveTdee(input.intake, points),
  };
}
