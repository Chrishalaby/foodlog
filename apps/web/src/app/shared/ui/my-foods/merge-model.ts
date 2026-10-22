import {
  API_LIMITS,
  roundNutrients,
  sanitizeNutrients,
  type FoodMergeSuggestion,
  type FoodMergeVariant,
  type MergeFoodsRequest,
  type MyFoodChangeResponse,
} from '@food/shared';
import { cleanMicrosPer100 } from '../../utils/micros';
import { kcalRangeText, pastItemsText } from '../../utils/saved-foods';

export interface MergeDraft {
  included: ReadonlySet<number>;
  valuesFrom: number;
  name: string;
  applyToPast: boolean;
}

export function recommendedVariant(suggestion: FoodMergeSuggestion): FoodMergeVariant | null {
  return (
    suggestion.variants.find((variant) => variant.recommended) ?? suggestion.variants[0] ?? null
  );
}

export function initialMergeDraft(suggestion: FoodMergeSuggestion): MergeDraft {
  const recommended = recommendedVariant(suggestion);
  return {
    included: new Set(suggestion.variants.map((_, index) => index)),
    valuesFrom: recommended ? suggestion.variants.indexOf(recommended) : -1,
    name: recommended?.name ?? suggestion.label,
    applyToPast: true,
  };
}

export function includedVariants(
  suggestion: FoodMergeSuggestion,
  draft: Pick<MergeDraft, 'included'>,
): FoodMergeVariant[] {
  return suggestion.variants.filter((_, index) => draft.included.has(index));
}

function sameFoodName(a: string, b: string): boolean {
  const clean = (value: string): string => value.replace(/\s+/g, ' ').trim().toLowerCase();
  return clean(a) === clean(b);
}

function distinctNames(names: readonly string[]): string[] {
  return names.filter(
    (name, index) => names.findIndex((other) => sameFoodName(other, name)) === index,
  );
}

function isIncludedName(included: readonly FoodMergeVariant[], name: string): boolean {
  return included.some((variant) => sameFoodName(variant.name, name));
}

export function keptApartNames(
  suggestion: FoodMergeSuggestion,
  draft: Pick<MergeDraft, 'included'>,
): string[] {
  const included = includedVariants(suggestion, draft);
  return distinctNames(
    suggestion.variants
      .filter((_, index) => !draft.included.has(index))
      .map((variant) => variant.name)
      .filter((name) => !isIncludedName(included, name)),
  );
}

export function nameIsKeptApart(
  suggestion: FoodMergeSuggestion,
  draft: Pick<MergeDraft, 'included' | 'name'>,
): boolean {
  return keptApartNames(suggestion, draft).some((name) => sameFoodName(name, draft.name));
}

export function withVariantIncluded(
  suggestion: FoodMergeSuggestion,
  draft: MergeDraft,
  variantIndex: number,
  include: boolean,
): MergeDraft {
  const included = new Set(draft.included);
  if (include) {
    included.add(variantIndex);
  } else {
    included.delete(variantIndex);
  }
  const next = { ...draft, included };
  if (!nameIsKeptApart(suggestion, next)) {
    return next;
  }
  const values = valuesVariant(suggestion, next);
  return values ? { ...next, name: values.name } : next;
}

export function valuesVariant(
  suggestion: FoodMergeSuggestion,
  draft: Pick<MergeDraft, 'included' | 'valuesFrom'>,
): FoodMergeVariant | null {
  const chosen = draft.included.has(draft.valuesFrom)
    ? suggestion.variants[draft.valuesFrom]
    : undefined;
  const included = includedVariants(suggestion, draft);
  return chosen ?? included.find((variant) => variant.recommended) ?? included[0] ?? null;
}

export function mergePastItems(
  suggestion: FoodMergeSuggestion,
  draft: Pick<MergeDraft, 'included'>,
): number {
  const included = includedVariants(suggestion, draft);
  return suggestion.variants
    .filter((variant) => isIncludedName(included, variant.name))
    .reduce((sum, variant) => sum + Math.max(0, variant.timesLogged), 0);
}

export function mergeWays(suggestion: FoodMergeSuggestion): number {
  return suggestion.variants.reduce((sum, variant) => {
    if (variant.timesLogged <= 0) {
      return sum;
    }
    const spread = variant.kcalPer100Max - variant.kcalPer100Min >= 0.5 ? 2 : 1;
    return sum + Math.min(variant.timesLogged, spread);
  }, 0);
}

export function mergeCardText(suggestion: FoodMergeSuggestion): string {
  const unit = suggestion.variants[0]?.basisUnit ?? 'g';
  const range = kcalRangeText(suggestion.kcalPer100Min, suggestion.kcalPer100Max, unit);
  const ways = mergeWays(suggestion);
  const logged = ways >= 2 ? `was logged ${ways} ways` : 'was logged with different values';
  return `${suggestion.label} ${logged} (${range}). Make it one food?`;
}

export function mergeRequest(
  suggestion: FoodMergeSuggestion,
  draft: MergeDraft,
): MergeFoodsRequest | null {
  const included = includedVariants(suggestion, draft);
  const values = valuesVariant(suggestion, draft);
  const name = draft.name.replace(/\s+/g, ' ').trim().slice(0, API_LIMITS.nameMax);
  if (included.length === 0 || !values || !name || nameIsKeptApart(suggestion, draft)) {
    return null;
  }
  const productId =
    values.productId ??
    included.find((variant) => variant.productId !== null)?.productId ??
    suggestion.variants.find(
      (variant) => variant.productId !== null && isIncludedName(included, variant.name),
    )?.productId ??
    null;
  const microsPer100 = cleanMicrosPer100(values.microsPer100);
  const keptApart = keptApartNames(suggestion, draft);
  return {
    key: suggestion.key,
    names: distinctNames(included.map((variant) => variant.name)),
    name,
    basisUnit: values.basisUnit,
    per100: roundNutrients(sanitizeNutrients(values.per100)),
    ...(microsPer100 ? { microsPer100 } : {}),
    productId,
    ...(keptApart.length > 0 ? { keptApart } : {}),
    applyToPast: draft.applyToPast,
  };
}

export function mergedMessage(response: MyFoodChangeResponse, applyToPast: boolean): string {
  const base = `${response.food.name} is now one food`;
  return applyToPast && response.updatedItems > 0
    ? `${base} · ${pastItemsText(response.updatedItems)} updated`
    : base;
}
