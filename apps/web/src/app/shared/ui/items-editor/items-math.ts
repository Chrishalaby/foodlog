import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  isFiniteNumber,
  microsFromPer100,
  roundMicros,
  roundNutrients,
  roundTo,
  sanitizeMicrosPer100,
  sanitizeNutrients,
  scaleMicros,
  sumMicros,
  sumNutrients,
  zeroNutrients,
  type AmountSource,
  type AnalysisItem,
  type Confidence,
  type EntryItemInput,
  type FoodState,
  type Micros,
  type MicrosCoverage,
  type MyFoodDto,
  type NutrientKey,
  type Nutrients,
  type Portion,
  type SavedFoodRef,
} from '@food/shared';
import { findSavedFood, sameNormalizedName } from '../../utils/food-match';
import { cleanMicros, hasMicros, itemExtras, sanitizeFluidMl } from '../../utils/micros';
import { productIdField, savedFoodItemName, savedFoodRef } from '../../utils/saved-foods';
import {
  clampCount,
  itemCountFields,
  itemPortion,
  sameCount,
  scaledCount,
  unitsFromText,
} from '../../utils/portion';

export const GRAMS_DECIMALS = 1;

export interface DraftItemHints {
  portionBasis?: string;
  amountSource?: AmountSource;
  state?: FoodState;
  flags?: readonly string[];
}

export interface DraftItem {
  key: string;
  name: string;
  grams: number;
  nutrients: Nutrients;
  basis: Nutrients | null;
  confidence: Confidence | null;
  hints: DraftItemHints | null;
  count: number | null;
  unit: string | null;
  unitPlural: string | null;
  productId: string | null;
  savedFood: SavedFoodRef | null;
  suggestedFood: SavedFoodRef | null;
  aiName: string | null;
  micros: Micros | null;
  microsBasis: Micros | null;
  fluidMl: number | null;
  fluidBasis: number | null;
  originalGrams?: number;
  originalCount?: number | null;
}

export interface DraftItemInit {
  name?: string;
  grams?: number;
  nutrients?: Partial<Nutrients> | null;
  basis?: Nutrients | null;
  confidence?: Confidence | null;
  hints?: DraftItemHints | null;
  count?: number | null;
  unit?: string | null;
  unitPlural?: string | null;
  productId?: string | null;
  savedFood?: SavedFoodRef | null;
  suggestedFood?: SavedFoodRef | null;
  aiName?: string | null;
  micros?: Micros | null;
  microsPer100?: Micros | null;
  fluidMl?: number | null;
  originalGrams?: number;
}

export interface PortionRef {
  grams: number;
  nutrients: Nutrients;
  count: number | null;
  micros: Micros | null;
  fluidMl: number | null;
}

export interface MealPortionState {
  factor: number;
  refs: ReadonlyMap<string, PortionRef>;
}

export interface MealPortionResult {
  items: DraftItem[];
  state: MealPortionState;
}

export interface MealScale {
  state: MealPortionState;
  baseCount: number | null;
}

export interface MealCountResult {
  items: DraftItem[];
  portion: Portion;
  scale: MealScale;
}

const DEFAULT_ITEM_UNITS = { unit: 'piece', unitPlural: 'pieces' } as const;

export const ITEM_PORTION_FACTORS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
export const MEAL_PORTION_FACTORS = [0.25, 1 / 3, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const GRAMS_TOLERANCE = 0.05;

let keySequence = 0;

export function nextDraftKey(): string {
  keySequence += 1;
  return `item-${keySequence}`;
}

export function sanitizeGrams(value: number): number {
  if (!isFiniteNumber(value) || value <= 0) {
    return 0;
  }
  return roundTo(Math.min(value, MAX_ITEM_GRAMS), GRAMS_DECIMALS);
}

export function clampNutrient(key: NutrientKey, value: number): number {
  if (!isFiniteNumber(value) || value <= 0) {
    return 0;
  }
  return Math.min(value, NUTRIENT_META[key].max);
}

export function perGram(nutrients: Nutrients, grams: number): Nutrients | null {
  if (!isFiniteNumber(grams) || grams <= 0) {
    return null;
  }
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = nutrients[key] / grams;
  }
  return out;
}

function applyBasis(basis: Nutrients, grams: number): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = clampNutrient(key, basis[key] * grams);
  }
  return roundNutrients(out);
}

function basisOf(item: DraftItem): Nutrients | null {
  return item.basis ?? perGram(item.nutrients, item.grams);
}

type ItemExtrasState = Pick<DraftItem, 'micros' | 'microsBasis' | 'fluidMl' | 'fluidBasis'>;

function perGramMicros(micros: Micros | null, grams: number): Micros | null {
  return micros && isFiniteNumber(grams) && grams > 0 ? scaleMicros(micros, 1 / grams) : null;
}

export function microsBasisFromPer100(per100: Micros | null | undefined): Micros | null {
  return scaleMicros(sanitizeMicrosPer100(per100), 1 / 100);
}

function fluidBasisFor(fluidMl: number | null, grams: number): number | null {
  return fluidMl !== null && isFiniteNumber(grams) && grams > 0 ? fluidMl / grams : null;
}

function rescaledExtras(item: DraftItem, grams: number): ItemExtrasState {
  const microsBasis = item.microsBasis ?? perGramMicros(item.micros, item.grams);
  const fluidBasis = item.fluidBasis ?? fluidBasisFor(item.fluidMl, item.grams);
  return {
    micros: microsBasis ? cleanMicros(scaleMicros(microsBasis, grams)) : item.micros,
    microsBasis,
    fluidMl: fluidBasis !== null ? sanitizeFluidMl(fluidBasis * grams) : item.fluidMl,
    fluidBasis,
  };
}

export function createDraftItem(init: DraftItemInit = {}): DraftItem {
  const grams = sanitizeGrams(init.grams ?? 0);
  const nutrients = roundNutrients(sanitizeNutrients(init.nutrients));
  const counted = itemCountFields(itemPortion(init));
  const micros = cleanMicros(init.micros);
  const fluidMl = sanitizeFluidMl(init.fluidMl);
  return {
    key: nextDraftKey(),
    name: init.name ?? '',
    grams,
    nutrients,
    basis: init.basis ?? perGram(nutrients, grams),
    confidence: init.confidence ?? null,
    hints: init.hints ?? null,
    ...counted,
    productId: init.productId ?? init.savedFood?.id ?? null,
    savedFood: init.savedFood ?? null,
    suggestedFood: init.suggestedFood ?? null,
    aiName: init.aiName ?? null,
    micros,
    microsBasis: microsBasisFromPer100(init.microsPer100) ?? perGramMicros(micros, grams),
    fluidMl,
    fluidBasis: fluidBasisFor(fluidMl, grams),
    originalGrams: sanitizeGrams(init.originalGrams ?? grams),
    originalCount: counted.count,
  };
}

function basisMatches(basis: Nutrients, nutrients: Nutrients, grams: number): boolean {
  return NUTRIENT_KEYS.every((key) => {
    const decimals = NUTRIENT_META[key].decimals;
    const expected = roundTo(basis[key] * grams, decimals);
    return Math.abs(expected - nutrients[key]) <= 10 ** -decimals + 1e-9;
  });
}

export function draftFromAnalysisItem(item: AnalysisItem): DraftItem {
  const grams = sanitizeGrams(item.grams);
  const nutrients = roundNutrients(sanitizeNutrients(item.nutrients));
  const per100Basis = perGram(sanitizeNutrients(item.savedFood?.per100 ?? item.per100g), 100);
  const matches = grams > 0 && per100Basis && basisMatches(per100Basis, nutrients, grams);
  const basis = item.savedFood || matches ? per100Basis : null;
  return createDraftItem({
    name: item.name,
    grams,
    nutrients,
    basis,
    confidence: item.confidence,
    count: item.count,
    unit: item.unit,
    unitPlural: item.unitPlural,
    savedFood: item.savedFood ?? null,
    suggestedFood: item.savedFood ? null : (item.suggestedFood ?? null),
    aiName: item.name,
    micros: item.micros,
    microsPer100: item.savedFood?.microsPer100 ?? item.microsPer100g,
    fluidMl: item.fluidMl,
    hints: {
      portionBasis: item.portionBasis,
      amountSource: item.amountSource,
      state: item.state,
      flags: item.flags,
    },
  });
}

export function draftFromEntryItem(item: EntryItemInput): DraftItem {
  return createDraftItem({
    name: item.name,
    grams: item.grams,
    nutrients: item.nutrients,
    confidence: item.confidence ?? null,
    count: item.count ?? null,
    unit: item.unit ?? null,
    unitPlural: item.unitPlural ?? null,
    productId: item.productId ?? null,
    micros: item.micros ?? null,
    fluidMl: item.fluidMl ?? null,
  });
}

export function draftFromCatalogItem(
  item: EntryItemInput,
  per100: Nutrients,
  microsPer100: Micros | null,
): DraftItem {
  return createDraftItem({
    name: item.name,
    grams: item.grams,
    nutrients: item.nutrients,
    basis: perGram(sanitizeNutrients(per100), 100),
    confidence: item.confidence ?? null,
    count: item.count ?? null,
    unit: item.unit ?? null,
    unitPlural: item.unitPlural ?? null,
    micros: item.micros ?? null,
    microsPer100,
  });
}

export function isBlankDraftItem(item: DraftItem): boolean {
  return (
    item.name.trim() === '' &&
    item.grams === 0 &&
    NUTRIENT_KEYS.every((key) => item.nutrients[key] === 0)
  );
}

export function rescaleItem(item: DraftItem, grams: number): DraftItem {
  const nextGrams = sanitizeGrams(grams);
  if (nextGrams === item.grams) {
    return item;
  }
  const basis = basisOf(item);
  const extras = rescaledExtras(item, nextGrams);
  if (nextGrams === 0) {
    return { ...item, ...extras, grams: 0, nutrients: zeroNutrients(), basis };
  }
  if (item.grams > 0 && basis) {
    return { ...item, ...extras, grams: nextGrams, nutrients: applyBasis(basis, nextGrams), basis };
  }
  const nutrients = zeroNutrients();
  const nextBasis = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    const explicit = item.nutrients[key];
    nutrients[key] = explicit > 0 ? explicit : clampNutrient(key, (basis?.[key] ?? 0) * nextGrams);
    nextBasis[key] = nutrients[key] / nextGrams;
  }
  return {
    ...item,
    ...extras,
    grams: nextGrams,
    nutrients: roundNutrients(nutrients),
    basis: nextBasis,
  };
}

export function updateNutrient(item: DraftItem, key: NutrientKey, value: number): DraftItem {
  const nextValue = roundTo(clampNutrient(key, value), NUTRIENT_META[key].decimals);
  const nutrients = { ...item.nutrients, [key]: nextValue };
  if (item.grams <= 0) {
    return unlinkItem({ ...item, nutrients });
  }
  const basis = { ...(basisOf(item) ?? zeroNutrients()), [key]: nextValue / item.grams };
  return unlinkItem({ ...item, nutrients, basis });
}

export function renameItem(item: DraftItem, name: string): DraftItem {
  return { ...item, name };
}

export function setItemCount(item: DraftItem, count: number | null): DraftItem {
  if (count === null || !isFiniteNumber(count) || count <= 0) {
    return item.count === null ? item : { ...item, count: null };
  }
  const next = clampCount(count);
  if (item.count !== null && sameCount(item.count, next)) {
    return item;
  }
  const units = item.unit?.trim() ? {} : DEFAULT_ITEM_UNITS;
  if (item.count !== null && item.count > 0 && item.grams > 0) {
    return { ...rescaleItem(item, (item.grams / item.count) * next), ...units, count: next };
  }
  const base = portionBaseGrams(item);
  const originalCount = item.grams > 0 && base > 0 ? roundTo((next * base) / item.grams, 2) : next;
  return { ...item, ...units, count: next, originalCount };
}

export function setItemUnit(item: DraftItem, text: string): DraftItem {
  const units = unitsFromText(text) ?? (item.count === null ? null : DEFAULT_ITEM_UNITS);
  return { ...item, unit: units?.unit ?? null, unitPlural: units?.unitPlural ?? null };
}

export function itemsTotals(items: readonly DraftItem[]): Nutrients {
  return roundNutrients(sumNutrients(items.map((item) => item.nutrients)));
}

export function validateItems(items: readonly DraftItem[]): string | null {
  if (items.length === 0) {
    return 'Add at least one item.';
  }
  if (items.length > API_LIMITS.itemsMax) {
    return `A meal can have at most ${API_LIMITS.itemsMax} items.`;
  }
  const unnamed = items.findIndex((item) => item.name.trim().length === 0);
  if (unnamed >= 0) {
    return `Item ${unnamed + 1} needs a name.`;
  }
  return null;
}

export function toEntryItemInputs(items: readonly DraftItem[]): EntryItemInput[] {
  return items.map((item) => ({
    name: item.name.trim().slice(0, API_LIMITS.nameMax),
    grams: sanitizeGrams(item.grams),
    nutrients: roundNutrients(sanitizeNutrients(item.nutrients)),
    confidence: item.confidence,
    ...itemCountFields(itemPortion(item)),
    ...productIdField(item.productId),
    ...itemExtras(item),
  }));
}

export function gramsStep(grams: number): number {
  if (grams < 20) {
    return 1;
  }
  if (grams < 100) {
    return 5;
  }
  if (grams < 500) {
    return 10;
  }
  return 25;
}

export function stepGrams(grams: number, direction: 1 | -1): number {
  const current = sanitizeGrams(grams);
  const step = gramsStep(direction > 0 ? current : Math.max(0, current - 0.001));
  const next =
    direction > 0
      ? Math.floor(current / step + 1e-9) * step + step
      : Math.ceil(current / step - 1e-9) * step - step;
  return sanitizeGrams(next);
}

export function isAddedByAi(item: DraftItem): boolean {
  return item.hints?.amountSource === 'assumed_hidden';
}

export function portionBaseGrams(item: DraftItem): number {
  return sanitizeGrams(item.originalGrams ?? 0);
}

export function gramsForFactor(item: DraftItem, factor: number): number {
  return sanitizeGrams(portionBaseGrams(item) * factor);
}

export function hasItemFactor(item: DraftItem, factor: number): boolean {
  return (
    portionBaseGrams(item) > 0 &&
    Math.abs(item.grams - gramsForFactor(item, factor)) <= GRAMS_TOLERANCE
  );
}

export function applyItemFactor(item: DraftItem, factor: number): DraftItem {
  if (portionBaseGrams(item) <= 0 || !isFiniteNumber(factor) || factor <= 0) {
    return item;
  }
  const rescaled = rescaleItem(item, gramsForFactor(item, factor));
  const base = item.originalCount ?? null;
  return base !== null && item.count !== null
    ? { ...rescaled, count: scaledCount(base, factor) }
    : rescaled;
}

export function initialMealPortion(): MealPortionState {
  return { factor: 1, refs: new Map() };
}

function scaledNutrients(nutrients: Nutrients, factor: number): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = clampNutrient(key, nutrients[key] * factor);
  }
  return roundNutrients(out);
}

function sameNutrients(a: Nutrients, b: Nutrients): boolean {
  return NUTRIENT_KEYS.every((key) => a[key] === b[key]);
}

function countMatches(ref: PortionRef, item: DraftItem, factor: number): boolean {
  if (ref.count === null || item.count === null) {
    return ref.count === null && item.count === null;
  }
  return sameCount(scaledCount(ref.count, factor) ?? 0, item.count);
}

function refMatches(ref: PortionRef, item: DraftItem, factor: number): boolean {
  if (!countMatches(ref, item, factor)) {
    return false;
  }
  if (item.grams > 0) {
    return Math.abs(sanitizeGrams(ref.grams * factor) - item.grams) <= GRAMS_TOLERANCE;
  }
  return ref.grams <= 0 && sameNutrients(scaledNutrients(ref.nutrients, factor), item.nutrients);
}

function currentRef(item: DraftItem, from: number): PortionRef {
  return {
    grams: item.grams / from,
    nutrients: scaledNutrients(item.nutrients, 1 / from),
    count: item.count === null ? null : item.count / from,
    micros: item.micros ? scaleMicros(item.micros, 1 / from) : null,
    fluidMl: item.fluidMl === null ? null : item.fluidMl / from,
  };
}

function applyRef(item: DraftItem, ref: PortionRef, factor: number): DraftItem {
  const count = ref.count === null ? item.count : scaledCount(ref.count, factor);
  if (ref.grams > 0) {
    return { ...rescaleItem(item, ref.grams * factor), count };
  }
  return {
    ...item,
    nutrients: scaledNutrients(ref.nutrients, factor),
    count,
    micros: ref.micros ? cleanMicros(scaleMicros(ref.micros, factor)) : item.micros,
    fluidMl: ref.fluidMl === null ? item.fluidMl : sanitizeFluidMl(ref.fluidMl * factor),
  };
}

export function applyMealPortion(
  items: readonly DraftItem[],
  state: MealPortionState,
  factor: number,
): MealPortionResult {
  const from = isFiniteNumber(state.factor) && state.factor > 0 ? state.factor : 1;
  if (!isFiniteNumber(factor) || factor <= 0 || factor === from) {
    return { items: [...items], state };
  }
  const refs = new Map<string, PortionRef>();
  const next = items.map((item) => {
    const known = state.refs.get(item.key);
    const ref = known && refMatches(known, item, from) ? known : currentRef(item, from);
    refs.set(item.key, ref);
    return applyRef(item, ref, factor);
  });
  return { items: next, state: { factor, refs } };
}

export function initialMealScale(portion: Portion | null): MealScale {
  return { state: initialMealPortion(), baseCount: portion?.count ?? null };
}

export function applyMealCount(
  items: readonly DraftItem[],
  portion: Portion,
  scale: MealScale,
  count: number,
): MealCountResult | null {
  const base = scale.baseCount ?? portion.count;
  if (!isFiniteNumber(base) || base <= 0 || !isFiniteNumber(count) || count <= 0) {
    return null;
  }
  const next = clampCount(count);
  const result = applyMealPortion(items, scale.state, next / base);
  return {
    items: result.items,
    portion: { ...portion, count: next },
    scale: { baseCount: base, state: result.state },
  };
}

export function portionFactorLabel(factor: number): string {
  const labels: ReadonlyArray<[number, string]> = [
    [0.25, '¼'],
    [1 / 3, '⅓'],
    [0.5, '½'],
    [0.75, '¾'],
    [1, '1'],
    [1.25, '1¼'],
    [1.5, '1½'],
    [2, '2'],
  ];
  const match = labels.find(([value]) => Math.abs(value - factor) < 1e-6);
  return match ? match[1] : String(roundTo(factor, 2));
}

export function savedFoodBasis(ref: Pick<SavedFoodRef, 'per100'>): Nutrients {
  return perGram(sanitizeNutrients(ref.per100), 100) ?? zeroNutrients();
}

function savedFoodMicros(
  item: DraftItem,
  ref: SavedFoodRef,
): Pick<DraftItem, 'micros' | 'microsBasis'> {
  const per100 = sanitizeMicrosPer100(ref.microsPer100);
  if (!per100) {
    return { micros: item.micros, microsBasis: item.microsBasis };
  }
  return {
    micros: cleanMicros(microsFromPer100(per100, Math.max(0, item.grams))),
    microsBasis: microsBasisFromPer100(per100),
  };
}

function linkedMicrosBasis(item: DraftItem, ref: SavedFoodRef): Micros | null {
  return microsBasisFromPer100(ref.microsPer100) ?? item.microsBasis;
}

export function useSavedFood(item: DraftItem, ref: SavedFoodRef): DraftItem {
  const basis = savedFoodBasis(ref);
  const nutrients = item.grams > 0 ? applyBasis(basis, item.grams) : zeroNutrients();
  return {
    ...item,
    ...savedFoodMicros(item, ref),
    name: savedFoodItemName(ref),
    nutrients,
    basis,
    productId: ref.id,
    savedFood: ref,
    suggestedFood: null,
  };
}

export function linkSavedFood(item: DraftItem, ref: SavedFoodRef): DraftItem {
  return {
    ...item,
    name: savedFoodItemName(ref),
    basis: savedFoodBasis(ref),
    microsBasis: linkedMicrosBasis(item, ref),
    productId: ref.id,
    savedFood: ref,
    suggestedFood: null,
  };
}

export function attachSavedFood(item: DraftItem, ref: SavedFoodRef): DraftItem {
  return item.productId === ref.id
    ? {
        ...item,
        savedFood: ref,
        basis: savedFoodBasis(ref),
        microsBasis: linkedMicrosBasis(item, ref),
      }
    : item;
}

export function unlinkItem(item: DraftItem): DraftItem {
  return item.productId === null && item.savedFood === null
    ? item
    : { ...item, productId: null, savedFood: null };
}

export function itemPer100(item: Pick<DraftItem, 'grams' | 'nutrients'>): Nutrients | null {
  if (!isFiniteNumber(item.grams) || item.grams <= 0) {
    return null;
  }
  const basis = perGram(sanitizeNutrients(item.nutrients), item.grams);
  return basis ? roundNutrients(scaledNutrients(basis, 100)) : null;
}

export function usesServerSuggestion(item: DraftItem): boolean {
  return item.aiName !== null && sameNormalizedName(item.name, item.aiName);
}

export function itemSuggestion(item: DraftItem, foods: readonly MyFoodDto[]): SavedFoodRef | null {
  if (item.productId !== null || item.name.trim().length === 0) {
    return null;
  }
  if (usesServerSuggestion(item)) {
    return item.suggestedFood;
  }
  const match = findSavedFood(item.name, foods);
  return match ? savedFoodRef(match) : null;
}

export function needsSavedFoods(item: DraftItem): boolean {
  if (item.productId !== null) {
    return item.savedFood === null;
  }
  return item.name.trim().length > 0 && !usesServerSuggestion(item);
}

export const DEFAULT_DRINK_ML = 250;

export function isDrink(item: Pick<DraftItem, 'fluidMl' | 'fluidBasis'>): boolean {
  return item.fluidMl !== null || item.fluidBasis !== null;
}

export function defaultDrinkMl(item: Pick<DraftItem, 'grams'>): number {
  return sanitizeFluidMl(item.grams) ?? DEFAULT_DRINK_ML;
}

export function setItemFluid(item: DraftItem, ml: number | null): DraftItem {
  const fluidMl = sanitizeFluidMl(ml);
  if (fluidMl === item.fluidMl && (fluidMl !== null || item.fluidBasis === null)) {
    return item;
  }
  return { ...item, fluidMl, fluidBasis: fluidBasisFor(fluidMl, item.grams) };
}

function countsAsFood(item: DraftItem): boolean {
  return item.name.trim().length > 0 || item.grams > 0;
}

export function itemsMicros(items: readonly DraftItem[]): {
  micros: Micros;
  coverage: MicrosCoverage;
} {
  const foods = items.filter(countsAsFood);
  const known = foods.filter((item) => hasMicros(item.micros));
  return {
    micros: roundMicros(sumMicros(known.map((item) => item.micros))),
    coverage: { items: foods.length, withMicros: known.length },
  };
}
