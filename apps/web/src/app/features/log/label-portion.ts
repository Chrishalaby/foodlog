import {
  MICRO_KEYS,
  MICRO_META,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  isFiniteNumber,
  roundNutrients,
  roundTo,
  sanitizeNutrients,
  zeroNutrients,
  type LabelInfo,
  type MicroKey,
  type NutrientKey,
  type Nutrients,
} from '@food/shared';
import {
  clampNutrient,
  rescaleItem,
  sanitizeGrams,
  type DraftItem,
} from '../../shared/ui/items-editor/items-math';
import { formatMicroAmount } from '../../shared/ui/micros/micros-model';
import { cleanMicrosPer100 } from '../../shared/utils/micros';

export const SERVING_STEP = 0.5;
export const MIN_SERVINGS = SERVING_STEP;

export interface LabelMicroRow {
  key: MicroKey;
  label: string;
  per100: string;
  perServing: string | null;
}

export interface LabelRow {
  key: NutrientKey;
  label: string;
  unit: string;
  decimals: number;
  per100: number;
  perServing: number | null;
}

function positive(value: number | null): number | null {
  return value !== null && isFiniteNumber(value) && value > 0 ? value : null;
}

export function servingSizeOf(label: LabelInfo): number | null {
  return positive(label.servingSize);
}

export function packSizeOf(label: LabelInfo): number | null {
  return positive(label.packSize);
}

export function labelBasisPerUnit(label: LabelInfo): Nutrients {
  const per100 = sanitizeNutrients(label.per100);
  const basis = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    basis[key] = per100[key] / 100;
  }
  return basis;
}

export function nutrientsForAmount(label: LabelInfo, amount: number): Nutrients {
  const safeAmount = sanitizeGrams(amount);
  const basis = labelBasisPerUnit(label);
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = clampNutrient(key, basis[key] * safeAmount);
  }
  return roundNutrients(out);
}

export function applyLabelPortion(item: DraftItem, label: LabelInfo, amount: number): DraftItem {
  const grams = sanitizeGrams(amount);
  return {
    ...rescaleItem(item, grams),
    grams,
    basis: labelBasisPerUnit(label),
    nutrients: nutrientsForAmount(label, grams),
  };
}

export function servingsForAmount(amount: number, servingSize: number | null): number | null {
  const size = positive(servingSize);
  if (size === null || !isFiniteNumber(amount) || amount < 0) {
    return null;
  }
  return roundTo(amount / size, 2);
}

export function amountForServings(servings: number, servingSize: number): number {
  return sanitizeGrams(servings * servingSize);
}

export function stepServings(servings: number, direction: 1 | -1): number {
  const current = isFiniteNumber(servings) && servings > 0 ? servings : 0;
  const steps =
    direction > 0
      ? Math.floor(current / SERVING_STEP + 1e-9) + 1
      : Math.ceil(current / SERVING_STEP - 1e-9) - 1;
  return Math.max(MIN_SERVINGS, roundTo(steps * SERVING_STEP, 2));
}

export function labelRows(label: LabelInfo): LabelRow[] {
  const per100 = sanitizeNutrients(label.per100);
  const servingSize = servingSizeOf(label);
  return NUTRIENT_KEYS.filter((key) => key !== 'alcohol' || per100.alcohol > 0).map((key) => {
    const meta = NUTRIENT_META[key];
    return {
      key,
      label: meta.label,
      unit: meta.unit,
      decimals: meta.decimals,
      per100: roundTo(per100[key], meta.decimals),
      perServing:
        servingSize === null ? null : roundTo((per100[key] * servingSize) / 100, meta.decimals),
    };
  });
}

export function labelMicroRows(label: LabelInfo): LabelMicroRow[] {
  const per100 = cleanMicrosPer100(label.microsPer100);
  const servingSize = servingSizeOf(label);
  return MICRO_KEYS.flatMap((key) => {
    const value = per100?.[key];
    if (value === undefined) {
      return [];
    }
    return [
      {
        key,
        label: MICRO_META[key].label,
        per100: formatMicroAmount(key, value),
        perServing:
          servingSize === null ? null : formatMicroAmount(key, (value * servingSize) / 100),
      },
    ];
  });
}
