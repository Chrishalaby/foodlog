import { API_LIMITS, zeroNutrients, type FoodSearchResult } from '@food/shared';
import {
  foldText,
  highlightParts,
  matchQuality,
  normalizeQuery,
  queryTokens,
  resultDetail,
  resultDetailParts,
  splitSections,
  timeAgo,
} from './food-search';

function result(overrides: Partial<FoodSearchResult> = {}): FoodSearchResult {
  return {
    portion: null,
    key: 'meal:entry-1',
    kind: 'meal',
    name: 'Chicken shawarma plate',
    detail: null,
    items: [],
    totals: zeroNutrients(),
    grams: 330,
    mealType: 'lunch',
    photo: null,
    favoriteId: null,
    entryId: 'entry-1',
    useCount: 5,
    lastUsedAt: null,
    productId: null,
    starred: false,
    ...overrides,
  };
}

const NOW = new Date(2026, 8, 28, 15, 0);
const at = (days: number, hours = 12, minutes = 0): string =>
  new Date(2026, 8, 28 - days, hours, minutes).toISOString();

describe('normalizeQuery', () => {
  it('trims, collapses whitespace and caps the length', () => {
    expect(normalizeQuery('  khoury   yogurt \n')).toBe('khoury yogurt');
    expect(normalizeQuery('   ')).toBe('');
    expect(normalizeQuery('yog\u0000urt\u0007 bar')).toBe('yog urt bar');
    expect(normalizeQuery('x'.repeat(API_LIMITS.foodQueryMax + 10))).toHaveLength(
      API_LIMITS.foodQueryMax,
    );
  });

  it('splits a folded query into tokens', () => {
    expect(queryTokens(' Crème  BRÛLÉE ')).toEqual(['creme', 'brulee']);
    expect(foldText('Café Olé')).toBe('cafe ole');
  });
});

describe('highlightParts', () => {
  it('marks every occurrence of every token, case-insensitively', () => {
    expect(highlightParts('Khoury strawberry yogurt', 'STRAW yog')).toEqual([
      { text: 'Khoury ', match: false },
      { text: 'straw', match: true },
      { text: 'berry ', match: false },
      { text: 'yog', match: true },
      { text: 'urt', match: false },
    ]);
  });

  it('matches through diacritics and keeps the original characters', () => {
    expect(highlightParts('Café latte', 'cafe')).toEqual([
      { text: 'Café', match: true },
      { text: ' latte', match: false },
    ]);
    const decomposed = 'Café';
    expect(highlightParts(decomposed, 'cafe')).toEqual([{ text: decomposed, match: true }]);
  });

  it('keeps emoji and other astral characters intact', () => {
    const parts = highlightParts('🍓 strawberries', 'straw');
    expect(parts.map((part) => part.text).join('')).toBe('🍓 strawberries');
    expect(parts[0]).toEqual({ text: '🍓 ', match: false });
  });

  it('returns the whole text when there is nothing to highlight', () => {
    expect(highlightParts('Oats', '')).toEqual([{ text: 'Oats', match: false }]);
    expect(highlightParts('Oats', 'rice')).toEqual([{ text: 'Oats', match: false }]);
    expect(highlightParts('', 'rice')).toEqual([]);
  });
});

describe('timeAgo', () => {
  it('describes recent and older times in plain words', () => {
    expect(timeAgo(null, NOW)).toBeNull();
    expect(timeAgo('not a date', NOW)).toBeNull();
    expect(timeAgo(new Date(NOW.getTime() - 20_000).toISOString(), NOW)).toBe('just now');
    expect(timeAgo(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW)).toBe('5 min ago');
    expect(timeAgo(at(0, 8), NOW)).toBe('today');
    expect(timeAgo(at(1, 20), NOW)).toBe('yesterday');
    expect(timeAgo(at(2), NOW)).toBe('2 days ago');
    expect(timeAgo(at(20), NOW)).toBe('2 weeks ago');
    expect(timeAgo(at(95), NOW)).toBe('3 months ago');
    expect(timeAgo(at(400), NOW)).toBe('a year ago');
    expect(timeAgo(at(800), NOW)).toBe('2 years ago');
  });

  it('never reports future times as negative', () => {
    expect(timeAgo(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe('just now');
  });

  it('counts a late-night log toward the day it belongs to', () => {
    const lateNight = new Date(2026, 8, 29, 0, 30);
    expect(timeAgo(new Date(2026, 8, 28, 22, 0).toISOString(), lateNight)).toBe('today');
    expect(timeAgo(new Date(2026, 8, 28, 1, 0).toISOString(), lateNight)).toBe('yesterday');
  });
});

describe('resultDetail', () => {
  it('shows how often and how recently a meal was logged', () => {
    expect(resultDetail(result({ lastUsedAt: at(2) }), NOW)).toBe('Logged 5× · 2 days ago');
    expect(resultDetail(result({ useCount: 1, lastUsedAt: at(1) }), NOW)).toBe(
      'Logged once · yesterday',
    );
  });

  it('shows where a single food came from', () => {
    const food = result({ kind: 'food', detail: 'Breakfast bowl', lastUsedAt: at(3) });
    expect(resultDetail(food, NOW)).toBe('from Breakfast bowl · 3 days ago');
    expect(resultDetail({ ...food, detail: null, useCount: 9 }, NOW)).toBe(
      'Logged 9× · 3 days ago',
    );
  });

  it('shows the brand of a scanned product', () => {
    const product = result({ kind: 'product', detail: 'Khoury', useCount: 2, lastUsedAt: at(1) });
    expect(resultDetail(product, NOW)).toBe('Khoury · Logged 2× · yesterday');
    expect(resultDetail({ ...product, detail: null, useCount: 0, lastUsedAt: null }, NOW)).toBe(
      'Product',
    );
  });

  it('leads with the food a meal of one item was logged as', () => {
    const meal = result({
      name: 'Strawberry Yogurt',
      detail: 'Khoury strawberry yogurt',
      useCount: 1,
      lastUsedAt: at(0, 14, 54),
    });
    expect(resultDetail(meal, NOW)).toBe('Khoury strawberry yogurt · Logged once · 6 min ago');
    expect(resultDetail({ ...meal, detail: '  ' }, NOW)).toBe('Logged once · 6 min ago');
  });

  it('falls back to the kind when nothing else is known', () => {
    expect(resultDetail(result({ kind: 'favorite', useCount: 0, starred: true }), NOW)).toBe(
      'Starred',
    );
    expect(resultDetail(result({ useCount: 0 }), NOW)).toBe('Meal');
  });
});

describe('resultDetailParts', () => {
  const meal = result({
    name: 'Strawberry Yogurt',
    detail: 'Khoury strawberry yogurt',
    useCount: 1,
    lastUsedAt: at(0, 14, 54),
  });
  const joined = (parts: { text: string }[]): string => parts.map((part) => part.text).join('');
  const marked = (parts: { text: string; match: boolean }[]): string[] =>
    parts.filter((part) => part.match).map((part) => part.text);

  it('marks the query in the food a meal was logged as', () => {
    const parts = resultDetailParts(meal, 'kho', NOW);
    expect(joined(parts)).toBe(resultDetail(meal, NOW));
    expect(marked(parts)).toEqual(['Kho']);
  });

  it('never marks the words the app adds', () => {
    expect(marked(resultDetailParts(meal, 'logged', NOW))).toEqual([]);
    expect(marked(resultDetailParts(meal, 'ago', NOW))).toEqual([]);
    expect(marked(resultDetailParts(meal, '', NOW))).toEqual([]);
    const food = result({ kind: 'food', detail: 'Chicken bowl', lastUsedAt: at(3) });
    const parts = resultDetailParts(food, 'chick from', NOW);
    expect(joined(parts)).toBe('from Chicken bowl · 3 days ago');
    expect(marked(parts)).toEqual(['Chick']);
  });

  it('marks the brand of a product', () => {
    const product = result({ kind: 'product', detail: 'Khoury', useCount: 2, lastUsedAt: at(1) });
    expect(marked(resultDetailParts(product, 'kho', NOW))).toEqual(['Kho']);
  });

  it('falls back to the kind like the plain detail', () => {
    const parts = resultDetailParts(result({ useCount: 0 }), 'meal', NOW);
    expect(parts).toEqual([{ text: 'Meal', match: false }]);
  });
});

describe('splitSections', () => {
  it('separates starred results from the rest, keeping order', () => {
    const a = result({ key: 'favorite:a', kind: 'favorite', starred: true });
    const b = result({ key: 'meal:b' });
    const c = result({ key: 'favorite:c', kind: 'favorite', starred: true });
    expect(splitSections([a, b, c])).toEqual({ starred: [a, c], recent: [b] });
  });
});

describe('matchQuality', () => {
  it('rates results by whether every token starts a word of a name', () => {
    expect(matchQuality([], 'pizza')).toBe('none');
    expect(matchQuality([result()], '')).toBe('good');
    expect(matchQuality([result()], 'chick sha')).toBe('good');
    expect(matchQuality([result()], 'hawarma')).toBe('weak');
    expect(
      matchQuality(
        [result({ kind: 'food', name: 'Plain rice', detail: 'Chicken bowl' })],
        'chicken',
      ),
    ).toBe('weak');
  });

  it('counts a match on the food a meal was logged as, or on a brand', () => {
    const meal = result({ name: 'Strawberry Yogurt', detail: 'Khoury strawberry yogurt' });
    expect(matchQuality([meal], 'kho')).toBe('good');
    expect(matchQuality([meal], 'kho straw')).toBe('good');
    expect(matchQuality([meal], 'oury')).toBe('weak');
    const product = result({ kind: 'product', name: 'Strawberry yogurt', detail: 'Khoury' });
    expect(matchQuality([product], 'khoury')).toBe('good');
  });
});
