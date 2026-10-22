import { API_LIMITS, MAX_ITEM_GRAMS, PORTION_COUNT_MAX } from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  FoodRenameDto,
  FoodSearchQueryDto,
  HiddenFoodQueryDto,
  HideFoodDto,
  QuickLogDto,
} from './foods.dto.js';

const ID = '019a0000-0000-7000-8000-0000000000c1';

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

function quickLog(overrides: object = {}): object {
  return {
    key: `meal:${ID}`,
    timestamp: '2026-09-28T07:45:00.000+03:00',
    localDate: '2026-09-28',
    mealType: 'breakfast',
    ...overrides,
  };
}

describe('FoodSearchQueryDto', () => {
  it('accepts an empty query and trims the search text', async () => {
    await expect(invalidFields(FoodSearchQueryDto, {})).resolves.toEqual([]);
    const dto = plainToInstance(FoodSearchQueryDto, {
      q: '  yogurt ',
      limit: '5',
    });
    expect(dto).toEqual({ q: 'yogurt', limit: 5 });
  });

  it('accepts only known scopes', async () => {
    await expect(
      invalidFields(FoodSearchQueryDto, { scope: 'standalone' }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(FoodSearchQueryDto, { scope: 'all' }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(FoodSearchQueryDto, { scope: 'meals' }),
    ).resolves.toEqual(['scope']);
  });

  it('limits the query length after trimming', async () => {
    await expect(
      invalidFields(FoodSearchQueryDto, {
        q: ` ${'x'.repeat(API_LIMITS.foodQueryMax)} `,
      }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(FoodSearchQueryDto, {
        q: 'x'.repeat(API_LIMITS.foodQueryMax + 1),
      }),
    ).resolves.toEqual(['q']);
  });

  it.each([
    ['0'],
    [String(API_LIMITS.foodSearchMax + 1)],
    ['2.5'],
    ['many'],
    [''],
  ])('rejects limit %j', async (limit) => {
    await expect(invalidFields(FoodSearchQueryDto, { limit })).resolves.toEqual(
      ['limit'],
    );
  });

  it('rejects repeated query parameters', async () => {
    await expect(
      invalidFields(FoodSearchQueryDto, { q: ['a', 'b'] }),
    ).resolves.toEqual(['q']);
  });
});

describe('QuickLogDto', () => {
  it('accepts every key kind with optional servings or grams', async () => {
    for (const kind of ['favorite', 'product', 'meal', 'food']) {
      await expect(
        invalidFields(QuickLogDto, quickLog({ key: `${kind}:${ID}` })),
      ).resolves.toEqual([]);
    }
    await expect(
      invalidFields(
        QuickLogDto,
        quickLog({ servings: API_LIMITS.favoriteServingsMax, grams: 0.1 }),
      ),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(QuickLogDto, quickLog({ grams: MAX_ITEM_GRAMS })),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(QuickLogDto, quickLog({ portionCount: 1.5 })),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(QuickLogDto, quickLog({ portionCount: PORTION_COUNT_MAX })),
    ).resolves.toEqual([]);
  });

  it.each<[string, object, string]>([
    ['a missing key', { key: undefined }, 'key'],
    ['an unknown kind', { key: `drink:${ID}` }, 'key'],
    ['a malformed id', { key: 'meal:123' }, 'key'],
    ['a key with spaces', { key: ` meal:${ID}` }, 'key'],
    ['a numeric key', { key: 42 }, 'key'],
    ['too few servings', { servings: 0.09 }, 'servings'],
    ['too many servings', { servings: 20.5 }, 'servings'],
    ['string servings', { servings: '2' }, 'servings'],
    ['zero grams', { grams: 0 }, 'grams'],
    ['too many grams', { grams: MAX_ITEM_GRAMS + 1 }, 'grams'],
    ['a zero portion count', { portionCount: 0 }, 'portionCount'],
    ['too many units', { portionCount: PORTION_COUNT_MAX + 1 }, 'portionCount'],
    ['a string portion count', { portionCount: '2' }, 'portionCount'],
    [
      'a timestamp without offset',
      { timestamp: '2026-09-28T07:45' },
      'timestamp',
    ],
    ['an impossible local date', { localDate: '2026-02-30' }, 'localDate'],
    ['an unknown meal type', { mealType: 'brunch' }, 'mealType'],
    ['an extra property', { name: 'Yogurt' }, 'name'],
  ])('rejects %s', async (_label, overrides, field) => {
    await expect(
      invalidFields(QuickLogDto, quickLog(overrides)),
    ).resolves.toEqual([field]);
  });
});

describe('FoodRenameDto', () => {
  it('trims both names and accepts an optional dry run', async () => {
    const dto = plainToInstance(FoodRenameDto, {
      from: '  Khoury yogurt ',
      to: ' Strawberry yogurt cup',
      dryRun: true,
    });

    expect(dto).toEqual({
      from: 'Khoury yogurt',
      to: 'Strawberry yogurt cup',
      dryRun: true,
    });
    await expect(
      invalidFields(FoodRenameDto, { from: 'a', to: 'A' }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(FoodRenameDto, {
        from: 'x'.repeat(API_LIMITS.nameMax),
        to: ` ${'y'.repeat(API_LIMITS.nameMax)} `,
      }),
    ).resolves.toEqual([]);
  });

  it.each<[string, object, string[]]>([
    ['a missing from', { from: undefined }, ['from']],
    ['a blank to', { to: '   ' }, ['to']],
    ['a too long from', { from: 'x'.repeat(API_LIMITS.nameMax + 1) }, ['from']],
    ['a null character', { to: 'Yo\u0000gurt' }, ['to']],
    ['a numeric name', { from: 42 }, ['from']],
    ['a text dry run', { dryRun: 'true' }, ['dryRun']],
    ['an extra property', { entryId: ID }, ['entryId']],
  ])('rejects %s', async (_label, overrides, fields) => {
    await expect(
      invalidFields(FoodRenameDto, {
        from: 'Khoury yogurt',
        to: 'Yogurt cup',
        ...overrides,
      }),
    ).resolves.toEqual(fields);
  });
});

describe('HideFoodDto and HiddenFoodQueryDto', () => {
  it('trim the name', () => {
    expect(plainToInstance(HideFoodDto, { name: ' Granola ' })).toEqual({
      name: 'Granola',
    });
    expect(plainToInstance(HiddenFoodQueryDto, { name: ' oats ' })).toEqual({
      name: 'oats',
    });
  });

  it.each<[string, object]>([
    ['a missing name', {}],
    ['a blank name', { name: ' ' }],
    ['a too long name', { name: 'x'.repeat(API_LIMITS.nameMax + 1) }],
    ['a null character', { name: 'Gra\u0000nola' }],
    ['repeated names', { name: ['a', 'b'] }],
  ])('reject %s', async (_label, plain) => {
    await expect(invalidFields(HideFoodDto, plain)).resolves.toEqual(['name']);
    await expect(invalidFields(HiddenFoodQueryDto, plain)).resolves.toEqual([
      'name',
    ]);
  });
});
