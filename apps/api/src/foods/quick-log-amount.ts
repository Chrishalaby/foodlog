import {
  type EntryItemInput,
  type Portion,
  portionFactor,
  scaleNutrients,
} from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import { scaledItemExtras } from '../common/micros.js';
import { scaledPortion, withScaledCount } from '../common/portions.js';
import {
  DEFAULT_SERVINGS,
  isWithinItemLimits,
  scaleFavoriteItems,
} from '../favorites/favorite-servings.js';

export interface QuickLogAmount {
  servings?: number | null;
  grams?: number | null;
  portionCount?: number | null;
}

export interface LibraryFood {
  items: EntryItemInput[];
  portion: Portion | null;
}

const PORTION_COUNT_CONFLICT_MESSAGE =
  'portionCount cannot be combined with servings or grams';
export const NO_PORTION_MESSAGE =
  'portionCount needs a food logged as a count (e.g. 2 burgers); use servings or grams instead';

export function isSet(value: number | null | undefined): value is number {
  return value !== undefined && value !== null;
}

export function assertSingleAmount(amount: QuickLogAmount): void {
  if (
    isSet(amount.portionCount) &&
    (isSet(amount.servings) || isSet(amount.grams))
  ) {
    throw new BadRequestException(PORTION_COUNT_CONFLICT_MESSAGE);
  }
}

export function portionCountFactor(
  portion: Portion | null,
  portionCount: number,
): number {
  const factor = portion ? portionFactor(portion, portionCount) : 0;
  if (!(factor > 0)) {
    throw new BadRequestException(NO_PORTION_MESSAGE);
  }
  return factor;
}

export function singleWeighedItem(
  items: readonly EntryItemInput[],
): EntryItemInput {
  const [item, ...others] = items;
  if (item === undefined || others.length > 0) {
    throw new BadRequestException(
      'grams can only be set for a single food; use servings for meals with several items',
    );
  }
  if (!(item.grams > 0)) {
    throw new BadRequestException(
      'grams cannot be set because this food has no recorded weight; use servings instead',
    );
  }
  return item;
}

export function scaleItemToGrams(
  item: EntryItemInput,
  grams: number,
): EntryItemInput {
  const factor = grams / item.grams;
  return {
    ...withScaledCount(item, factor),
    grams,
    nutrients: scaleNutrients(item.nutrients, factor),
    ...scaledItemExtras(item, factor),
  };
}

function requireWithinItemLimits(items: EntryItemInput[]): EntryItemInput[] {
  if (!items.every(isWithinItemLimits)) {
    throw new BadRequestException(
      'The amount is too large: a scaled item would exceed the item limits',
    );
  }
  return items;
}

export function servingsForGrams(
  items: readonly EntryItemInput[],
  grams: number,
): number {
  const item = singleWeighedItem(items);
  requireWithinItemLimits([scaleItemToGrams(item, grams)]);
  const servings = grams / item.grams;
  return item.grams * servings > grams
    ? servings * (1 - Number.EPSILON)
    : servings;
}

export function scaleLibraryItems(
  items: readonly EntryItemInput[],
  amount: QuickLogAmount,
): EntryItemInput[] {
  return requireWithinItemLimits(
    isSet(amount.grams)
      ? [scaleItemToGrams(singleWeighedItem(items), amount.grams)]
      : scaleFavoriteItems(items, amount.servings ?? DEFAULT_SERVINGS),
  );
}

function libraryFactor(food: LibraryFood, amount: QuickLogAmount): number {
  if (isSet(amount.portionCount)) {
    return portionCountFactor(food.portion, amount.portionCount);
  }
  if (isSet(amount.grams)) {
    return amount.grams / singleWeighedItem(food.items).grams;
  }
  return amount.servings ?? DEFAULT_SERVINGS;
}

export function scaleLibraryFood(
  food: LibraryFood,
  amount: QuickLogAmount,
): LibraryFood {
  assertSingleAmount(amount);
  const factor = libraryFactor(food, amount);
  return {
    items: scaleLibraryItems(
      food.items,
      isSet(amount.grams) ? { grams: amount.grams } : { servings: factor },
    ),
    portion: scaledPortion(food.portion, factor),
  };
}
