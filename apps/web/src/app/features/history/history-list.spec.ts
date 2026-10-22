import { zeroNutrients, type EntryDto } from '@food/shared';
import {
  appendPage,
  compareNewestFirst,
  dayTotals,
  groupEntriesByDay,
  mergeHead,
  normalizeSearch,
  toDayHeader,
  upsertEntry,
} from './history-list';

function entry(
  id: string,
  timestamp: string,
  localDate: string,
  calories = 0,
  protein = 0,
): EntryDto {
  return {
    portion: null,
    id,
    name: `Meal ${id}`,
    description: null,
    mealType: 'lunch',
    source: 'manual',
    timestamp,
    localDate,
    items: [],
    totals: { ...zeroNutrients(), calories, protein },
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

const ids = (list: readonly EntryDto[]): string[] => list.map((item) => item.id);

describe('history list helpers', () => {
  describe('groupEntriesByDay', () => {
    it('groups by localDate, newest day first, entries newest first within a day', () => {
      const groups = groupEntriesByDay([
        entry('a', '2026-09-27T08:00:00.000Z', '2026-09-27', 300, 20),
        entry('b', '2026-09-28T12:00:00.000Z', '2026-09-28', 650.4, 41.25),
        entry('c', '2026-09-27T19:00:00.000Z', '2026-09-27', 800, 55.5),
        entry('d', '2026-09-28T07:30:00.000Z', '2026-09-28', 420.3, 18.1),
      ]);
      expect(groups.map((group) => group.date)).toEqual(['2026-09-28', '2026-09-27']);
      expect(ids(groups[0].entries)).toEqual(['b', 'd']);
      expect(ids(groups[1].entries)).toEqual(['c', 'a']);
    });

    it("sums the day's kcal and protein with display rounding", () => {
      const [today] = groupEntriesByDay([
        entry('b', '2026-09-28T12:00:00.000Z', '2026-09-28', 650.4, 41.25),
        entry('d', '2026-09-28T07:30:00.000Z', '2026-09-28', 420.3, 18.1),
      ]);
      expect(today.calories).toBe(1071);
      expect(today.protein).toBe(59.4);
    });

    it('uses localDate rather than the UTC day of the timestamp', () => {
      const groups = groupEntriesByDay([
        entry('late', '2026-09-28T02:30:00.000Z', '2026-09-27', 500),
        entry('early', '2026-09-28T09:00:00.000Z', '2026-09-28', 300),
      ]);
      expect(groups.map((group) => [group.date, ids(group.entries)])).toEqual([
        ['2026-09-28', ['early']],
        ['2026-09-27', ['late']],
      ]);
    });

    it('marks only the oldest loaded day as partial while more pages exist', () => {
      const list = [
        entry('b', '2026-09-28T12:00:00.000Z', '2026-09-28'),
        entry('a', '2026-09-27T08:00:00.000Z', '2026-09-27'),
      ];
      expect(groupEntriesByDay(list, true).map((group) => group.partial)).toEqual([false, true]);
      expect(groupEntriesByDay(list, false).map((group) => group.partial)).toEqual([false, false]);
    });

    it('returns no groups for no entries', () => {
      expect(groupEntriesByDay([], true)).toEqual([]);
    });
  });

  it('dayTotals ignores other nutrients and handles empty days', () => {
    expect(dayTotals([])).toEqual({ calories: 0, protein: 0 });
  });

  describe('toDayHeader', () => {
    it('labels today with its short date and formats totals', () => {
      const [group] = groupEntriesByDay([
        entry('a', '2026-09-28T12:00:00.000Z', '2026-09-28', 1840.4, 112.26),
      ]);
      const header = toDayHeader(group, '2026-09-28');
      expect(header.label).toBe('Today');
      expect(header.dateLabel).toBe('Mon 28 Sep');
      expect(header.calories).toBe('1,840');
      expect(header.protein).toBe('112.3');
    });

    it('omits the secondary date when the label already is the date', () => {
      const [group] = groupEntriesByDay([entry('a', '2026-09-20T12:00:00.000Z', '2026-09-20')]);
      const header = toDayHeader(group, '2026-09-28');
      expect(header.label).toBe('Sun 20 Sep');
      expect(header.dateLabel).toBeNull();
    });

    it('calls the previous day Yesterday', () => {
      const [group] = groupEntriesByDay([entry('a', '2026-09-27T12:00:00.000Z', '2026-09-27')]);
      expect(toDayHeader(group, '2026-09-28').label).toBe('Yesterday');
    });
  });

  it('compareNewestFirst orders by timestamp then by id descending', () => {
    const sorted = [
      entry('a', '2026-09-28T10:00:00.000Z', '2026-09-28'),
      entry('c', '2026-09-28T12:00:00.000Z', '2026-09-28'),
      entry('b', '2026-09-28T10:00:00.000Z', '2026-09-28'),
    ].sort(compareNewestFirst);
    expect(ids(sorted)).toEqual(['c', 'b', 'a']);
  });

  it('appendPage adds the next page and drops duplicates already loaded', () => {
    const current = [
      entry('c', '2026-09-28T12:00:00.000Z', '2026-09-28'),
      entry('b', '2026-09-27T12:00:00.000Z', '2026-09-27'),
    ];
    const page = [
      entry('b', '2026-09-27T12:00:00.000Z', '2026-09-27'),
      entry('a', '2026-09-26T12:00:00.000Z', '2026-09-26'),
    ];
    expect(ids(appendPage(current, page))).toEqual(['c', 'b', 'a']);
  });

  describe('mergeHead', () => {
    const loaded = [
      entry('e', '2026-09-28T12:00:00.000Z', '2026-09-28'),
      entry('d', '2026-09-28T08:00:00.000Z', '2026-09-28'),
      entry('c', '2026-09-27T12:00:00.000Z', '2026-09-27'),
      entry('b', '2026-09-26T12:00:00.000Z', '2026-09-26'),
      entry('a', '2026-09-25T12:00:00.000Z', '2026-09-25'),
    ];

    it('prepends new entries, applies edits and drops head entries deleted elsewhere', () => {
      const edited = { ...entry('c', '2026-09-27T12:00:00.000Z', '2026-09-27'), name: 'Edited' };
      const head = [entry('f', '2026-09-28T18:00:00.000Z', '2026-09-28'), loaded[0], edited];
      const merged = mergeHead(loaded, head, false);
      expect(ids(merged)).toEqual(['f', 'e', 'c', 'b', 'a']);
      expect(merged[2].name).toBe('Edited');
    });

    it('replaces everything when the head is the complete list', () => {
      const head = [entry('f', '2026-09-28T18:00:00.000Z', '2026-09-28')];
      expect(ids(mergeHead(loaded, head, true))).toEqual(['f']);
    });

    it('keeps the current list when an incomplete head is empty', () => {
      expect(ids(mergeHead(loaded, [], false))).toEqual(ids(loaded));
    });
  });

  describe('upsertEntry', () => {
    const loaded = [
      entry('c', '2026-09-28T12:00:00.000Z', '2026-09-28'),
      entry('a', '2026-09-26T12:00:00.000Z', '2026-09-26'),
    ];

    it('inserts a new entry at its chronological position', () => {
      const inserted = upsertEntry(
        loaded,
        entry('b', '2026-09-27T12:00:00.000Z', '2026-09-27'),
        false,
      );
      expect(ids(inserted)).toEqual(['c', 'b', 'a']);
      const newest = upsertEntry(
        loaded,
        entry('d', '2026-09-29T12:00:00.000Z', '2026-09-29'),
        true,
      );
      expect(ids(newest)).toEqual(['d', 'c', 'a']);
    });

    it('moves an edited entry when its time changed', () => {
      const moved = upsertEntry(
        loaded,
        entry('c', '2026-09-25T12:00:00.000Z', '2026-09-25'),
        false,
      );
      expect(ids(moved)).toEqual(['a', 'c']);
    });

    it('drops an entry that now belongs to pages that are not loaded yet', () => {
      const moved = upsertEntry(loaded, entry('c', '2026-09-01T12:00:00.000Z', '2026-09-01'), true);
      expect(ids(moved)).toEqual(['a']);
    });

    it('keeps the oldest loaded entry in place when it is refreshed unchanged', () => {
      expect(ids(upsertEntry(loaded, loaded[1], true))).toEqual(['c', 'a']);
    });

    it('drops the oldest loaded entry when it moved past the loaded pages', () => {
      const moved = upsertEntry(loaded, entry('a', '2026-09-20T12:00:00.000Z', '2026-09-20'), true);
      expect(ids(moved)).toEqual(['c']);
    });
  });

  it('normalizeSearch trims, collapses whitespace and caps the length', () => {
    expect(normalizeSearch('  chicken   rice  ')).toBe('chicken rice');
    expect(normalizeSearch('x'.repeat(500))).toHaveLength(120);
  });

  it('normalizeSearch never splits an emoji, which would make the query unencodable', () => {
    const query = normalizeSearch(`${'x'.repeat(119)}🍕🍕`);
    expect(Array.from(query)).toHaveLength(120);
    expect(query.endsWith('🍕')).toBe(true);
    expect(() => encodeURIComponent(query)).not.toThrow();
  });
});
