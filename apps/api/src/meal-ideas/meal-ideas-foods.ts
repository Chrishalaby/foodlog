import { type FoodSearchResult, formatPortion, roundTo } from '@food/shared';
import { cleanText } from '../ai/normalize.js';
import type { IdeaFood } from './meal-ideas-prompt.js';

export const IDEA_FOODS_MAX = 40;
export const IDEA_FOOD_CONTENTS_MAX = 4;
export const IDEA_FOOD_CONTENT_NAME_MAX = 40;

export interface ListedFood {
  id: string;
  food: FoodSearchResult;
}

export function foodId(index: number): string {
  return `F${index + 1}`;
}

export function listFoods(results: readonly FoodSearchResult[]): ListedFood[] {
  return results
    .slice(0, IDEA_FOODS_MAX)
    .map((food, index) => ({ id: foodId(index), food }));
}

export function usualAmount(
  food: Pick<FoodSearchResult, 'portion' | 'grams'>,
): string {
  const grams = food.grams > 0 ? `${roundTo(food.grams, 0)} g` : null;
  if (food.portion) {
    const portion = formatPortion(food.portion);
    return grams ? `${portion} (${grams})` : portion;
  }
  return grams ?? '1 serving';
}

function contents(food: FoodSearchResult): string[] {
  if (food.items.length < 2) {
    return [];
  }
  return food.items
    .slice(0, IDEA_FOOD_CONTENTS_MAX)
    .map((item) => cleanText(item.name, IDEA_FOOD_CONTENT_NAME_MAX))
    .filter(Boolean);
}

export function toIdeaFood({ id, food }: ListedFood): IdeaFood {
  return {
    id,
    name: food.name,
    amount: usualAmount(food),
    contains: contents(food),
    nutrients: food.totals,
    useCount: food.useCount,
    mealType: food.mealType,
  };
}
