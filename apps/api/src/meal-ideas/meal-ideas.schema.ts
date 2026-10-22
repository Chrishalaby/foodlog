import { API_LIMITS, MEAL_TYPES } from '@food/shared';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { countedPortion } from '../ai/food-analysis.schema.js';

export const MEAL_IDEAS_FORMAT_NAME = 'meal_ideas';

const newFoodEstimate = z.object({
  grams: z.number().describe('Edible grams of this food as eaten'),
  portion: countedPortion
    .nullable()
    .describe('The amount as countable units (2 eggs, 1 wrap), else null'),
  calories: z.number().describe('kcal of the whole amount'),
  protein_g: z.number(),
  carbs_g: z.number().describe('Total carbohydrate including fiber'),
  fat_g: z.number(),
  saturated_fat_g: z.number(),
  fiber_g: z.number(),
  sugar_g: z.number().describe('Total sugars'),
  sodium_mg: z.number(),
});

const ideaPart = z.object({
  food_id: z
    .string()
    .nullable()
    .describe('Id of a listed food, e.g. "F3"; null for a food not listed'),
  name: z
    .string()
    .describe('The listed name, or a plain name for a food not listed'),
  servings: z
    .number()
    .describe(
      'Listed food: multiple of its usual amount (1 = as listed). Otherwise 1',
    ),
  estimate: newFoodEstimate
    .nullable()
    .describe('Only for a food that is not listed; null for listed foods'),
});

const mealIdea = z.object({
  title: z.string().describe('Max 8 words: what the meal is'),
  meal_type: z.enum(MEAL_TYPES),
  parts: z
    .array(ideaPart)
    .describe(`1 to ${API_LIMITS.mealIdeaPartsMax} foods eaten together`),
  reason: z
    .string()
    .describe(
      'Max 20 words: why it fits now, without calorie or macro numbers',
    ),
});

export const MealIdeasSchema = z.object({
  summary: z
    .string()
    .describe('One sentence, max 25 words: what the rest of the day needs'),
  ideas: z.array(mealIdea).describe('The options asked for, best first'),
});

export type MealIdeasOutput = z.infer<typeof MealIdeasSchema>;
export type MealIdeaOutput = MealIdeasOutput['ideas'][number];
export type MealIdeaPartOutput = MealIdeaOutput['parts'][number];
export type NewFoodEstimate = NonNullable<MealIdeaPartOutput['estimate']>;

export const MEAL_IDEAS_TEXT_FORMAT = zodTextFormat(
  MealIdeasSchema,
  MEAL_IDEAS_FORMAT_NAME,
);

export type MealIdeasParseResult =
  { ok: true; data: MealIdeasOutput } | { ok: false; error: string };

export function parseMealIdeasJson(text: string): MealIdeasParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Model output is not valid JSON' };
  }
  const result = MealIdeasSchema.safeParse(json);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}
