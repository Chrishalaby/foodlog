import { API_LIMITS } from '@food/shared';
import { FALAFEL_FOOD, HUMMUS_FOOD, OLIVE_OIL_FOOD } from '../testing/catalog-fixtures';
import {
  amountLabel,
  catalogAmountNutrients,
  catalogEntryItem,
  catalogFoodUrl,
  catalogSourceLabel,
  catalogSubtitle,
  clampQuantity,
  countedPortion,
  defaultCatalogAmount,
  gramsAmount,
  portionAmount,
} from './catalog';

describe('catalog amounts', () => {
  it('starts with the first USDA portion, or 100 g when there is none', () => {
    expect(defaultCatalogAmount(HUMMUS_FOOD)).toEqual({
      portion: { label: '1 serving', grams: 60 },
      quantity: 1,
      grams: 60,
    });
    expect(defaultCatalogAmount(OLIVE_OIL_FOOD)).toEqual({ portion: null, quantity: 1, grams: 100 });
  });

  it('multiplies portions and keeps quantities in range', () => {
    expect(portionAmount({ label: '1 tablespoon', grams: 15 }, 2.5)).toEqual({
      portion: { label: '1 tablespoon', grams: 15 },
      quantity: 2.5,
      grams: 37.5,
    });
    expect(clampQuantity(0)).toBe(1);
    expect(clampQuantity(0.1)).toBe(0.25);
    expect(clampQuantity(99)).toBe(20);
    expect(gramsAmount(-3).grams).toBe(100);
  });

  it('describes the amount the way people say it', () => {
    expect(amountLabel(defaultCatalogAmount(HUMMUS_FOOD))).toBe('1 serving (60 g)');
    expect(amountLabel(portionAmount({ label: '1 tablespoon', grams: 15 }, 1.5))).toBe(
      '1½ × 1 tablespoon (22.5 g)',
    );
    expect(amountLabel(gramsAmount(125))).toBe('125 g');
  });

  it('turns simple household measures into counted portions', () => {
    expect(countedPortion('1 tablespoon', 2)).toEqual({
      count: 2,
      unit: 'tablespoon',
      unitPlural: 'tablespoons',
    });
    expect(countedPortion('2 slices', 1)).toEqual({ count: 2, unit: 'slice', unitPlural: 'slices' });
    expect(countedPortion('5 tomatoes', 1)).toEqual({
      count: 5,
      unit: 'tomato',
      unitPlural: 'tomatoes',
    });
    expect(countedPortion('4 pieces', 0.5)).toEqual({ count: 2, unit: 'piece', unitPlural: 'pieces' });
    expect(countedPortion('1 glass')).toEqual({ count: 1, unit: 'glass', unitPlural: 'glasses' });
    expect(countedPortion('2 sandwiches')).toEqual({
      count: 2,
      unit: 'sandwich',
      unitPlural: 'sandwiches',
    });
    expect(countedPortion('3 cookies')).toEqual({ count: 3, unit: 'cookie', unitPlural: 'cookies' });
    expect(countedPortion('2 patties')).toEqual({ count: 2, unit: 'patty', unitPlural: 'patties' });
    expect(countedPortion('1 serving')).toBeNull();
    expect(countedPortion('3 oz')).toBeNull();
    expect(countedPortion('1 cup, chopped')).toBeNull();
    expect(countedPortion('1 patty (approx 2-1/4" dia)')).toBeNull();
  });
});

describe('catalog items', () => {
  it('builds an item with USDA values for the amount', () => {
    const item = catalogEntryItem(HUMMUS_FOOD, portionAmount({ label: '1 tablespoon', grams: 15 }, 2));
    expect(item).toEqual({
      name: 'Hummus, plain',
      grams: 30,
      nutrients: catalogAmountNutrients(HUMMUS_FOOD, gramsAmount(30)),
      confidence: 'high',
      count: 2,
      unit: 'tablespoon',
      unitPlural: 'tablespoons',
      productId: null,
      micros: { calcium: 11, iron: 0.7 },
      fluidMl: null,
    });
    expect(item.nutrients.calories).toBe(73);
  });

  it('keeps names within the item limit and leaves uncountable portions uncounted', () => {
    const long = { ...FALAFEL_FOOD, name: `Falafel, ${'very '.repeat(40)}crispy` };
    const item = catalogEntryItem(long, defaultCatalogAmount(long));
    expect(item.name.length).toBeLessThanOrEqual(API_LIMITS.nameMax);
    expect(item.count).toBeNull();
    expect(item.micros).toBeNull();
  });

  it('labels the food, its source and its USDA page', () => {
    expect(catalogSubtitle(HUMMUS_FOOD)).toBe('Soups & sauces · 243 kcal per 100 g');
    expect(catalogSourceLabel(FALAFEL_FOOD)).toBe('USDA SR Legacy #172447');
    expect(catalogFoodUrl(FALAFEL_FOOD)).toBe(
      'https://fdc.nal.usda.gov/food-details/172447/nutrients',
    );
  });
});
