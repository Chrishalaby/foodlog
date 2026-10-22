import { addDays, isValidLocalDate, type FoodMergeSuggestion } from '@food/shared';

export const MERGE_CARD_STORAGE_PREFIX = 'foodlog.mergeCard.';

export interface MergeCardMemory {
  date: string | null;
  key: string | null;
  snoozedUntil: string | null;
}

export interface MergeCardPick {
  suggestion: FoodMergeSuggestion | null;
  memory: MergeCardMemory;
}

export const EMPTY_MERGE_MEMORY: MergeCardMemory = { date: null, key: null, snoozedUntil: null };

export function mergeCardStorageKey(userId: string | null): string {
  return `${MERGE_CARD_STORAGE_PREFIX}${userId ?? 'anonymous'}`;
}

export function pickMergeCard(
  suggestions: readonly FoodMergeSuggestion[],
  memory: MergeCardMemory,
  today: string,
): MergeCardPick {
  if (memory.snoozedUntil !== null && today < memory.snoozedUntil) {
    return { suggestion: null, memory };
  }
  if (memory.date === today) {
    return {
      suggestion: suggestions.find((suggestion) => suggestion.key === memory.key) ?? null,
      memory,
    };
  }
  const first = suggestions[0];
  if (!first) {
    return { suggestion: null, memory };
  }
  return { suggestion: first, memory: { date: today, key: first.key, snoozedUntil: null } };
}

export function snoozedMemory(memory: MergeCardMemory, today: string): MergeCardMemory {
  return { ...memory, date: today, snoozedUntil: addDays(today, 1) };
}

function dateOrNull(value: unknown): string | null {
  return isValidLocalDate(value) ? value : null;
}

export function parseMergeMemory(raw: string | null): MergeCardMemory {
  if (!raw) {
    return EMPTY_MERGE_MEMORY;
  }
  try {
    const value = JSON.parse(raw) as Record<string, unknown> | null;
    if (typeof value !== 'object' || value === null) {
      return EMPTY_MERGE_MEMORY;
    }
    return {
      date: dateOrNull(value['date']),
      key: typeof value['key'] === 'string' ? value['key'] : null,
      snoozedUntil: dateOrNull(value['snoozedUntil']),
    };
  } catch {
    return EMPTY_MERGE_MEMORY;
  }
}

export function readMergeMemory(storage: Storage | null, key: string): MergeCardMemory {
  try {
    return parseMergeMemory(storage?.getItem(key) ?? null);
  } catch {
    return EMPTY_MERGE_MEMORY;
  }
}

export function writeMergeMemory(
  storage: Storage | null,
  key: string,
  memory: MergeCardMemory,
): void {
  try {
    storage?.setItem(key, JSON.stringify(memory));
  } catch {
    return;
  }
}

export function sameMemory(a: MergeCardMemory, b: MergeCardMemory): boolean {
  return a.date === b.date && a.key === b.key && a.snoozedUntil === b.snoozedUntil;
}
