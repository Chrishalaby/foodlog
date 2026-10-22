import { zeroNutrients, type AnalysisItem, type Nutrients } from '@food/shared';
import { myFood, per100 } from '../../testing/my-foods-fixtures';
import { savedFoodRef } from '../../utils/saved-foods';
import {
  DEFAULT_DRINK_ML,
  applyItemFactor,
  applyMealPortion,
  attachSavedFood,
  createDraftItem,
  defaultDrinkMl,
  draftFromAnalysisItem,
  draftFromEntryItem,
  initialMealPortion,
  isDrink,
  itemsMicros,
  linkSavedFood,
  rescaleItem,
  setItemCount,
  setItemFluid,
  toEntryItemInputs,
  updateNutrient,
  useSavedFood,
} from './items-math';

function nutrients(values: Partial<Nutrients>): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function analysisItem(overrides: Partial<AnalysisItem> = {}): AnalysisItem {
  return {
    count: null,
    unit: null,
    unitPlural: null,
    name: 'Red apple',
    grams: 180,
    nutrients: nutrients({ calories: 94, carbs: 25, sugar: 19, fiber: 4.3 }),
    per100g: nutrients({ calories: 52, carbs: 13.8, sugar: 10.4, fiber: 2.4 }),
    micros: { vitaminC: 8, potassium: 193 },
    microsPer100g: { vitaminC: 4.6, potassium: 107 },
    fluidMl: null,
    confidence: 'high',
    amountSource: 'visual_estimate',
    state: 'raw',
    portionBasis: 'One medium apple',
    flags: [],
    savedFood: null,
    suggestedFood: null,
    ...overrides,
  };
}

const PEPSI = {
  name: 'Diet Pepsi',
  grams: 330,
  nutrients: nutrients({ sodium: 40 }),
  micros: { caffeine: 36 },
  fluidMl: 330,
};

const VITAMIN_D = myFood({
  id: 'food-vitamin-d',
  name: 'Doctor’s Best Vitamin D3 5000 IU',
  aliases: [],
  unitName: 'softgel',
  unitGrams: 0.5,
  per100: per100({ calories: 900, fat: 100 }),
  microsPer100: { vitaminD: 25000 },
});

describe('item micros and drinks', () => {
  it('rescales micros and drink ml by the ratio of new to old grams', () => {
    const can = createDraftItem(PEPSI);
    const bottle = rescaleItem(can, 500);
    expect(bottle.micros).toEqual({ caffeine: 55 });
    expect(bottle.fluidMl).toBe(500);
    const back = rescaleItem(bottle, 330);
    expect(back.micros).toEqual({ caffeine: 36 });
    expect(back.fluidMl).toBe(330);
  });

  it('rescales from the AI per-100 g micros when they are known', () => {
    const apple = draftFromAnalysisItem(analysisItem());
    expect(apple.micros).toEqual({ vitaminC: 8, potassium: 193 });
    const half = rescaleItem(apple, 90);
    expect(half.micros).toEqual({ vitaminC: 4, potassium: 96 });
    expect(rescaleItem(apple, 200).micros).toEqual({ vitaminC: 9, potassium: 214 });
  });

  it('keeps micros at 0 g as known zeros and restores them when grams come back', () => {
    const apple = draftFromAnalysisItem(analysisItem());
    const none = rescaleItem(apple, 0);
    expect(none.micros).toEqual({ vitaminC: 0, potassium: 0 });
    expect(rescaleItem(none, 180).micros).toEqual({ vitaminC: 8, potassium: 193 });
  });

  it('rescales micros and drink ml when the count changes', () => {
    const cans = createDraftItem({ ...PEPSI, count: 1, unit: 'can', unitPlural: 'cans' });
    const two = setItemCount(cans, 2);
    expect(two.grams).toBe(660);
    expect(two.micros).toEqual({ caffeine: 72 });
    expect(two.fluidMl).toBe(660);
  });

  it('scales micros and drink ml with the item portion chips and the meal portion', () => {
    const can = createDraftItem(PEPSI);
    expect(applyItemFactor(can, 0.5).fluidMl).toBe(165);
    expect(applyItemFactor(can, 0.5).micros).toEqual({ caffeine: 18 });
    const { items } = applyMealPortion([can], initialMealPortion(), 2);
    expect(items[0].micros).toEqual({ caffeine: 72 });
    expect(items[0].fluidMl).toBe(660);
  });

  it('scales micros of items without grams with the meal portion', () => {
    const shot = createDraftItem({ name: 'Espresso', micros: { caffeine: 64 }, fluidMl: 30 });
    const { items } = applyMealPortion([shot], initialMealPortion(), 2);
    expect(items[0].micros).toEqual({ caffeine: 128 });
    expect(items[0].fluidMl).toBe(60);
  });

  it('leaves micros alone when nutrients are edited by hand', () => {
    const apple = draftFromAnalysisItem(analysisItem());
    const edited = updateNutrient(apple, 'calories', 120);
    expect(edited.nutrients.calories).toBe(120);
    expect(edited.micros).toEqual({ vitaminC: 8, potassium: 193 });
  });

  it('applies a saved food’s micros per 100 g when its values are used', () => {
    const softgel = createDraftItem({ name: 'Vitamin D', grams: 0.5, micros: { vitaminD: 50 } });
    const used = useSavedFood(softgel, savedFoodRef(VITAMIN_D));
    expect(used.micros).toEqual({ vitaminD: 125 });
    expect(used.productId).toBe('food-vitamin-d');
    expect(rescaleItem(used, 1).micros).toEqual({ vitaminD: 250 });
  });

  it('keeps the item’s own micros when the saved food has none', () => {
    const apple = draftFromAnalysisItem(analysisItem());
    const used = useSavedFood(apple, savedFoodRef(myFood({ id: 'food-apple', name: 'Apple' })));
    expect(used.micros).toEqual({ vitaminC: 8, potassium: 193 });
    expect(rescaleItem(used, 90).micros).toEqual({ vitaminC: 4, potassium: 96 });
  });

  it('rescales a linked entry item from the saved micros per 100 g', () => {
    const logged = draftFromEntryItem({
      name: 'Vitamin D',
      grams: 0.5,
      nutrients: nutrients({ calories: 4.5, fat: 0.5 }),
      productId: 'food-vitamin-d',
      micros: { vitaminD: 125 },
    });
    const attached = attachSavedFood(logged, savedFoodRef(VITAMIN_D));
    expect(rescaleItem(attached, 1.5).micros).toEqual({ vitaminD: 375 });
  });

  it('links a just-saved food without touching the item’s micros', () => {
    const apple = draftFromAnalysisItem(analysisItem());
    const linked = linkSavedFood(apple, savedFoodRef(myFood({ id: 'food-apple', name: 'Apple' })));
    expect(linked.micros).toBe(apple.micros);
  });

  it('drops a scaled amount above the per-item sanity limit instead of sending it', () => {
    const softgel = useSavedFood(
      createDraftItem({ name: 'Vitamin D', grams: 0.5 }),
      savedFoodRef(VITAMIN_D),
    );
    const handful = rescaleItem(softgel, 20);
    expect(handful.micros).toBeNull();
    expect(toEntryItemInputs([handful])[0]).not.toHaveProperty('micros');
  });

  it('sends micros and drink ml with every saved item, and omits unknowns', () => {
    const [pepsi, apple, plain] = toEntryItemInputs([
      createDraftItem(PEPSI),
      draftFromAnalysisItem(analysisItem()),
      createDraftItem({ name: 'Bread', grams: 60 }),
    ]);
    expect(pepsi).toMatchObject({ micros: { caffeine: 36 }, fluidMl: 330 });
    expect(apple).toMatchObject({ micros: { vitaminC: 8, potassium: 193 } });
    expect(apple).not.toHaveProperty('fluidMl');
    expect(plain).not.toHaveProperty('micros');
    expect(plain).not.toHaveProperty('fluidMl');
  });

  it('sets, changes and clears the drink amount', () => {
    const milk = createDraftItem({ name: 'Soy milk', grams: 250 });
    expect(isDrink(milk)).toBe(false);
    expect(defaultDrinkMl(milk)).toBe(250);
    const drink = setItemFluid(milk, defaultDrinkMl(milk));
    expect(isDrink(drink)).toBe(true);
    expect(drink.fluidMl).toBe(250);
    expect(rescaleItem(drink, 300).fluidMl).toBe(300);
    const custom = setItemFluid(drink, 200);
    expect(rescaleItem(custom, 500).fluidMl).toBe(400);
    const cleared = setItemFluid(custom, null);
    expect(isDrink(cleared)).toBe(false);
    expect(rescaleItem(cleared, 600).fluidMl).toBeNull();
    expect(setItemFluid(cleared, null)).toBe(cleared);
  });

  it('defaults a drink without grams to 250 ml and caps drinks at 5 litres', () => {
    expect(defaultDrinkMl(createDraftItem({ name: 'Water' }))).toBe(DEFAULT_DRINK_ML);
    const jug = setItemFluid(createDraftItem({ name: 'Water', grams: 2000 }), 2000);
    expect(rescaleItem(jug, 9000).fluidMl).toBe(5000);
    expect(toEntryItemInputs([rescaleItem(jug, 9000)])[0].fluidMl).toBe(5000);
  });

  it('keeps a drink while its grams are 0 and brings the ml back', () => {
    const drink = createDraftItem(PEPSI);
    const empty = rescaleItem(drink, 0);
    expect(empty.fluidMl).toBeNull();
    expect(isDrink(empty)).toBe(true);
    expect(rescaleItem(empty, 330).fluidMl).toBe(330);
  });

  it('sums the meal’s micros and counts which foods have them', () => {
    const meal = itemsMicros([
      createDraftItem(PEPSI),
      draftFromAnalysisItem(analysisItem()),
      createDraftItem({ name: 'Bun', grams: 70 }),
      createDraftItem(),
    ]);
    expect(meal.micros).toEqual({ vitaminC: 8, potassium: 193, caffeine: 36 });
    expect(meal.coverage).toEqual({ items: 3, withMicros: 2 });
  });
});
