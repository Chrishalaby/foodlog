import {
  NUTRIENT_META,
  zeroNutrients,
  type DaySummary,
  type Nutrients,
  type TargetKey,
  type TargetValues,
} from '@food/shared';
import { formatNumber, formatNutrient, formatNutrientValue } from '../../shared/utils/format';

export interface DayBudget {
  readonly targets: TargetValues;
  readonly eaten: Nutrients;
  readonly fullDay: boolean;
}

export interface Remaining {
  readonly calories: number;
  readonly protein: number;
  readonly fiber: number;
  readonly satFat: number;
  readonly sodium: number;
  readonly sugar: number;
}

export interface RankContext {
  readonly budget: DayBudget;
  readonly hour: number;
}

export interface RankInput {
  readonly id: string;
  readonly nutrients: Nutrients;
}

export type CalorieFit = 'fits' | 'close' | 'over';
export type ReasonTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface RankReason {
  readonly tone: ReasonTone;
  readonly text: string;
}

export interface RankedOption {
  readonly id: string;
  readonly score: number;
  readonly rank: number;
  readonly fit: CalorieFit;
  readonly best: boolean;
  readonly reasons: readonly RankReason[];
}

export interface Ranking {
  readonly options: readonly RankedOption[];
  readonly winnerId: string | null;
  readonly winnerLabel: string | null;
  readonly remaining: Remaining;
  readonly tolerance: number;
}

export type LimitKey = 'satFat' | 'sodium' | 'sugar';
export type RowKey = 'calories' | 'protein' | 'carbs' | 'fat' | 'fiber' | LimitKey;

export interface TableCell {
  readonly id: string;
  readonly value: number;
  readonly text: string;
  readonly best: boolean;
  readonly over: boolean;
}

export interface TableRow {
  readonly key: RowKey;
  readonly label: string;
  readonly unit: string;
  readonly cells: readonly TableCell[];
}

interface LimitSpec {
  readonly key: LimitKey;
  readonly target: TargetKey;
  readonly label: string;
  readonly noticeable: number;
}

interface ScoredReason extends RankReason {
  readonly severity: number;
}

export const BEST_FIT_LABEL = 'Best fit for today';
export const BEST_OF_LABEL = 'Best of these';
export const FULL_DAY_NOTE =
  'Nothing logged yet today, so options are ranked against your full-day targets.';

export const SCORE_WEIGHTS = {
  calories: 0.4,
  protein: 0.3,
  fiber: 0.1,
  satFat: 0.08,
  sodium: 0.07,
  sugar: 0.05,
} as const;

export const MIN_TOLERANCE_KCAL = 50;
export const TOLERANCE_SHARE = 0.05;
export const MAX_REASONS = 3;

export const LIMIT_SPECS: readonly LimitSpec[] = [
  { key: 'satFat', target: 'satFatMax', label: 'saturated fat', noticeable: 1 },
  { key: 'sodium', target: 'sodiumMax', label: 'sodium', noticeable: 100 },
  { key: 'sugar', target: 'sugarMax', label: 'sugar', noticeable: 3 },
];

export const TABLE_ROWS: readonly { key: RowKey; label: string }[] = [
  { key: 'calories', label: 'Calories' },
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
  { key: 'fiber', label: 'Fiber' },
  { key: 'satFat', label: 'Sat fat' },
  { key: 'sodium', label: 'Sodium' },
  { key: 'sugar', label: 'Sugar' },
];

const EPSILON = 1e-9;

export function budgetFromDay(
  day: Pick<DaySummary, 'targets' | 'totals' | 'entryCount'>,
): DayBudget {
  return { targets: day.targets, eaten: day.totals, fullDay: day.entryCount === 0 };
}

export function remainingBudget(budget: DayBudget): Remaining {
  const t = budget.targets;
  const e = budget.fullDay ? zeroNutrients() : budget.eaten;
  return {
    calories: t.calories - e.calories,
    protein: Math.max(0, t.protein - e.protein),
    fiber: Math.max(0, t.fiberMin - e.fiber),
    satFat: t.satFatMax - e.satFat,
    sodium: t.sodiumMax - e.sodium,
    sugar: t.sugarMax - e.sugar,
  };
}

export function calorieTolerance(targetKcal: number): number {
  const safe = Number.isFinite(targetKcal) && targetKcal > 0 ? targetKcal : 0;
  return Math.max(MIN_TOLERANCE_KCAL, Math.round(safe * TOLERANCE_SHARE));
}

export function mealShare(hour: number): number {
  if (hour < 11) {
    return 0.45;
  }
  if (hour < 15) {
    return 0.65;
  }
  return hour < 18 ? 0.8 : 1;
}

export function laterPhrase(hour: number): string {
  if (hour < 11) {
    return 'for the rest of the day';
  }
  return hour < 18 ? 'for dinner' : 'to spare';
}

export function calorieFit(kcal: number, remaining: number, tolerance: number): CalorieFit {
  const over = Math.round(kcal) - Math.round(remaining);
  if (over <= 0) {
    return 'fits';
  }
  return over <= tolerance ? 'close' : 'over';
}

export function roomFactor(kcal: number, remaining: number, hour: number): number {
  const share = mealShare(hour);
  if (remaining <= 0 || share >= 1) {
    return 1;
  }
  const allowance = share * remaining;
  if (kcal <= allowance) {
    return 1;
  }
  const excess = Math.min(1, (kcal - allowance) / ((1 - share) * remaining));
  return 1 - 0.3 * excess;
}

export function calorieScore(
  kcal: number,
  remaining: number,
  targetKcal: number,
  hour: number,
): number {
  const tolerance = calorieTolerance(targetKcal);
  const over = kcal - remaining;
  let fit: number;
  if (over <= 0) {
    fit = 1;
  } else if (over <= tolerance) {
    fit = 1 - 0.15 * (over / tolerance);
  } else {
    fit = 0.85 * Math.max(0, 1 - (over - tolerance) / Math.max(1, 0.35 * targetKcal));
  }
  return fit * roomFactor(kcal, remaining, hour);
}

export function proteinPace(
  protein: number,
  kcal: number,
  need: number,
  remainingKcal: number,
): number | null {
  if (need < 1 || !(remainingKcal > 0)) {
    return null;
  }
  const kcalShare = kcal / remainingKcal;
  return kcalShare <= 0 ? (protein > 0 ? 1 : 0) : Math.min(1, protein / need / kcalShare);
}

export function proteinScore(
  protein: number,
  kcal: number,
  need: number,
  remainingKcal: number,
): number {
  if (need < 1) {
    return 1;
  }
  const coverage = Math.min(protein, need) / need;
  const pace = proteinPace(protein, kcal, need, remainingKcal);
  return pace === null ? coverage : 0.6 * coverage + 0.4 * pace;
}

export function fiberScore(fiber: number, need: number): number {
  return need < 1 ? 1 : Math.min(fiber, need) / need;
}

export function limitScore(amount: number, headroom: number, limit: number): number {
  if (!(limit > 0)) {
    return 1;
  }
  const room = Math.max(0, headroom);
  if (amount <= room) {
    return room > 0 ? 1 - 0.2 * (amount / room) : 1;
  }
  return 0.8 * Math.max(0, 1 - (amount - room) / (0.5 * limit));
}

export function optionScore(nutrients: Nutrients, context: RankContext): number {
  const { targets } = context.budget;
  const remaining = remainingBudget(context.budget);
  const total =
    SCORE_WEIGHTS.calories *
      calorieScore(nutrients.calories, remaining.calories, targets.calories, context.hour) +
    SCORE_WEIGHTS.protein *
      proteinScore(nutrients.protein, nutrients.calories, remaining.protein, remaining.calories) +
    SCORE_WEIGHTS.fiber * fiberScore(nutrients.fiber, remaining.fiber) +
    LIMIT_SPECS.reduce(
      (sum, spec) =>
        sum +
        SCORE_WEIGHTS[spec.key] *
          limitScore(nutrients[spec.key], remaining[spec.key], targets[spec.target]),
      0,
    );
  return total * 100;
}

function kcalText(value: number): string {
  return formatNumber(Math.round(value));
}

export function calorieReason(
  kcal: number,
  remaining: number,
  tolerance: number,
  hour: number,
): RankReason {
  const eat = Math.round(kcal);
  const left = Math.round(remaining);
  if (eat < 1) {
    return { tone: 'good', text: 'Adds almost no calories' };
  }
  if (left <= 0) {
    const tone: ReasonTone = eat <= tolerance ? 'warn' : 'bad';
    return left < 0
      ? { tone, text: `Already ${kcalText(-left)} kcal over today, adds ${kcalText(eat)}` }
      : { tone, text: `No calories left today, adds ${kcalText(eat)} kcal` };
  }
  const after = left - eat;
  if (after < 0) {
    return -after <= tolerance
      ? { tone: 'warn', text: `Just ${kcalText(-after)} kcal over your target` }
      : { tone: 'bad', text: `Goes ${kcalText(-after)} kcal over your target` };
  }
  if (roomFactor(eat, left, hour) < 1) {
    return { tone: 'warn', text: `Leaves only ${kcalText(after)} kcal ${laterPhrase(hour)}` };
  }
  if (after < MIN_TOLERANCE_KCAL) {
    return { tone: 'good', text: 'Uses up the rest of your calories' };
  }
  return { tone: 'good', text: `Leaves ${kcalText(after)} kcal ${laterPhrase(hour)}` };
}

export function proteinReason(
  protein: number,
  need: number,
  kcal?: number,
  remainingKcal?: number,
): RankReason | null {
  if (need < 1) {
    return null;
  }
  const grams = formatNumber(protein);
  const needText = formatNumber(need);
  if (protein < 1) {
    return need >= 15 ? { tone: 'warn', text: 'Almost no protein' } : null;
  }
  const coverage = protein / need;
  if (coverage >= 0.995) {
    return { tone: 'good', text: `Covers the ${needText} g protein you still need` };
  }
  const pace =
    kcal === undefined || remainingKcal === undefined
      ? null
      : proteinPace(protein, kcal, need, remainingKcal);
  const onPace = pace !== null && pace >= 1;
  const lagging = pace === null ? coverage < 0.25 : pace < 0.5 && coverage < 0.4;
  if (lagging && need >= 20) {
    return { tone: 'warn', text: `Only ${grams} g protein of the ${needText} g you still need` };
  }
  if (coverage >= 0.25) {
    return {
      tone: coverage >= 0.4 || onPace ? 'good' : 'neutral',
      text: `Adds ${grams} g protein — ${Math.round(coverage * 100)}% of what you still need`,
    };
  }
  return { tone: onPace ? 'good' : 'neutral', text: `Adds ${grams} g protein` };
}

export function fiberReason(fiber: number, need: number): RankReason | null {
  if (need < 1 || fiber < 1) {
    return null;
  }
  if (fiber >= need) {
    return { tone: 'good', text: 'Covers the fiber you still need today' };
  }
  if (fiber >= 5 || fiber >= 0.3 * need) {
    return { tone: 'good', text: `Adds ${formatNumber(fiber, 1)} g fiber` };
  }
  return null;
}

function limitReason(
  spec: LimitSpec,
  amount: number,
  headroom: number,
  limit: number,
): ScoredReason | null {
  if (amount < spec.noticeable || !(limit > 0)) {
    return null;
  }
  if (headroom <= 0) {
    return {
      tone: 'bad',
      text: `Already over your ${spec.label} limit, adds ${formatNutrient(spec.key, amount)}`,
      severity: 1 + amount / limit,
    };
  }
  if (amount > headroom) {
    return {
      tone: 'bad',
      text: `Over your ${spec.label} limit by ${formatNutrient(spec.key, amount - headroom)}`,
      severity: 1 + (amount - headroom) / limit,
    };
  }
  if (amount >= 0.6 * headroom) {
    return {
      tone: 'warn',
      text: `Uses most of your ${spec.label} allowance`,
      severity: amount / headroom / 2,
    };
  }
  return null;
}

export function optionReasons(nutrients: Nutrients, context: RankContext): RankReason[] {
  const { targets } = context.budget;
  const remaining = remainingBudget(context.budget);
  const tolerance = calorieTolerance(targets.calories);
  const limits = LIMIT_SPECS.map((spec) =>
    limitReason(spec, nutrients[spec.key], remaining[spec.key], targets[spec.target]),
  )
    .filter((reason): reason is ScoredReason => reason !== null)
    .sort((a, b) => b.severity - a.severity);
  const ordered: (RankReason | null)[] = [
    calorieReason(nutrients.calories, remaining.calories, tolerance, context.hour),
    proteinReason(nutrients.protein, remaining.protein, nutrients.calories, remaining.calories),
    ...limits.filter((reason) => reason.tone === 'bad'),
    fiberReason(nutrients.fiber, remaining.fiber),
    ...limits.filter((reason) => reason.tone !== 'bad'),
  ];
  return ordered
    .filter((reason): reason is RankReason => reason !== null)
    .slice(0, MAX_REASONS)
    .map(({ tone, text }) => ({ tone, text }));
}

interface Scored {
  readonly input: RankInput;
  readonly index: number;
  readonly score: number;
}

function compareScored(a: Scored, b: Scored): number {
  if (Math.abs(b.score - a.score) > EPSILON) {
    return b.score - a.score;
  }
  const protein = b.input.nutrients.protein - a.input.nutrients.protein;
  if (Math.abs(protein) > EPSILON) {
    return protein;
  }
  const kcal = a.input.nutrients.calories - b.input.nutrients.calories;
  if (Math.abs(kcal) > EPSILON) {
    return kcal;
  }
  return a.index - b.index;
}

export function rankOptions(inputs: readonly RankInput[], context: RankContext): Ranking {
  const remaining = remainingBudget(context.budget);
  const tolerance = calorieTolerance(context.budget.targets.calories);
  const scored: Scored[] = inputs.map((input, index) => ({
    input,
    index,
    score: optionScore(input.nutrients, context),
  }));
  const order = [...scored].sort(compareScored);
  const winner = inputs.length >= 2 ? (order[0] ?? null) : null;
  const ranks = new Map(order.map((entry, position) => [entry.input.id, position + 1]));
  const options = scored.map<RankedOption>(({ input, score }) => ({
    id: input.id,
    score: Math.round(score),
    rank: ranks.get(input.id) ?? inputs.length,
    fit: calorieFit(input.nutrients.calories, remaining.calories, tolerance),
    best: winner?.input.id === input.id,
    reasons: optionReasons(input.nutrients, context),
  }));
  const winnerFit = options.find((option) => option.best)?.fit ?? null;
  return {
    options,
    winnerId: winner?.input.id ?? null,
    winnerLabel: winnerFit === null ? null : winnerFit === 'over' ? BEST_OF_LABEL : BEST_FIT_LABEL,
    remaining,
    tolerance,
  };
}

function rowMerit(key: RowKey, nutrients: Nutrients, context: RankContext): number | null {
  const remaining = remainingBudget(context.budget);
  switch (key) {
    case 'calories':
      return calorieScore(
        nutrients.calories,
        remaining.calories,
        context.budget.targets.calories,
        context.hour,
      );
    case 'protein':
      return remaining.protein >= 1 ? Math.min(nutrients.protein, remaining.protein) : null;
    case 'fiber':
      return remaining.fiber >= 1 ? Math.min(nutrients.fiber, remaining.fiber) : null;
    case 'satFat':
    case 'sodium':
    case 'sugar':
      return -nutrients[key];
    default:
      return null;
  }
}

function isOver(key: RowKey, nutrients: Nutrients, context: RankContext): boolean {
  const remaining = remainingBudget(context.budget);
  if (key === 'calories') {
    return (
      calorieFit(
        nutrients.calories,
        remaining.calories,
        calorieTolerance(context.budget.targets.calories),
      ) === 'over'
    );
  }
  const spec = LIMIT_SPECS.find((candidate) => candidate.key === key);
  return (
    spec !== undefined &&
    nutrients[spec.key] >= spec.noticeable &&
    nutrients[spec.key] > Math.max(0, remaining[spec.key])
  );
}

function bestIds(key: RowKey, inputs: readonly RankInput[], context: RankContext): Set<string> {
  if (inputs.length < 2) {
    return new Set();
  }
  const merits = inputs.map((input) => rowMerit(key, input.nutrients, context));
  if (merits.some((merit) => merit === null)) {
    return new Set();
  }
  const values = merits as number[];
  const top = Math.max(...values);
  const bottom = Math.min(...values);
  if (top - bottom <= EPSILON) {
    return new Set();
  }
  return new Set(
    inputs.filter((_, index) => top - values[index] <= EPSILON).map((input) => input.id),
  );
}

export function comparisonRows(
  inputs: readonly RankInput[],
  context: RankContext | null,
): TableRow[] {
  return TABLE_ROWS.map(({ key, label }) => {
    const best = context ? bestIds(key, inputs, context) : new Set<string>();
    return {
      key,
      label,
      unit: NUTRIENT_META[key].unit,
      cells: inputs.map((input) => ({
        id: input.id,
        value: input.nutrients[key],
        text: formatNutrientValue(key, input.nutrients[key]),
        best: best.has(input.id),
        over: context ? isOver(key, input.nutrients, context) : false,
      })),
    };
  });
}
