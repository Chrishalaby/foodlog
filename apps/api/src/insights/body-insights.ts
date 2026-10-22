import {
  type AdaptiveTdee,
  addDays,
  diffDays,
  type Goal,
  type Insight,
  type InsightSeverity,
  KCAL_PER_KG_BODY_MASS,
  roundTo,
  WEEKLY_CHANGE_WINDOW_DAYS,
  weeklyWeightChange,
  type WeightPoint,
} from '@food/shared';

export interface BodyInsightContext {
  to: string;
  goal: Goal;
  weights: readonly WeightPoint[];
  tdee: number | null;
  adaptiveTdee: AdaptiveTdee | null;
}

export interface WeightTrend {
  weeklyKg: number;
  weeklyPct: number;
  weightKg: number;
  periodDays: number;
}

interface PctBand {
  min: number;
  max: number;
}

export const BODY_INSIGHT_THRESHOLDS = {
  cutLossPct: { min: 0.25, max: 1 },
  bulkGainPct: { min: 0.1, max: 0.5 },
  maintainMaxWeeklyKg: 0.2,
  steadyWeeklyKg: 0.05,
  adaptiveTdeeDifference: 0.1,
} as const;

const FLOAT_TOLERANCE = 1e-9;
const DAYS_PER_WEEK = 7;
const MIN_KCAL_ADJUSTMENT = 50;

function bodyInsight(
  id: 'weight-trend' | 'adaptive-tdee',
  severity: InsightSeverity,
  title: string,
  detail: string,
): Insight {
  return { id, severity, title, detail };
}

function formatKg(value: number): string {
  return `${roundTo(Math.abs(value), 1).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} kg`;
}

function formatPct(value: number): string {
  return `${roundTo(Math.abs(value), 2).toLocaleString('en-US', {
    maximumFractionDigits: 2,
  })}%`;
}

function formatKcal(value: number): string {
  return `${Math.round(value).toLocaleString('en-US')} kcal`;
}

function roundToTen(value: number): number {
  return Math.round(value / 10) * 10;
}

function isBetween(value: number, band: PctBand): boolean {
  return (
    value >= band.min - FLOAT_TOLERANCE && value <= band.max + FLOAT_TOLERANCE
  );
}

function pctBand(band: PctBand): string {
  return `${band.min}–${band.max}%`;
}

function kgBand(weightKg: number, band: PctBand): string {
  const low = roundTo((weightKg * band.min) / 100, 1);
  const high = roundTo((weightKg * band.max) / 100, 1);
  return `${low.toFixed(1)}–${high.toFixed(1)} kg`;
}

function isSteady(trend: WeightTrend): boolean {
  return Math.abs(trend.weeklyKg) < BODY_INSIGHT_THRESHOLDS.steadyWeeklyKg;
}

function isGaining(trend: WeightTrend): boolean {
  return !isSteady(trend) && trend.weeklyKg > 0;
}

function isLosing(trend: WeightTrend): boolean {
  return !isSteady(trend) && trend.weeklyKg < 0;
}

export function dailyKcalAdjustment(
  trend: WeightTrend,
  targetWeeklyPct: number,
): number {
  const targetWeeklyKg = (trend.weightKg * targetWeeklyPct) / 100;
  const gapKg = Math.abs(targetWeeklyKg - trend.weeklyKg);
  return Math.max(
    MIN_KCAL_ADJUSTMENT,
    roundToTen((gapKg * KCAL_PER_KG_BODY_MASS) / DAYS_PER_WEEK),
  );
}

export function periodLabel(days: number): string {
  if (days % DAYS_PER_WEEK !== 0) {
    return `${days} days`;
  }
  const weeks = days / DAYS_PER_WEEK;
  return weeks === 1 ? 'week' : `${weeks} weeks`;
}

function pace(trend: WeightTrend): string {
  const period = periodLabel(trend.periodDays);
  if (isSteady(trend)) {
    return `Your weight has held steady over the last ${period} (less than ${BODY_INSIGHT_THRESHOLDS.steadyWeeklyKg} kg a week)`;
  }
  const direction = trend.weeklyKg > 0 ? 'gaining' : 'losing';
  return `Over the last ${period} you have been ${direction} about ${formatKg(trend.weeklyKg)} a week (${formatPct(trend.weeklyPct)} of your body weight)`;
}

function latestWeightKg(
  weights: readonly WeightPoint[],
  to: string,
): number | null {
  let latest: WeightPoint | null = null;
  for (const point of weights) {
    if (point.date <= to && (latest === null || point.date > latest.date)) {
      latest = point;
    }
  }
  return latest?.weightKg ?? null;
}

function trendPeriodDays(weights: readonly WeightPoint[], to: string): number {
  const windowStart = addDays(to, -(WEEKLY_CHANGE_WINDOW_DAYS - 1));
  let first = to;
  for (const point of weights) {
    if (point.date >= windowStart && point.date < first) {
      first = point.date;
    }
  }
  return diffDays(first, to) + 1;
}

export function weightTrend(
  weights: readonly WeightPoint[],
  to: string,
): WeightTrend | null {
  const weeklyKg = weeklyWeightChange(weights, to);
  const weightKg = latestWeightKg(weights, to);
  if (weeklyKg === null || weightKg === null || weightKg <= 0) {
    return null;
  }
  return {
    weeklyKg,
    weeklyPct: roundTo((weeklyKg / weightKg) * 100, 2),
    weightKg,
    periodDays: trendPeriodDays(weights, to),
  };
}

function eatAbout(kcal: number, direction: 'less' | 'more'): string {
  return `eating about ${formatKcal(kcal)} a day ${direction}`;
}

function cutInsight(trend: WeightTrend): Insight {
  const band = BODY_INSIGHT_THRESHOLDS.cutLossPct;
  const target = `${pctBand(band)} of your body weight a week (${kgBand(trend.weightKg, band)} for you)`;
  const reachTarget = eatAbout(dailyKcalAdjustment(trend, -band.min), 'less');
  const lossPct = -trend.weeklyPct;
  if (isGaining(trend)) {
    return bodyInsight(
      'weight-trend',
      'warning',
      'Gaining weight on a cut',
      `${pace(trend)}. To lose fat, aim to lose ${target}; ${reachTarget} would get you there.`,
    );
  }
  if (isLosing(trend) && lossPct > band.max + FLOAT_TOLERANCE) {
    return bodyInsight(
      'weight-trend',
      'warning',
      'Losing weight fast',
      `${pace(trend)}. Losing more than ${band.max}% a week makes it harder to keep muscle and to stick with the plan; ${eatAbout(dailyKcalAdjustment(trend, -band.max), 'more')} brings you back to a sustainable pace.`,
    );
  }
  if (isLosing(trend) && isBetween(lossPct, band)) {
    return bodyInsight(
      'weight-trend',
      'good',
      'Losing weight at a steady pace',
      `${pace(trend)}, right in the ${pctBand(band)} a week range that protects muscle while you lose fat.`,
    );
  }
  return bodyInsight(
    'weight-trend',
    'info',
    isSteady(trend) ? 'Weight holding steady on a cut' : 'Weight loss is slow',
    `${pace(trend)}. To lose fat, aim to lose ${target}; ${reachTarget} would get you there. Unlogged snacks and drinks are a common culprit.`,
  );
}

function bulkShortfallTitle(trend: WeightTrend): string {
  if (isGaining(trend)) {
    return 'Gaining slowly';
  }
  return isLosing(trend)
    ? 'Losing weight on a bulk'
    : 'Weight gain has stalled';
}

function bulkInsight(trend: WeightTrend): Insight {
  const band = BODY_INSIGHT_THRESHOLDS.bulkGainPct;
  if (isGaining(trend) && trend.weeklyPct > band.max + FLOAT_TOLERANCE) {
    return bodyInsight(
      'weight-trend',
      'info',
      'Gaining faster than needed',
      `${pace(trend)}. Above ${band.max}% a week most of the extra weight is fat; ${eatAbout(dailyKcalAdjustment(trend, band.max), 'less')} keeps the bulk lean.`,
    );
  }
  if (isGaining(trend) && isBetween(trend.weeklyPct, band)) {
    return bodyInsight(
      'weight-trend',
      'good',
      'Gaining at a lean pace',
      `${pace(trend)}, within the ${pctBand(band)} a week range that favours muscle over fat.`,
    );
  }
  return bodyInsight(
    'weight-trend',
    'info',
    bulkShortfallTitle(trend),
    `${pace(trend)}. To build muscle, aim to gain ${pctBand(band)} of your body weight a week (${kgBand(trend.weightKg, band)} for you); ${eatAbout(dailyKcalAdjustment(trend, band.min), 'more')} would get you there.`,
  );
}

function maintainInsight(trend: WeightTrend): Insight {
  const limit = BODY_INSIGHT_THRESHOLDS.maintainMaxWeeklyKg;
  if (Math.abs(trend.weeklyKg) <= limit + FLOAT_TOLERANCE) {
    return bodyInsight(
      'weight-trend',
      'good',
      'Weight stable',
      `${pace(trend)}, within the ±${limit} kg a week that counts as maintaining.`,
    );
  }
  const gaining = trend.weeklyKg > 0;
  return bodyInsight(
    'weight-trend',
    'info',
    gaining ? 'Weight drifting up' : 'Weight drifting down',
    `${pace(trend)}. To hold your weight, try ${eatAbout(dailyKcalAdjustment(trend, 0), gaining ? 'less' : 'more')}.`,
  );
}

export function weightTrendInsight(
  context: BodyInsightContext,
): Insight | null {
  const trend = weightTrend(context.weights, context.to);
  if (!trend) {
    return null;
  }
  switch (context.goal) {
    case 'cut':
      return cutInsight(trend);
    case 'bulk':
      return bulkInsight(trend);
    case 'maintain':
      return maintainInsight(trend);
  }
}

export function adaptiveTdeeInsight(
  context: BodyInsightContext,
): Insight | null {
  const measured = context.adaptiveTdee;
  const setting = context.tdee;
  if (!measured || setting === null || setting <= 0) {
    return null;
  }
  const difference = measured.kcal - setting;
  if (
    Math.abs(difference) <=
    setting * BODY_INSIGHT_THRESHOLDS.adaptiveTdeeDifference + FLOAT_TOLERANCE
  ) {
    return null;
  }
  const direction = difference > 0 ? 'higher' : 'lower';
  return bodyInsight(
    'adaptive-tdee',
    'info',
    `Your measured burn is ${direction} than your setting`,
    `Your measured burn is about ${formatKcal(measured.kcal)}/day, ${formatKcal(Math.abs(difference))} ${direction} than your current setting — you can adopt it in Stats → Weight. It is based on ${measured.loggedDays} logged days and ${measured.weighIns} weigh-ins over the last ${measured.windowDays} days (${measured.confidence} confidence).`,
  );
}

export function buildBodyInsights(context: BodyInsightContext): Insight[] {
  return [weightTrendInsight(context), adaptiveTdeeInsight(context)].filter(
    (result): result is Insight => result !== null,
  );
}
