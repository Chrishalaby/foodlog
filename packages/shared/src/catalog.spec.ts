import { describe, expect, it } from 'vitest';
import {
  CATALOG_GROUP_LABELS,
  CATALOG_GROUPS,
  catalogItemName,
  catalogMicros,
  catalogMissingLabel,
  catalogNutrients,
  clampCatalogGrams,
  isCatalogGroup,
  normalizeCatalogText,
} from './catalog.js';
import { MAX_ITEM_GRAMS } from './nutrients.js';

const hummusPer100 = {
  calories: 177,
  protein: 4.86,
  carbs: 20.1,
  fat: 8.59,
  satFat: 1.14,
  fiber: 4,
  sugar: 0.27,
  sodium: 242,
  alcohol: 0,
};

describe('food catalog helpers', () => {
  it('labels every group', () => {
    for (const group of CATALOG_GROUPS) {
      expect(CATALOG_GROUP_LABELS[group]).toMatch(/\S/);
    }
    expect(isCatalogGroup('dishes')).toBe(true);
    expect(isCatalogGroup('pizza')).toBe(false);
    expect(isCatalogGroup(3)).toBe(false);
  });

  it('normalizes names and queries the same way', () => {
    expect(normalizeCatalogText('  Crème Brûlée, home-made (2%)  ')).toBe('creme brulee home made 2');
    expect(normalizeCatalogText('Egg, whole, raw')).toBe('egg whole raw');
    expect(normalizeCatalogText('***')).toBe('');
  });

  it('shortens long names at a comma so they fit an item name', () => {
    const name =
      'Beef, chuck, under blade center steak, boneless, Denver Cut, separable lean and fat, trimmed to 0" fat, all grades, cooked, grilled';
    const short = catalogItemName(name, 120);
    expect(short.length).toBeLessThanOrEqual(120);
    expect(short).toBe(
      'Beef, chuck, under blade center steak, boneless, Denver Cut, separable lean and fat, trimmed to 0" fat, all grades',
    );
    expect(catalogItemName('Hummus, plain', 120)).toBe('Hummus, plain');
    expect(catalogItemName('a'.repeat(130), 120)).toHaveLength(120);
  });

  it('scales per-100 g values to the eaten amount', () => {
    expect(catalogNutrients(hummusPer100, 30)).toEqual({
      calories: 53,
      protein: 1.5,
      carbs: 6,
      fat: 2.6,
      satFat: 0.3,
      fiber: 1.2,
      sugar: 0.1,
      sodium: 73,
      alcohol: 0,
    });
    expect(catalogMicros({ calcium: 49, vitaminC: 7.9 }, 50)).toEqual({ calcium: 25, vitaminC: 4 });
    expect(catalogMicros(null, 50)).toBeNull();
  });

  it('keeps grams inside the item limits', () => {
    expect(clampCatalogGrams(0)).toBe(100);
    expect(clampCatalogGrams(Number.NaN)).toBe(100);
    expect(clampCatalogGrams(33.94)).toBe(33.9);
    expect(clampCatalogGrams(MAX_ITEM_GRAMS * 2)).toBe(MAX_ITEM_GRAMS);
  });

  it('explains nutrients the source does not report', () => {
    expect(catalogMissingLabel([])).toBeNull();
    expect(catalogMissingLabel(['fiber', 'satFat'])).toBe('No fiber, saturated fat data in the source');
  });
});
