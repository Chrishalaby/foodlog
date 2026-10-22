import { NUTRIENT_META, type NutrientKey, roundTo } from '@food/shared';

const LOCALE = 'en-US';
const LIST_FORMAT = new Intl.ListFormat(LOCALE, { style: 'long', type: 'conjunction' });

export function formatNumber(value: number, decimals = 0): string {
  const safe = Number.isFinite(value) ? value : 0;
  return roundTo(safe, decimals).toLocaleString(LOCALE, { maximumFractionDigits: decimals });
}

export function nutrientUnit(key: NutrientKey): string {
  return NUTRIENT_META[key].unit;
}

export function formatNutrientValue(key: NutrientKey, value: number): string {
  return formatNumber(value, NUTRIENT_META[key].decimals);
}

export function formatNutrient(key: NutrientKey, value: number): string {
  return `${formatNutrientValue(key, value)} ${nutrientUnit(key)}`;
}

export function formatGrams(grams: number): string {
  return `${formatNumber(grams, 1)} g`;
}

export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(/\s+/g, '').replace(',', '.');
  if (normalized === '' || !/^-?\d*\.?\d*$/.test(normalized) || normalized === '.') {
    return null;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function formatList(parts: readonly string[]): string {
  return LIST_FORMAT.format(parts);
}
