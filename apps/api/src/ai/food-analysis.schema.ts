import {
  AMOUNT_SOURCES,
  ANALYSIS_MODES,
  CONFIDENCE_LEVELS,
  FOOD_STATES,
} from '@food/shared';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

export const FOOD_ANALYSIS_FORMAT_NAME = 'food_analysis';

const nutrientValues = z.object({
  calories: z.number().describe('kcal'),
  protein_g: z.number(),
  carbs_g: z.number().describe('Total carbohydrate including fiber'),
  fat_g: z.number(),
  saturated_fat_g: z.number(),
  fiber_g: z.number(),
  sugar_g: z.number().describe('Total sugars'),
  sodium_mg: z.number(),
  alcohol_g: z.number(),
});

const microValue = z.number().nullable();

const microValues = z.object({
  vitamin_a_ug_rae: microValue,
  vitamin_c_mg: microValue,
  vitamin_d_ug: microValue,
  vitamin_e_mg: microValue,
  vitamin_k_ug: microValue,
  vitamin_b6_mg: microValue,
  vitamin_b12_ug: microValue,
  folate_ug_dfe: microValue,
  calcium_mg: microValue,
  iron_mg: microValue,
  magnesium_mg: microValue,
  potassium_mg: microValue,
  zinc_mg: microValue,
  cholesterol_mg: microValue,
  caffeine_mg: microValue,
});

export const countedPortion = z.object({
  count: z
    .number()
    .describe('How many units, e.g. 2 or 1.5; from the description first'),
  unit: z.string().describe('Singular unit noun, e.g. "burger", "slice"'),
  unit_plural: z.string().describe('Plural of unit, e.g. "burgers"'),
});

const foodItem = z.object({
  name: z
    .string()
    .describe(
      'Specific food incl. preparation, e.g. "Chicken breast, grilled"',
    ),
  saved_food: z
    .string()
    .nullable()
    .describe('Exact listed saved food name when this item is it, else null'),
  amount_source: z.enum(AMOUNT_SOURCES),
  count: z
    .number()
    .nullable()
    .describe('Countable pieces this item is (2 eggs = 2), else null'),
  unit: z
    .string()
    .nullable()
    .describe('Singular piece noun ("egg", "slice"), else null'),
  unit_plural: z
    .string()
    .nullable()
    .describe('Plural of unit ("eggs", "slices"), else null'),
  portion_basis: z
    .string()
    .describe('Max 12 words: how the grams were derived'),
  state: z.enum(FOOD_STATES),
  estimated_quantity_g: z
    .number()
    .describe('Edible grams eaten, in the stated state (ml for drinks)'),
  fluid_ml: z
    .number()
    .nullable()
    .describe('ml of drinkable liquid for drinks, null for foods'),
  per_100g: nutrientValues.describe(
    'Per 100 g of this item in its stated state',
  ),
  micros_per_100g: microValues.describe(
    'Per 100 g in the stated state; null = unknown',
  ),
  confidence: z.enum(CONFIDENCE_LEVELS),
});

const nutritionLabel = z.object({
  product_name: z.string().nullable(),
  basis_unit: z.enum(['g', 'ml']),
  per_100: nutrientValues.describe('Per 100 g or 100 ml as printed'),
  micros_per_100: microValues.describe(
    'Printed vitamins/minerals per 100 g or 100 ml; null if not printed',
  ),
  serving_size: z.number().nullable().describe('In basis_unit'),
  serving_text: z
    .string()
    .nullable()
    .describe('Serving size exactly as printed'),
  pack_size: z.number().nullable().describe('Net contents in basis_unit'),
});

export const FoodAnalysisSchema = z.object({
  input_type: z.enum(ANALYSIS_MODES),
  meal_name: z.string().describe('Short title, max 6 words'),
  portion: countedPortion
    .nullable()
    .describe('Whole meal as N countable units (2 burgers), else null'),
  scale_cues: z
    .string()
    .describe('Objects used to judge size; "none" for text'),
  items: z.array(foodItem),
  label: nutritionLabel
    .nullable()
    .describe('Values of a visible nutrition label, else null'),
  assumptions: z.array(z.string()).describe('At most 6 terse assumptions'),
  follow_up_question: z.string().nullable(),
  follow_up_options: z.array(z.string()).describe('2-4 short answers, or []'),
});

export type FoodAnalysisOutput = z.infer<typeof FoodAnalysisSchema>;
export type FoodAnalysisItem = FoodAnalysisOutput['items'][number];
export type FoodAnalysisLabel = NonNullable<FoodAnalysisOutput['label']>;
export type FoodNutrientValues = FoodAnalysisItem['per_100g'];
export type FoodMicroValues = FoodAnalysisItem['micros_per_100g'];
export type FoodAnalysisPortion = NonNullable<FoodAnalysisOutput['portion']>;

export const FOOD_ANALYSIS_TEXT_FORMAT = zodTextFormat(
  FoodAnalysisSchema,
  FOOD_ANALYSIS_FORMAT_NAME,
);

export type FoodAnalysisParseResult =
  { ok: true; data: FoodAnalysisOutput } | { ok: false; error: string };

export function parseFoodAnalysisJson(text: string): FoodAnalysisParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Model output is not valid JSON' };
  }
  const result = FoodAnalysisSchema.safeParse(json);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}
