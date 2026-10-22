import { API_LIMITS, zeroNutrients } from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EntryItemInputDto, NutrientsDto } from '../common/dto.js';
import {
  CreateDraftDto,
  LogDraftDto,
  parseItemsField,
  parsePortionField,
  UpdateDraftDto,
} from './drafts.dto.js';

const UUID = '0199a0b6-3c1e-7d2f-8a4b-5c6d7e8f9a0b';

const ITEM = {
  name: ' Rice ',
  grams: 180,
  nutrients: { ...zeroNutrients(), calories: 234, carbs: 50 },
  confidence: 'medium',
};

async function invalidFields<T extends object>(
  type: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(type, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property).sort();
}

describe('parseItemsField', () => {
  it('turns a JSON list into item DTOs with nested nutrients', () => {
    const parsed = parseItemsField(JSON.stringify([ITEM]));

    expect(Array.isArray(parsed)).toBe(true);
    const [item] = parsed as EntryItemInputDto[];
    expect(item).toBeInstanceOf(EntryItemInputDto);
    expect(item?.nutrients).toBeInstanceOf(NutrientsDto);
    expect(item?.name).toBe('Rice');
  });

  it('leaves anything else for the validators to reject', () => {
    expect(parseItemsField('not json')).toBe('not json');
    expect(parseItemsField('{"name":"x"}')).toEqual({ name: 'x' });
    expect(parseItemsField(undefined)).toBeUndefined();
  });
});

describe('parsePortionField', () => {
  it('turns a JSON object into a portion DTO and keeps other values', () => {
    expect(
      parsePortionField('{"count":2,"unit":" burger ","unitPlural":"burgers"}'),
    ).toEqual({ count: 2, unit: 'burger', unitPlural: 'burgers' });
    expect(parsePortionField('null')).toBeNull();
    expect(parsePortionField('  ')).toBeUndefined();
    expect(parsePortionField('two burgers')).toBe('two burgers');
    expect(parsePortionField('[1]')).toEqual([1]);
    expect(parsePortionField(undefined)).toBeUndefined();
  });
});

describe('CreateDraftDto', () => {
  const base = {
    mode: 'food_photo',
    timestamp: '2026-09-30T12:15:00.000Z',
    localDate: '2026-09-30',
  };

  it('accepts the full multipart field set as strings', async () => {
    await expect(
      invalidFields(CreateDraftDto, {
        ...base,
        name: ' Office lunch ',
        description: 'rice and chicken',
        mealType: 'lunch',
        analysisId: UUID,
        items: JSON.stringify([ITEM]),
        imageRoles: 'food,label',
      }),
    ).resolves.toEqual([]);
    const dto = plainToInstance(CreateDraftDto, {
      ...base,
      name: ' Office lunch ',
      items: JSON.stringify([ITEM]),
    });
    expect(dto.name).toBe('Office lunch');
    expect(dto.items?.[0]).toMatchObject({ name: 'Rice', grams: 180 });
  });

  it('accepts a portion sent as a JSON string field', async () => {
    await expect(
      invalidFields(CreateDraftDto, {
        ...base,
        portion: JSON.stringify({
          count: 1.5,
          unit: 'burger',
          unitPlural: 'burgers',
        }),
      }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(CreateDraftDto, { ...base, portion: 'null' }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(CreateDraftDto, {
        ...base,
        portion: JSON.stringify({ count: 0, unit: '', unitPlural: '' }),
      }),
    ).resolves.toEqual(['portion']);
    await expect(
      invalidFields(CreateDraftDto, { ...base, portion: 'two burgers' }),
    ).resolves.toEqual(['portion']);
  });

  it('accepts items sent as a JSON array', async () => {
    await expect(
      invalidFields(CreateDraftDto, { ...base, items: [ITEM] }),
    ).resolves.toEqual([]);
  });

  it('needs only the mode and the intended time', async () => {
    await expect(invalidFields(CreateDraftDto, base)).resolves.toEqual([]);
    await expect(invalidFields(CreateDraftDto, {})).resolves.toEqual([
      'localDate',
      'mode',
      'timestamp',
    ]);
  });

  it('rejects invalid values and unknown fields', async () => {
    await expect(
      invalidFields(CreateDraftDto, {
        mode: 'menu',
        name: 'x'.repeat(API_LIMITS.nameMax + 1),
        description: 'y'.repeat(API_LIMITS.descriptionMax + 1),
        mealType: 'brunch',
        timestamp: '2026-09-30 12:15',
        localDate: '2026-02-30',
        analysisId: 'analysis-1',
        items: 'not json',
        imageRoles: 'food,drink',
        extra: '1',
      }),
    ).resolves.toEqual([
      'analysisId',
      'description',
      'extra',
      'imageRoles',
      'items',
      'localDate',
      'mealType',
      'mode',
      'name',
      'timestamp',
    ]);
  });

  it.each([
    ['an empty list', '[]'],
    ['an object', '{"name":"Rice"}'],
    ['an item without nutrients', '[{"name":"Rice","grams":10}]'],
    [
      'an item with an unknown field',
      JSON.stringify([{ ...ITEM, calories: 1 }]),
    ],
    ['an item with negative grams', JSON.stringify([{ ...ITEM, grams: -1 }])],
    [
      'a name with a null character',
      JSON.stringify([{ ...ITEM, name: 'Ri\u0000ce' }]),
    ],
    [
      'too many items',
      JSON.stringify(
        Array.from({ length: API_LIMITS.itemsMax + 1 }, () => ITEM),
      ),
    ],
  ])('rejects items that are %s', async (_name, items) => {
    await expect(
      invalidFields(CreateDraftDto, { ...base, items }),
    ).resolves.toEqual(['items']);
  });
});

describe('UpdateDraftDto', () => {
  it('accepts an empty body and nulls for the clearable fields', async () => {
    await expect(invalidFields(UpdateDraftDto, {})).resolves.toEqual([]);
    await expect(
      invalidFields(UpdateDraftDto, {
        name: null,
        description: null,
        mealType: null,
        items: null,
        analysisId: null,
        portion: null,
      }),
    ).resolves.toEqual([]);
  });

  it('accepts a full update', async () => {
    await expect(
      invalidFields(UpdateDraftDto, {
        name: 'Lunch',
        description: '',
        mealType: 'dinner',
        timestamp: '2026-09-30T19:00:00+02:00',
        localDate: '2026-09-30',
        items: [ITEM],
        analysisId: UUID,
        portion: { count: 3, unit: 'slice', unitPlural: 'slices' },
      }),
    ).resolves.toEqual([]);
  });

  it('rejects clearing the intended time and invalid values', async () => {
    await expect(
      invalidFields(UpdateDraftDto, {
        timestamp: null,
        localDate: null,
        mealType: 'brunch',
        items: [],
        analysisId: 'nope',
        mode: 'text',
      }),
    ).resolves.toEqual([
      'analysisId',
      'items',
      'localDate',
      'mealType',
      'mode',
      'timestamp',
    ]);
  });
});

describe('LogDraftDto', () => {
  it('requires what an entry requires', async () => {
    await expect(
      invalidFields(LogDraftDto, {
        name: 'Lunch',
        mealType: 'lunch',
        timestamp: '2026-09-30T12:15:00.000Z',
        localDate: '2026-09-30',
        items: [ITEM],
      }),
    ).resolves.toEqual([]);
    await expect(
      invalidFields(LogDraftDto, { name: '  ', items: [] }),
    ).resolves.toEqual(['items', 'localDate', 'mealType', 'name', 'timestamp']);
  });
});
