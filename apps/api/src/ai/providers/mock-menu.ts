import type {
  MenuScanDish,
  MenuScanOutput,
  MenuServingNutrients,
} from '../../compare/menu-scan.schema.js';
import { MOCK_NOTICE } from './mock-analysis.js';

export const MOCK_RESTAURANT = 'Mock Bistro';

function serving(
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  satFat: number,
  fiber: number,
  sugar: number,
  sodium: number,
): MenuServingNutrients {
  return {
    calories,
    protein_g: protein,
    carbs_g: carbs,
    fat_g: fat,
    saturated_fat_g: satFat,
    fiber_g: fiber,
    sugar_g: sugar,
    sodium_mg: sodium,
    alcohol_g: 0,
  };
}

export const MOCK_MENU_DISHES: readonly MenuScanDish[] = [
  {
    name: 'Grilled chicken plate',
    description: 'Chicken breast, rice, grilled vegetables, garlic sauce',
    portion_basis: 'Plate with ~180 g chicken and rice',
    portion: { count: 1, unit: 'plate', unit_plural: 'plates' },
    estimated_quantity_g: 450,
    per_serving: serving(570, 52, 58, 16, 4, 7, 6, 980),
    confidence: 'medium',
    notes: null,
  },
  {
    name: 'Falafel wrap',
    description: 'Falafel, tahini, pickles, tomato, parsley in flatbread',
    portion_basis: 'Wrap with ~5 falafel',
    portion: { count: 1, unit: 'wrap', unit_plural: 'wraps' },
    estimated_quantity_g: 320,
    per_serving: serving(638, 20, 78, 30, 4.5, 12, 7, 1350),
    confidence: 'medium',
    notes: null,
  },
  {
    name: 'Chicken caesar salad',
    description:
      'Romaine, grilled chicken, parmesan, croutons, caesar dressing',
    portion_basis: 'Large bowl with dressing mixed in',
    portion: { count: 1, unit: 'bowl', unit_plural: 'bowls' },
    estimated_quantity_g: 380,
    per_serving: serving(538, 38, 22, 34, 8, 4, 4, 1150),
    confidence: 'medium',
    notes: 'Dressing adds ~200 kcal',
  },
  {
    name: 'Beef burger',
    description:
      'Beef patty, cheddar, lettuce, tomato, burger sauce, brioche bun',
    portion_basis: 'Burger with ~150 g patty',
    portion: { count: 1, unit: 'burger', unit_plural: 'burgers' },
    estimated_quantity_g: 300,
    per_serving: serving(750, 42, 48, 44, 17, 3, 9, 1250),
    confidence: 'medium',
    notes: 'Fries not included',
  },
];

export function mockMenuScan(): MenuScanOutput {
  return {
    restaurant: MOCK_RESTAURANT,
    dishes: MOCK_MENU_DISHES.map((dish) => ({
      ...dish,
      portion: dish.portion ? { ...dish.portion } : null,
      per_serving: { ...dish.per_serving },
    })),
    warnings: [MOCK_NOTICE],
  };
}
