import { addDays, diffDays, eachDate } from './dates.js';
import { roundTo } from './nutrients.js';

export const WEIGHT_TREND_ALPHA = 0.1;
export const KCAL_PER_KG_BODY_MASS = 7700;
export const ADAPTIVE_TDEE_WINDOW_DAYS = 28;
export const WEEKLY_CHANGE_WINDOW_DAYS = 21;

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export interface WeightTrendPoint {
  date: string;
  weightKg: number | null;
  trendKg: number | null;
}

export interface DailyIntake {
  date: string;
  calories: number;
  logged: boolean;
}

export type AdaptiveTdeeConfidence = 'low' | 'medium' | 'high';

export interface AdaptiveTdee {
  kcal: number;
  windowDays: number;
  loggedDays: number;
  weighIns: number;
  avgIntakeKcal: number;
  weightChangeKg: number;
  confidence: AdaptiveTdeeConfidence;
}

function sortedByDate(points: readonly WeightPoint[]): WeightPoint[] {
  return [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function weightTrendSeries(
  logs: readonly WeightPoint[],
  from: string,
  to: string,
  alpha = WEIGHT_TREND_ALPHA,
): WeightTrendPoint[] {
  const sorted = sortedByDate(logs).filter((p) => p.date <= to);
  const byDate = new Map(sorted.map((p) => [p.date, p.weightKg]));
  const first = sorted[0];
  const start = first && first.date < from ? first.date : from;
  let trend: number | null = null;
  const out: WeightTrendPoint[] = [];
  for (const date of eachDate(start, to)) {
    const weight = byDate.get(date) ?? null;
    if (weight !== null) {
      trend = trend === null ? weight : trend + alpha * (weight - trend);
    }
    if (date >= from) {
      out.push({ date, weightKg: weight, trendKg: trend === null ? null : roundTo(trend, 2) });
    }
  }
  return out;
}

export function linearSlopePerDay(points: readonly WeightPoint[]): number | null {
  if (points.length < 2) {
    return null;
  }
  const origin = points[0]!.date;
  const xs = points.map((p) => diffDays(origin, p.date));
  const ys = points.map((p) => p.weightKg);
  const n = points.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }
  return den === 0 ? null : num / den;
}

export function weeklyWeightChange(
  logs: readonly WeightPoint[],
  to: string,
  windowDays = WEEKLY_CHANGE_WINDOW_DAYS,
): number | null {
  const from = addDays(to, -(windowDays - 1));
  const inWindow = sortedByDate(logs).filter((p) => p.date >= from && p.date <= to);
  if (inWindow.length < 3 || diffDays(inWindow[0]!.date, inWindow[inWindow.length - 1]!.date) < 7) {
    return null;
  }
  const slope = linearSlopePerDay(inWindow);
  return slope === null ? null : roundTo(slope * 7, 2);
}

export function adaptiveTdee(
  intake: readonly DailyIntake[],
  logs: readonly WeightPoint[],
): AdaptiveTdee | null {
  const windowDays = intake.length;
  if (windowDays < 14) {
    return null;
  }
  const dates = intake.map((d) => d.date).sort();
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const logged = intake.filter((d) => d.logged && d.calories > 0);
  const loggedShare = logged.length / windowDays;
  if (loggedShare < 0.7) {
    return null;
  }
  const weighIns = sortedByDate(logs).filter((p) => p.date >= from && p.date <= to);
  const firstWeekEnd = addDays(from, 6);
  const lastWeekStart = addDays(to, -6);
  if (
    weighIns.length < 6 ||
    !weighIns.some((p) => p.date <= firstWeekEnd) ||
    !weighIns.some((p) => p.date >= lastWeekStart)
  ) {
    return null;
  }
  const slope = linearSlopePerDay(weighIns);
  if (slope === null) {
    return null;
  }
  const avgIntakeKcal = logged.reduce((sum, d) => sum + d.calories, 0) / logged.length;
  const kcal = avgIntakeKcal - slope * KCAL_PER_KG_BODY_MASS;
  if (!Number.isFinite(kcal) || kcal < 1000 || kcal > 6000) {
    return null;
  }
  const confidence: AdaptiveTdeeConfidence =
    loggedShare >= 0.9 && weighIns.length >= 12 && windowDays >= 21
      ? 'high'
      : loggedShare >= 0.8 && weighIns.length >= 8
        ? 'medium'
        : 'low';
  return {
    kcal: Math.round(kcal / 10) * 10,
    windowDays,
    loggedDays: logged.length,
    weighIns: weighIns.length,
    avgIntakeKcal: Math.round(avgIntakeKcal),
    weightChangeKg: roundTo(slope * (windowDays - 1), 2),
    confidence,
  };
}
