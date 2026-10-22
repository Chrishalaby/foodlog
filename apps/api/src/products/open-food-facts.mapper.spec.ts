import { NUTRIENT_META, zeroNutrients } from '@food/shared';
import {
  mapOffProduct,
  mapOffResponse,
  offAmount,
  offBasisUnit,
  offBrand,
  offEnergyKcal,
  offImageUrl,
  offMissingNutrients,
  offNumber,
  offTotalCarbs,
  type OffProduct,
} from './open-food-facts.mapper.js';

const BARCODE = '5280001234566';
const IMAGE_URL =
  'https://images.openfoodfacts.org/images/products/528/000/123/4566/front_en.3.200.jpg';

type Fixture = Record<string, unknown>;

const EU_GRANOLA: Fixture = {
  code: BARCODE,
  product_name: '  Crunchy   Granola ',
  brands: 'Dolly, Dolly Foods',
  quantity: '500 g',
  serving_size: '40 g',
  serving_quantity: 40,
  product_quantity: '500',
  nutrition_data_per: '100g',
  image_front_small_url: IMAGE_URL,
  nutriments: {
    'energy-kcal_100g': 450,
    energy_100g: 1883,
    proteins_100g: 10,
    carbohydrates_100g: 60,
    fiber_100g: 8,
    sugars_100g: 20,
    fat_100g: 18,
    'saturated-fat_100g': 3,
    sodium_100g: 0.2,
    salt_100g: 0.5,
  },
};

const KJ_ONLY_CRACKERS: Fixture = {
  product_name: 'Sesame crackers',
  brands: 'Gandour',
  quantity: '200 g',
  nutriments: {
    energy_100g: 1046,
    proteins_100g: 9,
    carbohydrates_100g: 45,
    fat_100g: 5,
  },
};

const SALT_ONLY_LABNEH: Fixture = {
  product_name: 'Labneh',
  brands: 'Taanayel',
  quantity: '500 g',
  serving_quantity: '30',
  nutriments: {
    'energy-kcal_100g': '160',
    proteins_100g: '8,5',
    carbohydrates_100g: 4,
    fat_100g: 12,
    'saturated-fat_100g': 7.5,
    salt_100g: 1.25,
  },
};

const LABAN_DRINK: Fixture = {
  product_name: 'Laban Ayran',
  brands: 'Almarai',
  quantity: '1 L',
  serving_size: '250 ml',
  serving_quantity: 250,
  product_quantity: 1000,
  nutriments: {
    'energy-kcal_100g': 42,
    proteins_100g: 3.2,
    carbohydrates_100g: 4.6,
    sugars_100g: 4.6,
    fat_100g: 1.2,
    sodium_100g: 0.05,
  },
};

const ONLY_ENERGY = [
  'protein',
  'carbs',
  'fat',
  'satFat',
  'fiber',
  'sugar',
  'sodium',
] as const;

const US_WHITE_BREAD: Fixture = {
  product_name: 'Classic White Bread',
  brands: 'Sunbeam',
  quantity: '20 oz',
  nutriments: {
    'energy-kcal_100g': 245.6,
    proteins_100g: 8.77,
    carbohydrates_100g: 50.88,
    fiber_100g: 5.26,
    sugars_100g: 5.26,
    fat_100g: 2.63,
    sodium_100g: 0.491,
  },
};

const NO_ENERGY: Fixture = {
  product_name: 'Mystery snack',
  brands: 'Unknown',
  nutriments: { proteins_100g: 5, fat_100g: 30 },
};

function expected(overrides: Partial<OffProduct>): OffProduct {
  return {
    name: '',
    brand: null,
    basisUnit: 'g',
    per100: zeroNutrients(),
    microsPer100: null,
    servingSizeG: null,
    packSizeG: null,
    imageUrl: null,
    missingNutrients: [],
    ...overrides,
  };
}

describe('mapOffProduct', () => {
  it('keeps US total carbohydrate that already includes fibre', () => {
    expect(mapOffProduct(US_WHITE_BREAD, BARCODE)?.per100).toMatchObject({
      calories: 245.6,
      carbs: 50.88,
      fiber: 5.26,
    });
  });

  it('maps EU data and adds fibre to the carbohydrates', () => {
    expect(mapOffProduct(EU_GRANOLA, BARCODE)).toEqual(
      expected({
        name: 'Crunchy Granola',
        brand: 'Dolly',
        per100: {
          calories: 450,
          protein: 10,
          carbs: 68,
          fat: 18,
          satFat: 3,
          fiber: 8,
          sugar: 20,
          sodium: 200,
          alcohol: 0,
        },
        servingSizeG: 40,
        packSizeG: 500,
        imageUrl: IMAGE_URL,
      }),
    );
  });

  it('converts kJ to kcal when only kJ are known', () => {
    expect(mapOffProduct(KJ_ONLY_CRACKERS, BARCODE)).toEqual(
      expected({
        name: 'Sesame crackers',
        brand: 'Gandour',
        per100: {
          ...zeroNutrients(),
          calories: 250,
          protein: 9,
          carbs: 45,
          fat: 5,
        },
        missingNutrients: ['satFat', 'fiber', 'sugar', 'sodium'],
      }),
    );
  });

  it('derives sodium from salt and parses numeric text', () => {
    expect(mapOffProduct(SALT_ONLY_LABNEH, BARCODE)).toEqual(
      expected({
        name: 'Labneh',
        brand: 'Taanayel',
        per100: {
          ...zeroNutrients(),
          calories: 160,
          protein: 8.5,
          carbs: 4,
          fat: 12,
          satFat: 7.5,
          sodium: 500,
        },
        servingSizeG: 30,
        missingNutrients: ['fiber', 'sugar'],
      }),
    );
  });

  it('keeps millilitre products per 100 ml', () => {
    expect(mapOffProduct(LABAN_DRINK, BARCODE)).toEqual(
      expected({
        name: 'Laban Ayran',
        brand: 'Almarai',
        basisUnit: 'ml',
        per100: {
          ...zeroNutrients(),
          calories: 42,
          protein: 3.2,
          carbs: 4.6,
          fat: 1.2,
          sugar: 4.6,
          sodium: 50,
        },
        servingSizeG: 250,
        packSizeG: 1000,
        missingNutrients: ['satFat', 'fiber'],
      }),
    );
  });

  it('maps vitamins and minerals stored in grams to mg and µg per 100 g', () => {
    const cereal = mapOffProduct(
      {
        ...EU_GRANOLA,
        nutriments: {
          ...(EU_GRANOLA.nutriments as Fixture),
          'vitamin-a_100g': 0.00012,
          'vitamin-c_100g': 0.012,
          'vitamin-d_100g': 0.0000025,
          'vitamin-e_100g': '0.0031',
          phylloquinone_100g: 0.00003,
          'vitamin-b6_100g': 0.0014,
          'vitamin-b12_100g': 0.00000038,
          'folic-acid_100g': 0.0001,
          calcium_100g: 0.12,
          iron_100g: 0.0036,
          magnesium_100g: 0.105,
          potassium_100g: 0.38,
          zinc_100g: 0.0024,
          cholesterol_100g: 0,
          caffeine_100g: 'n/a',
          'vitamin-c_unit': 'mg',
        },
      },
      BARCODE,
    );

    expect(cereal?.microsPer100).toEqual({
      vitaminA: 120,
      vitaminC: 12,
      vitaminD: 2.5,
      vitaminE: 3.1,
      vitaminK: 30,
      vitaminB6: 1.4,
      vitaminB12: 0.38,
      folate: 170,
      calcium: 120,
      iron: 3.6,
      magnesium: 105,
      potassium: 380,
      zinc: 2.4,
      cholesterol: 0,
    });
  });

  it('prefers natural folates and the vitamin K field over their fallbacks', () => {
    const drink = mapOffProduct(
      {
        ...LABAN_DRINK,
        nutriments: {
          ...(LABAN_DRINK.nutriments as Fixture),
          folates_100g: 0.00004,
          'folic-acid_100g': 0.0001,
          'vitamin-k_100g': 0.000002,
          phylloquinone_100g: 0.00003,
          caffeine_100g: 0.032,
        },
      },
      BARCODE,
    );

    expect(drink?.microsPer100).toEqual({
      folate: 40,
      vitaminK: 2,
      caffeine: 32,
    });
  });

  it('ignores negative and impossible vitamin values', () => {
    const product = mapOffProduct(
      {
        ...LABAN_DRINK,
        nutriments: {
          ...(LABAN_DRINK.nutriments as Fixture),
          'vitamin-c_100g': -0.01,
          calcium_100g: 150,
        },
      },
      BARCODE,
    );

    expect(product?.microsPer100).toBeNull();
  });

  it('rejects products without energy', () => {
    expect(mapOffProduct(NO_ENERGY, BARCODE)).toBeNull();
    expect(
      mapOffProduct(
        { ...NO_ENERGY, nutriments: { 'energy-kcal_100g': -5 } },
        BARCODE,
      ),
    ).toBeNull();
    expect(
      mapOffProduct(
        { ...NO_ENERGY, nutriments: { 'energy-kcal_100g': 'n/a' } },
        BARCODE,
      ),
    ).toBeNull();
    expect(mapOffProduct({ product_name: 'Bare' }, BARCODE)).toBeNull();
  });

  it('accepts zero-calorie products, fills missing nutrients with zero and lists them', () => {
    expect(
      mapOffProduct(
        {
          product_name: 'Sohat water',
          quantity: '1.5 l',
          nutriments: { 'energy-kcal_100g': 0 },
        },
        BARCODE,
      ),
    ).toEqual(
      expected({
        name: 'Sohat water',
        basisUnit: 'ml',
        per100: zeroNutrients(),
        missingNutrients: [...ONLY_ENERGY],
      }),
    );
  });

  it('converts alcohol by volume to grams', () => {
    const beer = mapOffProduct(
      {
        product_name: 'Almaza',
        quantity: '330 ml',
        nutriments: {
          'energy-kcal_100g': 41,
          alcohol_100g: 4.2,
          alcohol_unit: '% vol',
        },
      },
      BARCODE,
    );
    const grams = mapOffProduct(
      {
        product_name: 'Rum cake',
        nutriments: {
          'energy-kcal_100g': 380,
          alcohol_100g: 2,
          alcohol_unit: 'g',
        },
      },
      BARCODE,
    );

    expect(beer?.per100.alcohol).toBe(3.31);
    expect(grams?.per100.alcohol).toBe(2);
  });

  it('caps nutrients at their maximum', () => {
    const salt = mapOffProduct(
      {
        product_name: 'Sea salt',
        nutriments: { 'energy-kcal_100g': 0, sodium_100g: 390 },
      },
      BARCODE,
    );

    expect(salt?.per100.sodium).toBe(NUTRIENT_META.sodium.max);
  });

  it('falls back to the brand or the barcode for a missing name', () => {
    const nutriments = { 'energy-kcal_100g': 100 };

    expect(mapOffProduct({ brands: 'Bonjus', nutriments }, BARCODE)?.name).toBe(
      'Bonjus',
    );
    expect(mapOffProduct({ product_name: ' ', nutriments }, BARCODE)).toEqual(
      expected({
        name: `Product ${BARCODE}`,
        per100: { ...zeroNutrients(), calories: 100 },
        missingNutrients: [...ONLY_ENERGY],
      }),
    );
  });

  it('removes characters that cannot be stored', () => {
    const product = mapOffProduct(
      {
        product_name: 'Hal\u0000loumi\ud800 cheese\u0007',
        brands: '\u0000',
        nutriments: { 'energy-kcal_100g': 300 },
      },
      BARCODE,
    );

    expect(product).toMatchObject({ name: 'Hal loumi cheese', brand: null });
  });

  it('truncates long names and brands', () => {
    const product = mapOffProduct(
      {
        product_name: 'n'.repeat(200),
        brands: 'b'.repeat(200),
        nutriments: { 'energy-kcal_100g': 1 },
      },
      BARCODE,
    );

    expect(product?.name).toHaveLength(120);
    expect(product?.brand).toHaveLength(120);
  });
});

describe('offMissingNutrients', () => {
  it('lists nothing when every nutrient is given', () => {
    expect(offMissingNutrients(EU_GRANOLA['nutriments'] as Fixture)).toEqual(
      [],
    );
  });

  it('lists every nutrient Open Food Facts leaves out, in nutrient order', () => {
    expect(offMissingNutrients({ 'energy-kcal_100g': 50 })).toEqual(
      ONLY_ENERGY,
    );
  });

  it('counts unusable values as missing', () => {
    expect(
      offMissingNutrients({
        'energy-kcal_100g': 50,
        proteins_100g: -1,
        carbohydrates_100g: 'n/a',
        fat_100g: '',
        'saturated-fat_100g': null,
        fiber_100g: '2,5',
        sugars_100g: 0,
        sodium_100g: 0.1,
      }),
    ).toEqual(['protein', 'carbs', 'fat', 'satFat']);
  });

  it('accepts a declared total carbohydrate and salt instead of sodium', () => {
    expect(
      offMissingNutrients({
        proteins_100g: 1,
        'carbohydrates-total_100g': 12,
        fat_100g: 1,
        'saturated-fat_100g': 0.5,
        fiber_100g: 1,
        sugars_100g: 3,
        salt_100g: 0.3,
      }),
    ).toEqual([]);
  });

  it('never lists alcohol, which only alcoholic drinks declare', () => {
    expect(
      offMissingNutrients({ 'energy-kcal_100g': 50, alcohol_100g: 5 }),
    ).not.toContain('alcohol');
    expect(offMissingNutrients({})).not.toContain('alcohol');
  });

  it('flags fibre as missing when only the carbohydrates are known', () => {
    const product = mapOffProduct(
      {
        product_name: 'Oat biscuits',
        nutriments: {
          'energy-kcal_100g': 470,
          proteins_100g: 7,
          carbohydrates_100g: 65,
          sugars_100g: 20,
          fat_100g: 19,
          'saturated-fat_100g': 8,
          salt_100g: 0.8,
        },
      },
      BARCODE,
    );

    expect(product?.per100.fiber).toBe(0);
    expect(product?.missingNutrients).toEqual(['fiber']);
  });
});

describe('mapOffResponse', () => {
  it('reads the product of a found response', () => {
    expect(
      mapOffResponse(
        { code: BARCODE, status: 1, product: LABAN_DRINK },
        BARCODE,
      ),
    ).toMatchObject({ name: 'Laban Ayran', basisUnit: 'ml' });
  });

  it.each<[string, unknown]>([
    ['a not found status', { code: BARCODE, status: 0, product: LABAN_DRINK }],
    ['a missing product', { code: BARCODE, status: 1 }],
    ['a product that is not an object', { status: 1, product: 'x' }],
    ['an array', [LABAN_DRINK]],
    ['null', null],
    ['text', 'product found'],
  ])('returns null for %s', (_label, body) => {
    expect(mapOffResponse(body, BARCODE)).toBeNull();
  });
});

describe('offEnergyKcal', () => {
  it('prefers kcal, then kJ from energy-kj, then energy', () => {
    expect(offEnergyKcal({ 'energy-kcal_100g': 120, energy_100g: 2000 })).toBe(
      120,
    );
    expect(
      offEnergyKcal({ 'energy-kj_100g': 418.4, energy_100g: 2000 }),
    ).toBeCloseTo(100, 10);
    expect(offEnergyKcal({ energy_100g: 836.8 })).toBeCloseTo(200, 10);
    expect(offEnergyKcal({})).toBeNull();
  });

  it('reads kilojoules entered as kilocalories as kilojoules', () => {
    expect(offEnergyKcal({ 'energy-kcal_100g': 900 })).toBe(900);
    expect(
      offEnergyKcal({ 'energy-kcal_100g': 1883, energy_100g: 7878 }),
    ).toBeCloseTo(450.05, 2);
  });

  it('rejects energy no food can have', () => {
    expect(offEnergyKcal({ 'energy-kcal_100g': 4000 })).toBeNull();
    expect(offEnergyKcal({ energy_100g: 3800 })).toBeNull();
    expect(
      mapOffProduct(
        { product_name: 'Typo', nutriments: { 'energy-kcal_100g': 45000 } },
        BARCODE,
      ),
    ).toBeNull();
  });
});

describe('offTotalCarbs', () => {
  it('adds fibre to EU-style available carbohydrates', () => {
    expect(
      offTotalCarbs(
        { carbohydrates_100g: 60, fiber_100g: 10, proteins_100g: 12 },
        'g',
        308,
      ),
    ).toBe(70);
  });

  it('keeps carbohydrates that must already include fibre by mass', () => {
    expect(
      offTotalCarbs(
        {
          carbohydrates_100g: 70,
          fiber_100g: 12,
          proteins_100g: 12,
          fat_100g: 15,
        },
        'g',
        439,
      ),
    ).toBe(70);
  });

  it('applies the mass rule to grams only and adds fibre per 100 ml when energy fits', () => {
    expect(
      offTotalCarbs(
        { carbohydrates_100g: 80, fiber_100g: 2, proteins_100g: 20 },
        'ml',
        404,
      ),
    ).toBe(82);
  });

  it('uses a declared total carbohydrate value', () => {
    expect(
      offTotalCarbs(
        { 'carbohydrates-total_100g': 30, carbohydrates_100g: 25 },
        'g',
        120,
      ),
    ).toBe(30);
  });

  it('treats missing values as zero', () => {
    expect(offTotalCarbs({ fiber_100g: 3 }, 'g', 0)).toBe(3);
    expect(offTotalCarbs({}, 'g', 0)).toBe(0);
  });

  it.each<[string, Record<string, number>, number, number]>([
    [
      'US white bread',
      {
        proteins_100g: 8.77,
        fat_100g: 2.63,
        carbohydrates_100g: 50.88,
        fiber_100g: 5.26,
      },
      245.6,
      50.88,
    ],
    [
      'a US label computed with 4-4-9 on total carbohydrate',
      {
        proteins_100g: 9,
        fat_100g: 3,
        carbohydrates_100g: 49,
        fiber_100g: 6,
      },
      259,
      49,
    ],
    [
      'US rolled oats',
      {
        proteins_100g: 12.5,
        fat_100g: 7.5,
        carbohydrates_100g: 67.5,
        fiber_100g: 10,
      },
      375,
      67.5,
    ],
  ])(
    'recognises fibre already included in %s from the declared energy',
    (_label, nutriments, calories, expected) => {
      expect(offTotalCarbs(nutriments, 'g', calories)).toBe(expected);
    },
  );

  it('recognises fibre already included per 100 ml', () => {
    expect(
      offTotalCarbs({ carbohydrates_100g: 20, fiber_100g: 10 }, 'ml', 80),
    ).toBe(20);
  });

  it.each<[string, Record<string, number>, number, number]>([
    [
      'EU bread',
      {
        proteins_100g: 7.5,
        fat_100g: 4.3,
        carbohydrates_100g: 42,
        fiber_100g: 6.5,
      },
      250,
      48.5,
    ],
    [
      'a little fibre within label rounding',
      {
        proteins_100g: 5.4,
        fat_100g: 21,
        carbohydrates_100g: 4.3,
        fiber_100g: 0.2,
      },
      226,
      4.5,
    ],
    [
      'EU sugar-free chocolate with polyols',
      {
        proteins_100g: 7,
        fat_100g: 35,
        carbohydrates_100g: 45,
        polyols_100g: 40,
        fiber_100g: 8,
      },
      475,
      53,
    ],
  ])('adds fibre for %s', (_label, nutriments, calories, expected) => {
    expect(offTotalCarbs(nutriments, 'g', calories)).toBeCloseTo(expected, 6);
  });

  it('adds fibre when there is no energy to compare with', () => {
    expect(
      offTotalCarbs(
        { carbohydrates_100g: 50.88, fiber_100g: 5.26, proteins_100g: 8.77 },
        'g',
        0,
      ),
    ).toBeCloseTo(56.14, 6);
  });
});

describe('offBasisUnit', () => {
  it.each<[Fixture, 'g' | 'ml']>([
    [{ quantity: '1 L' }, 'ml'],
    [{ quantity: '1,5 l' }, 'ml'],
    [{ quantity: '33cl' }, 'ml'],
    [{ quantity: '6 x 250 mL' }, 'ml'],
    [{ quantity: '12 fl oz' }, 'ml'],
    [{ quantity: '1 Lt' }, 'ml'],
    [{ quantity: '2 Ltr' }, 'ml'],
    [{ quantity: '1 Liter' }, 'ml'],
    [{ quantity: '0.5 litres' }, 'ml'],
    [{ quantity: '500 مل' }, 'ml'],
    [{ quantity: '١ لتر' }, 'ml'],
    [{ quantity: '٥٠٠ غ' }, 'g'],
    [{ quantity: 'Lait 1 kg' }, 'g'],
    [{ quantity: '500 g' }, 'g'],
    [{ quantity: '1 kg' }, 'g'],
    [{ quantity: '1 lb' }, 'g'],
    [{ quantity: 'Large', serving_size: '1 cup (240 ml)' }, 'ml'],
    [{ quantity: '12 fl oz (355 ml)' }, 'ml'],
    [{ quantity: '16 oz' }, 'g'],
    [{ quantity: '500 grams' }, 'g'],
    [{ quantity: '٤٠٠ غرام' }, 'g'],
    [
      { quantity: '900 g', serving_size: '1 scoop (30 g) in 200 ml water' },
      'g',
    ],
    [{ quantity: '500 g', serving_size: '250 ml' }, 'g'],
    [{ quantity: '6 x 330 ml', serving_size: '330 g' }, 'ml'],
    [{ serving_size: '1 scoop (30 g) + 150 ml water' }, 'g'],
    [{ quantity: 'Family pack', serving_size: '2 tbsp' }, 'g'],
    [{}, 'g'],
  ])('reads %j as %s', (product, unit) => {
    expect(offBasisUnit(product)).toBe(unit);
  });
});

describe('field parsers', () => {
  it.each<[unknown, number | null]>([
    [12, 12],
    [' 8,5 ', 8.5],
    ['.5', 0.5],
    ['1e3', null],
    ['12 g', null],
    ['', null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [null, null],
    [true, null],
  ])('parses %j as %j', (value, number) => {
    expect(offNumber(value)).toBe(number);
  });

  it.each<[unknown, number | null]>([
    [40, 40],
    ['125.04', 125],
    [0, null],
    [0.04, null],
    [10_000, 10_000],
    [10_001, null],
    ['abc', null],
    [undefined, null],
  ])('reads the amount %j as %j', (value, amount) => {
    expect(offAmount(value)).toBe(amount);
  });

  it('keeps the first brand', () => {
    expect(offBrand(' Al Wadi Al Akhdar , Wadi Food ')).toBe(
      'Al Wadi Al Akhdar',
    );
    expect(offBrand(', Other')).toBeNull();
    expect(offBrand(undefined)).toBeNull();
  });

  it.each([
    'http://images.openfoodfacts.org/front.jpg',
    'https://openfoodfacts.org.example.com/front.jpg',
    'https://example.com/front.jpg',
    'https://user@images.openfoodfacts.org/front.jpg',
    'javascript:alert(1)',
    '/images/front.jpg',
    `https://images.openfoodfacts.org/${'x'.repeat(500)}.jpg`,
  ])('rejects the image URL %s', (url) => {
    expect(offImageUrl(url)).toBeNull();
  });

  it('accepts Open Food Facts image URLs', () => {
    expect(offImageUrl(IMAGE_URL)).toBe(IMAGE_URL);
    expect(offImageUrl('https://static.openfoodfacts.org/a.png')).toBe(
      'https://static.openfoodfacts.org/a.png',
    );
  });
});
