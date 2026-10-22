import {
  PORTION_COUNT_MAX,
  PORTION_UNIT_MAX,
  formatCount,
  formatPortion,
  isFiniteNumber,
  isValidPortion,
  pluralizeUnit,
  portionUnitFor,
  roundTo,
  type Portion,
} from '@food/shared';
import { formatNumber, formatNutrientValue } from './format';

const PORTION_SEPARATOR = ' · ';
const COUNT_STEP = 0.5;
export const COUNT_MIN = 0.01;
const COUNT_DECIMALS = 2;
const COUNT_CHIPS: readonly number[] = [0.5, 1, 1.5, 2, 3];

export interface CountedAmount {
  count?: number | null;
  unit?: string | null;
  unitPlural?: string | null;
}

export function sumGrams(items: readonly { grams: number }[]): number {
  return roundTo(
    items.reduce(
      (sum, item) => sum + (isFiniteNumber(item.grams) && item.grams > 0 ? item.grams : 0),
      0,
    ),
    1,
  );
}

export function gramsText(grams: number): string | null {
  return isFiniteNumber(grams) && grams > 0 ? `${formatNumber(grams, 0)} g` : null;
}

export function amountLine(portion: Portion | null | undefined, grams: number): string {
  return [portion ? formatPortion(portion) : null, gramsText(grams)]
    .filter((part): part is string => part !== null)
    .join(PORTION_SEPARATOR);
}

export function amountSummary(
  portion: Portion | null | undefined,
  grams: number,
  calories: number,
): string {
  const amount = amountLine(portion, grams);
  const kcal = `${formatNutrientValue('calories', calories)} kcal`;
  return amount ? `${amount}${PORTION_SEPARATOR}${kcal}` : kcal;
}

export function clampCount(value: number): number {
  if (!isFiniteNumber(value) || value <= 0) {
    return COUNT_MIN;
  }
  return roundTo(Math.min(PORTION_COUNT_MAX, Math.max(COUNT_MIN, value)), COUNT_DECIMALS);
}

export function stepCount(value: number, direction: 1 | -1): number {
  const current = isFiniteNumber(value) && value > 0 ? value : 0;
  const steps =
    direction > 0
      ? Math.floor(current / COUNT_STEP + 1e-9) + 1
      : Math.ceil(current / COUNT_STEP - 1e-9) - 1;
  return clampCount(Math.max(COUNT_STEP, steps * COUNT_STEP));
}

export function canStepCount(value: number, direction: 1 | -1): boolean {
  return direction > 0 ? value < PORTION_COUNT_MAX : value > COUNT_STEP + 1e-9;
}

export function sameCount(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

export function countChips(extra: number | null = null): number[] {
  const chips = [...COUNT_CHIPS];
  if (
    extra !== null &&
    isFiniteNumber(extra) &&
    extra > 0 &&
    !chips.some((c) => sameCount(c, extra))
  ) {
    chips.push(roundTo(extra, COUNT_DECIMALS));
  }
  return chips.sort((a, b) => a - b);
}

export function unitLabel(portion: Pick<Portion, 'unit' | 'unitPlural'>, count: number): string {
  return portionUnitFor(portion, count);
}

export function countLabel(portion: Pick<Portion, 'unit' | 'unitPlural'>, count: number): string {
  return `${formatCount(count)} ${unitLabel(portion, count)}`;
}

const IRREGULAR_PLURALS: Readonly<Record<string, string>> = {
  half: 'halves',
  knife: 'knives',
  leaf: 'leaves',
  loaf: 'loaves',
  mango: 'mangoes',
  potato: 'potatoes',
  tomato: 'tomatoes',
};

const IRREGULAR_SINGULARS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(IRREGULAR_PLURALS).map(([singular, plural]) => [plural, singular]),
);

const E_ENDING_SINGULARS: ReadonlySet<string> = new Set([
  'brioche',
  'brownie',
  'cookie',
  'hoagie',
  'pie',
  'quiche',
  'smoothie',
  'veggie',
]);

function splitPhrase(text: string): [string, string] {
  const match = /^(\S+)(\s.*)?$/.exec(text);
  return match ? [match[1], match[2] ?? ''] : [text, ''];
}

function matchCase(original: string, word: string): string {
  if (original.length > 1 && original === original.toUpperCase()) {
    return word.toUpperCase();
  }
  return /^[A-Z]/.test(original) ? word[0].toUpperCase() + word.slice(1) : word;
}

function pluralizeUnitWord(word: string): string {
  const irregular = IRREGULAR_PLURALS[word.toLowerCase()];
  return irregular ? matchCase(word, irregular) : pluralizeUnit(word);
}

export function pluralizeUnitPhrase(unit: string): string {
  const [head, rest] = splitPhrase(unit.trim());
  return rest.trim() ? `${pluralizeUnitWord(head)}${rest}` : pluralizeUnitWord(head);
}

function singularizeUnitWord(word: string): string {
  const lower = word.toLowerCase();
  const irregular = IRREGULAR_SINGULARS[lower];
  if (irregular) {
    return matchCase(word, irregular);
  }
  if (lower.length <= 2 || !lower.endsWith('s') || /(ss|us)$/.test(lower)) {
    return word;
  }
  if (E_ENDING_SINGULARS.has(lower.slice(0, -1))) {
    return word.slice(0, -1);
  }
  if (/[^aeiou]ies$/.test(lower)) {
    return `${word.slice(0, -3)}y`;
  }
  if (/(ches|shes|xes|zes|sses|oes)$/.test(lower)) {
    return word.slice(0, -2);
  }
  return word.slice(0, -1);
}

export function singularizeUnitPhrase(unit: string): string {
  const [head, rest] = splitPhrase(unit.trim());
  return `${singularizeUnitWord(head)}${rest}`;
}

function cleanUnit(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, PORTION_UNIT_MAX).trim();
}

export function unitsFromText(text: string): Pick<Portion, 'unit' | 'unitPlural'> | null {
  const typed = cleanUnit(text);
  if (!typed) {
    return null;
  }
  const singular = cleanUnit(singularizeUnitPhrase(typed));
  if (singular && singular !== typed) {
    return { unit: singular, unitPlural: typed };
  }
  return { unit: typed, unitPlural: cleanUnit(pluralizeUnitPhrase(typed)) || typed };
}

export function makePortion(count: number, text: string): Portion | null {
  if (!isFiniteNumber(count) || count <= 0) {
    return null;
  }
  const units = unitsFromText(text);
  const portion = units ? { count: clampCount(count), ...units } : null;
  return portion && isValidPortion(portion) ? portion : null;
}

export function renamePortion(portion: Portion, text: string): Portion | null {
  if (cleanUnit(text) === unitLabel(portion, portion.count)) {
    return portion;
  }
  return makePortion(portion.count, text);
}

export function toPortion(value: unknown): Portion | null {
  return isValidPortion(value)
    ? { count: value.count, unit: value.unit, unitPlural: value.unitPlural }
    : null;
}

export function parsePortionJson(json: string | null | undefined): Portion | null {
  if (!json) {
    return null;
  }
  try {
    return toPortion(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}

export function itemPortion(item: CountedAmount): Portion | null {
  if (!isFiniteNumber(item.count) || item.count <= 0 || !item.unit?.trim()) {
    return null;
  }
  return toPortion({
    count: item.count,
    unit: item.unit.trim(),
    unitPlural: item.unitPlural?.trim() || pluralizeUnitPhrase(item.unit),
  });
}

export function itemCountFields(portion: Portion | null): Required<CountedAmount> {
  return portion
    ? { count: portion.count, unit: portion.unit, unitPlural: portion.unitPlural }
    : { count: null, unit: null, unitPlural: null };
}

export function scaledCount(count: number | null | undefined, factor: number): number | null {
  if (!isFiniteNumber(count) || count <= 0 || !isFiniteNumber(factor) || factor <= 0) {
    return count ?? null;
  }
  return Math.min(PORTION_COUNT_MAX, Math.max(0.01, roundTo(count * factor, COUNT_DECIMALS)));
}

export function scaledPortion(portion: Portion | null, factor: number): Portion | null {
  if (!portion) {
    return null;
  }
  const count = scaledCount(portion.count, factor);
  return count === null ? portion : { ...portion, count };
}
