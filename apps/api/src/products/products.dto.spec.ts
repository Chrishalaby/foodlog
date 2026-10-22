import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  NUTRIENT_META,
  zeroNutrients,
} from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LogProductDto, UpsertProductDto } from './products.dto.js';

async function invalidFields<T extends object>(
  cls: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

function upsert(overrides: object = {}): object {
  return {
    name: 'Labneh',
    brand: 'Taanayel',
    basisUnit: 'g',
    per100: { ...zeroNutrients(), calories: 160, protein: 8.5 },
    servingSizeG: 30,
    packSizeG: 500,
    source: 'label',
    ...overrides,
  };
}

function log(overrides: object = {}): object {
  return {
    timestamp: '2026-09-28T07:45:00.000+03:00',
    localDate: '2026-09-28',
    mealType: 'breakfast',
    ...overrides,
  };
}

describe('UpsertProductDto', () => {
  it('accepts a full product and trims text', async () => {
    await expect(invalidFields(UpsertProductDto, upsert())).resolves.toEqual(
      [],
    );
    const dto = plainToInstance(
      UpsertProductDto,
      upsert({ name: '  Labneh ', brand: ' Taanayel  ' }),
    );
    expect(dto).toMatchObject({ name: 'Labneh', brand: 'Taanayel' });
  });

  it('accepts missing or null optional fields', async () => {
    await expect(
      invalidFields(
        UpsertProductDto,
        upsert({ brand: null, servingSizeG: null, packSizeG: null }),
      ),
    ).resolves.toEqual([]);
    const {
      brand: _brand,
      servingSizeG: _serving,
      packSizeG: _pack,
      ...required
    } = upsert() as Record<string, unknown>;
    await expect(invalidFields(UpsertProductDto, required)).resolves.toEqual(
      [],
    );
  });

  it('accepts printed micros per 100 and rejects junk', async () => {
    await expect(
      invalidFields(
        UpsertProductDto,
        upsert({ microsPer100: { calcium: 120, vitaminD: 12500, iron: null } }),
      ),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(UpsertProductDto, upsert({ microsPer100: null })),
    ).resolves.toEqual([]);
    for (const microsPer100 of [
      { vitaminZ: 1 },
      { calcium: -1 },
      { calcium: 100_001 },
      { calcium: '120' },
      'lots',
    ]) {
      await expect(
        invalidFields(UpsertProductDto, upsert({ microsPer100 })),
      ).resolves.toEqual(['microsPer100']);
    }
  });

  it('accepts every source and basis unit', async () => {
    for (const source of ['label', 'openfoodfacts', 'manual']) {
      for (const basisUnit of ['g', 'ml']) {
        await expect(
          invalidFields(UpsertProductDto, upsert({ source, basisUnit })),
        ).resolves.toEqual([]);
      }
    }
  });

  it('accepts values at their limits', async () => {
    await expect(
      invalidFields(
        UpsertProductDto,
        upsert({
          name: 'n'.repeat(API_LIMITS.nameMax),
          brand: 'b'.repeat(API_LIMITS.nameMax),
          per100: {
            ...zeroNutrients(),
            sodium: NUTRIENT_META.sodium.max,
          },
          servingSizeG: 0.1,
          packSizeG: MAX_ITEM_GRAMS,
        }),
      ),
    ).resolves.toEqual([]);
  });

  it.each<[string, object, string]>([
    ['a missing name', { name: undefined }, 'name'],
    ['a blank name', { name: '   ' }, 'name'],
    ['a long name', { name: 'n'.repeat(API_LIMITS.nameMax + 1) }, 'name'],
    ['a long brand', { brand: 'b'.repeat(API_LIMITS.nameMax + 1) }, 'brand'],
    ['a numeric brand', { brand: 42 }, 'brand'],
    ['an unknown basis unit', { basisUnit: 'oz' }, 'basisUnit'],
    ['missing per-100 values', { per100: undefined }, 'per100'],
    ['an incomplete per-100 object', { per100: { calories: 100 } }, 'per100'],
    [
      'a negative nutrient',
      { per100: { ...zeroNutrients(), fat: -1 } },
      'per100',
    ],
    [
      'a nutrient above its maximum',
      {
        per100: {
          ...zeroNutrients(),
          calories: NUTRIENT_META.calories.max + 1,
        },
      },
      'per100',
    ],
    [
      'a text nutrient',
      { per100: { ...zeroNutrients(), protein: '8' } },
      'per100',
    ],
    ['a zero serving', { servingSizeG: 0 }, 'servingSizeG'],
    ['a tiny serving', { servingSizeG: 0.09 }, 'servingSizeG'],
    ['a huge pack', { packSizeG: MAX_ITEM_GRAMS + 1 }, 'packSizeG'],
    ['a text pack size', { packSizeG: '500' }, 'packSizeG'],
    ['an unknown source', { source: 'ai' }, 'source'],
    ['a missing source', { source: undefined }, 'source'],
    ['an extra property', { barcode: '4006381333931' }, 'barcode'],
    ['a null character', { name: 'Lab\u0000neh' }, 'name'],
    ['a null character in the brand', { brand: 'Taa\u0000nayel' }, 'brand'],
  ])('rejects %s', async (_label, overrides, field) => {
    await expect(
      invalidFields(UpsertProductDto, upsert(overrides)),
    ).resolves.toEqual([field]);
  });
});

describe('LogProductDto', () => {
  it('accepts grams, servings or neither', async () => {
    await expect(invalidFields(LogProductDto, log())).resolves.toEqual([]);
    await expect(
      invalidFields(LogProductDto, log({ grams: 0.1 })),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(LogProductDto, log({ grams: MAX_ITEM_GRAMS })),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(
        LogProductDto,
        log({ servings: API_LIMITS.favoriteServingsMax }),
      ),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(LogProductDto, log({ grams: null, servings: 2 })),
    ).resolves.toEqual([]);
  });

  it('accepts the analysis, photo and description of a label scan', async () => {
    await expect(
      invalidFields(
        LogProductDto,
        log({
          analysisId: '019a0000-0000-7000-8000-0000000000a1',
          photoId: '019a0000-0000-7000-8000-0000000000f1',
          description: '1 serving',
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(
        LogProductDto,
        log({ analysisId: null, photoId: null, description: null }),
      ),
    ).resolves.toEqual([]);
  });

  it.each<[string, object, string]>([
    ['both grams and servings', { grams: 100, servings: 1 }, 'grams'],
    ['zero grams', { grams: 0 }, 'grams'],
    ['too many grams', { grams: MAX_ITEM_GRAMS + 1 }, 'grams'],
    ['text grams', { grams: '100' }, 'grams'],
    ['too few servings', { servings: 0.09 }, 'servings'],
    [
      'too many servings',
      { servings: API_LIMITS.favoriteServingsMax + 0.5 },
      'servings',
    ],
    ['a missing timestamp', { timestamp: undefined }, 'timestamp'],
    [
      'a timestamp without offset',
      { timestamp: '2026-09-28T07:45' },
      'timestamp',
    ],
    ['an impossible local date', { localDate: '2026-02-30' }, 'localDate'],
    ['an unknown meal type', { mealType: 'brunch' }, 'mealType'],
    ['an extra property', { name: 'Labneh' }, 'name'],
    ['an analysis id that is no uuid', { analysisId: 'abc' }, 'analysisId'],
    ['a photo id that is no uuid', { photoId: 42 }, 'photoId'],
    [
      'a too long description',
      { description: 'x'.repeat(API_LIMITS.descriptionMax + 1) },
      'description',
    ],
    [
      'a description with a null character',
      { description: 'a\u0000b' },
      'description',
    ],
  ])('rejects %s', async (_label, overrides, field) => {
    await expect(invalidFields(LogProductDto, log(overrides))).resolves.toEqual(
      [field],
    );
  });
});
