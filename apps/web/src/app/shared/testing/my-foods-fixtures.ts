import {
  zeroNutrients,
  type FoodMergeSuggestion,
  type FoodMergeVariant,
  type MyFoodDto,
  type Nutrients,
} from '@food/shared';

export function per100(values: Partial<Nutrients>): Nutrients {
  return { ...zeroNutrients(), ...values };
}

export function myFood(overrides: Partial<MyFoodDto> = {}): MyFoodDto {
  return {
    id: 'food-ketchup',
    barcode: null,
    name: 'Heinz tomato ketchup',
    brand: null,
    aliases: ['Tomato ketchup'],
    unitName: 'tbsp',
    unitGrams: 15,
    basisUnit: 'g',
    per100: per100({ calories: 110, carbs: 25.8, sugar: 22.8, protein: 1.2, sodium: 900 }),
    microsPer100: null,
    servingSizeG: null,
    packSizeG: null,
    source: 'manual',
    imageUrl: null,
    missingNutrients: [],
    useCount: 3,
    lastUsedAt: '2026-09-29T19:00:00.000Z',
    itemCount: 3,
    ...overrides,
  };
}

export const MAYO = myFood({
  id: 'food-mayo',
  name: 'Heinz mayonnaise, regular',
  aliases: ['Mayonnaise, regular'],
  unitName: null,
  unitGrams: null,
  per100: per100({ calories: 680, fat: 75, satFat: 6, carbs: 1.5, protein: 1 }),
  useCount: 2,
  itemCount: 2,
});

export const YOGURT = myFood({
  id: 'food-yogurt',
  barcode: '5281234567896',
  name: 'Khoury strawberry Greek yogurt, low fat',
  brand: 'Khoury',
  aliases: [],
  unitName: null,
  unitGrams: null,
  per100: per100({ calories: 88, protein: 7, carbs: 11, sugar: 10, fat: 1.5 }),
  source: 'label',
  useCount: 3,
  itemCount: 3,
});

export function mergeVariant(overrides: Partial<FoodMergeVariant> = {}): FoodMergeVariant {
  return {
    name: 'Heinz tomato ketchup',
    productId: null,
    timesLogged: 2,
    typicalGrams: 26,
    lastUsedAt: '2026-09-29T19:00:00.000Z',
    basisUnit: 'g',
    per100: per100({ calories: 118, carbs: 27 }),
    microsPer100: null,
    kcalPer100Min: 103,
    kcalPer100Max: 118,
    valueSource: 'estimate',
    recommended: true,
    ...overrides,
  };
}

export function ketchupSuggestion(
  overrides: Partial<FoodMergeSuggestion> = {},
): FoodMergeSuggestion {
  return {
    key: 'tomato ketchup',
    label: 'Tomato ketchup',
    variants: [
      mergeVariant(),
      mergeVariant({
        name: 'Tomato ketchup',
        timesLogged: 1,
        typicalGrams: 30,
        lastUsedAt: '2026-09-28T19:00:00.000Z',
        per100: per100({ calories: 110, carbs: 25 }),
        kcalPer100Min: 110,
        kcalPer100Max: 110,
        recommended: false,
      }),
    ],
    itemCount: 3,
    entryCount: 2,
    kcalPer100Min: 103,
    kcalPer100Max: 118,
    ...overrides,
  };
}

export function mayoSuggestion(): FoodMergeSuggestion {
  return {
    key: 'mayo',
    label: 'Mayonnaise, regular',
    variants: [
      mergeVariant({
        name: 'Heinz mayonnaise, regular',
        per100: per100({ calories: 680, fat: 75 }),
        kcalPer100Min: 673,
        kcalPer100Max: 680,
      }),
      mergeVariant({
        name: 'Mayonnaise, regular',
        timesLogged: 1,
        per100: per100({ calories: 685, fat: 76 }),
        kcalPer100Min: 685,
        kcalPer100Max: 685,
        recommended: false,
      }),
    ],
    itemCount: 3,
    entryCount: 2,
    kcalPer100Min: 673,
    kcalPer100Max: 685,
  };
}

export function bunSuggestion(): FoodMergeSuggestion {
  return {
    key: 'sofisoft potato bun',
    label: 'Sofisoft potato bun',
    variants: [
      mergeVariant({
        name: 'Sofisoft potato bun',
        productId: 'food-bun',
        timesLogged: 0,
        typicalGrams: 70,
        per100: per100({ calories: 290, carbs: 50 }),
        kcalPer100Min: 290,
        kcalPer100Max: 290,
        valueSource: 'saved',
      }),
      mergeVariant({
        name: 'Sofisoft potato bun',
        timesLogged: 2,
        typicalGrams: 70,
        lastUsedAt: '2026-10-01T19:00:00.000Z',
        per100: per100({ calories: 320, carbs: 56 }),
        kcalPer100Min: 320,
        kcalPer100Max: 320,
        recommended: false,
      }),
    ],
    itemCount: 2,
    entryCount: 2,
    kcalPer100Min: 290,
    kcalPer100Max: 320,
  };
}
