import {
  API_LIMITS,
  CONFIDENCE_LEVELS,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  isFiniteNumber,
  microsFromPer100,
  roundNutrients,
  sanitizeMicros,
  sanitizeNutrients,
  scaleNutrients,
  sumNutrients,
  type AnalysisMode,
  type AnalyzeResponse,
  type Confidence,
  type EntryItemInput,
  type FoodResultKind,
  type FoodSearchResult,
  type MealType,
  type MenuDish,
  type Nutrients,
  type Portion,
  type ProductDto,
  type QuickLogRequest,
} from '@food/shared';
import { sanitizeGrams, stepGrams } from '../../shared/ui/items-editor/items-math';
import { formatList, formatNumber } from '../../shared/utils/format';
import { cleanMicrosPer100, itemExtras } from '../../shared/utils/micros';
import { productIdField } from '../../shared/utils/saved-foods';
import {
  canStepCount,
  clampCount,
  countLabel,
  itemCountFields,
  itemPortion,
  scaledPortion,
  stepCount,
  toPortion,
} from '../../shared/utils/portion';
import {
  defaultProductPortion,
  productDisplayName,
  productTotals,
  servingGrams,
} from '../log/barcode/product-portion';
import {
  QUICK_SERVING_MIN,
  clampQuickGrams,
  clampServings,
  scaledEntryItems,
  servingChipLabel,
  stepQuickServings,
  usesGrams,
} from '../log/quick-log-math';

export const MAX_OPTIONS = 4;
export const MIN_TO_COMPARE = 2;
export const COMPARE_STORAGE_KEY = 'foodlog.compare.v1';
export const COMPARE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type OptionSource =
  'library' | 'barcode' | 'text' | 'food_photo' | 'nutrition_label' | 'menu';

export type OptionPortion =
  | { readonly mode: 'grams'; readonly grams: number }
  | { readonly mode: 'servings'; readonly servings: number }
  | { readonly mode: 'count'; readonly count: number };

export interface OptionBase {
  readonly grams: number;
  readonly items: readonly EntryItemInput[];
  readonly totals: Nutrients;
  readonly portion: Portion | null;
}

export type OptionLog =
  | {
      readonly kind: 'analysis';
      readonly analysisId: string;
      readonly mode: AnalysisMode;
      readonly description: string | null;
      readonly photoId: string | null;
    }
  | {
      readonly kind: 'library';
      readonly key: string;
      readonly resultKind: FoodResultKind;
      readonly mealType: MealType | null;
    }
  | { readonly kind: 'product'; readonly productId: string }
  | { readonly kind: 'menu'; readonly description: string | null };

export interface CompareOption {
  readonly id: string;
  readonly source: OptionSource;
  readonly badge: string;
  readonly name: string;
  readonly detail: string | null;
  readonly note: string | null;
  readonly thumbUrl: string | null;
  readonly base: OptionBase;
  readonly portion: OptionPortion;
  readonly log: OptionLog;
  readonly loggedEntryId: string | null;
}

export interface SavedMenu {
  readonly restaurant: string | null;
  readonly dishes: readonly MenuDish[];
  readonly warnings: readonly string[];
  readonly scannedAt: number;
}

export interface PersistedCompare {
  readonly v: 1;
  readonly userId: string;
  readonly savedAt: number;
  readonly options: readonly CompareOption[];
  readonly menu: SavedMenu | null;
}

export const SOURCE_BADGES: Record<OptionSource, string> = {
  library: 'My foods',
  barcode: 'Barcode',
  text: 'Described',
  food_photo: 'Photo',
  nutrition_label: 'Label',
  menu: 'Menu',
};

const LIBRARY_BADGES: Record<FoodResultKind, string> = {
  favorite: 'Favorite',
  product: 'Product',
  meal: 'My foods',
  food: 'My foods',
};

const FALLBACK_NAMES: Record<AnalysisMode, string> = {
  text: 'Described meal',
  food_photo: 'Food photo',
  nutrition_label: 'Labelled food',
};

let optionSeq = 0;

export function nextOptionId(): string {
  optionSeq += 1;
  return `opt-${Date.now().toString(36)}-${optionSeq}`;
}

function cleanText(value: string | null | undefined, max: number): string | null {
  const text = value?.replace(/\s+/g, ' ').trim().slice(0, max).trim() ?? '';
  return text ? text : null;
}

export function cleanName(value: string | null | undefined, fallback: string): string {
  return cleanText(value, API_LIMITS.nameMax) ?? fallback;
}

function sumGrams(items: readonly EntryItemInput[]): number {
  return sanitizeGrams(items.reduce((sum, item) => sum + (item.grams > 0 ? item.grams : 0), 0));
}

function normalizeItems(items: readonly EntryItemInput[]): EntryItemInput[] {
  return items.slice(0, API_LIMITS.itemsMax).map((item) => ({
    name: cleanName(item.name, 'Food'),
    grams: sanitizeGrams(item.grams),
    nutrients: roundNutrients(sanitizeNutrients(item.nutrients)),
    confidence: item.confidence ?? null,
    ...itemCountFields(itemPortion(item)),
    ...productIdField(item.productId),
    ...itemExtras(item),
  }));
}

function itemsTotals(items: readonly EntryItemInput[]): Nutrients {
  return roundNutrients(sumNutrients(items.map((item) => item.nutrients)));
}

function gramsOrServings(grams: number, singleItem: boolean): OptionPortion {
  return singleItem && grams > 0 ? { mode: 'grams', grams } : { mode: 'servings', servings: 1 };
}

function defaultOptionPortion(
  portion: Portion | null,
  grams: number,
  singleItem: boolean,
): OptionPortion {
  return portion
    ? { mode: 'count', count: clampCount(portion.count) }
    : gramsOrServings(grams, singleItem);
}

function hasLowConfidence(items: readonly EntryItemInput[]): boolean {
  return items.some((item) => item.confidence === 'low');
}

export function optionFromLibrary(result: FoodSearchResult, id: string): CompareOption {
  const items = normalizeItems(result.items);
  const grams = sanitizeGrams(result.grams) || sumGrams(items);
  const byWeight = result.kind !== 'favorite' && result.kind !== 'product' && usesGrams(result);
  const portion = toPortion(result.portion);
  return {
    id,
    source: 'library',
    badge: LIBRARY_BADGES[result.kind],
    name: cleanName(result.name, 'Food'),
    detail: cleanText(result.detail, 80),
    note: null,
    thumbUrl: result.photo?.thumbUrl ?? null,
    base: { grams, items, totals: roundNutrients(sanitizeNutrients(result.totals)), portion },
    portion: defaultOptionPortion(portion, grams, byWeight),
    log: {
      kind: 'library',
      key: result.key,
      resultKind: result.kind,
      mealType: result.mealType,
    },
    loggedEntryId: null,
  };
}

function missingNote(product: ProductDto): string | null {
  const labels = NUTRIENT_KEYS.filter((key) => product.missingNutrients.includes(key)).map((key) =>
    NUTRIENT_META[key].label.toLowerCase(),
  );
  return labels.length > 0 ? `No ${formatList(labels)} data for this product` : null;
}

function productExtras(product: ProductDto, grams: number) {
  return itemExtras({
    micros: microsFromPer100(cleanMicrosPer100(product.microsPer100), grams),
    fluidMl: product.basisUnit === 'ml' ? grams : null,
  });
}

export function optionFromProduct(product: ProductDto, id: string): CompareOption {
  const name = cleanName(productDisplayName(product), 'Product');
  const grams = servingGrams(product);
  const totals = productTotals(product, grams);
  const portion = defaultProductPortion(product);
  return {
    id,
    source: 'barcode',
    badge: SOURCE_BADGES.barcode,
    name,
    detail: cleanText(product.brand, 80),
    note: missingNote(product),
    thumbUrl: null,
    base: {
      grams,
      items: [
        {
          name,
          grams,
          nutrients: totals,
          confidence: null,
          ...itemCountFields(null),
          ...productIdField(product.id),
          ...productExtras(product, grams),
        },
      ],
      totals,
      portion: null,
    },
    portion:
      portion.mode === 'grams'
        ? { mode: 'grams', grams: portion.grams }
        : { mode: 'servings', servings: portion.servings },
    log: { kind: 'product', productId: product.id },
    loggedEntryId: null,
  };
}

function analysisName(response: AnalyzeResponse, items: readonly EntryItemInput[]): string {
  const fromItems =
    items.length === 1
      ? items[0].name
      : items.length === 2
        ? `${items[0].name} & ${items[1].name}`
        : null;
  return cleanName(
    cleanText(response.result.mealName, API_LIMITS.nameMax) ?? fromItems,
    FALLBACK_NAMES[response.mode],
  );
}

function analysisDetail(
  response: AnalyzeResponse,
  items: readonly EntryItemInput[],
): string | null {
  if (response.mode === 'text') {
    return cleanText(response.description, 80);
  }
  return items.length > 1 ? `${items.length} items` : null;
}

export function optionFromAnalysis(response: AnalyzeResponse, id: string): CompareOption {
  const linkable = response.mode !== 'nutrition_label';
  const items = normalizeItems(
    response.result.items.map((item) => ({
      name: item.name,
      grams: item.grams,
      nutrients: item.nutrients,
      confidence: item.confidence,
      count: item.count,
      unit: item.unit,
      unitPlural: item.unitPlural,
      ...productIdField(linkable ? item.savedFood?.id : null),
      micros: item.micros,
      fluidMl: item.fluidMl,
    })),
  );
  const grams = sumGrams(items);
  const source: OptionSource = response.mode;
  const portion = toPortion(response.result.portion);
  return {
    id,
    source,
    badge: SOURCE_BADGES[source],
    name: analysisName(response, items),
    detail: analysisDetail(response, items),
    note: hasLowConfidence(items) ? 'Rough estimate, the AI was unsure' : null,
    thumbUrl: response.photo?.thumbUrl ?? null,
    base: { grams, items, totals: itemsTotals(items), portion },
    portion: defaultOptionPortion(portion, grams, items.length === 1),
    log: {
      kind: 'analysis',
      analysisId: response.analysisId,
      mode: response.mode,
      description: cleanText(response.description, API_LIMITS.descriptionMax),
      photoId: response.photo?.id ?? null,
    },
    loggedEntryId: null,
  };
}

export function optionFromDish(
  dish: MenuDish,
  restaurant: string | null,
  id: string,
): CompareOption {
  const name = cleanName(dish.name, 'Dish');
  const grams = sanitizeGrams(dish.grams);
  const nutrients = roundNutrients(sanitizeNutrients(dish.nutrients));
  const note = cleanText(dish.notes, 140) ?? (dish.confidence === 'low' ? 'Rough estimate' : null);
  const portion = toPortion(dish.portion);
  return {
    id,
    source: 'menu',
    badge: SOURCE_BADGES.menu,
    name,
    detail: cleanText(restaurant, 80) ?? cleanText(dish.description, 80),
    note,
    thumbUrl: null,
    base: {
      grams,
      items: [{ name, grams, nutrients, confidence: dish.confidence, ...itemCountFields(portion) }],
      totals: nutrients,
      portion,
    },
    portion: defaultOptionPortion(portion, grams, true),
    log: { kind: 'menu', description: cleanText(dish.description, API_LIMITS.descriptionMax) },
    loggedEntryId: null,
  };
}

export function portionFactor(option: Pick<CompareOption, 'base' | 'portion'>): number {
  const { base, portion } = option;
  if (portion.mode === 'servings') {
    return clampServings(portion.servings);
  }
  if (portion.mode === 'count') {
    const count = base.portion?.count ?? 0;
    return count > 0 ? clampCount(portion.count) / count : 1;
  }
  return base.grams > 0 ? clampQuickGrams(portion.grams) / base.grams : 1;
}

export function optionPortion(option: Pick<CompareOption, 'base' | 'portion'>): Portion | null {
  return scaledPortion(option.base.portion, portionFactor(option));
}

export function optionNutrients(option: Pick<CompareOption, 'base' | 'portion'>): Nutrients {
  return roundNutrients(
    scaleNutrients(sanitizeNutrients(option.base.totals), portionFactor(option)),
  );
}

export function optionItems(option: Pick<CompareOption, 'base' | 'portion'>): EntryItemInput[] {
  return scaledEntryItems(option.base.items, portionFactor(option));
}

export function optionGrams(option: Pick<CompareOption, 'base' | 'portion'>): number {
  return option.portion.mode === 'grams'
    ? clampQuickGrams(option.portion.grams)
    : sanitizeGrams(option.base.grams * portionFactor(option));
}

function clampPortion(portion: OptionPortion): OptionPortion {
  switch (portion.mode) {
    case 'grams':
      return { mode: 'grams', grams: clampQuickGrams(portion.grams) };
    case 'servings':
      return { mode: 'servings', servings: clampServings(portion.servings) };
    case 'count':
      return { mode: 'count', count: clampCount(portion.count) };
  }
}

export function withPortion(option: CompareOption, portion: OptionPortion): CompareOption {
  return { ...option, portion: clampPortion(portion) };
}

export function stepPortion(portion: OptionPortion, direction: 1 | -1): OptionPortion {
  switch (portion.mode) {
    case 'servings':
      return { mode: 'servings', servings: stepQuickServings(portion.servings, direction) };
    case 'count':
      return { mode: 'count', count: stepCount(portion.count, direction) };
    case 'grams':
      return { mode: 'grams', grams: clampQuickGrams(stepGrams(portion.grams, direction)) };
  }
}

export function canStepDown(portion: OptionPortion): boolean {
  switch (portion.mode) {
    case 'grams':
      return clampQuickGrams(portion.grams) > 1;
    case 'servings':
      return clampServings(portion.servings) > QUICK_SERVING_MIN;
    case 'count':
      return canStepCount(portion.count, -1);
  }
}

export function portionLabel(portion: OptionPortion, unit: Portion | null = null): string {
  switch (portion.mode) {
    case 'grams':
      return `${formatNumber(clampQuickGrams(portion.grams), 1)} g`;
    case 'count':
      return unit
        ? countLabel(unit, clampCount(portion.count))
        : `${servingChipLabel(clampCount(portion.count))}×`;
    case 'servings': {
      const servings = clampServings(portion.servings);
      return `${servingChipLabel(servings)} ${servings === 1 ? 'serving' : 'servings'}`;
    }
  }
}

export function logAmount(
  option: Pick<CompareOption, 'base' | 'portion'>,
): Pick<QuickLogRequest, 'grams' | 'servings' | 'portionCount'> {
  switch (option.portion.mode) {
    case 'grams':
      return { grams: clampQuickGrams(option.portion.grams) };
    case 'count':
      return option.base.portion
        ? { portionCount: clampCount(option.portion.count) }
        : { servings: clampServings(portionFactor(option)) };
    case 'servings':
      return { servings: clampServings(option.portion.servings) };
  }
}

export function productLogAmount(
  option: Pick<CompareOption, 'base' | 'portion'>,
): { grams: number } | { servings: number } {
  return option.portion.mode === 'grams'
    ? { grams: clampQuickGrams(option.portion.grams) }
    : { servings: clampServings(portionFactor(option)) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

function reviveItems(value: unknown): EntryItemInput[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items: EntryItemInput[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw['name'] !== 'string' || !isFiniteNumber(raw['grams'])) {
      return null;
    }
    const confidence = raw['confidence'];
    items.push({
      name: raw['name'],
      grams: raw['grams'],
      nutrients: sanitizeNutrients(isRecord(raw['nutrients']) ? raw['nutrients'] : null),
      confidence: CONFIDENCE_LEVELS.includes(confidence as Confidence)
        ? (confidence as Confidence)
        : null,
      ...itemCountFields(
        itemPortion({
          count: isFiniteNumber(raw['count']) ? raw['count'] : null,
          unit: typeof raw['unit'] === 'string' ? raw['unit'] : null,
          unitPlural: typeof raw['unitPlural'] === 'string' ? raw['unitPlural'] : null,
        }),
      ),
      ...productIdField(typeof raw['productId'] === 'string' ? raw['productId'] : null),
      ...itemExtras({
        micros: sanitizeMicros(raw['micros']),
        fluidMl: isFiniteNumber(raw['fluidMl']) ? raw['fluidMl'] : null,
      }),
    });
  }
  return normalizeItems(items);
}

function revivePortion(value: unknown): OptionPortion | null {
  if (!isRecord(value)) {
    return null;
  }
  if (value['mode'] === 'grams' && isFiniteNumber(value['grams'])) {
    return { mode: 'grams', grams: clampQuickGrams(value['grams']) };
  }
  if (value['mode'] === 'servings' && isFiniteNumber(value['servings'])) {
    return { mode: 'servings', servings: clampServings(value['servings']) };
  }
  if (value['mode'] === 'count' && isFiniteNumber(value['count'])) {
    return { mode: 'count', count: clampCount(value['count']) };
  }
  return null;
}

const OPTION_SOURCES: readonly OptionSource[] = [
  'library',
  'barcode',
  'text',
  'food_photo',
  'nutrition_label',
  'menu',
];
const ANALYSIS_MODES: readonly AnalysisMode[] = ['text', 'food_photo', 'nutrition_label'];
const RESULT_KINDS: readonly FoodResultKind[] = ['favorite', 'meal', 'food', 'product'];
const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

function reviveLog(value: unknown): OptionLog | null {
  if (!isRecord(value)) {
    return null;
  }
  switch (value['kind']) {
    case 'analysis': {
      const description = stringOrNull(value['description']);
      const photoId = stringOrNull(value['photoId']);
      const mode = value['mode'] as AnalysisMode;
      if (
        typeof value['analysisId'] !== 'string' ||
        !ANALYSIS_MODES.includes(mode) ||
        description === undefined ||
        photoId === undefined
      ) {
        return null;
      }
      return { kind: 'analysis', analysisId: value['analysisId'], mode, description, photoId };
    }
    case 'library': {
      const resultKind = value['resultKind'] as FoodResultKind;
      const mealType = value['mealType'] as MealType | null;
      if (
        typeof value['key'] !== 'string' ||
        !RESULT_KINDS.includes(resultKind) ||
        (mealType !== null && !MEAL_TYPES.includes(mealType))
      ) {
        return null;
      }
      return { kind: 'library', key: value['key'], resultKind, mealType };
    }
    case 'product':
      return typeof value['productId'] === 'string'
        ? { kind: 'product', productId: value['productId'] }
        : null;
    case 'menu': {
      const description = stringOrNull(value['description']);
      return description === undefined ? null : { kind: 'menu', description };
    }
    default:
      return null;
  }
}

export function reviveOption(value: unknown): CompareOption | null {
  if (!isRecord(value) || !isRecord(value['base'])) {
    return null;
  }
  const source = value['source'] as OptionSource;
  const items = reviveItems(value['base']['items']);
  const basePortion = toPortion(value['base']['portion']);
  const revived = revivePortion(value['portion']);
  const portion =
    revived?.mode === 'count' && !basePortion
      ? { mode: 'servings' as const, servings: 1 }
      : revived;
  const log = reviveLog(value['log']);
  const detail = stringOrNull(value['detail']);
  const note = stringOrNull(value['note']);
  const thumbUrl = stringOrNull(value['thumbUrl']);
  const loggedEntryId = stringOrNull(value['loggedEntryId']);
  if (
    typeof value['id'] !== 'string' ||
    typeof value['name'] !== 'string' ||
    typeof value['badge'] !== 'string' ||
    !OPTION_SOURCES.includes(source) ||
    !isFiniteNumber(value['base']['grams']) ||
    !items ||
    !portion ||
    !log ||
    detail === undefined ||
    note === undefined ||
    thumbUrl === undefined ||
    loggedEntryId === undefined
  ) {
    return null;
  }
  return {
    id: value['id'],
    source,
    badge: value['badge'],
    name: cleanName(value['name'], 'Food'),
    detail,
    note,
    thumbUrl,
    base: {
      grams: sanitizeGrams(value['base']['grams']),
      items,
      totals: roundNutrients(
        sanitizeNutrients(isRecord(value['base']['totals']) ? value['base']['totals'] : null),
      ),
      portion: basePortion,
    },
    portion,
    log,
    loggedEntryId,
  };
}

export function reviveDish(value: unknown): MenuDish | null {
  if (!isRecord(value) || typeof value['name'] !== 'string' || !isFiniteNumber(value['grams'])) {
    return null;
  }
  const description = stringOrNull(value['description']);
  const notes = stringOrNull(value['notes']);
  const confidence = value['confidence'] as Confidence;
  if (description === undefined || notes === undefined || !CONFIDENCE_LEVELS.includes(confidence)) {
    return null;
  }
  return {
    name: value['name'],
    description,
    grams: sanitizeGrams(value['grams']),
    portion: toPortion(value['portion']),
    nutrients: roundNutrients(
      sanitizeNutrients(isRecord(value['nutrients']) ? value['nutrients'] : null),
    ),
    confidence,
    notes,
  };
}

function reviveMenu(value: unknown): SavedMenu | null {
  if (!isRecord(value) || !Array.isArray(value['dishes']) || !isFiniteNumber(value['scannedAt'])) {
    return null;
  }
  const restaurant = stringOrNull(value['restaurant']);
  const dishes = value['dishes'].map(reviveDish);
  const warnings = Array.isArray(value['warnings'])
    ? value['warnings'].filter((warning): warning is string => typeof warning === 'string')
    : [];
  if (restaurant === undefined || dishes.length === 0 || dishes.some((dish) => dish === null)) {
    return null;
  }
  return {
    restaurant,
    dishes: (dishes as MenuDish[]).slice(0, API_LIMITS.menuDishesMax),
    warnings,
    scannedAt: value['scannedAt'],
  };
}

export function parsePersisted(
  text: string | null,
  userId: string | null,
  now: number,
): PersistedCompare | null {
  if (!text || !userId) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !isRecord(raw) ||
    raw['v'] !== 1 ||
    raw['userId'] !== userId ||
    !isFiniteNumber(raw['savedAt']) ||
    now - raw['savedAt'] > COMPARE_MAX_AGE_MS ||
    raw['savedAt'] - now > COMPARE_MAX_AGE_MS ||
    !Array.isArray(raw['options'])
  ) {
    return null;
  }
  const options = raw['options']
    .map(reviveOption)
    .filter((option): option is CompareOption => option !== null)
    .slice(0, MAX_OPTIONS);
  return { v: 1, userId, savedAt: raw['savedAt'], options, menu: reviveMenu(raw['menu']) };
}
