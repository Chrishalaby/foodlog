import { MEAL_TYPES } from '@food/shared';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';
import { FoodAnalysisSchema } from './food-analysis.schema.js';

export const MEAL_SPLIT_FORMAT_NAME = 'meal_split';

const splitMeal = z.object({
  description: z
    .string()
    .describe("The user's own words for this meal, copied verbatim"),
  meal_type: z
    .enum(MEAL_TYPES)
    .nullable()
    .describe('As the user called it or a stated time implies, else null'),
  eaten_at: z
    .string()
    .nullable()
    .describe('24-hour HH:MM when a clock time is stated, else null'),
  days_ago: z.number().describe('0 = the day being logged, 1 = the day before'),
  ...FoodAnalysisSchema.shape,
});

export const MealSplitSchema = z.object({
  meals: z
    .array(splitMeal)
    .describe('One element per eating occasion, in the order eaten'),
});

export type MealSplitOutput = z.infer<typeof MealSplitSchema>;
export type MealSplitMeal = MealSplitOutput['meals'][number];

export const MEAL_SPLIT_TEXT_FORMAT = zodTextFormat(
  MealSplitSchema,
  MEAL_SPLIT_FORMAT_NAME,
);

export type MealSplitParseResult =
  { ok: true; data: MealSplitOutput } | { ok: false; error: string };

export function parseMealSplitJson(text: string): MealSplitParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Model output is not valid JSON' };
  }
  const result = MealSplitSchema.safeParse(json);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}
