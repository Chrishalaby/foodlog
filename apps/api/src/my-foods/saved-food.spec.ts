import { zeroNutrients } from '@food/shared';
import {
  findSavedFoodByName,
  type SavedFoodRow,
  suggestSavedFood,
  toSavedFood,
  toSavedFoodRef,
} from './saved-food.js';

function row(overrides: Partial<SavedFoodRow> = {}): SavedFoodRow {
  return {
    id: '019a0000-0000-7000-8000-0000000000d1',
    name: 'Tomato ketchup',
    brand: 'Heinz',
    aliases: ['Catsup'],
    basisUnit: 'g',
    unitName: 'tbsp',
    unitGrams: 17,
    servingSizeG: null,
    microsPer100: null,
    ...zeroNutrients(),
    calories: 110,
    ...overrides,
  };
}

const KETCHUP = toSavedFood(row());
const MAYO = toSavedFood(
  row({
    id: '019a0000-0000-7000-8000-0000000000d2',
    name: 'Heinz mayonnaise, regular',
    brand: null,
    aliases: [],
    unitName: null,
    unitGrams: null,
    calories: 680,
  }),
);
const LIGHT_MAYO = toSavedFood(
  row({
    id: '019a0000-0000-7000-8000-0000000000d3',
    name: 'Mayonnaise light',
    brand: null,
    aliases: [],
    calories: 300,
  }),
);

describe('toSavedFoodRef', () => {
  it('keeps the compact saved food fields', () => {
    expect(toSavedFoodRef(row({ basisUnit: 'ml' }))).toEqual({
      id: row().id,
      name: 'Tomato ketchup',
      brand: 'Heinz',
      basisUnit: 'ml',
      per100: { ...zeroNutrients(), calories: 110 },
      microsPer100: null,
      unitName: 'tbsp',
      unitGrams: 17,
    });
  });

  it('carries valid micros per 100 of the saved food', () => {
    expect(
      toSavedFoodRef(
        row({ microsPer100: { potassium: 281, vitaminA: 21, omega3: 1 } }),
      ).microsPer100,
    ).toEqual({ potassium: 281, vitaminA: 21 });
  });
});

describe('toSavedFood', () => {
  it('names linked items like product logs and matches all its names', () => {
    expect(KETCHUP.itemName).toBe('Heinz Tomato ketchup');
    expect(KETCHUP.names.map(({ key }) => key)).toEqual([
      'tomato ketchup',
      'heinz tomato ketchup',
      'ketchup',
    ]);
  });
});

describe('findSavedFoodByName', () => {
  const foods = [KETCHUP, MAYO, LIGHT_MAYO];

  it('finds a food by name, brand name or other name after normalization', () => {
    expect(findSavedFoodByName('TOMATO  KETCHUP!', foods)).toBe(KETCHUP);
    expect(findSavedFoodByName('Heinz tomato ketchup', foods)).toBe(KETCHUP);
    expect(findSavedFoodByName('catsup', foods)).toBe(KETCHUP);
    expect(findSavedFoodByName('Heinz mayo', foods)).toBe(MAYO);
  });

  it('finds a food whose name has brackets as the prompt lists it', () => {
    const patty = toSavedFood(row({ name: 'Burger (beef)', brand: null }));
    expect(findSavedFoodByName('Burger beef', [patty])).toBe(patty);
  });

  it('finds nothing for unknown, empty or missing names', () => {
    expect(findSavedFoodByName('Mustard', foods)).toBeNull();
    expect(findSavedFoodByName('', foods)).toBeNull();
    expect(findSavedFoodByName(null, foods)).toBeNull();
    expect(findSavedFoodByName('the', foods)).toBeNull();
  });

  it('prefers the first listed food when names collide', () => {
    const other = toSavedFood(row({ id: 'other', brand: null }));
    expect(findSavedFoodByName('Tomato ketchup', [other, KETCHUP])).toBe(other);
  });
});

describe('suggestSavedFood', () => {
  const foods = [KETCHUP, MAYO, LIGHT_MAYO];

  it('suggests the closest comparable food', () => {
    expect(suggestSavedFood('Ketchup packet', foods)).toBe(KETCHUP);
    expect(suggestSavedFood('Heinz tomato ketchup squeeze', foods)).toBe(
      KETCHUP,
    );
    expect(suggestSavedFood('Mayonnaise', foods)).toBe(MAYO);
  });

  it('never suggests a food with a conflicting qualifier or base food', () => {
    expect(suggestSavedFood('Garlic mayonnaise sauce', foods)).toBeNull();
    expect(suggestSavedFood('Mayonnaise, reduced fat', [MAYO])).toBeNull();
    expect(suggestSavedFood('Mustard', foods)).toBeNull();
    expect(suggestSavedFood('', foods)).toBeNull();
  });
});
