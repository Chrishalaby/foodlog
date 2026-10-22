import {
  areComparableFoodNames,
  type FoodName,
  headToken,
  toFoodName,
} from '../../my-foods/food-names.js';
import type { FoodAnalysisItem } from '../food-analysis.schema.js';
import type { SavedFoodPrompt } from '../prompt.js';
import { GENERIC_DISH, GENERIC_DISH_MICROS } from './mock-foods.js';

export const MOCK_SEGMENT_SEPARATOR = /,|;|\+|&|\n|\band\b|\bwith\b/i;
export const MOCK_SAVED_FOOD_GRAMS = 20;

const DIGIT = /\p{N}/u;
const QUANTITY_WORDS: ReadonlySet<string> = new Set([
  'g',
  'gr',
  'gram',
  'kg',
  'ml',
  'l',
  'tbsp',
  'tsp',
  'tablespoon',
  'teaspoon',
  'cup',
  'slice',
  'piece',
  'serving',
  'half',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
]);

function foodNames(food: SavedFoodPrompt): FoodName[] {
  return [food.name, ...food.aliases]
    .map(toFoodName)
    .filter((name) => name.tokens.size > 0);
}

function segmentName(segment: string): FoodName {
  const tokens = [...toFoodName(segment).tokens].filter(
    (token) => !DIGIT.test(token) && !QUANTITY_WORDS.has(token),
  );
  const key = tokens.join(' ');
  return { key, tokens: new Set(tokens), head: headToken(key, tokens) };
}

function isNamed(name: FoodName, food: SavedFoodPrompt): boolean {
  return (
    name.tokens.size > 0 &&
    foodNames(food).some((saved) => areComparableFoodNames(name, saved))
  );
}

function savedFoodItem(food: SavedFoodPrompt, grams: number): FoodAnalysisItem {
  return {
    name: food.name,
    saved_food: food.name,
    amount_source: 'typical_serving',
    count: null,
    unit: null,
    unit_plural: null,
    portion_basis: 'Typical serving',
    state: 'as_served',
    estimated_quantity_g: grams,
    fluid_ml: null,
    per_100g: { ...GENERIC_DISH },
    micros_per_100g: { ...GENERIC_DISH_MICROS },
    confidence: 'medium',
  };
}

function linkSegment(
  items: readonly FoodAnalysisItem[],
  food: SavedFoodPrompt,
  grams: number,
): FoodAnalysisItem[] {
  const index = items.findIndex(
    (item) => item.saved_food === null && isNamed(toFoodName(item.name), food),
  );
  if (index >= 0) {
    return items.map((item, position) =>
      position === index ? { ...item, saved_food: food.name } : item,
    );
  }
  return items.some((item) => item.saved_food === food.name)
    ? [...items]
    : [...items, savedFoodItem(food, grams)];
}

export function linkMockSavedFoods(
  items: readonly FoodAnalysisItem[],
  description: string,
  foods: readonly SavedFoodPrompt[],
  gramsFor: (segment: string) => number,
): FoodAnalysisItem[] {
  let linked = [...items];
  for (const segment of description.split(MOCK_SEGMENT_SEPARATOR)) {
    const name = segmentName(segment);
    const food = foods.find((candidate) => isNamed(name, candidate));
    if (food) {
      linked = linkSegment(linked, food, gramsFor(segment));
    }
  }
  return linked;
}
