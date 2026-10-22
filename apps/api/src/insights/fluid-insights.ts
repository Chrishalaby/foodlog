import {
  type DaySummary,
  type Insight,
  type InsightSeverity,
  MICRO_LIMITS,
} from '@food/shared';
import { hasFluids, isAtMost, isLogged, mean } from '../dashboard/stats.js';

export const FLUID_INSIGHT_THRESHOLDS = {
  recentDays: 7,
  lowRatio: 0.7,
  minLowDays: 4,
} as const;

export interface FluidInsightOptions {
  caffeineLimitMg?: number;
  fluidLogDates?: ReadonlySet<string>;
}

const ML_PER_LITRE = 1000;

function insight(
  id: 'fluids-low' | 'caffeine-high',
  severity: InsightSeverity,
  title: string,
  detail: string,
): Insight {
  return { id, severity, title, detail };
}

function formatLitres(ml: number): string {
  return `${(ml / ML_PER_LITRE).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} L`;
}

function formatMg(mg: number): string {
  return `${Math.round(mg).toLocaleString('en-US')} mg`;
}

function caffeineMg(day: DaySummary): number {
  return day.micros.caffeine ?? 0;
}

function isLowFluidDay(day: DaySummary): boolean {
  return (
    day.fluidTargetMl > 0 &&
    day.fluidsMl < day.fluidTargetMl * FLUID_INSIGHT_THRESHOLDS.lowRatio
  );
}

export function fluidsLowInsight(
  days: readonly DaySummary[],
  fluidLogDates: ReadonlySet<string>,
): Insight | null {
  const recent = days
    .filter((day) => fluidLogDates.has(day.date))
    .slice(-FLUID_INSIGHT_THRESHOLDS.recentDays);
  const low = recent.filter(isLowFluidDay);
  if (low.length < FLUID_INSIGHT_THRESHOLDS.minLowDays) {
    return null;
  }
  const ratioPct = Math.round(FLUID_INSIGHT_THRESHOLDS.lowRatio * 100);
  return insight(
    'fluids-low',
    'warning',
    `Fluids under ${ratioPct}% of your target on ${low.length} of ${recent.length} days`,
    `On the days you logged fluids you averaged ${formatLitres(
      mean(recent.map((day) => day.fluidsMl)),
    )} a day vs your target of ${formatLitres(
      mean(recent.map((day) => day.fluidTargetMl)),
    )}. Drinks inside meals count too. Keeping a bottle of water nearby and having a glass with every meal makes the target easier to reach.`,
  );
}

export function caffeineInsight(
  days: readonly DaySummary[],
  limitMg: number = MICRO_LIMITS.caffeineMg,
): Insight | null {
  const tracked = days
    .slice(-FLUID_INSIGHT_THRESHOLDS.recentDays)
    .filter((day) => isLogged(day) || hasFluids(day));
  const over = tracked.filter((day) => !isAtMost(caffeineMg(day), limitMg));
  if (over.length === 0) {
    return null;
  }
  const severity: InsightSeverity =
    over.length * 2 >= tracked.length ? 'warning' : 'info';
  return insight(
    'caffeine-high',
    severity,
    `Caffeine over ${formatMg(limitMg)} on ${over.length} of ${tracked.length} days`,
    `Your highest day was about ${formatMg(
      Math.max(...over.map(caffeineMg)),
    )} vs a limit of ${formatMg(limitMg)} a day. Coffee, tea, energy drinks and pre-workout supplements add up quickly, and caffeine late in the day can disturb sleep.`,
  );
}

export function buildFluidInsights(
  days: readonly DaySummary[],
  options: FluidInsightOptions = {},
): Insight[] {
  return [
    fluidsLowInsight(days, options.fluidLogDates ?? new Set()),
    caffeineInsight(days, options.caffeineLimitMg),
  ].filter((result): result is Insight => result !== null);
}
