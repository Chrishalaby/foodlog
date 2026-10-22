import { type ProductDto, zeroNutrients } from '@food/shared';
import { Prisma, type Product } from '../generated/prisma/client.js';
import {
  cleanText,
  correctedMissingNutrients,
  PRODUCT_ORDER,
  productColumns,
  productDisplayName,
  toBasisUnit,
  toNutrientKeys,
  toProductDto,
} from './product-data.js';

const NOW = new Date('2026-09-28T08:00:00.000Z');

function productRow(overrides: Partial<Product> = {}): Product {
  return {
    id: '019a0000-0000-7000-8000-0000000000d1',
    userId: '019a0000-0000-7000-8000-000000000001',
    barcode: '5280001234566',
    name: 'Laban Ayran',
    brand: 'Almarai',
    basisUnit: 'ml',
    ...zeroNutrients(),
    calories: 42,
    protein: 3.2,
    microsPer100: { calcium: 110, vitaminB12: 0.3 },
    servingSizeG: 250,
    packSizeG: 1000,
    source: 'openfoodfacts',
    imageUrl: 'https://images.openfoodfacts.org/front.jpg',
    missingNutrients: [],
    aliases: [],
    unitName: null,
    unitGrams: null,
    useCount: 3,
    lastUsedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('productDisplayName', () => {
  it.each<[string, string | null, string]>([
    ['Laban Ayran', 'Almarai', 'Almarai Laban Ayran'],
    ['Almarai Laban', 'Almarai', 'Almarai Laban'],
    ['ALMARAI laban', 'almarai', 'ALMARAI laban'],
    ['Crème fraîche', 'Président', 'Président Crème fraîche'],
    ['President creme fraiche', 'Président', 'President creme fraiche'],
    ['Almaraiya dessert', 'Almarai', 'Almarai Almaraiya dessert'],
    ['Almarai', 'Almarai', 'Almarai'],
    ['  Laban   Ayran ', '  Almarai ', 'Almarai Laban Ayran'],
    ['Laban', null, 'Laban'],
    ['Laban', '', 'Laban'],
    ['Laban', '   ', 'Laban'],
  ])('names %j by %j as %j', (name, brand, expected) => {
    expect(productDisplayName(name, brand)).toBe(expected);
  });

  it('stays within the name limit', () => {
    const name = productDisplayName('n'.repeat(120), 'b'.repeat(120));
    expect(Array.from(name)).toHaveLength(120);
    expect(name.startsWith('b'.repeat(120))).toBe(true);
  });
});

describe('cleanText', () => {
  it('collapses whitespace and truncates by code points', () => {
    expect(cleanText('  a \n b\t c ', 10)).toBe('a b c');
    expect(cleanText('😀😀😀', 2)).toBe('😀😀');
    expect(cleanText('ab cd', 3)).toBe('ab');
    expect(cleanText('a\u0000b\ud83dc', 10)).toBe('a b c');
  });
});

describe('toBasisUnit', () => {
  it('maps unknown stored units to grams', () => {
    expect(toBasisUnit('ml')).toBe('ml');
    expect(toBasisUnit('g')).toBe('g');
    expect(toBasisUnit('oz')).toBe('g');
  });
});

describe('productColumns', () => {
  it('flattens per-100 values into nutrient columns', () => {
    expect(
      productColumns({
        name: 'Labneh',
        brand: null,
        basisUnit: 'g',
        per100: { ...zeroNutrients(), calories: 160, sodium: 500 },
        servingSizeG: 30,
        packSizeG: null,
        source: 'openfoodfacts',
        missingNutrients: ['fiber'],
      }),
    ).toEqual({
      name: 'Labneh',
      brand: null,
      basisUnit: 'g',
      ...zeroNutrients(),
      calories: 160,
      sodium: 500,
      servingSizeG: 30,
      packSizeG: null,
      source: 'openfoodfacts',
      missingNutrients: ['fiber'],
    });
  });

  it('writes micros only when they are given and clears them with null', () => {
    const fields = {
      name: 'Labneh',
      brand: null,
      basisUnit: 'g' as const,
      per100: zeroNutrients(),
      servingSizeG: null,
      packSizeG: null,
      source: 'label' as const,
      missingNutrients: [],
    };

    expect(
      productColumns({ ...fields, microsPer100: { calcium: 110 } }),
    ).toMatchObject({ microsPer100: { calcium: 110 } });
    expect(productColumns({ ...fields, microsPer100: null })).toMatchObject({
      microsPer100: Prisma.DbNull,
    });
    expect(productColumns(fields)).not.toHaveProperty('microsPer100');
  });
});

describe('toNutrientKeys', () => {
  it('keeps known nutrient keys once, in nutrient order', () => {
    expect(toNutrientKeys(['sodium', 'fiber', 'vitaminC', 'fiber'])).toEqual([
      'fiber',
      'sodium',
    ]);
    expect(toNutrientKeys([])).toEqual([]);
  });
});

describe('correctedMissingNutrients', () => {
  const stored = productRow({
    fiber: 0,
    satFat: 0,
    missingNutrients: ['satFat', 'fiber', 'sodium'],
  });
  const per100 = { ...zeroNutrients(), calories: 42, protein: 3.2 };

  it.each(['manual', 'label'] as const)(
    'clears every missing nutrient when the user saves %s values',
    (source) => {
      expect(correctedMissingNutrients(stored, source, per100)).toEqual([]);
    },
  );

  it('drops only the nutrients whose values were corrected on an Open Food Facts product', () => {
    expect(
      correctedMissingNutrients(stored, 'openfoodfacts', {
        ...per100,
        fiber: 2.5,
      }),
    ).toEqual(['satFat', 'sodium']);
  });

  it('has nothing missing for a new product', () => {
    expect(correctedMissingNutrients(null, 'openfoodfacts', per100)).toEqual(
      [],
    );
  });
});

describe('toProductDto', () => {
  it('maps a stored product', () => {
    expect(toProductDto(productRow())).toEqual<ProductDto>({
      id: '019a0000-0000-7000-8000-0000000000d1',
      barcode: '5280001234566',
      name: 'Laban Ayran',
      brand: 'Almarai',
      basisUnit: 'ml',
      per100: { ...zeroNutrients(), calories: 42, protein: 3.2 },
      microsPer100: { calcium: 110, vitaminB12: 0.3 },
      servingSizeG: 250,
      packSizeG: 1000,
      source: 'openfoodfacts',
      imageUrl: 'https://images.openfoodfacts.org/front.jpg',
      missingNutrients: [],
      aliases: [],
      unitName: null,
      unitGrams: null,
      useCount: 3,
      lastUsedAt: NOW.toISOString(),
    });
  });

  it('reports the nutrients Open Food Facts did not provide', () => {
    expect(
      toProductDto(productRow({ missingNutrients: ['sodium', 'fiber'] }))
        .missingNutrients,
    ).toEqual(['fiber', 'sodium']);
  });

  it('returns only valid stored micros and null without any', () => {
    expect(
      toProductDto(
        productRow({ microsPer100: { calcium: 110, junk: 1, iron: -1 } }),
      ).microsPer100,
    ).toEqual({ calcium: 110 });
    expect(
      toProductDto(productRow({ microsPer100: null })).microsPer100,
    ).toBeNull();
  });

  it('maps a never used product', () => {
    expect(
      toProductDto(productRow({ lastUsedAt: null, useCount: 0 })),
    ).toMatchObject({ lastUsedAt: null, useCount: 0 });
  });
});

describe('PRODUCT_ORDER', () => {
  it('sorts by use count, recency and name', () => {
    expect(PRODUCT_ORDER).toEqual([
      { useCount: 'desc' },
      { lastUsedAt: { sort: 'desc', nulls: 'last' } },
      { name: 'asc' },
      { id: 'asc' },
    ]);
  });
});
