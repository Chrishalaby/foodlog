import {
  API_LIMITS,
  CATALOG_DEFAULT_GRAMS,
  CATALOG_GROUP_LABELS,
  CATALOG_SOURCE_LABELS,
  PORTION_COUNT_MAX,
  PORTION_UNIT_MAX,
  catalogItemName,
  catalogMicros,
  catalogNutrients,
  clampCatalogGrams,
  formatCount,
  pluralizeUnit,
  roundTo,
  type CatalogFoodDto,
  type CatalogPortion,
  type EntryItemInput,
  type Nutrients,
  type Portion,
} from '@food/shared';
import { formatNutrientValue } from './format';

export const CATALOG_QUANTITY_STEPS = [0.5, 1, 1.5, 2, 3] as const;
export const CATALOG_QUANTITY_MIN = 0.25;
export const CATALOG_QUANTITY_MAX = 20;

export interface CatalogAmount {
  portion: CatalogPortion | null;
  quantity: number;
  grams: number;
}

const COUNTED_LABEL = /^(\d+(?:\.\d+)?)\s+([a-z][a-z -]*[a-z])$/i;

export function gramsAmount(grams: number): CatalogAmount {
  return { portion: null, quantity: 1, grams: clampCatalogGrams(grams) };
}

export function portionAmount(portion: CatalogPortion, quantity = 1): CatalogAmount {
  const safe = clampQuantity(quantity);
  return { portion, quantity: safe, grams: clampCatalogGrams(portion.grams * safe) };
}

export function defaultCatalogAmount(food: Pick<CatalogFoodDto, 'portions'>): CatalogAmount {
  const first = food.portions[0];
  return first ? portionAmount(first) : gramsAmount(CATALOG_DEFAULT_GRAMS);
}

export function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return 1;
  }
  return roundTo(Math.min(Math.max(quantity, CATALOG_QUANTITY_MIN), CATALOG_QUANTITY_MAX), 2);
}

export function singularUnit(unit: string): string {
  if (/([b-df-hj-np-tv-z])\1ies$/.test(unit)) {
    return `${unit.slice(0, -3)}y`;
  }
  if (/ies$/.test(unit)) {
    return unit.slice(0, -1);
  }
  if (/((ch|sh|x|ss)es|oes)$/.test(unit)) {
    return unit.slice(0, -2);
  }
  if (/[^s]s$/.test(unit)) {
    return unit.slice(0, -1);
  }
  return unit;
}

export function countedPortion(label: string, quantity = 1): Portion | null {
  const match = COUNTED_LABEL.exec(label.trim());
  if (!match) {
    return null;
  }
  const perPortion = Number(match[1]);
  const word = (match[2] ?? '').toLowerCase();
  const unit = singularUnit(word);
  const count = roundTo(perPortion * clampQuantity(quantity), 2);
  const unitPlural = word !== unit ? word : pluralizeUnit(unit);
  if (
    !(count > 0) ||
    count > PORTION_COUNT_MAX ||
    unit.length > PORTION_UNIT_MAX ||
    unitPlural.length > PORTION_UNIT_MAX ||
    /^(oz|g|lb|ml|fl oz|serving)$/.test(unit)
  ) {
    return null;
  }
  return { count, unit, unitPlural };
}

export function amountLabel(amount: CatalogAmount): string {
  if (!amount.portion) {
    return `${formatNutrientValue('protein', amount.grams)} g`;
  }
  const times = amount.quantity === 1 ? '' : `${formatCount(amount.quantity)} × `;
  return `${times}${amount.portion.label} (${formatNutrientValue('protein', amount.grams)} g)`;
}

export function catalogAmountNutrients(food: Pick<CatalogFoodDto, 'per100'>, amount: CatalogAmount): Nutrients {
  return catalogNutrients(food.per100, amount.grams);
}

export function catalogEntryItem(food: CatalogFoodDto, amount: CatalogAmount): EntryItemInput {
  const counted = amount.portion ? countedPortion(amount.portion.label, amount.quantity) : null;
  return {
    name: catalogItemName(food.name, API_LIMITS.nameMax),
    grams: amount.grams,
    nutrients: catalogNutrients(food.per100, amount.grams),
    confidence: 'high',
    count: counted?.count ?? null,
    unit: counted?.unit ?? null,
    unitPlural: counted?.unitPlural ?? null,
    productId: null,
    micros: catalogMicros(food.microsPer100, amount.grams),
    fluidMl: null,
  };
}

export function catalogSubtitle(food: Pick<CatalogFoodDto, 'group' | 'per100'>): string {
  return `${CATALOG_GROUP_LABELS[food.group]} · ${formatNutrientValue('calories', food.per100.calories)} kcal per 100 g`;
}

export function catalogSourceLabel(food: Pick<CatalogFoodDto, 'source' | 'id'>): string {
  return `${CATALOG_SOURCE_LABELS[food.source]} #${food.id}`;
}

export function catalogFoodUrl(food: Pick<CatalogFoodDto, 'id'>): string {
  return `https://fdc.nal.usda.gov/food-details/${food.id}/nutrients`;
}
