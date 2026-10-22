import type { CatalogFoodDto } from '@food/shared';

export const HUMMUS_FOOD: CatalogFoodDto = {
  id: 2705367,
  name: 'Hummus, plain',
  category: 'Dips, gravies, other sauces',
  group: 'sauces_soups',
  source: 'survey',
  per100: {
    calories: 243,
    protein: 7.35,
    carbs: 14.9,
    fat: 17.1,
    satFat: 2.22,
    fiber: 5.4,
    sugar: 0.34,
    sodium: 438,
    alcohol: 0,
  },
  missing: [],
  microsPer100: { calcium: 38, iron: 2.4 },
  portions: [
    { label: '1 serving', grams: 60 },
    { label: '1 tablespoon', grams: 15 },
  ],
};

export const FALAFEL_FOOD: CatalogFoodDto = {
  id: 172447,
  name: 'Falafel, home-prepared',
  category: 'Legumes and Legume Products',
  group: 'legumes_nuts',
  source: 'sr_legacy',
  per100: {
    calories: 333,
    protein: 13.3,
    carbs: 31.8,
    fat: 17.8,
    satFat: 2.38,
    fiber: 0,
    sugar: 0,
    sodium: 294,
    alcohol: 0,
  },
  missing: ['fiber', 'sugar'],
  microsPer100: null,
  portions: [{ label: '1 patty (approx 2-1/4" dia)', grams: 17 }],
};

export const OLIVE_OIL_FOOD: CatalogFoodDto = {
  id: 2710211,
  name: 'Olive oil',
  category: 'Salad dressings and vegetable oils',
  group: 'fats_oils',
  source: 'survey',
  per100: {
    calories: 900,
    protein: 0,
    carbs: 0,
    fat: 100,
    satFat: 13.8,
    fiber: 0,
    sugar: 0,
    sodium: 2,
    alcohol: 0,
  },
  missing: [],
  microsPer100: { vitaminE: 14.4, vitaminK: 60.2 },
  portions: [],
};
