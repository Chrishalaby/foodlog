import {
  API_LIMITS,
  type Confidence,
  type EntryItemInput,
  isFiniteNumber,
  type MealIdea,
  type MealIdeaPart,
  type MealIdeasResponse,
  type Nutrients,
  roundNutrients,
  roundTo,
  sumNutrients,
} from '@food/shared';
import { cleanText, normalizeOutputPortion } from '../ai/normalize.js';
import { itemCount, scaledPortion } from '../common/portions.js';
import { estimateServing } from '../compare/menu-normalize.js';
import {
  DEFAULT_SERVINGS,
  isWithinItemLimits,
  scaleFavoriteItems,
} from '../favorites/favorite-servings.js';
import { foldText } from '../foods/food-text.js';
import type { ListedFood } from './meal-ideas-foods.js';
import type {
  MealIdeaOutput,
  MealIdeaPartOutput,
  MealIdeasOutput,
  NewFoodEstimate,
} from './meal-ideas.schema.js';

export type NormalizedMealIdeas = Omit<MealIdeasResponse, 'usage'>;

export const IDEA_TEXT_LIMITS = {
  title: API_LIMITS.nameMax,
  name: API_LIMITS.nameMax,
  reason: 200,
  summary: 240,
} as const;

export const NEW_FOOD_CONFIDENCE: Confidence = 'medium';
export const NO_IDEAS_SUMMARY =
  'No ideas came back this time. Ask again, or add what you feel like eating.';

const SERVINGS_DECIMALS = 2;
const GRAMS_DECIMALS = 1;
const TITLE_SEPARATOR = ' + ';

interface FoodIndex {
  byId: ReadonlyMap<string, ListedFood>;
  byName: ReadonlyMap<string, ListedFood>;
}

function indexFoods(foods: readonly ListedFood[]): FoodIndex {
  const byName = new Map<string, ListedFood>();
  for (const listed of foods) {
    const key = foldText(listed.food.name);
    if (key && !byName.has(key)) {
      byName.set(key, listed);
    }
  }
  return {
    byId: new Map(foods.map((listed) => [listed.id, listed])),
    byName,
  };
}

function resolveListed(
  part: MealIdeaPartOutput,
  index: FoodIndex,
): ListedFood | null {
  const byId = part.food_id
    ? index.byId.get(part.food_id.trim().toUpperCase())
    : undefined;
  if (byId) {
    return byId;
  }
  return part.estimate ? null : (index.byName.get(foldText(part.name)) ?? null);
}

export function ideaServings(value: number): number {
  if (!isFiniteNumber(value) || value <= 0) {
    return DEFAULT_SERVINGS;
  }
  const clamped = Math.min(
    Math.max(value, API_LIMITS.favoriteServingsMin),
    API_LIMITS.favoriteServingsMax,
  );
  return roundTo(clamped, SERVINGS_DECIMALS);
}

function tidyItem(item: EntryItemInput): EntryItemInput {
  return {
    ...item,
    grams: roundTo(item.grams, GRAMS_DECIMALS),
    nutrients: roundNutrients(item.nutrients),
  };
}

function partOf(
  name: string,
  items: EntryItemInput[],
  extras: Pick<MealIdeaPart, 'foodKey' | 'servings' | 'portion'>,
): MealIdeaPart {
  return {
    name,
    ...extras,
    grams: roundTo(
      items.reduce((sum, item) => sum + item.grams, 0),
      GRAMS_DECIMALS,
    ),
    nutrients: roundNutrients(sumNutrients(items.map((i) => i.nutrients))),
    items,
  };
}

function listedPart({ food }: ListedFood, wanted: number): MealIdeaPart {
  const scaled = scaleFavoriteItems(food.items, wanted);
  const fits = scaled.every(isWithinItemLimits);
  const servings = fits ? wanted : DEFAULT_SERVINGS;
  return partOf(food.name, (fits ? scaled : food.items).map(tidyItem), {
    foodKey: food.key,
    servings,
    portion: scaledPortion(food.portion, servings),
  });
}

function estimateNutrients(estimate: NewFoodEstimate): Nutrients {
  return {
    calories: estimate.calories,
    protein: estimate.protein_g,
    carbs: estimate.carbs_g,
    fat: estimate.fat_g,
    satFat: estimate.saturated_fat_g,
    fiber: estimate.fiber_g,
    sugar: estimate.sugar_g,
    sodium: estimate.sodium_mg,
    alcohol: 0,
  };
}

function newFoodPart(part: MealIdeaPartOutput): MealIdeaPart | null {
  const name = cleanText(part.name, IDEA_TEXT_LIMITS.name);
  if (!name || !part.estimate) {
    return null;
  }
  const serving = estimateServing(
    estimateNutrients(part.estimate),
    part.estimate.grams,
  );
  if (serving.grams <= 0 && serving.nutrients.calories <= 0) {
    return null;
  }
  const portion = normalizeOutputPortion(part.estimate.portion);
  const item: EntryItemInput = {
    name,
    grams: serving.grams,
    nutrients: serving.nutrients,
    confidence: NEW_FOOD_CONFIDENCE,
    ...itemCount(portion),
  };
  return partOf(name, [item], { foodKey: null, servings: null, portion });
}

function normalizePart(
  part: MealIdeaPartOutput,
  index: FoodIndex,
): MealIdeaPart | null {
  const listed = resolveListed(part, index);
  return listed
    ? listedPart(listed, ideaServings(part.servings))
    : newFoodPart(part);
}

function withinEntryLimits(parts: readonly MealIdeaPart[]): MealIdeaPart[] {
  const kept: MealIdeaPart[] = [];
  let items = 0;
  for (const part of parts) {
    if (
      kept.length >= API_LIMITS.mealIdeaPartsMax ||
      items + part.items.length > API_LIMITS.itemsMax
    ) {
      break;
    }
    kept.push(part);
    items += part.items.length;
  }
  return kept;
}

function ideaTitle(
  raw: MealIdeaOutput,
  parts: readonly MealIdeaPart[],
): string {
  return (
    cleanText(raw.title, IDEA_TEXT_LIMITS.title) ||
    cleanText(
      parts.map((part) => part.name).join(TITLE_SEPARATOR),
      IDEA_TEXT_LIMITS.title,
    )
  );
}

function normalizeIdea(raw: MealIdeaOutput, index: FoodIndex): MealIdea | null {
  const parts = withinEntryLimits(
    raw.parts.flatMap((part) => normalizePart(part, index) ?? []),
  );
  if (parts.length === 0) {
    return null;
  }
  return {
    title: ideaTitle(raw, parts),
    mealType: raw.meal_type,
    reason: cleanText(raw.reason, IDEA_TEXT_LIMITS.reason),
    parts,
    totals: roundNutrients(sumNutrients(parts.map((part) => part.nutrients))),
    grams: roundTo(
      parts.reduce((sum, part) => sum + part.grams, 0),
      GRAMS_DECIMALS,
    ),
  };
}

function uniqueByTitle(ideas: readonly MealIdea[]): MealIdea[] {
  const seen = new Set<string>();
  return ideas.filter((idea) => {
    const key = foldText(idea.title);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function normalizeMealIdeas(
  raw: MealIdeasOutput,
  foods: readonly ListedFood[],
  count: number = API_LIMITS.mealIdeasMax,
): NormalizedMealIdeas {
  const index = indexFoods(foods);
  const ideas = uniqueByTitle(
    raw.ideas.flatMap((idea) => normalizeIdea(idea, index) ?? []),
  ).slice(0, count);
  return {
    summary:
      ideas.length === 0
        ? NO_IDEAS_SUMMARY
        : cleanText(raw.summary, IDEA_TEXT_LIMITS.summary),
    ideas,
  };
}
