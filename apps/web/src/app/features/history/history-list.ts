import { API_LIMITS, NUTRIENT_META, roundTo, type EntryDto } from '@food/shared';
import { relativeDayLabel, shortDateLabel } from '../../core/time';
import { formatNutrientValue } from '../../shared/utils/format';

export interface DayGroup {
  date: string;
  entries: EntryDto[];
  calories: number;
  protein: number;
  partial: boolean;
}

export interface DayHeader {
  date: string;
  label: string;
  dateLabel: string | null;
  calories: string;
  protein: string;
  partial: boolean;
  entries: EntryDto[];
}

export function compareNewestFirst(a: EntryDto, b: EntryDto): number {
  const byTime = Date.parse(b.timestamp) - Date.parse(a.timestamp);
  if (byTime !== 0) {
    return byTime;
  }
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export function sortNewestFirst(entries: readonly EntryDto[]): EntryDto[] {
  return [...entries].sort(compareNewestFirst);
}

export function dayTotals(entries: readonly EntryDto[]): { calories: number; protein: number } {
  let calories = 0;
  let protein = 0;
  for (const entry of entries) {
    calories += entry.totals.calories;
    protein += entry.totals.protein;
  }
  return {
    calories: roundTo(calories, NUTRIENT_META.calories.decimals),
    protein: roundTo(protein, NUTRIENT_META.protein.decimals),
  };
}

export function groupEntriesByDay(entries: readonly EntryDto[], hasMore = false): DayGroup[] {
  const sorted = sortNewestFirst(entries);
  const oldest = sorted[sorted.length - 1];
  const byDate = new Map<string, EntryDto[]>();
  for (const entry of sorted) {
    const list = byDate.get(entry.localDate);
    if (list) {
      list.push(entry);
    } else {
      byDate.set(entry.localDate, [entry]);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, list]) => ({
      date,
      entries: list,
      ...dayTotals(list),
      partial: hasMore && oldest?.localDate === date,
    }));
}

export function toDayHeader(group: DayGroup, today: string): DayHeader {
  const label = relativeDayLabel(group.date, today);
  const dateLabel = shortDateLabel(group.date, today);
  return {
    date: group.date,
    label,
    dateLabel: dateLabel === label ? null : dateLabel,
    calories: formatNutrientValue('calories', group.calories),
    protein: formatNutrientValue('protein', group.protein),
    partial: group.partial,
    entries: group.entries,
  };
}

export function appendPage(current: readonly EntryDto[], page: readonly EntryDto[]): EntryDto[] {
  const ids = new Set(page.map((entry) => entry.id));
  return sortNewestFirst([...current.filter((entry) => !ids.has(entry.id)), ...page]);
}

export function mergeHead(
  current: readonly EntryDto[],
  head: readonly EntryDto[],
  headComplete: boolean,
): EntryDto[] {
  const sortedHead = sortNewestFirst(head);
  if (headComplete) {
    return sortedHead;
  }
  const boundary = sortedHead[sortedHead.length - 1];
  if (!boundary) {
    return [...current];
  }
  const headIds = new Set(sortedHead.map((entry) => entry.id));
  const olderTail = current.filter(
    (entry) => !headIds.has(entry.id) && compareNewestFirst(entry, boundary) > 0,
  );
  return [...sortedHead, ...olderTail];
}

export function removeEntry(entries: readonly EntryDto[], id: string): EntryDto[] {
  return entries.filter((entry) => entry.id !== id);
}

export function upsertEntry(
  entries: readonly EntryDto[],
  entry: EntryDto,
  hasMore: boolean,
): EntryDto[] {
  const oldestLoaded = entries[entries.length - 1];
  const others = removeEntry(entries, entry.id);
  if (hasMore && oldestLoaded && compareNewestFirst(entry, oldestLoaded) > 0) {
    return others;
  }
  const index = others.findIndex((other) => compareNewestFirst(entry, other) < 0);
  if (index < 0) {
    return [...others, entry];
  }
  return [...others.slice(0, index), entry, ...others.slice(index)];
}

export function normalizeSearch(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, ' ');
  return Array.from(collapsed).slice(0, API_LIMITS.nameMax).join('').trimEnd();
}
