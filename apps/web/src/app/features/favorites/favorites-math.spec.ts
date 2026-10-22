import { zeroNutrients, type EntryItemInput, type FavoriteDto } from '@food/shared';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { createDraftItem } from '../../shared/ui/items-editor/items-math';
import {
  SERVINGS_MAX,
  SERVINGS_MIN,
  clampServings,
  filterFavorites,
  formatServings,
  momentAt,
  momentFromDateTimeLocal,
  recordUse,
  scaledItemTotals,
  servingsLabel,
  servingsLimit,
  sortFavorites,
  stepServings,
  upsertFavorite,
  useCountLabel,
  validateFavoriteDraft,
} from './favorites-math';

function item(name: string, grams: number, calories: number, protein: number): EntryItemInput {
  return { name, grams, nutrients: { ...zeroNutrients(), calories, protein } };
}

function favorite(id: string, name: string, items: EntryItemInput[] = []): FavoriteDto {
  return {
    portion: null,
    id,
    name,
    mealType: null,
    items,
    totals: zeroNutrients(),
    photo: null,
    useCount: 0,
    lastUsedAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
  };
}

describe('favorites math', () => {
  describe('servings', () => {
    it('snaps to quarter servings within 0.25–5', () => {
      expect(clampServings(1.3)).toBe(1.25);
      expect(clampServings(1.4)).toBe(1.5);
      expect(clampServings(0)).toBe(SERVINGS_MIN);
      expect(clampServings(-2)).toBe(SERVINGS_MIN);
      expect(clampServings(12)).toBe(SERVINGS_MAX);
      expect(clampServings(Number.NaN)).toBe(1);
    });

    it('steps by a quarter and stops at the bounds', () => {
      expect(stepServings(1, 1)).toBe(1.25);
      expect(stepServings(1, -1)).toBe(0.75);
      expect(stepServings(0.25, -1)).toBe(0.25);
      expect(stepServings(5, 1)).toBe(5);
      expect(stepServings(1.1, 1)).toBe(1.25);
    });

    it('caps servings so no scaled item exceeds the server item limits', () => {
      expect(servingsLimit([item('Oats', 80, 303, 10.5)])).toBe(SERVINGS_MAX);
      expect(servingsLimit([item('Oats', 80, 303, 10.5), item('Soup pot', 2600, 1800, 90)])).toBe(
        3.75,
      );
      expect(servingsLimit([item('Pot', 2500, 0, 0)])).toBe(4);
      expect(servingsLimit([item('Lard', 100, 9000, 0)])).toBe(2);
      expect(servingsLimit([])).toBe(SERVINGS_MAX);
      expect(clampServings(5, 3.75)).toBe(3.75);
      expect(stepServings(3.75, 1, 3.75)).toBe(3.75);
      expect(clampServings(Number.NaN, 3.75)).toBe(1);
    });

    it('formats quarter servings with fraction glyphs', () => {
      expect(formatServings(0.25)).toBe('¼');
      expect(formatServings(0.5)).toBe('½');
      expect(formatServings(1)).toBe('1');
      expect(formatServings(1.5)).toBe('1½');
      expect(formatServings(2.75)).toBe('2¾');
      expect(formatServings(1.3)).toBe('1.3');
      expect(servingsLabel(1)).toBe('1 serving');
      expect(servingsLabel(0.5)).toBe('½ servings');
      expect(servingsLabel(2)).toBe('2 servings');
    });

    it('previews totals exactly like the server: scale, round each item, then sum', () => {
      const items = [item('Oats', 80, 303, 10.5), item('Milk', 200, 128, 6.8)];
      expect(scaledItemTotals(items, 1)).toMatchObject({ calories: 431, protein: 17.3 });
      expect(scaledItemTotals(items, 1.5)).toMatchObject({ calories: 647, protein: 26 });
      const tricky = [item('A', 10, 0.5, 0.05), item('B', 10, 0.5, 0.05)];
      expect(scaledItemTotals(tricky, 1)).toMatchObject({ calories: 2, protein: 0.2 });
      expect(scaledItemTotals([], 2).calories).toBe(0);
    });
  });

  describe('log moments', () => {
    beforeEach(() => setDayStartHour(DEFAULT_DAY_START_HOUR, null));
    afterEach(() => setDayStartHour(DEFAULT_DAY_START_HOUR, null));

    it('derives the local date and ISO instant from a datetime-local value', () => {
      const moment = momentFromDateTimeLocal('2026-09-27T19:45');
      expect(moment).not.toBeNull();
      expect(moment!.localDate).toBe('2026-09-27');
      const instant = new Date(moment!.timestamp);
      expect([instant.getFullYear(), instant.getMonth(), instant.getDate()]).toEqual([2026, 8, 27]);
      expect([instant.getHours(), instant.getMinutes()]).toEqual([19, 45]);
    });

    it('accepts seconds and rejects empty or invalid values', () => {
      expect(momentFromDateTimeLocal('2026-09-27T07:05:30')?.localDate).toBe('2026-09-27');
      expect(momentFromDateTimeLocal('')).toBeNull();
      expect(momentFromDateTimeLocal('2026-02-30T10:00')).toBeNull();
      expect(momentFromDateTimeLocal('2026-09-27T25:00')).toBeNull();
    });

    it('rejects two-digit years that Date would silently map to the 1900s', () => {
      expect(momentFromDateTimeLocal('0026-09-27T10:00')).toBeNull();
    });

    it('momentAt files a moment under its eating day', () => {
      const evening = new Date(2026, 8, 28, 23, 50);
      expect(momentAt(evening)).toEqual({
        timestamp: evening.toISOString(),
        localDate: '2026-09-28',
      });
      const lateNight = new Date(2026, 8, 29, 0, 56);
      expect(momentAt(lateNight)).toEqual({
        timestamp: lateNight.toISOString(),
        localDate: '2026-09-28',
      });
      const morning = new Date(2026, 8, 29, 3, 0);
      expect(momentAt(morning).localDate).toBe('2026-09-29');
    });

    it('momentAt follows the chosen day start', () => {
      const lateNight = new Date(2026, 8, 29, 0, 56);
      setDayStartHour(0, null);
      expect(momentAt(lateNight).localDate).toBe('2026-09-29');
      setDayStartHour(1, null);
      expect(momentAt(lateNight).localDate).toBe('2026-09-28');
    });

    it('reads a time before the day start as after midnight of the picked eating day', () => {
      const moment = momentFromDateTimeLocal('2026-09-28T00:30');
      expect(moment?.localDate).toBe('2026-09-28');
      const instant = new Date(moment!.timestamp);
      expect([instant.getFullYear(), instant.getMonth(), instant.getDate()]).toEqual([2026, 8, 29]);
      expect([instant.getHours(), instant.getMinutes()]).toEqual([0, 30]);
    });
  });

  describe('lists', () => {
    const list = [
      favorite('1', 'Überbowl', [item('Quinoa', 100, 120, 4)]),
      favorite('2', 'apple pie'),
      favorite('3', 'Chicken rice', [item('Jasmine rice', 150, 195, 4)]),
      favorite('4', 'Banana 10 pack'),
      favorite('5', 'Banana 2 pack'),
    ];

    it('filters by name or item names, ignoring case and accents, all words must match', () => {
      expect(filterFavorites(list, 'uber').map((f) => f.id)).toEqual(['1']);
      expect(filterFavorites(list, 'QUINOA').map((f) => f.id)).toEqual(['1']);
      expect(filterFavorites(list, 'rice jasmine').map((f) => f.id)).toEqual(['3']);
      expect(filterFavorites(list, 'rice apple')).toEqual([]);
      expect(filterFavorites(list, '   ')).toHaveLength(5);
    });

    it('keeps server order for most used and sorts naturally for A–Z', () => {
      expect(sortFavorites(list, 'most-used').map((f) => f.id)).toEqual(['1', '2', '3', '4', '5']);
      expect(sortFavorites(list, 'name').map((f) => f.name)).toEqual([
        'apple pie',
        'Banana 2 pack',
        'Banana 10 pack',
        'Chicken rice',
        'Überbowl',
      ]);
    });

    it('records a use without reordering and upserts edits in place', () => {
      const used = recordUse(list[1], '2026-09-28T10:00:00.000Z');
      expect(used).toMatchObject({ useCount: 1, lastUsedAt: '2026-09-28T10:00:00.000Z' });
      const renamed = { ...list[2], name: 'Chicken & rice' };
      expect(upsertFavorite(list, renamed)[2].name).toBe('Chicken & rice');
      expect(upsertFavorite(list, favorite('9', 'New')).map((f) => f.id)[0]).toBe('9');
    });

    it('describes use counts', () => {
      expect(useCountLabel(0)).toBe('Not logged yet');
      expect(useCountLabel(1)).toBe('Logged once');
      expect(useCountLabel(1234)).toBe('Logged 1,234 times');
    });
  });

  it('validates the editor draft', () => {
    const named = createDraftItem({ name: 'Oats', grams: 80 });
    expect(validateFavoriteDraft('  ', [named])).toBe('Give this favorite a name.');
    expect(validateFavoriteDraft('x'.repeat(121), [named])).toContain('at most 120');
    expect(validateFavoriteDraft('Breakfast', [])).toBe('Add at least one item.');
    expect(validateFavoriteDraft('Breakfast', [createDraftItem()])).toBe('Item 1 needs a name.');
    expect(validateFavoriteDraft('Breakfast', [named])).toBeNull();
  });
});
