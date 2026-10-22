import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  zeroNutrients,
  type AnalysisItem,
  type Nutrients,
  type SavedFoodRef,
} from '@food/shared';
import { MAYO, myFood } from '../../testing/my-foods-fixtures';
import { savedFoodRef } from '../../utils/saved-foods';
import {
  ITEM_PORTION_FACTORS,
  MEAL_PORTION_FACTORS,
  applyItemFactor,
  applyMealPortion,
  attachSavedFood,
  createDraftItem,
  draftFromAnalysisItem,
  draftFromEntryItem,
  gramsForFactor,
  gramsStep,
  hasItemFactor,
  initialMealPortion,
  isAddedByAi,
  itemPer100,
  itemSuggestion,
  itemsTotals,
  linkSavedFood,
  needsSavedFoods,
  portionBaseGrams,
  portionFactorLabel,
  renameItem,
  rescaleItem,
  sanitizeGrams,
  setItemCount,
  setItemUnit,
  stepGrams,
  toEntryItemInputs,
  unlinkItem,
  updateNutrient,
  useSavedFood,
  validateItems,
  type DraftItem,
  type MealPortionState,
} from './items-math';

function nutrients(values: Partial<Nutrients>): Nutrients {
  return { ...zeroNutrients(), ...values };
}

const RICE = nutrients({ calories: 195, protein: 4, carbs: 42, fat: 0.4, fiber: 0.6, sodium: 2 });

function rice(grams = 150): DraftItem {
  return createDraftItem({ name: 'Rice', grams, nutrients: RICE, confidence: 'high' });
}

function analysisItem(overrides: Partial<AnalysisItem> = {}): AnalysisItem {
  return {
    count: null,
    unit: null,
    unitPlural: null,
    name: 'Chicken breast',
    grams: 120,
    nutrients: nutrients({ calories: 198, protein: 37.2, fat: 4.3, satFat: 1.2, sodium: 89 }),
    per100g: nutrients({ calories: 165, protein: 31, fat: 3.6, satFat: 1, sodium: 74 }),
    micros: null,
    microsPer100g: null,
    fluidMl: null,
    confidence: 'medium',
    amountSource: 'visual_estimate',
    state: 'cooked',
    portionBasis: 'Palm-sized fillet',
    flags: ['atwater_check'],
    savedFood: null,
    suggestedFood: null,
    ...overrides,
  };
}

describe('sanitizeGrams', () => {
  it('clamps to the allowed range and rounds to one decimal', () => {
    expect(sanitizeGrams(-5)).toBe(0);
    expect(sanitizeGrams(Number.NaN)).toBe(0);
    expect(sanitizeGrams(12.345)).toBe(12.3);
    expect(sanitizeGrams(MAX_ITEM_GRAMS + 1)).toBe(MAX_ITEM_GRAMS);
  });
});

describe('createDraftItem', () => {
  it('creates an empty item with defaults and a unique key', () => {
    const a = createDraftItem();
    const b = createDraftItem();
    expect(a).toMatchObject({ name: '', grams: 0, nutrients: zeroNutrients(), basis: null });
    expect(a.confidence).toBeNull();
    expect(a.hints).toBeNull();
    expect(a.key).not.toBe(b.key);
  });

  it('captures a per-gram basis from the loaded nutrients', () => {
    const item = rice(150);
    expect(item.basis?.calories).toBeCloseTo(1.3, 10);
    expect(item.basis?.protein).toBeCloseTo(4 / 150, 10);
  });

  it('sanitizes negative and non-finite nutrient values', () => {
    const item = createDraftItem({
      name: 'Odd',
      grams: 10,
      nutrients: { calories: -3, protein: Number.POSITIVE_INFINITY, fat: 2 },
    });
    expect(item.nutrients.calories).toBe(0);
    expect(item.nutrients.protein).toBe(0);
    expect(item.nutrients.fat).toBe(2);
  });
});

describe('rescaleItem', () => {
  it('scales every nutrient proportionally to the new grams', () => {
    const doubled = rescaleItem(rice(150), 300);
    expect(doubled.grams).toBe(300);
    expect(doubled.nutrients).toEqual(
      nutrients({ calories: 390, protein: 8, carbs: 84, fat: 0.8, fiber: 1.2, sodium: 4 }),
    );
  });

  it('rounds scaled values using nutrient precision', () => {
    const item = rescaleItem(rice(150), 100);
    expect(item.nutrients.calories).toBe(130);
    expect(item.nutrients.protein).toBe(2.7);
    expect(item.nutrients.carbs).toBe(28);
    expect(item.nutrients.sodium).toBe(1);
  });

  it('does not accumulate rounding drift across repeated rescales', () => {
    let item = rice(150);
    for (const grams of [7, 13, 333, 1, 42]) {
      item = rescaleItem(item, grams);
    }
    const back = rescaleItem(item, 150);
    expect(back.nutrients).toEqual(RICE);
  });

  it('returns the same object when grams do not change', () => {
    const item = rice(150);
    expect(rescaleItem(item, 150)).toBe(item);
  });

  it('zeroes nutrients at 0 g but keeps the basis for a later rescale', () => {
    const zero = rescaleItem(rice(150), 0);
    expect(zero.grams).toBe(0);
    expect(zero.nutrients).toEqual(zeroNutrients());
    expect(zero.basis).not.toBeNull();
    const restored = rescaleItem(zero, 150);
    expect(restored.nutrients).toEqual(RICE);
  });

  it('keeps manually entered nutrients when an item without grams gets an amount', () => {
    const manual = createDraftItem({
      name: 'Protein bar',
      grams: 0,
      nutrients: { calories: 210, protein: 20 },
    });
    expect(manual.basis).toBeNull();
    const withGrams = rescaleItem(manual, 60);
    expect(withGrams.nutrients.calories).toBe(210);
    expect(withGrams.nutrients.protein).toBe(20);
    const doubled = rescaleItem(withGrams, 120);
    expect(doubled.nutrients.calories).toBe(420);
    expect(doubled.nutrients.protein).toBe(40);
  });

  it('prefers values typed while at 0 g over the remembered basis', () => {
    const zero = rescaleItem(rice(150), 0);
    const typed = updateNutrient(zero, 'calories', 500);
    const rescaled = rescaleItem(typed, 100);
    expect(rescaled.nutrients.calories).toBe(500);
    expect(rescaled.nutrients.carbs).toBe(28);
    expect(rescaleItem(rescaled, 200).nutrients.calories).toBe(1000);
  });

  it('clamps grams to the maximum item weight', () => {
    const item = rescaleItem(rice(150), MAX_ITEM_GRAMS * 3);
    expect(item.grams).toBe(MAX_ITEM_GRAMS);
  });
});

describe('updateNutrient', () => {
  it('sets the value and updates the basis used for future rescales', () => {
    const edited = updateNutrient(rice(150), 'protein', 6);
    expect(edited.nutrients.protein).toBe(6);
    expect(edited.nutrients.calories).toBe(195);
    const doubled = rescaleItem(edited, 300);
    expect(doubled.nutrients.protein).toBe(12);
    expect(doubled.nutrients.calories).toBe(390);
  });

  it('clamps negatives to zero and rounds to the nutrient precision', () => {
    const item = rice(150);
    expect(updateNutrient(item, 'fat', -4).nutrients.fat).toBe(0);
    expect(updateNutrient(item, 'fat', 1.26).nutrients.fat).toBe(1.3);
    expect(updateNutrient(item, 'calories', 199.6).nutrients.calories).toBe(200);
  });

  it('keeps the existing basis when the item has no grams', () => {
    const zero = rescaleItem(rice(150), 0);
    const edited = updateNutrient(zero, 'fiber', 3);
    expect(edited.basis).toEqual(zero.basis);
    expect(edited.nutrients.fiber).toBe(3);
  });
});

describe('draftFromAnalysisItem', () => {
  it('copies name, grams, nutrients, confidence and read-only hints', () => {
    const item = draftFromAnalysisItem(analysisItem());
    expect(item.name).toBe('Chicken breast');
    expect(item.grams).toBe(120);
    expect(item.nutrients.protein).toBe(37.2);
    expect(item.confidence).toBe('medium');
    expect(item.hints).toEqual({
      portionBasis: 'Palm-sized fillet',
      amountSource: 'visual_estimate',
      state: 'cooked',
      flags: ['atwater_check'],
    });
  });

  it('uses the precise per-100 g basis when it matches the item nutrients', () => {
    const item = draftFromAnalysisItem(analysisItem());
    expect(item.basis?.calories).toBeCloseTo(1.65, 10);
    expect(rescaleItem(item, 200).nutrients.calories).toBe(330);
  });

  it('falls back to the displayed nutrients when per-100 g values disagree', () => {
    const item = draftFromAnalysisItem(
      analysisItem({ per100g: nutrients({ calories: 400, protein: 10 }) }),
    );
    expect(item.basis?.calories).toBeCloseTo(198 / 120, 10);
    expect(rescaleItem(item, 240).nutrients.calories).toBe(396);
  });
});

describe('draftFromEntryItem', () => {
  it('creates a draft with a basis from a saved entry item', () => {
    const item = draftFromEntryItem({
      name: 'Oats',
      grams: 40,
      nutrients: nutrients({ calories: 150 }),
    });
    expect(item.confidence).toBeNull();
    expect(rescaleItem(item, 80).nutrients.calories).toBe(300);
  });
});

describe('itemsTotals', () => {
  it('sums and rounds nutrients across items', () => {
    const totals = itemsTotals([
      rice(150),
      createDraftItem({ name: 'Oil', grams: 5, nutrients: { calories: 44.2, fat: 5 } }),
    ]);
    expect(totals.calories).toBe(239);
    expect(totals.fat).toBe(5.4);
    expect(totals.carbs).toBe(42);
  });

  it('returns zeros for an empty list', () => {
    expect(itemsTotals([])).toEqual(zeroNutrients());
  });
});

describe('validateItems', () => {
  it('requires at least one item', () => {
    expect(validateItems([])).toBe('Add at least one item.');
  });

  it('reports the first unnamed item', () => {
    expect(validateItems([rice(), renameItem(rice(), '  ')])).toBe('Item 2 needs a name.');
  });

  it('enforces the item limit', () => {
    const many = Array.from({ length: API_LIMITS.itemsMax + 1 }, () => rice());
    expect(validateItems(many)).toContain(String(API_LIMITS.itemsMax));
  });

  it('accepts valid items', () => {
    expect(validateItems([rice()])).toBeNull();
  });
});

describe('toEntryItemInputs', () => {
  it('maps drafts to API inputs with trimmed names and sanitized values', () => {
    const inputs = toEntryItemInputs([
      renameItem(rice(150), '  Jasmine rice  '),
      createDraftItem({ name: 'x'.repeat(API_LIMITS.nameMax + 20), grams: 10.26 }),
    ]);
    expect(inputs[0]).toEqual({
      name: 'Jasmine rice',
      grams: 150,
      nutrients: RICE,
      confidence: 'high',
      count: null,
      unit: null,
      unitPlural: null,
    });
    expect(inputs[1].name).toHaveLength(API_LIMITS.nameMax);
    expect(inputs[1].grams).toBe(10.3);
    expect(inputs[1].confidence).toBeNull();
  });
});

describe('item counts', () => {
  const patties = (): DraftItem =>
    createDraftItem({
      name: 'Beef patty',
      grams: 300,
      nutrients: { calories: 750, protein: 60, fat: 55 },
      count: 2,
      unit: 'patty',
      unitPlural: 'patties',
    });

  it('carries counts from entries and analyses and never sends a count without a unit', () => {
    const fromEntry = draftFromEntryItem({
      name: 'Egg',
      grams: 100,
      nutrients: RICE,
      count: 2,
      unit: 'egg',
      unitPlural: 'eggs',
    });
    expect(fromEntry).toMatchObject({ count: 2, unit: 'egg', unitPlural: 'eggs' });
    const fromAi = draftFromAnalysisItem(
      analysisItem({ count: 3, unit: 'slice', unitPlural: 'slices' }),
    );
    expect(fromAi).toMatchObject({ count: 3, unit: 'slice', unitPlural: 'slices' });
    expect(createDraftItem({ name: 'Odd', count: 2, unit: '  ' })).toMatchObject({
      count: null,
      unit: null,
    });
    const [input] = toEntryItemInputs([patties()]);
    expect(input).toMatchObject({ count: 2, unit: 'patty', unitPlural: 'patties' });
    const [unitless] = toEntryItemInputs([{ ...rice(150), count: 2 }]);
    expect(unitless).toMatchObject({ count: null, unit: null, unitPlural: null });
  });

  it('counts in pieces until a unit is given', () => {
    const counted = setItemCount(rice(150), 2);
    expect(counted).toMatchObject({ count: 2, unit: 'piece', unitPlural: 'pieces' });
    expect(toEntryItemInputs([counted])[0]).toMatchObject({
      count: 2,
      unit: 'piece',
      unitPlural: 'pieces',
    });
    expect(setItemUnit(counted, '  ')).toMatchObject({ unit: 'piece', unitPlural: 'pieces' });
    expect(setItemUnit(rice(150), '  ')).toMatchObject({ unit: null, unitPlural: null });
    expect(setItemUnit(rice(150), 'slices')).toMatchObject({
      count: null,
      unit: 'slice',
      unitPlural: 'slices',
    });
    expect(setItemCount(patties(), 3)).toMatchObject({ unit: 'patty', unitPlural: 'patties' });
  });

  it('rescales grams from the per-unit weight when the count changes', () => {
    const one = setItemCount(patties(), 1);
    expect(one).toMatchObject({ count: 1, grams: 150 });
    expect(one.nutrients.calories).toBe(375);
    const three = setItemCount(one, 3);
    expect(three).toMatchObject({ count: 3, grams: 450 });
    expect(setItemCount(three, null).count).toBeNull();
    expect(setItemCount(three, null).grams).toBe(450);
  });

  it('keeps the count when grams are edited directly', () => {
    expect(rescaleItem(patties(), 320)).toMatchObject({ count: 2, grams: 320 });
  });

  it('defines the per-unit weight when a count is first added', () => {
    const counted = setItemUnit(setItemCount(rice(150), 3), 'scoops');
    expect(counted).toMatchObject({ grams: 150, count: 3, unit: 'scoop', unitPlural: 'scoops' });
    expect(setItemCount(counted, 1).grams).toBe(50);
    expect(applyItemFactor(counted, 2)).toMatchObject({ grams: 300, count: 6 });
  });

  it('scales counts with the item portion chips', () => {
    expect(applyItemFactor(patties(), 0.5)).toMatchObject({ grams: 150, count: 1 });
    expect(applyItemFactor(patties(), 1.5)).toMatchObject({ grams: 450, count: 3 });
  });

  it('scales counts with the whole meal and never compounds rounding', () => {
    let current = applyMealPortion([patties(), rice(150)], initialMealPortion(), 1 / 3);
    expect(current.items.map((item) => item.count)).toEqual([0.67, null]);
    current = applyMealPortion(current.items, current.state, 0.75);
    expect(current.items[0]).toMatchObject({ count: 1.5, grams: 225 });
    current = applyMealPortion(current.items, current.state, 1);
    expect(current.items[0]).toMatchObject({ count: 2, grams: 300 });
  });
});

describe('grams stepping', () => {
  it('picks larger steps for larger amounts', () => {
    expect(gramsStep(5)).toBe(1);
    expect(gramsStep(40)).toBe(5);
    expect(gramsStep(150)).toBe(10);
    expect(gramsStep(800)).toBe(25);
  });

  it('snaps to the step grid in both directions', () => {
    expect(stepGrams(147, 1)).toBe(150);
    expect(stepGrams(147, -1)).toBe(140);
    expect(stepGrams(150, 1)).toBe(160);
    expect(stepGrams(100, -1)).toBe(95);
    expect(stepGrams(12.5, 1)).toBe(13);
    expect(stepGrams(12.5, -1)).toBe(12);
  });

  it('never goes below zero', () => {
    expect(stepGrams(0, -1)).toBe(0);
    expect(stepGrams(0.4, -1)).toBe(0);
  });
});

describe('original grams', () => {
  it('remembers the grams an item was created with across edits', () => {
    const item = rescaleItem(updateNutrient(rice(150), 'protein', 5), 90);
    expect(item.originalGrams).toBe(150);
    expect(portionBaseGrams(item)).toBe(150);
    expect(createDraftItem().originalGrams).toBe(0);
    expect(draftFromAnalysisItem(analysisItem()).originalGrams).toBe(120);
    expect(draftFromEntryItem({ name: 'Oats', grams: 40, nutrients: RICE }).originalGrams).toBe(40);
  });

  it('treats items without a remembered amount as having no portion base', () => {
    const legacy: DraftItem = { ...rice(150), originalGrams: undefined };
    expect(portionBaseGrams(legacy)).toBe(0);
    expect(applyItemFactor(legacy, 2)).toBe(legacy);
    expect(hasItemFactor(legacy, 1)).toBe(false);
  });
});

describe('per-item portion factors', () => {
  it('offers ½× to 2× chips', () => {
    expect([...ITEM_PORTION_FACTORS]).toEqual([0.5, 0.75, 1, 1.25, 1.5, 2]);
  });

  it('scales an item relative to its original grams, never compounding', () => {
    const half = applyItemFactor(rice(150), 0.5);
    expect(half.grams).toBe(75);
    expect(half.nutrients.calories).toBe(98);
    const again = applyItemFactor(half, 0.5);
    expect(again.grams).toBe(75);
    expect(applyItemFactor(half, 2).grams).toBe(300);
    expect(applyItemFactor(half, 2).nutrients.calories).toBe(390);
  });

  it('reports which factor matches the current grams', () => {
    const item = applyItemFactor(rice(150), 1.25);
    expect(gramsForFactor(item, 1.25)).toBe(187.5);
    expect(hasItemFactor(item, 1.25)).toBe(true);
    expect(hasItemFactor(item, 1)).toBe(false);
    expect(hasItemFactor(rescaleItem(item, 187.4), 1.25)).toBe(false);
  });

  it('ignores invalid factors', () => {
    const item = rice(150);
    expect(applyItemFactor(item, 0)).toBe(item);
    expect(applyItemFactor(item, Number.NaN)).toBe(item);
  });
});

describe('isAddedByAi', () => {
  it('flags items the AI assumed were hidden', () => {
    expect(
      isAddedByAi(draftFromAnalysisItem(analysisItem({ amountSource: 'assumed_hidden' }))),
    ).toBe(true);
    expect(isAddedByAi(draftFromAnalysisItem(analysisItem()))).toBe(false);
    expect(isAddedByAi(rice())).toBe(false);
  });
});

describe('portionFactorLabel', () => {
  it('uses fraction glyphs for common portions', () => {
    expect(MEAL_PORTION_FACTORS.map(portionFactorLabel)).toEqual([
      '¼',
      '⅓',
      '½',
      '¾',
      '1',
      '1¼',
      '1½',
      '2',
    ]);
    expect(portionFactorLabel(1.75)).toBe('1.75');
  });
});

describe('applyMealPortion', () => {
  const oil = (): DraftItem =>
    createDraftItem({ name: 'Oil', grams: 10, nutrients: { calories: 88, fat: 10 } });

  function portion(items: DraftItem[], state: MealPortionState, factor: number) {
    return applyMealPortion(items, state, factor);
  }

  it('rescales every item proportionally', () => {
    const { items, state } = portion([rice(150), oil()], initialMealPortion(), 0.5);
    expect(items.map((item) => item.grams)).toEqual([75, 5]);
    expect(items[1].nutrients.calories).toBe(44);
    expect(state.factor).toBe(0.5);
  });

  it('is relative to the original estimate and never compounds', () => {
    let current = portion([rice(150), oil()], initialMealPortion(), 0.5);
    current = portion(current.items, current.state, 0.25);
    expect(current.items.map((item) => item.grams)).toEqual([37.5, 2.5]);
    current = portion(current.items, current.state, 1 / 3);
    expect(current.items.map((item) => item.grams)).toEqual([50, 3.3]);
    current = portion(current.items, current.state, 1);
    expect(current.items.map((item) => item.grams)).toEqual([150, 10]);
    expect(current.items[0].nutrients).toEqual(RICE);
  });

  it('keeps manual edits made between portion changes', () => {
    const first = portion([rice(150), oil()], initialMealPortion(), 0.5);
    const edited = [rescaleItem(first.items[0], 100), first.items[1]];
    const back = portion(edited, first.state, 1);
    expect(back.items.map((item) => item.grams)).toEqual([200, 10]);
    const half = portion(back.items, back.state, 0.5);
    expect(half.items.map((item) => item.grams)).toEqual([100, 5]);
  });

  it('includes items added after the first portion change', () => {
    const first = portion([rice(150)], initialMealPortion(), 0.5);
    const added = [...first.items, oil()];
    const doubled = portion(added, first.state, 1);
    expect(doubled.items.map((item) => item.grams)).toEqual([150, 20]);
  });

  it('scales the nutrients of items without grams', () => {
    const bar = createDraftItem({
      name: 'Bar',
      grams: 0,
      nutrients: { calories: 210, protein: 20 },
    });
    let current = portion([bar], initialMealPortion(), 0.5);
    expect(current.items[0].nutrients.calories).toBe(105);
    current = portion(current.items, current.state, 2);
    expect(current.items[0].nutrients.calories).toBe(420);
    current = portion(current.items, current.state, 1);
    expect(current.items[0].nutrients).toMatchObject({ calories: 210, protein: 20 });
  });

  it('returns the same state for the current or an invalid factor', () => {
    const state = initialMealPortion();
    expect(portion([rice(150)], state, 1).state).toBe(state);
    expect(portion([rice(150)], state, 0).state).toBe(state);
    expect(portion([rice(150)], state, -2).items[0].grams).toBe(150);
  });
});

describe('saved foods on items', () => {
  const KETCHUP_FOOD = myFood({ aliases: [] });
  const KETCHUP: SavedFoodRef = savedFoodRef(KETCHUP_FOOD);

  function typedKetchup(grams = 26): DraftItem {
    return createDraftItem({
      name: 'Tomato ketchup',
      grams,
      nutrients: nutrients({ calories: 30.7, carbs: 7 }),
    });
  }

  it('uses a saved food’s name, link and per-100 values for the item’s grams', () => {
    const used = useSavedFood(typedKetchup(26), KETCHUP);
    expect(used).toMatchObject({
      name: 'Heinz tomato ketchup',
      grams: 26,
      productId: 'food-ketchup',
      savedFood: KETCHUP,
      suggestedFood: null,
    });
    expect(used.nutrients).toEqual(
      nutrients({ calories: 29, carbs: 6.7, sugar: 5.9, protein: 0.3, sodium: 234 }),
    );
    expect(useSavedFood(typedKetchup(0), KETCHUP).nutrients).toEqual(zeroNutrients());
  });

  it('keeps the link when grams change and recomputes from the saved per-100', () => {
    const linked = useSavedFood(typedKetchup(26), KETCHUP);
    const doubled = rescaleItem(linked, 52);
    expect(doubled.productId).toBe('food-ketchup');
    expect(doubled.nutrients.calories).toBe(57);
    expect(rescaleItem(doubled, 100).nutrients.calories).toBe(110);
    const counted = setItemCount({ ...linked, count: 2, unit: 'tbsp', unitPlural: 'tbsp' }, 3);
    expect(counted).toMatchObject({ productId: 'food-ketchup', grams: 39 });
    expect(applyItemFactor(linked, 2).productId).toBe('food-ketchup');
  });

  it('unlinks an item whose nutrients are edited by hand but keeps its values', () => {
    const linked = useSavedFood(typedKetchup(26), KETCHUP);
    const edited = updateNutrient(linked, 'calories', 40);
    expect(edited).toMatchObject({
      productId: null,
      savedFood: null,
      name: 'Heinz tomato ketchup',
    });
    expect(edited.nutrients.calories).toBe(40);
    expect(updateNutrient({ ...linked, grams: 0 }, 'protein', 1).productId).toBeNull();
    expect(unlinkItem(linked)).toMatchObject({ productId: null, nutrients: linked.nutrients });
    const plain = typedKetchup();
    expect(unlinkItem(plain)).toBe(plain);
  });

  it('names an item after a branded saved food the same way the API does', () => {
    const branded = savedFoodRef(
      myFood({ id: 'food-labneh', name: 'Labneh', brand: 'Khoury', aliases: [] }),
    );
    const item = createDraftItem({ name: 'Labneh', grams: 30 });
    expect(useSavedFood(item, branded).name).toBe('Khoury Labneh');
    expect(linkSavedFood(item, branded).name).toBe('Khoury Labneh');
  });

  it('links a saved food without changing the item’s values', () => {
    const item = typedKetchup(26);
    const linked = linkSavedFood(item, KETCHUP);
    expect(linked).toMatchObject({ productId: 'food-ketchup', name: 'Heinz tomato ketchup' });
    expect(linked.nutrients).toEqual(item.nutrients);
    expect(rescaleItem(linked, 100).nutrients.calories).toBe(110);
  });

  it('attaches the saved values only to the item that links that food', () => {
    const item = createDraftItem({ name: 'Ketchup', grams: 26, productId: 'food-ketchup' });
    expect(attachSavedFood(item, KETCHUP).savedFood).toBe(KETCHUP);
    expect(attachSavedFood(item, savedFoodRef(MAYO))).toBe(item);
  });

  it('turns an item into per-100 values for saving', () => {
    expect(itemPer100(typedKetchup(26))).toEqual(nutrients({ calories: 119, carbs: 26.9 }));
    expect(itemPer100(typedKetchup(0))).toBeNull();
  });

  it('carries links from analyses and entries to the API', () => {
    const linked = draftFromAnalysisItem(
      analysisItem({ name: 'Heinz tomato ketchup', grams: 26, savedFood: KETCHUP }),
    );
    expect(linked).toMatchObject({ productId: 'food-ketchup', savedFood: KETCHUP });
    expect(rescaleItem(linked, 100).nutrients.calories).toBe(110);
    const suggested = draftFromAnalysisItem(
      analysisItem({ name: 'Tomato ketchup', suggestedFood: KETCHUP }),
    );
    expect(suggested).toMatchObject({ productId: null, suggestedFood: KETCHUP });
    expect(suggested.aiName).toBe('Tomato ketchup');

    const fromEntry = draftFromEntryItem({
      name: 'Ketchup',
      grams: 26,
      nutrients: nutrients({ calories: 29 }),
      productId: 'food-ketchup',
    });
    expect(fromEntry.productId).toBe('food-ketchup');
    const [input, plain] = toEntryItemInputs([fromEntry, rice()]);
    expect(input.productId).toBe('food-ketchup');
    expect(plain).not.toHaveProperty('productId');
  });

  it('suggests the server’s match until the AI name is changed, then matches locally', () => {
    const foods = [KETCHUP_FOOD, MAYO];
    const fromAi = draftFromAnalysisItem(
      analysisItem({ name: 'Tomato ketchup', suggestedFood: null }),
    );
    expect(itemSuggestion(fromAi, foods)).toBeNull();
    expect(needsSavedFoods(fromAi)).toBe(false);

    const renamed = renameItem(fromAi, 'Mayonnaise, regular');
    expect(needsSavedFoods(renamed)).toBe(true);
    expect(itemSuggestion(renamed, foods)?.id).toBe('food-mayo');

    const typed = createDraftItem({ name: 'tomato ketchup', grams: 20 });
    expect(itemSuggestion(typed, foods)?.id).toBe('food-ketchup');
    expect(itemSuggestion(createDraftItem({ name: 'Garlic mayonnaise sauce' }), foods)).toBeNull();
    expect(itemSuggestion(useSavedFood(typed, KETCHUP), foods)).toBeNull();
    expect(needsSavedFoods(createDraftItem({ name: 'Ketchup', productId: 'food-ketchup' }))).toBe(
      true,
    );
  });
});
