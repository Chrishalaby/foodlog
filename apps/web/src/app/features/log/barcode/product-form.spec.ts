import { zeroNutrients, type LabelInfo, type ProductDto } from '@food/shared';
import {
  draftFromProduct,
  emptyProductDraft,
  itemMatchesLabel,
  missingNutrientNames,
  per100Fields,
  per100InRange,
  per100Max,
  productDraftError,
  productRequestFromDraft,
  productRequestFromItem,
  productRequestFromLabel,
} from './product-form';

const PRODUCT: ProductDto = {
  id: 'product-1',
  barcode: '5281234567896',
  name: 'Labneh',
  brand: 'Khoury',
  aliases: [],
  unitName: null,
  unitGrams: null,
  basisUnit: 'g',
  per100: { ...zeroNutrients(), calories: 160, protein: 8, carbs: 4, sugar: 4, fat: 12.5 },
  microsPer100: null,
  servingSizeG: 30,
  packSizeG: null,
  source: 'openfoodfacts',
  imageUrl: null,
  missingNutrients: [],
  useCount: 2,
  lastUsedAt: null,
};

const LABEL: LabelInfo = {
  productName: '  Granola   crunch ',
  basisUnit: 'g',
  per100: { ...zeroNutrients(), calories: 450, protein: 10, carbs: 60, fat: 18, fiber: -2 },
  microsPer100: null,
  servingSize: 40,
  servingText: '40 g',
  packSize: 0,
};

describe('product form', () => {
  it('lists per-100 fields with sensible limits', () => {
    expect(per100Fields('g').map((field) => field.key)).toEqual([
      'calories',
      'protein',
      'carbs',
      'sugar',
      'fat',
      'satFat',
      'fiber',
      'sodium',
      'alcohol',
    ]);
    expect(per100Max('protein', 'g')).toBe(100);
    expect(per100Max('carbs', 'ml')).toBe(150);
    expect(per100Max('sodium', 'g')).toBe(40000);
  });

  it('round-trips a product through the draft', () => {
    const draft = draftFromProduct(PRODUCT);
    expect(draft).toMatchObject({
      name: 'Labneh',
      brand: 'Khoury',
      servingSizeG: 30,
      packSizeG: 0,
    });
    expect(productRequestFromDraft({ ...draft, brand: '  ' }, 'manual')).toEqual({
      name: 'Labneh',
      brand: null,
      basisUnit: 'g',
      per100: PRODUCT.per100,
      servingSizeG: 30,
      packSizeG: null,
      source: 'manual',
    });
  });

  it('validates the draft', () => {
    const draft = draftFromProduct(PRODUCT);
    expect(productDraftError(draft)).toBeNull();
    expect(productDraftError(emptyProductDraft())).toBe('Give the product a name.');
    expect(productDraftError({ ...draft, per100: { ...draft.per100, sugar: 9 } })).toMatch(
      /sugars/i,
    );
    expect(productDraftError({ ...draft, per100: { ...draft.per100, satFat: 13 } })).toMatch(
      /saturated/i,
    );
    expect(productDraftError({ ...draft, per100: { ...draft.per100, protein: 120 } })).toMatch(
      /protein per 100 g/i,
    );
    expect(productDraftError({ ...draft, packSizeG: 20000 })).toMatch(/sizes/i);
  });

  it('builds the product from a scanned label under the given name', () => {
    expect(productRequestFromLabel(LABEL, '  Granola   crunch ')).toEqual({
      name: 'Granola crunch',
      brand: null,
      basisUnit: 'g',
      per100: { ...zeroNutrients(), calories: 450, protein: 10, carbs: 60, fat: 18 },
      servingSizeG: 40,
      packSizeG: null,
      source: 'label',
    });
    expect(productRequestFromLabel(LABEL, ' ')).toBeNull();
  });

  it('keeps the label values for an untouched label item and uses corrected item values', () => {
    const untouched = {
      name: 'Granola',
      grams: 40,
      nutrients: { ...zeroNutrients(), calories: 180, protein: 4, carbs: 24, fat: 7.2 },
    };
    expect(itemMatchesLabel(LABEL, untouched)).toBe(true);
    expect(productRequestFromLabel(LABEL, 'Granola', untouched)?.per100).toEqual({
      ...zeroNutrients(),
      calories: 450,
      protein: 10,
      carbs: 60,
      fat: 18,
    });

    const corrected = { ...untouched, nutrients: { ...untouched.nutrients, protein: 6 } };
    expect(itemMatchesLabel(LABEL, corrected)).toBe(false);
    expect(productRequestFromLabel(LABEL, 'Granola', corrected)?.per100).toEqual({
      ...zeroNutrients(),
      calories: 450,
      protein: 15,
      carbs: 60,
      fat: 18,
    });
  });

  it('derives per-100 values from a single logged item', () => {
    expect(
      productRequestFromItem({
        name: 'Toufoulti bread',
        grams: 60,
        nutrients: { ...zeroNutrients(), calories: 159, protein: 5.4, carbs: 31.2 },
      }),
    ).toEqual({
      name: 'Toufoulti bread',
      brand: null,
      basisUnit: 'g',
      per100: { ...zeroNutrients(), calories: 265, protein: 9, carbs: 52 },
      servingSizeG: null,
      packSizeG: null,
      source: 'manual',
    });
    expect(
      productRequestFromItem({ name: 'Mystery', grams: 0, nutrients: zeroNutrients() }),
    ).toBeNull();
    expect(
      productRequestFromItem({ name: '  ', grams: 10, nutrients: zeroNutrients() }),
    ).toBeNull();
  });

  it('names a product from one item after the meal it was saved as', () => {
    const bread = {
      name: 'Toufoulti bread',
      grams: 60,
      nutrients: { ...zeroNutrients(), calories: 159, protein: 5.4, carbs: 31.2 },
    };
    expect(productRequestFromItem(bread, '  Morning   toufoulti ')).toMatchObject({
      name: 'Morning toufoulti',
      per100: { ...zeroNutrients(), calories: 265, protein: 9, carbs: 52 },
      source: 'manual',
    });
    expect(productRequestFromItem(bread, '   ')).toBeNull();
    expect(productRequestFromItem(bread)?.name).toBe('Toufoulti bread');
  });

  it('keeps printed and estimated vitamins per 100 g on every product request', () => {
    const fortified = { ...PRODUCT, microsPer100: { vitaminD: 1.5, calcium: 120.123456 } };
    const draft = draftFromProduct(fortified);
    expect(draft.microsPer100).toEqual({ vitaminD: 1.5, calcium: 120.12 });
    expect(productRequestFromDraft(draft, 'manual').microsPer100).toEqual({
      vitaminD: 1.5,
      calcium: 120.12,
    });
    expect(productRequestFromDraft(draftFromProduct(PRODUCT), 'manual')).not.toHaveProperty(
      'microsPer100',
    );
    expect(
      productRequestFromLabel({ ...LABEL, microsPer100: { vitaminC: 30, iron: -1 } }, 'Granola')
        ?.microsPer100,
    ).toEqual({ vitaminC: 30 });
    expect(
      productRequestFromItem({
        name: 'Soy milk',
        grams: 250,
        nutrients: { ...zeroNutrients(), calories: 100 },
        micros: { calcium: 300, potassium: 0 },
      })?.microsPer100,
    ).toEqual({ calcium: 120, potassium: 0 });
  });

  it('flags per-100 values that no real product has', () => {
    const tiny = productRequestFromItem({
      name: 'Pinch of sugar',
      grams: 0.5,
      nutrients: { ...zeroNutrients(), calories: 20, carbs: 5 },
    });
    expect(tiny?.per100.calories).toBe(4000);
    expect(per100InRange(tiny!.per100, 'g')).toBe(false);
    expect(per100InRange(LABEL.per100, 'g')).toBe(true);
    expect(per100InRange({ ...zeroNutrients(), carbs: 120 }, 'g')).toBe(false);
    expect(per100InRange({ ...zeroNutrients(), carbs: 120 }, 'ml')).toBe(true);
  });

  it('names missing nutrients in nutrient order', () => {
    expect(missingNutrientNames(['sodium', 'fiber', 'satFat'])).toEqual([
      'saturated fat',
      'fiber',
      'sodium',
    ]);
    expect(missingNutrientNames([])).toEqual([]);
  });
});
