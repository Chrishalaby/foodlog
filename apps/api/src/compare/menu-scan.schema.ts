import { API_LIMITS, CONFIDENCE_LEVELS } from '@food/shared';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

export const MENU_SCAN_FORMAT_NAME = 'menu_scan';

const servingNutrients = z.object({
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

const menuDish = z.object({
  name: z.string().describe('Dish name as on the menu, max 8 words'),
  description: z
    .string()
    .nullable()
    .describe('Main components, max 15 words, or null'),
  portion_basis: z
    .string()
    .describe('Max 10 words: the serving the estimate assumes'),
  portion: z
    .object({
      count: z.number().describe('Units in one serving, usually 1'),
      unit: z
        .string()
        .describe('Singular noun, e.g. "burger", "wrap", "bowl", "plate"'),
      unit_plural: z.string().describe('Plural of unit, e.g. "burgers"'),
    })
    .nullable()
    .describe('One serving as countable units (1 burger, 6 wings), else null'),
  estimated_quantity_g: z
    .number()
    .describe('Edible grams of one serving as served'),
  per_serving: servingNutrients.describe(
    'Whole serving incl. cooking fat, sauces and listed sides',
  ),
  confidence: z.enum(CONFIDENCE_LEVELS),
  notes: z
    .string()
    .nullable()
    .describe('Max 15 words: changes applied or caveats, else null'),
});

export const MenuScanSchema = z.object({
  restaurant: z
    .string()
    .nullable()
    .describe('Restaurant name printed on the menu, else null'),
  dishes: z
    .array(menuDish)
    .describe(`At most ${API_LIMITS.menuDishesMax} orderable dishes`),
  warnings: z
    .array(z.string())
    .describe('At most 3 terse notes about the whole menu, or []'),
});

export type MenuScanOutput = z.infer<typeof MenuScanSchema>;
export type MenuScanDish = MenuScanOutput['dishes'][number];
export type MenuServingNutrients = MenuScanDish['per_serving'];

export const MENU_SCAN_TEXT_FORMAT = zodTextFormat(
  MenuScanSchema,
  MENU_SCAN_FORMAT_NAME,
);

export type MenuScanParseResult =
  { ok: true; data: MenuScanOutput } | { ok: false; error: string };

export function parseMenuScanJson(text: string): MenuScanParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Model output is not valid JSON' };
  }
  const result = MenuScanSchema.safeParse(json);
  return result.success
    ? { ok: true, data: result.data }
    : { ok: false, error: z.prettifyError(result.error) };
}
