import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  NUTRIENT_META,
  PORTION_UNIT_MAX,
  zeroNutrients,
} from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EntryItemInputDto } from '../common/dto.js';
import {
  DismissFoodMergeDto,
  MERGE_NAMES_MAX,
  MergeFoodsDto,
  MY_FOOD_ALIASES_MAX,
  MY_FOOD_UNIT_GRAMS_MAX,
  MyFoodsQueryDto,
  SaveMyFoodDto,
  UpdateMyFoodDto,
} from './my-foods.dto.js';

const PRODUCT_ID = '019a0000-0000-7000-8000-0000000000d1';

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

function save(overrides: object = {}): object {
  return {
    name: 'Heinz tomato ketchup',
    brand: 'Heinz',
    aliases: ['Tomato ketchup'],
    basisUnit: 'g',
    per100: { ...zeroNutrients(), calories: 110, carbs: 25 },
    unitName: 'tbsp',
    unitGrams: 17,
    servingSizeG: 17,
    source: 'manual',
    ...overrides,
  };
}

function merge(overrides: object = {}): object {
  return {
    key: 'tomato ketchup',
    names: ['Heinz tomato ketchup', 'Tomato ketchup'],
    name: 'Heinz tomato ketchup',
    basisUnit: 'g',
    per100: { ...zeroNutrients(), calories: 110 },
    applyToPast: true,
    ...overrides,
  };
}

describe('SaveMyFoodDto', () => {
  it('accepts a full saved food and trims text', async () => {
    await expect(invalidFields(SaveMyFoodDto, save())).resolves.toEqual([]);
    expect(
      plainToInstance(
        SaveMyFoodDto,
        save({
          name: '  Ketchup ',
          aliases: [' Catsup  '],
          unitName: ' tbsp ',
        }),
      ),
    ).toMatchObject({ name: 'Ketchup', aliases: ['Catsup'], unitName: 'tbsp' });
  });

  it('accepts only the required fields and nulls for optional ones', async () => {
    await expect(
      invalidFields(SaveMyFoodDto, {
        name: 'Rice',
        basisUnit: 'g',
        per100: zeroNutrients(),
      }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(
        SaveMyFoodDto,
        save({
          brand: null,
          unitName: null,
          unitGrams: null,
          servingSizeG: null,
        }),
      ),
    ).resolves.toEqual([]);
  });

  it('treats a blank unit name as none', async () => {
    const dto = plainToInstance(SaveMyFoodDto, save({ unitName: '   ' }));
    expect(dto.unitName).toBeNull();
    await expect(
      invalidFields(SaveMyFoodDto, save({ unitName: '  ' })),
    ).resolves.toEqual([]);
  });

  it.each<[string, object]>([
    ['name', { name: '' }],
    ['name', { name: 'x'.repeat(API_LIMITS.nameMax + 1) }],
    ['name', { name: 'Ket\u0000chup' }],
    ['brand', { brand: 'x'.repeat(API_LIMITS.nameMax + 1) }],
    ['aliases', { aliases: 'Catsup' }],
    ['aliases', { aliases: [''] }],
    ['aliases', { aliases: ['x'.repeat(API_LIMITS.nameMax + 1)] }],
    ['aliases', { aliases: [3] }],
    ['aliases', { aliases: ['a\u0000b'] }],
    [
      'aliases',
      {
        aliases: Array.from(
          { length: MY_FOOD_ALIASES_MAX + 1 },
          (_, i) => `n${i}`,
        ),
      },
    ],
    ['basisUnit', { basisUnit: 'oz' }],
    ['per100', { per100: undefined }],
    ['per100', { per100: { ...zeroNutrients(), calories: -1 } }],
    [
      'per100',
      {
        per100: {
          ...zeroNutrients(),
          sodium: NUTRIENT_META.sodium.max + 1,
        },
      },
    ],
    ['unitName', { unitName: 'x'.repeat(PORTION_UNIT_MAX + 1) }],
    ['unitName', { unitName: 5 }],
    ['unitGrams', { unitGrams: -1 }],
    ['unitGrams', { unitGrams: MY_FOOD_UNIT_GRAMS_MAX + 1 }],
    ['unitGrams', { unitGrams: Number.NaN }],
    ['servingSizeG', { servingSizeG: MAX_ITEM_GRAMS + 1 }],
    ['source', { source: 'ai' }],
    ['barcode', { barcode: '5280001234566' }],
  ])('rejects an invalid %s', async (field, overrides) => {
    await expect(
      invalidFields(SaveMyFoodDto, save(overrides)),
    ).resolves.toContain(field);
  });

  it('accepts the unit weight bounds', async () => {
    for (const unitGrams of [0, MY_FOOD_UNIT_GRAMS_MAX]) {
      await expect(
        invalidFields(SaveMyFoodDto, save({ unitGrams })),
      ).resolves.toEqual([]);
    }
  });
});

describe('micros per 100 of saved foods', () => {
  const MICROS = { calcium: 120, vitaminD: 0.75 };

  it('accepts micros on create, update and merge', async () => {
    await expect(
      invalidFields(SaveMyFoodDto, save({ microsPer100: MICROS })),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(UpdateMyFoodDto, { microsPer100: null }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(MergeFoodsDto, merge({ microsPer100: MICROS })),
    ).resolves.toEqual([]);
  });

  it.each<[string, object]>([
    ['an unknown key', { omega3: 1 }],
    ['a negative value', { iron: -0.1 }],
    ['an impossible value', { potassium: 100_001 }],
    ['a list', [120]],
  ])('rejects micros with %s', async (_label, microsPer100) => {
    await expect(
      invalidFields(SaveMyFoodDto, save({ microsPer100 })),
    ).resolves.toEqual(['microsPer100']);
    await expect(
      invalidFields(UpdateMyFoodDto, { microsPer100 }),
    ).resolves.toEqual(['microsPer100']);
    await expect(
      invalidFields(MergeFoodsDto, merge({ microsPer100 })),
    ).resolves.toEqual(['microsPer100']);
  });
});

describe('UpdateMyFoodDto', () => {
  it('accepts an empty change and a full change', async () => {
    const { source: _source, ...full } = save() as { source: string };
    await expect(invalidFields(UpdateMyFoodDto, {})).resolves.toEqual([]);
    await expect(
      invalidFields(UpdateMyFoodDto, { ...full, applyToPast: true }),
    ).resolves.toEqual([]);
  });

  it.each<[string, object]>([
    ['name', { name: ' ' }],
    ['per100', { per100: { calories: 1 } }],
    ['applyToPast', { applyToPast: 'yes' }],
    ['source', { source: 'manual' }],
    ['aliases', { aliases: [''] }],
  ])('rejects an invalid %s', async (field, body) => {
    await expect(invalidFields(UpdateMyFoodDto, body)).resolves.toContain(
      field,
    );
  });
});

describe('MergeFoodsDto', () => {
  it('accepts a merge into a new or an existing saved food', async () => {
    await expect(invalidFields(MergeFoodsDto, merge())).resolves.toEqual([]);
    await expect(
      invalidFields(
        MergeFoodsDto,
        merge({ productId: PRODUCT_ID, brand: null, applyToPast: false }),
      ),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(MergeFoodsDto, merge({ productId: null })),
    ).resolves.toEqual([]);
  });

  it('accepts the names the user kept apart, trimmed', async () => {
    const dto = plainToInstance(
      MergeFoodsDto,
      merge({ keptApart: ['  Garlic mayonnaise sauce '] }),
    );

    await expect(validate(dto)).resolves.toEqual([]);
    expect(dto.keptApart).toEqual(['Garlic mayonnaise sauce']);
    await expect(
      invalidFields(MergeFoodsDto, merge({ keptApart: [] })),
    ).resolves.toEqual([]);
  });

  it.each<[string, object]>([
    ['keptApart', { keptApart: 'Garlic mayo' }],
    ['keptApart', { keptApart: [''] }],
    ['keptApart', { keptApart: [42] }],
    ['keptApart', { keptApart: ['x'.repeat(API_LIMITS.nameMax + 1)] }],
    [
      'keptApart',
      {
        keptApart: Array.from(
          { length: MERGE_NAMES_MAX + 1 },
          (_, i) => `n${i}`,
        ),
      },
    ],
    ['key', { key: '' }],
    ['key', { key: 'x'.repeat(API_LIMITS.nameMax + 1) }],
    ['names', { names: [] }],
    ['names', { names: [''] }],
    [
      'names',
      {
        names: Array.from({ length: MERGE_NAMES_MAX + 1 }, (_, i) => `n${i}`),
      },
    ],
    ['name', { name: undefined }],
    ['per100', { per100: null }],
    ['productId', { productId: 'nope' }],
    ['applyToPast', { applyToPast: undefined }],
    ['basisUnit', { basisUnit: undefined }],
  ])('rejects an invalid %s', async (field, overrides) => {
    await expect(
      invalidFields(MergeFoodsDto, merge(overrides)),
    ).resolves.toContain(field);
  });
});

describe('DismissFoodMergeDto', () => {
  it('needs a key', async () => {
    await expect(
      invalidFields(DismissFoodMergeDto, { key: 'mayo' }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(DismissFoodMergeDto, { key: '   ' }),
    ).resolves.toEqual(['key']);
    await expect(invalidFields(DismissFoodMergeDto, {})).resolves.toEqual([
      'key',
    ]);
  });
});

describe('MyFoodsQueryDto', () => {
  it('accepts an optional search term', async () => {
    await expect(invalidFields(MyFoodsQueryDto, {})).resolves.toEqual([]);
    await expect(
      invalidFields(MyFoodsQueryDto, { q: 'ketchup' }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(MyFoodsQueryDto, { q: 'x'.repeat(API_LIMITS.nameMax + 1) }),
    ).resolves.toEqual(['q']);
  });
});

describe('EntryItemInputDto productId', () => {
  const item = {
    name: 'Ketchup',
    grams: 20,
    nutrients: zeroNutrients(),
  };

  it('accepts a saved food id or null', async () => {
    await expect(
      invalidFields(EntryItemInputDto, { ...item, productId: PRODUCT_ID }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(EntryItemInputDto, { ...item, productId: null }),
    ).resolves.toEqual([]);
  });

  it('rejects malformed ids', async () => {
    await expect(
      invalidFields(EntryItemInputDto, { ...item, productId: 'ketchup' }),
    ).resolves.toEqual(['productId']);
  });
});
