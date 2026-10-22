import {
  type CatalogFoodDto,
  isCatalogGroup,
  sanitizeMicrosPer100,
} from '@food/shared';
import type { CatalogFood } from '../generated/prisma/client.js';
import { parseCatalogPortions, parseMissing } from './catalog-file.js';

export type CatalogFoodRow = Pick<
  CatalogFood,
  | 'id'
  | 'source'
  | 'name'
  | 'category'
  | 'group'
  | 'calories'
  | 'protein'
  | 'carbs'
  | 'fat'
  | 'satFat'
  | 'fiber'
  | 'sugar'
  | 'sodium'
  | 'alcohol'
  | 'missing'
  | 'microsPer100'
  | 'portions'
>;

export function toCatalogFoodDto(row: CatalogFoodRow): CatalogFoodDto {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    group: isCatalogGroup(row.group) ? row.group : 'other',
    source: row.source,
    per100: {
      calories: row.calories,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
      satFat: row.satFat,
      fiber: row.fiber,
      sugar: row.sugar,
      sodium: row.sodium,
      alcohol: row.alcohol,
    },
    missing: parseMissing(row.missing),
    microsPer100: sanitizeMicrosPer100(row.microsPer100),
    portions: parseCatalogPortions(row.portions),
  };
}
