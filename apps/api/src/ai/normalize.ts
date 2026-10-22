import {
  type AnalysisItem,
  type AnalysisMode,
  type AnalysisResult,
  API_LIMITS,
  atwaterCalories,
  isFiniteNumber,
  type LabelInfo,
  MAX_ITEM_GRAMS,
  type MicroKey,
  type Micros,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  type Nutrients,
  nutrientsFromPer100g,
  type Portion,
  roundNutrients,
  roundTo,
  type SavedFoodRef,
  sumNutrients,
  zeroNutrients,
} from '@food/shared';
import {
  itemFluidMl,
  microsForGrams,
  per100Micros,
  scaleFluidMl,
} from '../common/micros.js';
import { clampedPortion, itemCount } from '../common/portions.js';
import { foldText } from '../foods/food-text.js';
import { normalizeFoodKey } from '../my-foods/food-names.js';
import {
  findSavedFoodByName,
  type SavedFood,
  suggestSavedFood,
} from '../my-foods/saved-food.js';
import type {
  FoodAnalysisItem,
  FoodAnalysisLabel,
  FoodAnalysisOutput,
  FoodAnalysisPortion,
  FoodMicroValues,
  FoodNutrientValues,
} from './food-analysis.schema.js';

export const NUTRIENT_FLAGS = [
  'negative_value',
  'kj_as_kcal_fixed',
  'atwater_mismatch',
  'mass_balance',
  'fiber_gt_carbs',
  'sugar_gt_carbs',
  'satfat_gt_fat',
  'energy_density_impossible',
  'sodium_impossible',
] as const;

export type NutrientFlag = (typeof NUTRIENT_FLAGS)[number];
export type ItemFlag = NutrientFlag | 'grams_clamped';

export const KJ_PER_KCAL = 4.184;
export const ATWATER_TOLERANCE_REL = 0.15;
export const ATWATER_TOLERANCE_KCAL = 15;

const KJ_RATIO_TOLERANCE = 0.4;
const MIN_KCAL_FOR_KJ_CHECK = 20;
const MAX_MACRO_GRAMS_PER_100G = 102;
const MAX_KCAL_PER_100G = 902;
const MAX_SODIUM_MG_PER_100G = 40_000;
const COMPARISON_SLACK_G = 0.5;
const GRAMS_DECIMALS = 1;

export const TEXT_LIMITS = {
  name: API_LIMITS.nameMax,
  portionBasis: 120,
  scaleCues: 300,
  assumption: 200,
  assumptions: 10,
  question: 300,
  option: 80,
  options: 4,
  servingText: 120,
} as const;

const FALLBACK_MEAL_NAME = 'Meal';
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;
const PLACEHOLDER_SCALE_CUES = new Set([
  'none',
  'n/a',
  'na',
  'null',
  'nil',
  'unknown',
  'not applicable',
  'no scale cues',
  'no scale cue',
  'no scale cues visible',
  'no cues',
  '-',
  '--',
  '—',
]);
const TRAILING_PUNCTUATION = /[.!;:]+$/u;

export const LABEL_MATCH = {
  kcalRel: 0.1,
  kcalMin: 10,
  macroRel: 0.15,
  macroMin: 2,
} as const;

const LABEL_MACROS = ['protein', 'carbs', 'fat'] as const;

export interface ValidatedPer100 {
  per100: Nutrients;
  flags: NutrientFlag[];
}

export function nutrientsFromOutput(values: FoodNutrientValues): Nutrients {
  return {
    calories: values.calories,
    protein: values.protein_g,
    carbs: values.carbs_g,
    fat: values.fat_g,
    satFat: values.saturated_fat_g,
    fiber: values.fiber_g,
    sugar: values.sugar_g,
    sodium: values.sodium_mg,
    alcohol: values.alcohol_g,
  };
}

export function microsFromOutput(
  values: FoodMicroValues,
): Record<MicroKey, number | null> {
  return {
    vitaminA: values.vitamin_a_ug_rae,
    vitaminC: values.vitamin_c_mg,
    vitaminD: values.vitamin_d_ug,
    vitaminE: values.vitamin_e_mg,
    vitaminK: values.vitamin_k_ug,
    vitaminB6: values.vitamin_b6_mg,
    vitaminB12: values.vitamin_b12_ug,
    folate: values.folate_ug_dfe,
    calcium: values.calcium_mg,
    iron: values.iron_mg,
    magnesium: values.magnesium_mg,
    potassium: values.potassium_mg,
    zinc: values.zinc_mg,
    cholesterol: values.cholesterol_mg,
    caffeine: values.caffeine_mg,
  };
}

function nonNegative(input: Nutrients): {
  values: Nutrients;
  changed: boolean;
} {
  const values = zeroNutrients();
  let changed = false;
  for (const key of NUTRIENT_KEYS) {
    const value = input[key];
    if (isFiniteNumber(value) && value >= 0) {
      values[key] = value;
    } else {
      changed = true;
    }
  }
  return { values, changed };
}

function looksLikeKilojoules(calories: number, atwater: number): boolean {
  return (
    atwater > MIN_KCAL_FOR_KJ_CHECK &&
    Math.abs(calories / atwater - KJ_PER_KCAL) < KJ_RATIO_TOLERANCE
  );
}

function consistencyFlags(n: Nutrients, atwater: number): NutrientFlag[] {
  const flags: NutrientFlag[] = [];
  const tolerance = Math.max(
    ATWATER_TOLERANCE_REL * atwater,
    ATWATER_TOLERANCE_KCAL,
  );
  if (Math.abs(n.calories - atwater) > tolerance) {
    flags.push('atwater_mismatch');
  }
  if (n.protein + n.carbs + n.fat + n.alcohol > MAX_MACRO_GRAMS_PER_100G) {
    flags.push('mass_balance');
  }
  if (n.fiber > n.carbs + COMPARISON_SLACK_G) {
    flags.push('fiber_gt_carbs');
  }
  if (n.sugar > n.carbs + COMPARISON_SLACK_G) {
    flags.push('sugar_gt_carbs');
  }
  if (n.satFat > n.fat + COMPARISON_SLACK_G) {
    flags.push('satfat_gt_fat');
  }
  if (n.calories > MAX_KCAL_PER_100G) {
    flags.push('energy_density_impossible');
  }
  if (n.sodium > MAX_SODIUM_MG_PER_100G) {
    flags.push('sodium_impossible');
  }
  return flags;
}

export function validatePer100(input: Nutrients): ValidatedPer100 {
  const { values, changed } = nonNegative(input);
  const flags: NutrientFlag[] = changed ? ['negative_value'] : [];
  const atwater = atwaterCalories(values);
  if (looksLikeKilojoules(values.calories, atwater)) {
    values.calories = values.calories / KJ_PER_KCAL;
    flags.push('kj_as_kcal_fixed');
  }
  return {
    per100: values,
    flags: [...flags, ...consistencyFlags(values, atwater)],
  };
}

export function cleanText(
  value: string | null | undefined,
  max: number,
): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

function cleanOptionalText(
  value: string | null | undefined,
  max: number,
): string | null {
  return cleanText(value, max) || null;
}

function clampToNutrientMax(n: Nutrients): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = Math.min(n[key], NUTRIENT_META[key].max);
  }
  return out;
}

function normalizeGrams(value: number): { grams: number; clamped: boolean } {
  if (!isFiniteNumber(value) || value <= 0) {
    return { grams: 0, clamped: false };
  }
  return {
    grams: roundTo(Math.min(value, MAX_ITEM_GRAMS), GRAMS_DECIMALS),
    clamped: value > MAX_ITEM_GRAMS,
  };
}

interface NormalizedItem {
  item: AnalysisItem;
  flags: ItemFlag[];
  savedFoodName: string | null;
  labelled: boolean;
}

const MEASURE_UNITS: ReadonlySet<string> = new Set([
  'g',
  'gr',
  'gram',
  'grams',
  'kg',
  'kilogram',
  'kilograms',
  'mg',
  'ml',
  'millilitre',
  'millilitres',
  'milliliter',
  'milliliters',
  'l',
  'litre',
  'litres',
  'liter',
  'liters',
  'cl',
  'dl',
  'oz',
  'ounce',
  'ounces',
  'fl oz',
  'lb',
  'lbs',
  'pound',
  'pounds',
  'kcal',
  'cal',
  'calorie',
  'calories',
  'kj',
]);

function isMeasureUnit(unit: string | null): boolean {
  return (
    unit !== null &&
    MEASURE_UNITS.has(unit.trim().toLowerCase().replace(/\.$/, ''))
  );
}

function outputPortion(
  count: number | null,
  unit: string | null,
  unitPlural: string | null,
): Portion | null {
  return isMeasureUnit(unit) ? null : clampedPortion(count, unit, unitPlural);
}

export function normalizeOutputPortion(
  portion: FoodAnalysisPortion | null,
): Portion | null {
  return portion
    ? outputPortion(portion.count, portion.unit, portion.unit_plural)
    : null;
}

function normalizeItem(item: FoodAnalysisItem, name: string): NormalizedItem {
  const { per100, flags } = validatePer100(nutrientsFromOutput(item.per_100g));
  const { grams, clamped } = normalizeGrams(item.estimated_quantity_g);
  const itemFlags: ItemFlag[] = clamped ? [...flags, 'grams_clamped'] : flags;
  const microsPer100g = per100Micros(microsFromOutput(item.micros_per_100g));
  return {
    item: {
      name,
      grams,
      ...itemCount(outputPortion(item.count, item.unit, item.unit_plural)),
      nutrients: roundNutrients(
        clampToNutrientMax(nutrientsFromPer100g(per100, grams)),
      ),
      per100g: roundNutrients(per100),
      micros: microsForGrams(microsPer100g, grams),
      microsPer100g,
      fluidMl: itemFluidMl(item.fluid_ml),
      confidence: item.confidence,
      amountSource: item.amount_source,
      state: item.state,
      portionBasis: cleanText(item.portion_basis, TEXT_LIMITS.portionBasis),
      flags: [...itemFlags],
      savedFood: null,
      suggestedFood: null,
    },
    flags: itemFlags,
    savedFoodName: item.saved_food,
    labelled: false,
  };
}

function positiveOrNull(value: number | null): number | null {
  return isFiniteNumber(value) && value > 0
    ? roundTo(value, GRAMS_DECIMALS)
    : null;
}

interface NormalizedLabel {
  label: LabelInfo;
  flags: NutrientFlag[];
}

function normalizeLabel(label: FoodAnalysisLabel): NormalizedLabel {
  const { per100, flags } = validatePer100(nutrientsFromOutput(label.per_100));
  return {
    label: {
      productName: cleanOptionalText(label.product_name, TEXT_LIMITS.name),
      basisUnit: label.basis_unit,
      per100: roundNutrients(per100),
      microsPer100: per100Micros(microsFromOutput(label.micros_per_100)),
      servingSize: positiveOrNull(label.serving_size),
      servingText: cleanOptionalText(
        label.serving_text,
        TEXT_LIMITS.servingText,
      ),
      packSize: positiveOrNull(label.pack_size),
    },
    flags,
  };
}

const FLAG_WARNINGS: Record<ItemFlag, (subject: string) => string> = {
  negative_value: (s) => `Replaced invalid nutrient values for ${s} with 0`,
  kj_as_kcal_fixed: (s) => `Converted kJ to kcal for ${s}`,
  atwater_mismatch: (s) =>
    `Calories for ${s} don't match its macros — double-check`,
  mass_balance: (s) =>
    `Macros for ${s} add up to more than its weight — double-check`,
  fiber_gt_carbs: (s) =>
    `Fiber for ${s} is higher than its carbs — double-check`,
  sugar_gt_carbs: (s) =>
    `Sugar for ${s} is higher than its carbs — double-check`,
  satfat_gt_fat: (s) =>
    `Saturated fat for ${s} is higher than its total fat — double-check`,
  energy_density_impossible: (s) =>
    `Calories for ${s} are impossibly high — double-check`,
  sodium_impossible: (s) => `Sodium for ${s} is impossibly high — double-check`,
  grams_clamped: (s) => `Weight for ${s} was capped at ${MAX_ITEM_GRAMS} g`,
};

function flagWarnings(subject: string, flags: readonly ItemFlag[]): string[] {
  return flags.map((flag) => FLAG_WARNINGS[flag](subject));
}

function cleanScaleCues(
  value: string | null | undefined,
  mode: AnalysisMode,
): string {
  if (mode === 'text') {
    return '';
  }
  const cleaned = cleanText(value, TEXT_LIMITS.scaleCues);
  const key = cleaned.toLowerCase().replace(TRAILING_PUNCTUATION, '').trim();
  return PLACEHOLDER_SCALE_CUES.has(key) ? '' : cleaned;
}

function nameWords(name: string): Set<string> {
  return new Set(foldText(name).split(WORD_SEPARATOR).filter(Boolean));
}

function isNarrowerName(mealName: string, itemName: string): boolean {
  const meal = nameWords(mealName);
  const item = nameWords(itemName);
  return (
    meal.size > 0 &&
    item.size > meal.size &&
    [...meal].every((word) => item.has(word))
  );
}

function resolveMealName(
  rawName: string,
  labelName: string | null,
  items: readonly AnalysisItem[],
): string {
  const cleaned = cleanText(rawName, TEXT_LIMITS.name);
  const [only, ...others] = items;
  if (cleaned === '') {
    return labelName || only?.name || FALLBACK_MEAL_NAME;
  }
  return only !== undefined &&
    others.length === 0 &&
    isNarrowerName(cleaned, only.name)
    ? only.name
    : cleaned;
}

function withinLabel(
  value: number,
  target: number,
  relative: number,
  minimum: number,
): boolean {
  return Math.abs(value - target) <= Math.max(relative * target, minimum);
}

function matchesLabel(per100: Nutrients, label: Nutrients): boolean {
  return (
    withinLabel(
      per100.calories,
      label.calories,
      LABEL_MATCH.kcalRel,
      LABEL_MATCH.kcalMin,
    ) &&
    LABEL_MACROS.every((key) =>
      withinLabel(
        per100[key],
        label[key],
        LABEL_MATCH.macroRel,
        LABEL_MATCH.macroMin,
      ),
    )
  );
}

function labelDistance(per100: Nutrients, label: Nutrients): number {
  return LABEL_MACROS.reduce(
    (sum, key) =>
      sum +
      Math.abs(per100[key] - label[key]) /
        Math.max(label[key], LABEL_MATCH.macroMin),
    Math.abs(per100.calories - label.calories) /
      Math.max(label.calories, LABEL_MATCH.kcalMin),
  );
}

interface LabelCandidate {
  index: number;
  fromLabel: boolean;
  distance: number;
}

function isBetterCandidate(a: LabelCandidate, b: LabelCandidate): boolean {
  if (a.fromLabel !== b.fromLabel) {
    return a.fromLabel;
  }
  return a.distance < b.distance;
}

export function labelItemIndex(
  items: readonly AnalysisItem[],
  label: Nutrients,
): number | null {
  const best = items.reduce<LabelCandidate | null>((current, item, index) => {
    if (!matchesLabel(item.per100g, label)) {
      return current;
    }
    const candidate: LabelCandidate = {
      index,
      fromLabel: item.amountSource === 'label',
      distance: labelDistance(item.per100g, label),
    };
    return current === null || isBetterCandidate(candidate, current)
      ? candidate
      : current;
  }, null);
  return best?.index ?? null;
}

function labelledMicros(
  estimated: Micros | null,
  printed: Micros | null,
): Micros | null {
  return printed ? { ...estimated, ...printed } : estimated;
}

function labelledItem(
  entry: NormalizedItem,
  label: NormalizedLabel,
): NormalizedItem {
  const per100 = label.label.per100;
  const flags: ItemFlag[] = entry.flags.includes('grams_clamped')
    ? [...label.flags, 'grams_clamped']
    : [...label.flags];
  const microsPer100g = labelledMicros(
    entry.item.microsPer100g,
    label.label.microsPer100,
  );
  return {
    ...entry,
    item: {
      ...entry.item,
      per100g: per100,
      nutrients: roundNutrients(
        clampToNutrientMax(nutrientsFromPer100g(per100, entry.item.grams)),
      ),
      micros: microsForGrams(microsPer100g, entry.item.grams),
      microsPer100g,
      flags: [...flags],
    },
    flags,
    labelled: true,
  };
}

function withLabelItemFirst(
  entries: readonly NormalizedItem[],
  label: NormalizedLabel | null,
): NormalizedItem[] {
  const index = label
    ? labelItemIndex(
        entries.map((entry) => entry.item),
        label.label.per100,
      )
    : null;
  const matched = index === null ? undefined : entries[index];
  if (label === null || matched === undefined) {
    return [...entries];
  }
  return [
    labelledItem(matched, label),
    ...entries.filter((entry) => entry !== matched),
  ];
}

function isSameUnit(unit: string | null, unitName: string | null): boolean {
  if (unit === null || unitName === null) {
    return false;
  }
  const key = normalizeFoodKey(unit);
  return (
    foldText(unit) === foldText(unitName) ||
    (key !== '' && key === normalizeFoodKey(unitName))
  );
}

function savedFoodGrams(
  item: AnalysisItem,
  ref: SavedFoodRef,
): { grams: number; clamped: boolean } | null {
  if (
    ref.unitGrams === null ||
    !(ref.unitGrams > 0) ||
    item.count === null ||
    !isSameUnit(item.unit, ref.unitName)
  ) {
    return null;
  }
  return normalizeGrams(item.count * ref.unitGrams);
}

function rescaledFluidMl(
  fluidMl: number | null,
  from: number,
  to: number,
): number | null {
  return from > 0 && from !== to ? scaleFluidMl(fluidMl, to / from) : fluidMl;
}

function linkedItem(entry: NormalizedItem, food: SavedFood): NormalizedItem {
  const unitGrams = savedFoodGrams(entry.item, food.ref);
  const grams = unitGrams?.grams ?? entry.item.grams;
  const clamped = unitGrams
    ? unitGrams.clamped
    : entry.flags.includes('grams_clamped');
  const flags: ItemFlag[] = clamped ? ['grams_clamped'] : [];
  const per100 = food.ref.per100;
  const microsPer100g = food.ref.microsPer100 ?? entry.item.microsPer100g;
  return {
    ...entry,
    item: {
      ...entry.item,
      name: food.itemName,
      grams,
      per100g: roundNutrients(per100),
      nutrients: roundNutrients(
        clampToNutrientMax(nutrientsFromPer100g(per100, grams)),
      ),
      micros: microsForGrams(microsPer100g, grams),
      microsPer100g,
      fluidMl: rescaledFluidMl(entry.item.fluidMl, entry.item.grams, grams),
      flags: [...flags],
      savedFood: food.ref,
      suggestedFood: null,
    },
    flags,
  };
}

function withSuggestion(
  entry: NormalizedItem,
  food: SavedFood | null,
): NormalizedItem {
  return {
    ...entry,
    item: { ...entry.item, savedFood: null, suggestedFood: food?.ref ?? null },
  };
}

function linkSavedFood(
  entry: NormalizedItem,
  foods: readonly SavedFood[],
): NormalizedItem {
  if (foods.length === 0) {
    return entry;
  }
  const requested = findSavedFoodByName(entry.savedFoodName, foods);
  if (entry.labelled) {
    return withSuggestion(
      entry,
      requested ?? suggestSavedFood(entry.item.name, foods),
    );
  }
  const food = requested ?? findSavedFoodByName(entry.item.name, foods);
  return food
    ? linkedItem(entry, food)
    : withSuggestion(entry, suggestSavedFood(entry.item.name, foods));
}

function resolveInputType(
  reported: AnalysisMode,
  requested: AnalysisMode,
): AnalysisMode {
  if (requested === 'text' || reported === 'text') {
    return requested;
  }
  return reported;
}

function cleanList(
  values: readonly string[],
  maxLength: number,
  maxCount: number,
): string[] {
  const cleaned = values
    .map((value) => cleanText(value, maxLength))
    .filter(Boolean);
  return [...new Set(cleaned)].slice(0, maxCount);
}

interface NamedItem {
  item: FoodAnalysisItem;
  name: string;
}

function namedItems(items: readonly FoodAnalysisItem[]): NamedItem[] {
  return items
    .map((item) => ({ item, name: cleanText(item.name, TEXT_LIMITS.name) }))
    .filter((entry) => entry.name.length > 0);
}

function itemWarnings(total: number, named: number, kept: number): string[] {
  const warnings: string[] = [];
  if (named < total) {
    const dropped = total - named;
    warnings.push(`Ignored ${dropped} unnamed item${dropped === 1 ? '' : 's'}`);
  }
  if (kept < named) {
    warnings.push(`Only the first ${kept} items were kept`);
  }
  if (kept === 0) {
    warnings.push('No food detected');
  }
  return warnings;
}

export interface NormalizeOptions {
  mode: AnalysisMode;
  answeredQuestions?: readonly string[];
  savedFoods?: readonly SavedFood[];
}

function questionKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function unansweredQuestion(
  question: string | null,
  answered: readonly string[],
): string | null {
  if (!question) {
    return null;
  }
  const key = questionKey(question);
  return answered.some((text) => questionKey(text) === key) ? null : question;
}

function labelWarnings(mode: AnalysisMode, hasLabel: boolean): string[] {
  return mode === 'nutrition_label' && !hasLabel
    ? ['No nutrition label could be read — values are estimates']
    : [];
}

export function normalizeAnalysis(
  raw: FoodAnalysisOutput,
  options: NormalizeOptions,
): AnalysisResult {
  const named = namedItems(raw.items);
  const kept = named.slice(0, API_LIMITS.itemsMax);
  const label = raw.label ? normalizeLabel(raw.label) : null;
  const savedFoods = options.savedFoods ?? [];
  const normalized = withLabelItemFirst(
    kept.map(({ item, name }) => normalizeItem(item, name)),
    label,
  ).map((entry) => linkSavedFood(entry, savedFoods));
  const items = normalized.map((entry) => entry.item);
  const followUpQuestion = unansweredQuestion(
    cleanOptionalText(raw.follow_up_question, TEXT_LIMITS.question),
    options.answeredQuestions ?? [],
  );
  const warnings = [
    ...itemWarnings(raw.items.length, named.length, kept.length),
    ...labelWarnings(options.mode, label !== null),
    ...normalized.flatMap(({ item, flags }) =>
      flagWarnings(`'${item.name}'`, flags),
    ),
    ...(label ? flagWarnings('the label', label.flags) : []),
  ];
  return {
    inputType: resolveInputType(raw.input_type, options.mode),
    mealName: resolveMealName(
      raw.meal_name,
      label?.label.productName ?? null,
      items,
    ),
    portion: items.length > 0 ? normalizeOutputPortion(raw.portion) : null,
    scaleCues: cleanScaleCues(raw.scale_cues, options.mode),
    items,
    label: label?.label ?? null,
    totals: roundNutrients(sumNutrients(items.map((item) => item.nutrients))),
    assumptions: cleanList(
      raw.assumptions,
      TEXT_LIMITS.assumption,
      TEXT_LIMITS.assumptions,
    ),
    followUpQuestion,
    followUpOptions: followUpQuestion
      ? cleanList(
          raw.follow_up_options,
          TEXT_LIMITS.option,
          TEXT_LIMITS.options,
        )
      : [],
    warnings: [...new Set(warnings)],
  };
}
