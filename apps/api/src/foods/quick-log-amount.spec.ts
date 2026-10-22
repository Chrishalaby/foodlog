import {
  type EntryItemInput,
  MAX_ITEM_GRAMS,
  NUTRIENT_META,
  zeroNutrients,
} from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import {
  assertSingleAmount,
  portionCountFactor,
  scaleItemToGrams,
  scaleLibraryFood,
  scaleLibraryItems,
  servingsForGrams,
  singleWeighedItem,
} from './quick-log-amount.js';

const BURGERS = { count: 2, unit: 'burger', unitPlural: 'burgers' };

function patties(): EntryItemInput {
  return {
    name: 'Black Angus patties',
    grams: 300,
    nutrients: { ...zeroNutrients(), calories: 810, protein: 72 },
    confidence: 'medium',
    count: 2,
    unit: 'patty',
    unitPlural: 'patties',
    micros: null,
    fluidMl: null,
  };
}

function yogurt(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    name: 'Khoury strawberry yogurt',
    grams: 170,
    nutrients: {
      ...zeroNutrients(),
      calories: 150,
      protein: 6.8,
      sugar: 20.4,
      sodium: 85,
    },
    confidence: 'high',
    micros: { calcium: 204, vitaminB12: 0.63 },
    fluidMl: null,
    ...overrides,
  };
}

function granola(): EntryItemInput {
  return {
    name: 'Granola',
    grams: 40,
    nutrients: { ...zeroNutrients(), calories: 180, carbs: 26 },
    confidence: 'medium',
    micros: { iron: 1.4 },
    fluidMl: null,
  };
}

function dietSoda(): EntryItemInput {
  return {
    name: 'Diet Pepsi',
    grams: 660,
    nutrients: { ...zeroNutrients(), sodium: 66 },
    confidence: 'high',
    count: 2,
    unit: 'can',
    unitPlural: 'cans',
    micros: { caffeine: 70, potassium: 73 },
    fluidMl: 660,
  };
}

describe('scaleLibraryItems', () => {
  it('logs the last amounts when neither servings nor grams are given', () => {
    expect(scaleLibraryItems([yogurt(), granola()], {})).toEqual([
      yogurt(),
      granola(),
    ]);
  });

  it('scales every item by the servings', () => {
    const [scaledYogurt, scaledGranola] = scaleLibraryItems(
      [yogurt(), granola()],
      { servings: 1.5 },
    );

    expect(scaledYogurt).toMatchObject({
      name: 'Khoury strawberry yogurt',
      grams: 255,
      confidence: 'high',
      nutrients: { calories: 225, sodium: 127.5 },
    });
    expect(scaledYogurt?.nutrients.protein).toBeCloseTo(10.2);
    expect(scaledGranola).toMatchObject({
      grams: 60,
      nutrients: { calories: 270 },
      micros: { iron: 2.1 },
    });
    expect(scaledYogurt?.micros).toEqual({ calcium: 306, vitaminB12: 0.95 });
  });

  it('scales a single item to the requested grams, ignoring servings', () => {
    const [scaled] = scaleLibraryItems([yogurt()], { grams: 250, servings: 3 });

    expect(scaled?.grams).toBe(250);
    expect(scaled?.nutrients.calories).toBeCloseTo(220.588, 3);
    expect(scaled?.nutrients.sodium).toBeCloseTo(125, 6);
    expect(scaled?.micros).toEqual({ calcium: 300, vitaminB12: 0.93 });
  });

  it('scales the drink volume and caffeine of a drink to the requested millilitres', () => {
    const [scaled] = scaleLibraryItems([dietSoda()], { grams: 330 });

    expect(scaled).toMatchObject({
      grams: 330,
      count: 1,
      micros: { caffeine: 35, potassium: 37 },
      fluidMl: 330,
    });
  });

  it('treats null amounts like missing ones', () => {
    expect(
      scaleLibraryItems([yogurt()], { grams: null, servings: null }),
    ).toEqual([yogurt()]);
  });

  it('rejects grams for results with several items', () => {
    expect(() =>
      scaleLibraryItems([yogurt(), granola()], { grams: 100 }),
    ).toThrow(BadRequestException);
  });

  it('rejects grams for items without a recorded weight', () => {
    expect(() =>
      scaleLibraryItems([yogurt({ grams: 0 })], { grams: 100 }),
    ).toThrow(/no recorded weight/);
  });

  it('rejects amounts that push an item beyond the gram or nutrient limits', () => {
    expect(() =>
      scaleLibraryItems([yogurt({ grams: 6000 })], { servings: 2 }),
    ).toThrow(/too large/);
    expect(() =>
      scaleLibraryItems(
        [
          yogurt({
            nutrients: {
              ...zeroNutrients(),
              calories: NUTRIENT_META.calories.max / 2 + 1,
            },
          }),
        ],
        { servings: 2 },
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      scaleLibraryItems(
        [yogurt({ grams: 1, nutrients: { ...zeroNutrients(), sodium: 100 } })],
        { grams: MAX_ITEM_GRAMS },
      ),
    ).toThrow(/too large/);
  });

  it('accepts the maximum weight exactly', () => {
    const [scaled] = scaleLibraryItems([yogurt()], { grams: MAX_ITEM_GRAMS });
    expect(scaled?.grams).toBe(MAX_ITEM_GRAMS);
  });
});

describe('scaleLibraryFood', () => {
  it('logs 1½ of 2 burgers as three quarters of everything', () => {
    const scaled = scaleLibraryFood(
      { items: [patties(), granola()], portion: BURGERS },
      { portionCount: 1.5 },
    );

    expect(scaled.portion).toEqual({ ...BURGERS, count: 1.5 });
    expect(scaled.items[0]).toMatchObject({
      grams: 225,
      count: 1.5,
      unit: 'patty',
      nutrients: { calories: 607.5, protein: 54 },
    });
    expect(scaled.items[1]).toMatchObject({
      grams: 30,
      nutrients: { calories: 135 },
    });
    expect(scaled.items[1]).not.toHaveProperty('count');
  });

  it('scales the portion by servings and by grams', () => {
    expect(
      scaleLibraryFood(
        { items: [patties()], portion: BURGERS },
        { servings: 1.5 },
      ).portion,
    ).toEqual({ ...BURGERS, count: 3 });
    const byGrams = scaleLibraryFood(
      { items: [patties()], portion: BURGERS },
      { grams: 150 },
    );
    expect(byGrams.portion).toEqual({ ...BURGERS, count: 1 });
    expect(byGrams.items[0]).toMatchObject({ grams: 150, count: 1 });
  });

  it('scales micros and the drink volume by the portion count', () => {
    const scaled = scaleLibraryFood(
      {
        items: [dietSoda()],
        portion: { count: 2, unit: 'can', unitPlural: 'cans' },
      },
      { portionCount: 3 },
    );

    expect(scaled.items[0]).toMatchObject({
      grams: 990,
      count: 3,
      micros: { caffeine: 105, potassium: 110 },
      fluidMl: 990,
    });
  });

  it('copies everything unchanged without an amount', () => {
    const food = { items: [patties()], portion: BURGERS };
    expect(scaleLibraryFood(food, {})).toEqual(food);
  });

  it('keeps foods without a portion portionless', () => {
    expect(
      scaleLibraryFood({ items: [yogurt()], portion: null }, { servings: 2 })
        .portion,
    ).toBeNull();
  });

  it('rejects a portion count without a portion or combined with another amount', () => {
    expect(() =>
      scaleLibraryFood(
        { items: [yogurt()], portion: null },
        { portionCount: 1 },
      ),
    ).toThrow(/portionCount needs a food logged as a count/);
    expect(() =>
      scaleLibraryFood(
        { items: [patties()], portion: BURGERS },
        { portionCount: 1, servings: 1 },
      ),
    ).toThrow(/cannot be combined/);
  });

  it('rejects portion counts that push items beyond the limits', () => {
    expect(() =>
      scaleLibraryFood(
        { items: [patties()], portion: { ...BURGERS, count: 0.25 } },
        { portionCount: 100 },
      ),
    ).toThrow(/too large/);
  });
});

describe('assertSingleAmount', () => {
  it('allows one amount, and grams together with servings', () => {
    expect(() => assertSingleAmount({})).not.toThrow();
    expect(() => assertSingleAmount({ portionCount: 2 })).not.toThrow();
    expect(() =>
      assertSingleAmount({ portionCount: 2, servings: null, grams: null }),
    ).not.toThrow();
    expect(() => assertSingleAmount({ grams: 10, servings: 2 })).not.toThrow();
  });

  it('rejects a portion count next to servings or grams', () => {
    expect(() => assertSingleAmount({ portionCount: 2, servings: 1 })).toThrow(
      BadRequestException,
    );
    expect(() => assertSingleAmount({ portionCount: 2, grams: 50 })).toThrow(
      BadRequestException,
    );
  });
});

describe('portionCountFactor', () => {
  it('divides the wanted count by the logged count', () => {
    expect(portionCountFactor(BURGERS, 1.5)).toBe(0.75);
    expect(portionCountFactor(BURGERS, 3)).toBe(1.5);
  });

  it('rejects foods without a portion', () => {
    expect(() => portionCountFactor(null, 1)).toThrow(BadRequestException);
  });
});

describe('scaleItemToGrams', () => {
  it('keeps the original item untouched', () => {
    const item = yogurt();
    scaleItemToGrams(item, 85);
    expect(item).toEqual(yogurt());
  });

  it('scales the item count with the weight', () => {
    expect(scaleItemToGrams(patties(), 75)).toMatchObject({
      grams: 75,
      count: 0.5,
      unit: 'patty',
    });
  });

  it('halves the nutrients for half the weight', () => {
    expect(scaleItemToGrams(yogurt(), 85).nutrients).toEqual({
      ...zeroNutrients(),
      calories: 75,
      protein: 3.4,
      sugar: 10.2,
      sodium: 42.5,
    });
  });
});

describe('singleWeighedItem', () => {
  it('returns the only item', () => {
    expect(singleWeighedItem([yogurt()])).toEqual(yogurt());
  });

  it('rejects empty lists', () => {
    expect(() => singleWeighedItem([])).toThrow(BadRequestException);
  });
});

describe('servingsForGrams', () => {
  it('converts grams to servings of a single-item result', () => {
    expect(servingsForGrams([yogurt()], 255)).toBeCloseTo(1.5);
  });

  it('never lets rounding push the scaled weight above the requested grams', () => {
    for (let itemGrams = 1; itemGrams <= 2000; itemGrams += 1) {
      const servings = servingsForGrams(
        [yogurt({ grams: itemGrams, nutrients: zeroNutrients() })],
        MAX_ITEM_GRAMS,
      );
      expect(itemGrams * servings).toBeLessThanOrEqual(MAX_ITEM_GRAMS);
      expect(itemGrams * servings).toBeCloseTo(MAX_ITEM_GRAMS, 6);
    }
  });

  it('rejects multi-item results', () => {
    expect(() => servingsForGrams([yogurt(), granola()], 100)).toThrow(
      BadRequestException,
    );
  });

  it('rejects grams that push the nutrients beyond their limits', () => {
    expect(() =>
      servingsForGrams(
        [yogurt({ grams: 1, nutrients: { ...zeroNutrients(), sodium: 400 } })],
        1000,
      ),
    ).toThrow(/too large/);
  });
});
