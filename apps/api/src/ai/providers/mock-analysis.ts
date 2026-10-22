import type { AmountSource, Confidence } from '@food/shared';
import type {
  FoodAnalysisItem,
  FoodAnalysisLabel,
  FoodAnalysisOutput,
  FoodAnalysisPortion,
  FoodMicroValues,
  FoodNutrientValues,
} from '../food-analysis.schema.js';
import type { AnalysisPromptInput, FollowUpContext } from '../prompt.js';
import {
  BUTTER,
  FRIED_BREADED_CHICKEN,
  FRIED_BREADED_CHICKEN_MICROS,
  GENERIC_DISH,
  GENERIC_DISH_MICROS,
  GENERIC_FOLLOW_UP,
  MOCK_FOODS,
  MOCK_LABEL,
  MOCK_PACKAGING_LABEL,
  type MockComponent,
  type MockFollowUp,
  type MockFood,
  type MockLabel,
  type MockUnit,
  OAT_DRINK,
  OAT_DRINK_MICROS,
  OLIVE_OIL,
  PHOTO_FOLLOW_UP,
  PHOTO_PLATE,
  WHOLE_MILK,
  WHOLE_MILK_MICROS,
} from './mock-foods.js';
import {
  linkMockSavedFoods,
  MOCK_SAVED_FOOD_GRAMS,
  MOCK_SEGMENT_SEPARATOR,
} from './mock-saved-foods.js';

interface DraftItem {
  key: string;
  item: FoodAnalysisItem;
}

interface Draft {
  mealName: string;
  portion: FoodAnalysisPortion | null;
  items: DraftItem[];
  label: FoodAnalysisLabel | null;
  followUp: MockFollowUp | null;
  assumptions: string[];
}

interface ItemDefaults {
  source: AmountSource;
  confidence: Confidence;
  basis: string;
}

type Quantity = { grams: number } | { count: number } | null;

export const MOCK_NOTICE = 'Mock AI result (AI_PROVIDER=mock)';

const GRAMS_PATTERN = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|grams?|ml)\b/i;
const COUNT_PATTERN =
  /^\s*(\d*½|(?:\d+(?:[.,]\d+)?|an?|one|two|three|four|five|six|half)\b)/i;
const SERVINGS_PATTERN = /(\d+(?:[.,]\d+)?)\s*servings?\b/i;
const NO_FOOD_PATTERN = /\bno food\b|^\s*nothing\b/i;
const COUNT_WORDS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  half: 0.5,
};

const TEXT_DEFAULTS: ItemDefaults = {
  source: 'typical_serving',
  confidence: 'medium',
  basis: 'Typical serving',
};

const PHOTO_DEFAULTS: ItemDefaults = {
  source: 'visual_estimate',
  confidence: 'medium',
  basis: 'Estimated against plate size',
};

function parseNumber(text: string): number {
  if (text.endsWith('½')) {
    return Number(text.slice(0, -1) || 0) + 0.5;
  }
  return Number(text.replace(',', '.'));
}

function counted(
  unit: MockUnit | undefined,
  count: number | null,
): FoodAnalysisPortion | null {
  return unit && count !== null
    ? { count, unit: unit[0], unit_plural: unit[1] }
    : null;
}

function statedCount(quantity: Quantity): number | null {
  if (quantity === null) {
    return 1;
  }
  return 'count' in quantity ? quantity.count : null;
}

function roundGrams(grams: number): number {
  return Math.round(grams * 10) / 10;
}

function withGrams(item: FoodAnalysisItem, grams: number): FoodAnalysisItem {
  const rounded = roundGrams(grams);
  return {
    ...item,
    estimated_quantity_g: rounded,
    fluid_ml: item.fluid_ml === null ? null : rounded,
  };
}

function parseQuantity(segment: string): Quantity {
  const grams = GRAMS_PATTERN.exec(segment);
  if (grams?.[1] && grams[2]) {
    const factor = grams[2].toLowerCase() === 'kg' ? 1000 : 1;
    return { grams: parseNumber(grams[1]) * factor };
  }
  const count = COUNT_PATTERN.exec(segment)?.[1]?.toLowerCase();
  if (count) {
    return { count: COUNT_WORDS[count] ?? parseNumber(count) };
  }
  return null;
}

function toItem(
  component: MockComponent,
  grams: number,
  defaults: ItemDefaults,
  count: number | null = null,
): FoodAnalysisItem {
  const hidden = component.amountSource === 'assumed_hidden';
  const pieces = counted(component.unit, count);
  return {
    name: component.name,
    saved_food: null,
    amount_source: component.amountSource ?? defaults.source,
    count: pieces?.count ?? null,
    unit: pieces?.unit ?? null,
    unit_plural: pieces?.unit_plural ?? null,
    portion_basis: hidden ? 'Typical amount for this dish' : defaults.basis,
    state: component.state,
    estimated_quantity_g: roundGrams(grams),
    fluid_ml: component.drink ? roundGrams(grams) : null,
    per_100g: { ...component.per100 },
    micros_per_100g: { ...component.micros },
    confidence: component.confidence ?? defaults.confidence,
  };
}

function itemsForFood(
  food: MockFood,
  quantity: Quantity,
  defaults: ItemDefaults,
): DraftItem[] {
  const count = statedCount(quantity);
  return food.components.map((component, index) => {
    if (quantity && 'grams' in quantity && index === 0) {
      return {
        key: component.key,
        item: toItem(component, quantity.grams, {
          source: 'user_stated',
          confidence: 'high',
          basis: 'Weight stated by user',
        }),
      };
    }
    if (quantity && 'count' in quantity) {
      return {
        key: component.key,
        item: toItem(
          component,
          component.grams * quantity.count,
          {
            ...defaults,
            source: 'user_stated',
            basis: `${quantity.count} × ~${component.grams} g`,
          },
          count,
        ),
      };
    }
    return {
      key: component.key,
      item: toItem(component, component.grams, defaults, count),
    };
  });
}

interface ParsedDescription {
  titles: string[];
  portions: (FoodAnalysisPortion | null)[];
  items: DraftItem[];
  followUp: MockFollowUp | null;
}

function mealPortion(
  portions: readonly (FoodAnalysisPortion | null)[],
): FoodAnalysisPortion | null {
  const [only, ...others] = portions;
  return only !== undefined && others.length === 0 ? only : null;
}

function parseDescription(
  description: string,
  defaults: ItemDefaults,
): ParsedDescription {
  const parsed: ParsedDescription = {
    titles: [],
    portions: [],
    items: [],
    followUp: null,
  };
  for (const segment of description.split(MOCK_SEGMENT_SEPARATOR)) {
    const food = MOCK_FOODS.find((candidate) =>
      candidate.pattern.test(segment),
    );
    if (!food) {
      continue;
    }
    const quantity = parseQuantity(segment);
    parsed.titles.push(food.title);
    parsed.portions.push(counted(food.unit, statedCount(quantity)));
    parsed.items.push(...itemsForFood(food, quantity, defaults));
    const weighed = quantity !== null && 'grams' in quantity;
    if (!weighed && food.followUp && !parsed.followUp) {
      parsed.followUp = food.followUp;
    }
  }
  return parsed;
}

function withoutKey(items: DraftItem[], key: string): DraftItem[] {
  return items.filter((draft) => draft.key !== key);
}

function withFat(
  items: DraftItem[],
  fat: MockComponent,
  grams: number,
  confidence: Confidence,
): DraftItem[] {
  return [
    ...withoutKey(items, 'oil'),
    {
      key: 'oil',
      item: toItem({ ...fat, grams, confidence }, grams, PHOTO_DEFAULTS),
    },
  ];
}

function deepFried(items: DraftItem[]): DraftItem[] {
  return withoutKey(items, 'oil').map((draft) =>
    draft.key === 'chicken'
      ? {
          ...draft,
          item: {
            ...draft.item,
            name: 'Chicken breast, breaded and deep-fried',
            per_100g: { ...FRIED_BREADED_CHICKEN },
            micros_per_100g: { ...FRIED_BREADED_CHICKEN_MICROS },
          },
        }
      : draft,
  );
}

function applyCooking(
  items: DraftItem[],
  text: string,
  options: {
    oilGrams: number;
    confidence: Confidence;
    dryCookingRemovesOil: boolean;
  },
): DraftItem[] {
  if (items.length === 0) {
    return items;
  }
  if (/deep[- ]?fr/i.test(text)) {
    return deepFried(items);
  }
  if (/no oil|without oil|air[- ]?fr/i.test(text)) {
    return withoutKey(items, 'oil');
  }
  if (/\bbutter\b/i.test(text)) {
    return withFat(items, BUTTER, options.oilGrams, options.confidence);
  }
  if (/\bfried\b|\bin oil\b|\boil\b/i.test(text)) {
    return withFat(items, OLIVE_OIL, options.oilGrams, options.confidence);
  }
  if (
    options.dryCookingRemovesOil &&
    /grilled|steamed|boiled|baked/i.test(text)
  ) {
    return withoutKey(items, 'oil');
  }
  return items;
}

function replaceMilk(items: DraftItem[], answer: string): DraftItem[] {
  if (/\bwater\b/i.test(answer)) {
    return withoutKey(items, 'milk');
  }
  const replacement: [string, FoodNutrientValues, FoodMicroValues] | null =
    /whole milk/i.test(answer)
      ? ['Whole milk', WHOLE_MILK, WHOLE_MILK_MICROS]
      : /\boat/i.test(answer)
        ? ['Oat drink', OAT_DRINK, OAT_DRINK_MICROS]
        : null;
  if (!replacement) {
    return items;
  }
  return items.map((draft) =>
    draft.key === 'milk'
      ? {
          ...draft,
          item: {
            ...draft.item,
            name: replacement[0],
            per_100g: { ...replacement[1] },
            micros_per_100g: { ...replacement[2] },
            confidence: 'high',
          },
        }
      : draft,
  );
}

function mainIndex(items: DraftItem[]): number {
  return items.findIndex(
    (draft) => draft.item.amount_source !== 'assumed_hidden',
  );
}

function scaleCount(count: number | null, factor: number): number | null {
  return count === null ? null : Math.round(count * factor * 100) / 100;
}

function scaleItems(
  items: DraftItem[],
  factor: number,
  onlyIndex: number | null,
): DraftItem[] {
  return items.map((draft, index) =>
    onlyIndex === null || index === onlyIndex
      ? {
          ...draft,
          item: {
            ...withGrams(draft.item, draft.item.estimated_quantity_g * factor),
            count:
              onlyIndex === null
                ? scaleCount(draft.item.count, factor)
                : draft.item.count,
          },
        }
      : draft,
  );
}

function scaledMealPortion(
  portion: FoodAnalysisPortion | null,
  factor: number,
): FoodAnalysisPortion | null {
  return portion
    ? { ...portion, count: scaleCount(portion.count, factor) ?? portion.count }
    : null;
}

function setMainGrams(items: DraftItem[], grams: number): DraftItem[] {
  const index = mainIndex(items);
  return items.map((draft, i) =>
    i === index
      ? {
          ...draft,
          item: {
            ...withGrams(draft.item, grams),
            amount_source: 'user_stated',
            portion_basis: 'From your answer',
            confidence: 'high',
          },
        }
      : draft,
  );
}

function answeredLabelGrams(
  label: FoodAnalysisLabel,
  answer: string,
): number | null {
  const servings = SERVINGS_PATTERN.exec(answer)?.[1];
  if (servings && label.serving_size) {
    return parseNumber(servings) * label.serving_size;
  }
  if (label.pack_size && /half (?:the |a )?(?:pack|bag|box)/i.test(answer)) {
    return label.pack_size / 2;
  }
  if (
    label.pack_size &&
    /(?:whole|entire|all the) (?:pack|bag|box)/i.test(answer)
  ) {
    return label.pack_size;
  }
  return null;
}

interface PortionChange {
  items: DraftItem[];
  mealFactor: number;
}

function resized(items: DraftItem[], mealFactor = 1): PortionChange {
  return { items, mealFactor };
}

function applyPortion(draft: Draft, answer: string): PortionChange {
  const stated = GRAMS_PATTERN.exec(answer);
  if (stated?.[1]) {
    return resized(setMainGrams(draft.items, parseNumber(stated[1])));
  }
  const fromLabel = draft.label
    ? answeredLabelGrams(draft.label, answer)
    : null;
  if (fromLabel !== null) {
    return resized(setMainGrams(draft.items, fromLabel));
  }
  if (/\b(small|thin|smash|little)\b/i.test(answer)) {
    return resized(scaleItems(draft.items, 0.7, mainIndex(draft.items)));
  }
  if (/\b(large|big|double|huge)\b/i.test(answer)) {
    return resized(scaleItems(draft.items, 1.5, mainIndex(draft.items)));
  }
  if (/\bhalf\b/i.test(answer)) {
    return resized(scaleItems(draft.items, 0.5, null), 0.5);
  }
  return resized(draft.items);
}

function applyAnswer(draft: Draft, answer: string): Draft {
  const cooked = applyCooking(draft.items, answer, {
    oilGrams: 15,
    confidence: 'medium',
    dryCookingRemovesOil: true,
  });
  const { items, mealFactor } = applyPortion(
    { ...draft, items: replaceMilk(cooked, answer) },
    answer,
  );
  return {
    ...draft,
    portion: scaledMealPortion(draft.portion, mealFactor),
    items,
    followUp: null,
    assumptions: [...draft.assumptions, `Applied your answer: "${answer}"`],
  };
}

interface LabelAmount {
  grams: number;
  source: AmountSource;
  basis: string;
  confidence: Confidence;
}

function labelAmount(
  label: MockLabel,
  stated: number | null,
  hasFoodPhoto: boolean,
): LabelAmount {
  if (stated !== null) {
    return {
      grams: stated,
      source: 'user_stated',
      basis: 'Weight stated by user',
      confidence: 'high',
    };
  }
  if (hasFoodPhoto) {
    return {
      grams: label.servingSize,
      source: 'visual_estimate',
      basis: 'Estimated from the food photo',
      confidence: 'medium',
    };
  }
  return {
    grams: label.servingSize,
    source: 'label',
    basis: 'One serving per label',
    confidence: 'high',
  };
}

function labelDraft(
  label: MockLabel,
  description: string,
  hasFoodPhoto: boolean,
): Draft {
  const quantity = parseQuantity(description);
  const stated = quantity && 'grams' in quantity ? quantity.grams : null;
  const amount = labelAmount(label, stated, hasFoodPhoto);
  const askAmount = amount.source === 'label';
  const item: FoodAnalysisItem = {
    name: label.productName,
    saved_food: null,
    amount_source: amount.source,
    count: null,
    unit: null,
    unit_plural: null,
    portion_basis: amount.basis,
    state: 'as_served',
    estimated_quantity_g: amount.grams,
    fluid_ml: null,
    per_100g: { ...label.per100 },
    micros_per_100g: { ...label.micros },
    confidence: amount.confidence,
  };
  return {
    mealName: label.productName,
    portion: null,
    items: [{ key: 'label', item }],
    label: {
      product_name: label.productName,
      basis_unit: 'g',
      per_100: { ...label.per100 },
      micros_per_100: { ...label.printedMicros },
      serving_size: label.servingSize,
      serving_text: label.servingText,
      pack_size: label.packSize,
    },
    followUp: askAmount
      ? { question: 'How much did you eat?', options: [...label.amountOptions] }
      : null,
    assumptions: askAmount ? ['Ate one serving'] : [],
  };
}

function emptyDraft(): Draft {
  return {
    mealName: 'Nothing detected',
    portion: null,
    items: [],
    label: null,
    followUp: { question: 'What did you eat?', options: [] },
    assumptions: [],
  };
}

function genericDraft(description: string): Draft {
  const name = description.trim().slice(0, 60) || 'Mixed dish';
  return {
    mealName: name,
    portion: null,
    items: [
      {
        key: 'generic',
        item: toItem(
          {
            key: 'generic',
            name,
            state: 'as_served',
            grams: 250,
            per100: GENERIC_DISH,
            micros: GENERIC_DISH_MICROS,
          },
          250,
          {
            source: 'typical_serving',
            confidence: 'low',
            basis: 'Typical serving',
          },
        ),
      },
    ],
    label: null,
    followUp: GENERIC_FOLLOW_UP,
    assumptions: ['Generic mixed-dish values'],
  };
}

function photoPlateDraft(): Draft {
  return {
    mealName: 'Chicken, rice & broccoli',
    portion: null,
    items: PHOTO_PLATE.map((component) => ({
      key: component.key,
      item: toItem(component, component.grams, PHOTO_DEFAULTS),
    })),
    label: null,
    followUp: PHOTO_FOLLOW_UP,
    assumptions: [
      'About 10 g oil used for cooking',
      'Rice cooked without salt',
    ],
  };
}

function baseDraft(prompt: AnalysisPromptInput, hasImage: boolean): Draft {
  const description = prompt.description ?? '';
  const hasFoodPhoto = prompt.imageRoles.includes('food');
  if (prompt.mode === 'nutrition_label') {
    return labelDraft(MOCK_LABEL, description, hasFoodPhoto);
  }
  if (prompt.imageRoles.includes('label')) {
    return labelDraft(MOCK_PACKAGING_LABEL, description, hasFoodPhoto);
  }
  if (NO_FOOD_PATTERN.test(description)) {
    return emptyDraft();
  }
  const parsed = parseDescription(
    description,
    hasImage ? PHOTO_DEFAULTS : TEXT_DEFAULTS,
  );
  if (parsed.items.length > 0) {
    return {
      mealName: parsed.titles.slice(0, 3).join(' & '),
      portion: mealPortion(parsed.portions),
      items: applyCooking(parsed.items, description, {
        oilGrams: 10,
        confidence: 'low',
        dryCookingRemovesOil: false,
      }),
      label: null,
      followUp: parsed.followUp,
      assumptions: [],
    };
  }
  return hasImage ? photoPlateDraft() : genericDraft(description);
}

function applyFollowUp(draft: Draft, followUp: FollowUpContext | null): Draft {
  if (followUp === null) {
    return draft;
  }
  const applied = applyAnswer(draft, followUp.answer);
  return followUp.kind === 'correction'
    ? { ...applied, followUp: draft.followUp }
    : applied;
}

function savedFoodGrams(segment: string): number {
  const quantity = parseQuantity(segment);
  return quantity && 'grams' in quantity
    ? roundGrams(quantity.grams)
    : MOCK_SAVED_FOOD_GRAMS;
}

export function mockAnalysis(prompt: AnalysisPromptInput): FoodAnalysisOutput {
  const hasImage = prompt.imageRoles.length > 0;
  const earlier = prompt.answeredQuestions
    .map((answered) => answered.answer)
    .reduce(applyAnswer, baseDraft(prompt, hasImage));
  const draft = applyFollowUp(earlier, prompt.followUp);
  return {
    input_type: prompt.mode,
    meal_name: draft.mealName,
    portion: draft.portion,
    scale_cues: hasImage ? 'Dinner plate ~27 cm, fork for scale' : 'none',
    items: linkMockSavedFoods(
      draft.items.map((entry) => entry.item),
      prompt.description ?? '',
      prompt.savedFoods ?? [],
      savedFoodGrams,
    ),
    label: draft.label,
    assumptions: [MOCK_NOTICE, ...draft.assumptions],
    follow_up_question: draft.followUp?.question ?? null,
    follow_up_options: draft.followUp?.options ?? [],
  };
}
