import { zeroNutrients, type FoodResultKind } from '@food/shared';
import {
  canRenameResult,
  cleanFoodName,
  foodUseSummary,
  hasLibraryMenu,
  hiddenMessage,
  initialOf,
  isProductResult,
  renameScope,
  renamedMessage,
} from './food-library';

const KINDS: FoodResultKind[] = ['favorite', 'meal', 'food', 'product'];

describe('food library helpers', () => {
  it('only renames meals, whose name is the name of the logged entries', () => {
    expect(KINDS.filter((kind) => canRenameResult({ kind }))).toEqual(['meal']);
  });

  it('offers the library menu for meals, single foods and saved products', () => {
    const menu = KINDS.filter((kind) =>
      hasLibraryMenu({ kind, productId: kind === 'product' ? 'p1' : null }),
    );
    expect(menu).toEqual(['meal', 'food', 'product']);
    expect(hasLibraryMenu({ kind: 'product', productId: null })).toBe(false);
    expect(isProductResult({ kind: 'product', productId: 'p1' })).toBe(true);
    expect(isProductResult({ kind: 'meal', productId: 'p1' })).toBe(false);
  });

  it('trims and collapses whitespace in a new name', () => {
    expect(cleanFoodName('  Khoury   strawberry\tyogurt ')).toBe('Khoury strawberry yogurt');
    expect(cleanFoodName('   ')).toBe('');
  });

  it('uses one wording for how many entries a rename touched', () => {
    expect(renamedMessage(1, 'Oat milk')).toBe('Renamed 1 entry to “Oat milk”');
    expect(renamedMessage(1200, 'Oat milk')).toBe('Renamed 1,200 entries to “Oat milk”');
    expect(renamedMessage(0, 'Oat milk')).toBe('No entries were renamed');
  });

  it('describes how many entries a rename changes before it runs', () => {
    expect(renameScope({ name: 'Soup', useCount: 0 })).toBe(
      'Changes the name of the entry called “Soup”.',
    );
    expect(renameScope({ name: 'Soup', useCount: 1 })).toBe(
      'Changes the name of the entry called “Soup”.',
    );
    expect(renameScope({ name: 'Soup', useCount: 1500 })).toBe(
      'Changes the name of all 1,500 entries called “Soup”.',
    );
  });

  it('confirms a hidden food and that its logs stay', () => {
    expect(hiddenMessage('Porridge')).toBe(
      'Removed “Porridge” from suggestions. Your logs are kept.',
    );
  });

  it('summarises where a food comes from, its calories and how often it was logged', () => {
    const totals = { ...zeroNutrients(), calories: 219.6 };
    expect(foodUseSummary({ kind: 'meal', detail: null, totals, useCount: 0 })).toBe('220 kcal');
    expect(foodUseSummary({ kind: 'meal', detail: 'Oats', totals, useCount: 1 })).toBe(
      '220 kcal · logged once',
    );
    expect(foodUseSummary({ kind: 'food', detail: 'Breakfast plate', totals, useCount: 12 })).toBe(
      'from Breakfast plate · 220 kcal · logged 12 times',
    );
    expect(foodUseSummary({ kind: 'product', detail: ' Khoury ', totals, useCount: 2 })).toBe(
      'Khoury · 220 kcal · logged 2 times',
    );
  });

  it('shows the amount like everywhere else: count first, then grams', () => {
    const totals = { ...zeroNutrients(), calories: 1450 };
    const portion = { count: 2, unit: 'burger', unitPlural: 'burgers' };
    expect(
      foodUseSummary({ kind: 'meal', detail: null, totals, useCount: 3, grams: 780, portion }),
    ).toBe('2 burgers · 780 g · 1,450 kcal · logged 3 times');
    expect(
      foodUseSummary({
        kind: 'meal',
        detail: null,
        totals,
        useCount: 1,
        grams: 780,
        portion: null,
      }),
    ).toBe('780 g · 1,450 kcal · logged once');
  });

  it('uses the first letter of a name for a thumbnail without a photo', () => {
    expect(initialOf('  banana')).toBe('B');
    expect(initialOf('   ')).toBe('?');
  });
});
