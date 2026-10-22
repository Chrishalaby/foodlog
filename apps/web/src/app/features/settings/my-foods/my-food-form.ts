import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  MICRO_KEYS,
  MICRO_META,
  MICRO_PER100_CEILING,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  isFiniteNumber,
  roundNutrients,
  roundTo,
  sanitizeNutrients,
  zeroNutrients,
  type MicroKey,
  type Micros,
  type MyFoodChangeResponse,
  type MyFoodDto,
  type NutrientKey,
  type Nutrients,
  type SaveMyFoodRequest,
  type UpdateMyFoodRequest,
} from '@food/shared';
import { per100Max } from '../../log/barcode/product-form';
import { UNIT_INCOMPLETE, UNIT_NAME_MAX } from '../../../shared/ui/my-foods/save-my-food-sheet';
import { normalizeFoodName } from '../../../shared/utils/food-match';
import { formatNumber, parseDecimal } from '../../../shared/utils/format';
import { MICROS_PER100_EXTRA_DECIMALS, cleanMicrosPer100 } from '../../../shared/utils/micros';
import { pastItemsText, sameValues } from '../../../shared/utils/saved-foods';

export type BasisUnit = 'g' | 'ml';
export type MicrosText = Partial<Record<MicroKey, string>>;

interface ParsedMicros {
  micros: Micros | null;
  invalid: MicroKey | null;
}

export interface MyFoodDraft {
  name: string;
  brand: string;
  aliases: string[];
  basisUnit: BasisUnit;
  per100: Nutrients;
  unitName: string;
  unitGrams: number;
  microsText: MicrosText;
}

export const MAIN_VALUE_KEYS: readonly NutrientKey[] = ['calories', 'protein', 'carbs', 'fat'];
export const MORE_VALUE_KEYS: readonly NutrientKey[] = [
  'sugar',
  'satFat',
  'fiber',
  'sodium',
  'alcohol',
];
export const ALIASES_MAX = 30;

export function cleanFoodText(text: string, max: number = API_LIMITS.nameMax): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function emptyMyFoodDraft(): MyFoodDraft {
  return {
    name: '',
    brand: '',
    aliases: [],
    basisUnit: 'g',
    per100: zeroNutrients(),
    unitName: '',
    unitGrams: 0,
    microsText: {},
  };
}

export function microMax(key: MicroKey): number {
  return MICRO_PER100_CEILING[MICRO_META[key].unit];
}

function microDecimals(key: MicroKey): number {
  return MICRO_META[key].decimals + MICROS_PER100_EXTRA_DECIMALS;
}

export function microsTextFrom(micros: Micros | null | undefined): MicrosText {
  const clean = cleanMicrosPer100(micros);
  const text: MicrosText = {};
  for (const key of MICRO_KEYS) {
    const value = clean?.[key];
    if (value !== undefined) {
      text[key] = formatNumber(value, microDecimals(key)).replace(/,/g, '');
    }
  }
  return text;
}

export function parseMicrosText(text: MicrosText): ParsedMicros {
  const micros: Micros = {};
  for (const key of MICRO_KEYS) {
    const raw = text[key]?.trim() ?? '';
    if (raw === '') {
      continue;
    }
    const value = parseDecimal(raw);
    if (value === null || value < 0 || value > microMax(key)) {
      return { micros: null, invalid: key };
    }
    micros[key] = value;
  }
  return { micros: cleanMicrosPer100(micros), invalid: null };
}

function draftMicros(draft: MyFoodDraft): Micros | null {
  return parseMicrosText(draft.microsText).micros;
}

function sameMicros(a: Micros | null, b: Micros | null): boolean {
  return MICRO_KEYS.every((key) => (a?.[key] ?? null) === (b?.[key] ?? null));
}

export function draftFromMyFood(food: MyFoodDto): MyFoodDraft {
  return {
    name: food.name,
    brand: food.brand ?? '',
    aliases: [...food.aliases],
    basisUnit: food.basisUnit,
    per100: roundNutrients(sanitizeNutrients(food.per100)),
    unitName: food.unitName ?? '',
    unitGrams: isFiniteNumber(food.unitGrams) && food.unitGrams > 0 ? food.unitGrams : 0,
    microsText: microsTextFrom(food.microsPer100),
  };
}

export function addAlias(draft: MyFoodDraft, text: string): MyFoodDraft {
  const alias = cleanFoodText(text);
  const key = normalizeFoodName(alias);
  if (!alias || !key || draft.aliases.length >= ALIASES_MAX) {
    return draft;
  }
  const taken = [draft.name, ...draft.aliases].some((name) => normalizeFoodName(name) === key);
  return taken ? draft : { ...draft, aliases: [...draft.aliases, alias] };
}

export function removeAlias(draft: MyFoodDraft, index: number): MyFoodDraft {
  return { ...draft, aliases: draft.aliases.filter((_, position) => position !== index) };
}

function unitComplete(draft: MyFoodDraft): boolean {
  return (cleanFoodText(draft.unitName, UNIT_NAME_MAX) === '') === !(draft.unitGrams > 0);
}

export function myFoodDraftError(draft: MyFoodDraft): string | null {
  if (!cleanFoodText(draft.name)) {
    return 'Give this food a name.';
  }
  for (const key of NUTRIENT_KEYS) {
    const value = draft.per100[key];
    const max = per100Max(key, draft.basisUnit);
    if (!isFiniteNumber(value) || value < 0 || value > max) {
      return `${NUTRIENT_META[key].label} per 100 ${draft.basisUnit} must be between 0 and ${max}.`;
    }
  }
  if (draft.per100.sugar > draft.per100.carbs + 0.05) {
    return "Sugar can't be more than carbs.";
  }
  if (draft.per100.satFat > draft.per100.fat + 0.05) {
    return "Saturated fat can't be more than fat.";
  }
  if (!unitComplete(draft)) {
    return UNIT_INCOMPLETE;
  }
  if (draft.unitGrams > MAX_ITEM_GRAMS) {
    return `A unit can weigh at most ${MAX_ITEM_GRAMS} g.`;
  }
  const invalid = parseMicrosText(draft.microsText).invalid;
  if (invalid) {
    const meta = MICRO_META[invalid];
    return `${meta.label} per 100 ${draft.basisUnit} must be a number from 0 to ${formatNumber(microMax(invalid))} ${meta.unit}, or blank.`;
  }
  return null;
}

export function microsChanged(food: MyFoodDto | null, draft: MyFoodDraft): boolean {
  return food !== null && !sameMicros(cleanMicrosPer100(food.microsPer100), draftMicros(draft));
}

export function valuesChanged(food: MyFoodDto | null, draft: MyFoodDraft): boolean {
  return (
    food !== null &&
    (food.basisUnit !== draft.basisUnit ||
      !sameValues(food.per100, draft.per100) ||
      microsChanged(food, draft))
  );
}

function requestFields(draft: MyFoodDraft) {
  const unitName = cleanFoodText(draft.unitName, UNIT_NAME_MAX);
  const unitGrams = draft.unitGrams > 0 ? roundTo(draft.unitGrams, 1) : 0;
  const brand = cleanFoodText(draft.brand);
  return {
    name: cleanFoodText(draft.name),
    brand: brand || null,
    aliases: draft.aliases.map((alias) => cleanFoodText(alias)).filter((alias) => alias !== ''),
    basisUnit: draft.basisUnit,
    per100: roundNutrients(sanitizeNutrients(draft.per100)),
    unitName: unitName && unitGrams ? unitName : null,
    unitGrams: unitName && unitGrams ? unitGrams : null,
  };
}

export function saveRequestFromDraft(draft: MyFoodDraft): SaveMyFoodRequest {
  const microsPer100 = draftMicros(draft);
  return { ...requestFields(draft), ...(microsPer100 ? { microsPer100 } : {}), source: 'manual' };
}

export function updateRequestFromDraft(
  food: MyFoodDto,
  draft: MyFoodDraft,
  applyToPast: boolean,
): UpdateMyFoodRequest {
  const fields = {
    ...requestFields(draft),
    ...(microsChanged(food, draft) ? { microsPer100: draftMicros(draft) } : {}),
  };
  return valuesChanged(food, draft) ? { ...fields, applyToPast } : fields;
}

export function sameDraft(a: MyFoodDraft, b: MyFoodDraft): boolean {
  return (
    JSON.stringify(requestFields(a)) === JSON.stringify(requestFields(b)) &&
    JSON.stringify(parseMicrosText(a.microsText)) === JSON.stringify(parseMicrosText(b.microsText))
  );
}

export function updatedMessage(response: MyFoodChangeResponse): string {
  const base = `Updated ${response.food.name}`;
  return response.updatedItems > 0
    ? `${base} · ${pastItemsText(response.updatedItems)} updated`
    : base;
}
