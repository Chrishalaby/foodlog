import { ketchupSuggestion, mayoSuggestion } from '../../shared/testing/my-foods-fixtures';
import {
  EMPTY_MERGE_MEMORY,
  mergeCardStorageKey,
  parseMergeMemory,
  pickMergeCard,
  readMergeMemory,
  snoozedMemory,
  writeMergeMemory,
} from './merge-card-memory';

const TODAY = '2026-09-30';
const SUGGESTIONS = [ketchupSuggestion(), mayoSuggestion()];

describe('merge card memory', () => {
  it('shows the best suggestion on a new day and remembers it', () => {
    const pick = pickMergeCard(SUGGESTIONS, EMPTY_MERGE_MEMORY, TODAY);
    expect(pick.suggestion?.key).toBe('tomato ketchup');
    expect(pick.memory).toEqual({ date: TODAY, key: 'tomato ketchup', snoozedUntil: null });
  });

  it('keeps showing the same card for the rest of the day and nothing once it is handled', () => {
    const memory = { date: TODAY, key: 'tomato ketchup', snoozedUntil: null };
    expect(pickMergeCard(SUGGESTIONS, memory, TODAY).suggestion?.key).toBe('tomato ketchup');
    expect(pickMergeCard([mayoSuggestion()], memory, TODAY).suggestion).toBeNull();
    expect(pickMergeCard([mayoSuggestion()], memory, '2026-10-01').suggestion?.key).toBe('mayo');
  });

  it('snoozes until tomorrow', () => {
    const snoozed = snoozedMemory(EMPTY_MERGE_MEMORY, TODAY);
    expect(snoozed).toEqual({ date: TODAY, key: null, snoozedUntil: '2026-10-01' });
    expect(pickMergeCard(SUGGESTIONS, snoozed, TODAY).suggestion).toBeNull();
    const tomorrow = pickMergeCard(SUGGESTIONS, snoozed, '2026-10-01');
    expect(tomorrow.suggestion?.key).toBe('tomato ketchup');
    expect(tomorrow.memory.snoozedUntil).toBeNull();
  });

  it('shows nothing without suggestions', () => {
    expect(pickMergeCard([], EMPTY_MERGE_MEMORY, TODAY)).toEqual({
      suggestion: null,
      memory: EMPTY_MERGE_MEMORY,
    });
  });

  it('reads and writes per user and survives broken or blocked storage', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    } as Storage;
    const key = mergeCardStorageKey('user-1');
    expect(key).toBe('foodlog.mergeCard.user-1');
    expect(mergeCardStorageKey(null)).toBe('foodlog.mergeCard.anonymous');
    const memory = { date: TODAY, key: 'mayo', snoozedUntil: null };
    writeMergeMemory(storage, key, memory);
    expect(readMergeMemory(storage, key)).toEqual(memory);

    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    expect(() => writeMergeMemory(blocked, key, memory)).not.toThrow();
    expect(readMergeMemory(blocked, key)).toEqual(EMPTY_MERGE_MEMORY);
    expect(readMergeMemory(null, key)).toEqual(EMPTY_MERGE_MEMORY);
    expect(parseMergeMemory('{oops')).toEqual(EMPTY_MERGE_MEMORY);
    expect(parseMergeMemory('null')).toEqual(EMPTY_MERGE_MEMORY);
    expect(parseMergeMemory('{"date":"soon","key":3,"snoozedUntil":"2026-10-01"}')).toEqual({
      date: null,
      key: null,
      snoozedUntil: '2026-10-01',
    });
  });
});
