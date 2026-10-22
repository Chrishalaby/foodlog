import {
  MICRO_KEYS,
  NUTRIENT_KEYS,
  addDays,
  diffDays,
  isFiniteNumber,
  isValidLocalDate,
  roundMicros,
  roundNutrients,
  roundTo,
  sumMicros,
  targetsForDay,
  zeroNutrients,
  type DayDashboardResponse,
  type DaySummary,
  type EntryDto,
  type FoodSearchResult,
  type MealType,
  type MicroKey,
  type Micros,
  type MicrosCoverage,
  type Nutrients,
  type TargetsDto,
} from '@food/shared';
import {
  localClockTime,
  localDateOf,
  localDateTimeToIso,
  relativeDayLabel,
  shortDateLabel,
} from '../../core/time';
import { hasLibraryMenu } from '../../shared/utils/food-library';
import { hasMicros } from '../../shared/utils/micros';

export const QUICK_ADD_LIMIT = 10;

export interface MealGroup {
  id: string;
  mealType: MealType;
  entries: EntryDto[];
  calories: number;
}

export interface LogMoment {
  timestamp: string;
  localDate: string;
  at: Date;
}

export type DayTargetsSource = Pick<TargetsDto, 'trainingDay' | 'restDay'>;

export function resolveViewDate(param: string | null | undefined, today: string): string {
  return isValidLocalDate(param) && param <= today ? param : today;
}

export function adjacentDate(date: string, delta: number, today: string): string | null {
  const next = addDays(date, delta);
  return next > today ? null : next;
}

export function dayTitle(date: string, today: string): string {
  return relativeDayLabel(date, today);
}

export function emptyDayTitle(date: string, today: string): string {
  if (date === today) {
    return 'Nothing logged yet today';
  }
  if (date === addDays(today, -1)) {
    return 'Nothing logged yesterday';
  }
  return `Nothing logged on ${shortDateLabel(date, today)}`;
}

export function loggedDayNote(localDate: string, viewDate: string, today: string): string {
  if (localDate === today) {
    return viewDate === today ? '' : ' for today';
  }
  if (localDate === addDays(today, -1)) {
    return ' for yesterday';
  }
  return ` for ${shortDateLabel(localDate, today)}`;
}

export function daySubtitle(date: string, today: string): string {
  if (date === today || date === addDays(today, -1)) {
    return shortDateLabel(date, today);
  }
  return `${diffDays(date, today)} days ago`;
}

function timestampOf(entry: EntryDto): number {
  const time = Date.parse(entry.timestamp);
  return Number.isNaN(time) ? 0 : time;
}

export function compareEntriesByTime(a: EntryDto, b: EntryDto): number {
  return timestampOf(a) - timestampOf(b) || a.createdAt.localeCompare(b.createdAt);
}

export function groupEntriesByMeal(entries: readonly EntryDto[]): MealGroup[] {
  const groups: MealGroup[] = [];
  for (const entry of [...entries].sort(compareEntriesByTime)) {
    const last = groups.at(-1);
    if (last && last.mealType === entry.mealType) {
      last.entries.push(entry);
      last.calories += entry.totals.calories;
    } else {
      groups.push({
        id: entry.id,
        mealType: entry.mealType,
        entries: [entry],
        calories: entry.totals.calories,
      });
    }
  }
  return groups.map((group) => ({ ...group, calories: roundTo(group.calories, 0) }));
}

function orderGroup(
  group: readonly FoodSearchResult[],
  previous: ReadonlyMap<string, number>,
): FoodSearchResult[] {
  const kept = group
    .filter((result) => previous.has(result.key))
    .sort((a, b) => (previous.get(a.key) ?? 0) - (previous.get(b.key) ?? 0));
  const added = group.filter((result) => !previous.has(result.key));
  return [...kept, ...added];
}

export function orderQuickAdd(
  results: readonly FoodSearchResult[],
  previous: readonly FoodSearchResult[] = [],
  limit = QUICK_ADD_LIMIT,
): FoodSearchResult[] {
  const positions = new Map(previous.map((result, index) => [result.key, index]));
  const starred = orderGroup(
    results.filter((result) => result.starred),
    positions,
  );
  const others = orderGroup(
    results.filter((result) => !result.starred),
    positions,
  );
  return [...starred, ...others].slice(0, Math.max(0, limit));
}

export function dayPhraseFor(localDate: string, today: string): string {
  if (localDate === today) {
    return 'today';
  }
  if (localDate === addDays(today, -1)) {
    return 'yesterday';
  }
  return shortDateLabel(localDate, today);
}

export function quickLogMessage(name: string, localDate: string, today: string): string {
  return `Logged “${name}” for ${dayPhraseFor(localDate, today)}`;
}

export function offersFoodActions(
  result: Pick<FoodSearchResult, 'kind' | 'starred' | 'productId'>,
): boolean {
  return !result.starred && hasLibraryMenu(result);
}

export function withoutFood(
  foods: readonly FoodSearchResult[],
  key: string,
): readonly FoodSearchResult[] {
  return foods.some((food) => food.key === key) ? foods.filter((food) => food.key !== key) : foods;
}

export function withFoodAt(
  foods: readonly FoodSearchResult[],
  food: FoodSearchResult,
  index: number,
  limit = QUICK_ADD_LIMIT,
): readonly FoodSearchResult[] {
  if (foods.some((existing) => existing.key === food.key)) {
    return foods;
  }
  const at = Math.min(Math.max(0, index), foods.length);
  return [...foods.slice(0, at), food, ...foods.slice(at)].slice(0, Math.max(0, limit));
}

export function withFoodName(
  foods: readonly FoodSearchResult[],
  key: string,
  name: string,
): readonly FoodSearchResult[] {
  return foods.map((food) => (food.key === key && food.name !== name ? { ...food, name } : food));
}

function shiftTotals(base: Nutrients, delta: Nutrients, sign: 1 | -1): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = Math.max(0, base[key] + sign * delta[key]);
  }
  return roundNutrients(out);
}

type DayMicrosFields = Pick<DaySummary, 'micros' | 'microsCoverage'>;

const MICROS_EPSILON = 1e-6;

function entryMicros(entry: EntryDto): { micros: Micros; coverage: MicrosCoverage } {
  const known = entry.items.filter((item) => hasMicros(item.micros));
  return {
    micros: sumMicros(known.map((item) => item.micros)),
    coverage: { items: entry.items.length, withMicros: known.length },
  };
}

function shiftCount(base: number | undefined, delta: number, sign: 1 | -1): number {
  return Math.max(0, (isFiniteNumber(base) ? base : 0) + sign * delta);
}

function knownMicroKeys(entries: readonly EntryDto[]): ReadonlySet<MicroKey> {
  const keys = new Set<MicroKey>();
  for (const entry of entries) {
    for (const item of entry.items) {
      for (const key of MICRO_KEYS) {
        if (isFiniteNumber(item.micros?.[key])) {
          keys.add(key);
        }
      }
    }
  }
  return keys;
}

export function shiftDayMicros(
  day: Partial<DayMicrosFields>,
  entry: EntryDto,
  sign: 1 | -1,
  remaining: readonly EntryDto[] = [],
): DayMicrosFields {
  const delta = entryMicros(entry);
  const coverage = {
    items: shiftCount(day.microsCoverage?.items, delta.coverage.items, sign),
    withMicros: shiftCount(day.microsCoverage?.withMicros, delta.coverage.withMicros, sign),
  };
  const stillKnown = sign < 0 ? knownMicroKeys(remaining) : null;
  const micros: Micros = {};
  for (const key of MICRO_KEYS) {
    const current = day.micros?.[key];
    const change = delta.micros[key];
    if (change === undefined) {
      if (isFiniteNumber(current)) {
        micros[key] = current;
      }
      continue;
    }
    const next = Math.max(0, (isFiniteNumber(current) ? current : 0) + sign * change);
    if (!stillKnown || next > MICROS_EPSILON || stillKnown.has(key)) {
      micros[key] = next;
    }
  }
  return { micros: roundMicros(micros), microsCoverage: coverage };
}

export function withEntry(dashboard: DayDashboardResponse, entry: EntryDto): DayDashboardResponse {
  if (dashboard.entries.some((existing) => existing.id === entry.id)) {
    return dashboard;
  }
  const entries = [...dashboard.entries, entry].sort(compareEntriesByTime);
  return {
    day: {
      ...dashboard.day,
      totals: shiftTotals(dashboard.day.totals, entry.totals, 1),
      ...shiftDayMicros(dashboard.day, entry, 1),
      entryCount: entries.length,
    },
    entries,
  };
}

export function withoutEntry(
  dashboard: DayDashboardResponse,
  entryId: string,
): DayDashboardResponse {
  const removed = dashboard.entries.find((entry) => entry.id === entryId);
  if (!removed) {
    return dashboard;
  }
  const entries = dashboard.entries.filter((entry) => entry.id !== entryId);
  return {
    day: {
      ...dashboard.day,
      totals:
        entries.length === 0
          ? zeroNutrients()
          : shiftTotals(dashboard.day.totals, removed.totals, -1),
      ...shiftDayMicros(dashboard.day, removed, -1, entries),
      entryCount: entries.length,
    },
    entries,
  };
}

export function withTrainingDay(
  dashboard: DayDashboardResponse,
  trainingDay: boolean,
  targets: DayTargetsSource | null,
): DayDashboardResponse {
  return {
    ...dashboard,
    day: {
      ...dashboard.day,
      trainingDay,
      targets: targets ? { ...targetsForDay(targets, trainingDay) } : dashboard.day.targets,
    },
  };
}

export function logMomentFor(date: string, now: Date = new Date()): LogMoment {
  if (date === localDateOf(now)) {
    return { timestamp: now.toISOString(), localDate: date, at: now };
  }
  const iso = localDateTimeToIso(date, localClockTime(now));
  if (!iso) {
    return { timestamp: now.toISOString(), localDate: localDateOf(now), at: now };
  }
  return { timestamp: iso, localDate: date, at: new Date(iso) };
}
