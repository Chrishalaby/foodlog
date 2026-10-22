import {
  type DaySummary,
  formatNutrient,
  type Insight,
  type InsightSeverity,
  type NutrientKey,
  type TargetKey,
} from '@food/shared';
import {
  CALORIE_TOLERANCE,
  countWhere,
  fiberHit,
  isAtLeast,
  isLogged,
  isOverLimit,
  mean,
  proteinHit,
} from '../dashboard/stats.js';
import { type BodyInsightContext, buildBodyInsights } from './body-insights.js';
import { buildFluidInsights } from './fluid-insights.js';

export const INSIGHT_THRESHOLDS = {
  minLoggedDays: 3,
  goodRate: 0.7,
  lowRate: 0.5,
  restDayGapPoints: 30,
  minSplitDays: 2,
  loggingRate: 0.7,
  minAlcoholDays: 3,
  lowFiberGrams: 10,
  calorieTolerancePct: Math.round(CALORIE_TOLERANCE * 100),
  carbsUnderRatio: 0.9,
  minLimitInfoDays: 2,
} as const;

const ALCOHOL_KCAL_PER_G = 7;

const SEVERITY_ORDER: Record<InsightSeverity, number> = {
  warning: 0,
  info: 1,
  good: 2,
};

interface InsightContext {
  logged: readonly DaySummary[];
  tracked: readonly DaySummary[];
}

export interface InsightOptions {
  trackingSince?: string | null;
  body?: BodyInsightContext | null;
  caffeineLimitMg?: number;
  fluidLogDates?: ReadonlySet<string>;
}

type InsightRule = (context: InsightContext) => Insight | null;

interface LimitRuleSpec {
  id: string;
  label: string;
  nutrient: Extract<NutrientKey, 'satFat' | 'sodium' | 'sugar'>;
  limit: Extract<TargetKey, 'satFatMax' | 'sodiumMax' | 'sugarMax'>;
  tip: string;
}

function insight(
  id: string,
  severity: InsightSeverity,
  title: string,
  detail: string,
): Insight {
  return { id, severity, title, detail };
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function isMajority(count: number, total: number): boolean {
  return count * 2 > total;
}

function isAtLeastHalf(count: number, total: number): boolean {
  return count * 2 >= total;
}

function ofLoggedDays(count: number, total: number): string {
  return `${count} of ${total} logged days`;
}

function averageOf(
  days: readonly DaySummary[],
  pick: (day: DaySummary) => number,
): number {
  return mean(days.map(pick));
}

function limitSeverity(count: number, total: number): InsightSeverity | null {
  if (count > 0 && isAtLeastHalf(count, total)) {
    return 'warning';
  }
  if (count >= INSIGHT_THRESHOLDS.minLimitInfoDays) {
    return 'info';
  }
  return null;
}

function limitRule(spec: LimitRuleSpec): InsightRule {
  return ({ logged }) => {
    const over = logged.filter((day) =>
      isOverLimit(day, spec.nutrient, spec.limit),
    );
    const severity = limitSeverity(over.length, logged.length);
    if (!severity) {
      return null;
    }
    const average = averageOf(over, (day) => day.totals[spec.nutrient]);
    const limit = averageOf(over, (day) => day.targets[spec.limit]);
    return insight(
      spec.id,
      severity,
      `${spec.label} over your limit on ${ofLoggedDays(over.length, logged.length)}`,
      `On those days you averaged ${formatNutrient(spec.nutrient, average)} vs your limit of ${formatNutrient(spec.nutrient, limit)}. ${spec.tip}`,
    );
  };
}

const caloriesRule: InsightRule = ({ logged }) => {
  const average = averageOf(logged, (day) => day.totals.calories);
  const target = averageOf(logged, (day) => day.targets.calories);
  if (target <= 0) {
    return null;
  }
  const deviationPct = Math.round(((average - target) / target) * 100);
  const summary = `You averaged ${formatNutrient('calories', average)} a day vs your target of ${formatNutrient('calories', target)}.`;
  if (deviationPct > INSIGHT_THRESHOLDS.calorieTolerancePct) {
    return insight(
      'calories-over',
      'warning',
      `Calories ${deviationPct}% above target on average`,
      `${summary} Cooking oils, sauces, snacks and drinks add up quickly and are worth a closer look.`,
    );
  }
  if (deviationPct < -INSIGHT_THRESHOLDS.calorieTolerancePct) {
    return insight(
      'calories-under',
      'info',
      `Calories ${-deviationPct}% below target on average`,
      `${summary} If some meals, snacks or drinks went unlogged, your real intake is higher.`,
    );
  }
  return insight(
    'calories-on-target',
    'good',
    'Calories on target',
    `${summary} That is within ${INSIGHT_THRESHOLDS.calorieTolerancePct}% of your target.`,
  );
};

const proteinRule: InsightRule = ({ logged }) => {
  const total = logged.length;
  const hitDays = countWhere(logged, proteinHit);
  const summary = `You averaged ${formatNutrient(
    'protein',
    averageOf(logged, (day) => day.totals.protein),
  )} a day vs your target of ${formatNutrient(
    'protein',
    averageOf(logged, (day) => day.targets.protein),
  )}.`;
  if (rate(hitDays, total) >= INSIGHT_THRESHOLDS.goodRate) {
    return insight(
      'protein-hit',
      'good',
      `Protein target hit on ${ofLoggedDays(hitDays, total)}`,
      summary,
    );
  }
  if (rate(hitDays, total) < INSIGHT_THRESHOLDS.lowRate) {
    return insight(
      'protein-low',
      'warning',
      `Protein under target on ${ofLoggedDays(total - hitDays, total)}`,
      `${summary} A protein source at every meal, such as meat, fish, eggs, tofu, Greek yogurt or legumes, makes the target easier to reach.`,
    );
  }
  return null;
};

const proteinRestDaysRule: InsightRule = ({ logged }) => {
  const training = logged.filter((day) => day.trainingDay);
  const rest = logged.filter((day) => !day.trainingDay);
  if (
    training.length < INSIGHT_THRESHOLDS.minSplitDays ||
    rest.length < INSIGHT_THRESHOLDS.minSplitDays
  ) {
    return null;
  }
  const trainingHits = countWhere(training, proteinHit);
  const restHits = countWhere(rest, proteinHit);
  const restRate = rate(restHits, rest.length);
  const gapPoints = Math.round(
    (rate(trainingHits, training.length) - restRate) * 100,
  );
  if (
    restRate >= INSIGHT_THRESHOLDS.lowRate ||
    gapPoints < INSIGHT_THRESHOLDS.restDayGapPoints
  ) {
    return null;
  }
  return insight(
    'protein-rest-days',
    'warning',
    'Protein under target on rest days',
    `You hit your protein target on ${restHits} of ${rest.length} rest days vs ${trainingHits} of ${training.length} training days. Muscles keep repairing on rest days, so aim for the same protein every day.`,
  );
};

const carbsTrainingDaysRule: InsightRule = ({ logged }) => {
  const training = logged.filter((day) => day.trainingDay);
  if (training.length < INSIGHT_THRESHOLDS.minSplitDays) {
    return null;
  }
  const underDays = countWhere(
    training,
    (day) =>
      !isAtLeast(
        day.totals.carbs,
        day.targets.carbs * INSIGHT_THRESHOLDS.carbsUnderRatio,
      ),
  );
  if (!isMajority(underDays, training.length)) {
    return null;
  }
  return insight(
    'carbs-training-days',
    'info',
    `Carbs under target on ${underDays} of ${training.length} training days`,
    `Training days have a higher carb target (${formatNutrient(
      'carbs',
      averageOf(training, (day) => day.targets.carbs),
    )} on average) to fuel your sessions and recovery. You averaged ${formatNutrient(
      'carbs',
      averageOf(training, (day) => day.totals.carbs),
    )} on those days.`,
  );
};

const fiberRule: InsightRule = ({ logged }) => {
  const total = logged.length;
  const summary = `You averaged ${formatNutrient(
    'fiber',
    averageOf(logged, (day) => day.totals.fiber),
  )} a day vs your minimum of ${formatNutrient(
    'fiber',
    averageOf(logged, (day) => day.targets.fiberMin),
  )}.`;
  const lowDays = countWhere(
    logged,
    (day) => day.totals.fiber < INSIGHT_THRESHOLDS.lowFiberGrams,
  );
  if (isMajority(lowDays, total)) {
    return insight(
      'fiber-low',
      'warning',
      `Fiber under ${INSIGHT_THRESHOLDS.lowFiberGrams} g on ${ofLoggedDays(lowDays, total)}`,
      `${summary} Beans, lentils, oats, whole grains, vegetables and fruit are easy ways to add more.`,
    );
  }
  const hitDays = countWhere(logged, fiberHit);
  if (rate(hitDays, total) >= INSIGHT_THRESHOLDS.goodRate) {
    return insight(
      'fiber-good',
      'good',
      `Fiber target met on ${ofLoggedDays(hitDays, total)}`,
      `${summary} Fiber keeps you full for longer and supports digestion.`,
    );
  }
  if (rate(hitDays, total) < INSIGHT_THRESHOLDS.lowRate) {
    return insight(
      'fiber-below-target',
      'info',
      `Fiber below your minimum on ${ofLoggedDays(total - hitDays, total)}`,
      `${summary} Adding vegetables, fruit or legumes to one more meal a day closes most of the gap.`,
    );
  }
  return null;
};

const satFatRule = limitRule({
  id: 'satfat-over',
  label: 'Saturated fat',
  nutrient: 'satFat',
  limit: 'satFatMax',
  tip: 'Swapping some butter, cheese, cream or fatty meat for olive oil, nuts, fish or lean protein brings it down.',
});

const sodiumRule = limitRule({
  id: 'sodium-over',
  label: 'Sodium',
  nutrient: 'sodium',
  limit: 'sodiumMax',
  tip: 'Most sodium comes from bread, sauces, processed foods and eating out rather than the salt shaker.',
});

const sugarRule = limitRule({
  id: 'sugar-over',
  label: 'Sugar',
  nutrient: 'sugar',
  limit: 'sugarMax',
  tip: 'This counts all sugars, including fruit and dairy. Sweet drinks, desserts and sauces are the easiest to trim.',
});

const alcoholDaysRule: InsightRule = ({ logged }) => {
  const drinkingDays = logged.filter((day) => day.totals.alcohol > 0);
  if (drinkingDays.length < INSIGHT_THRESHOLDS.minAlcoholDays) {
    return null;
  }
  const grams = averageOf(drinkingDays, (day) => day.totals.alcohol);
  return insight(
    'alcohol-days',
    'info',
    `Alcohol on ${ofLoggedDays(drinkingDays.length, logged.length)}`,
    `You averaged ${formatNutrient('alcohol', grams)} of alcohol on those days, about ${formatNutrient('calories', grams * ALCOHOL_KCAL_PER_G)}.`,
  );
};

const loggingGapsRule: InsightRule = ({ logged, tracked }) => {
  if (
    tracked.length === 0 ||
    rate(logged.length, tracked.length) >= INSIGHT_THRESHOLDS.loggingRate
  ) {
    return null;
  }
  return insight(
    'logging-gaps',
    'info',
    `Logged ${logged.length} of ${tracked.length} days`,
    'Averages only count days with entries. Logging every day, even rough estimates, makes these insights more accurate.',
  );
};

export const INSIGHT_RULES: readonly InsightRule[] = [
  caloriesRule,
  proteinRule,
  proteinRestDaysRule,
  carbsTrainingDaysRule,
  fiberRule,
  satFatRule,
  sodiumRule,
  sugarRule,
  alcoholDaysRule,
  loggingGapsRule,
];

export function notEnoughDataInsight(
  loggedCount: number,
  totalDays: number,
): Insight {
  const progress =
    loggedCount === 0
      ? `Nothing logged in this ${totalDays}-day period yet.`
      : `You have logged meals on ${loggedCount} of ${totalDays} days so far.`;
  return insight(
    'not-enough-data',
    'info',
    'Not enough data yet',
    `${progress} Log meals on at least ${INSIGHT_THRESHOLDS.minLoggedDays} days to see patterns in your nutrition.`,
  );
}

export function sortInsights(insights: readonly Insight[]): Insight[] {
  return [...insights].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}

export function trackedDays(
  days: readonly DaySummary[],
  trackingSince: string | null | undefined,
): DaySummary[] {
  if (!trackingSince) {
    return [...days];
  }
  return days.filter((day) => isLogged(day) || day.date >= trackingSince);
}

export function buildInsights(
  days: readonly DaySummary[],
  options: InsightOptions = {},
): Insight[] {
  const body = options.body ? buildBodyInsights(options.body) : [];
  const fluids = buildFluidInsights(days, {
    caffeineLimitMg: options.caffeineLimitMg,
    fluidLogDates: options.fluidLogDates,
  });
  return sortInsights([
    ...nutritionInsights(days, options),
    ...fluids,
    ...body,
  ]);
}

function nutritionInsights(
  days: readonly DaySummary[],
  options: InsightOptions,
): Insight[] {
  const logged = days.filter(isLogged);
  if (logged.length < INSIGHT_THRESHOLDS.minLoggedDays) {
    return [notEnoughDataInsight(logged.length, days.length)];
  }
  const tracked = trackedDays(days, options.trackingSince);
  const context: InsightContext = { logged, tracked };
  return INSIGHT_RULES.map((rule) => rule(context)).filter(
    (result): result is Insight => result !== null,
  );
}
