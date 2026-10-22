import { zeroNutrients } from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateEntryDto, EntryListQueryDto } from './entries.dto.js';
import {
  hasNoNullCharacter,
  hasNoNullCharacterInItemNames,
  isStorableTimestamp,
} from './entry-validation.js';

function entryPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Porridge',
    mealType: 'breakfast',
    source: 'manual',
    timestamp: '2026-09-28T08:00:00.000Z',
    localDate: '2026-09-28',
    items: [{ name: 'Oats', grams: 80, nutrients: zeroNutrients() }],
    ...overrides,
  };
}

async function failedProperties(
  payload: Record<string, unknown>,
): Promise<string[]> {
  const errors = await validate(plainToInstance(CreateEntryDto, payload), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('entry validation helpers', () => {
  it('detects null characters only in strings', () => {
    expect(hasNoNullCharacter('Oats')).toBe(true);
    expect(hasNoNullCharacter('Oa\u0000ts')).toBe(false);
    expect(hasNoNullCharacter(42)).toBe(true);
    expect(hasNoNullCharacter(undefined)).toBe(true);
  });

  it('inspects item names without failing on malformed items', () => {
    expect(
      hasNoNullCharacterInItemNames([{ name: 'Oats' }, { name: 'Milk' }]),
    ).toBe(true);
    expect(
      hasNoNullCharacterInItemNames([{ name: 'Oats' }, { name: 'Mi\u0000lk' }]),
    ).toBe(false);
    expect(hasNoNullCharacterInItemNames([null, 'text', { grams: 1 }])).toBe(
      true,
    );
    expect(hasNoNullCharacterInItemNames('not an array')).toBe(true);
  });

  it.each([
    ['0001-01-01T00:00:00.000Z', true],
    ['9999-12-31T23:59:59.999Z', true],
    ['2026-09-28T08:00:00+02:00', true],
    ['0000-12-31T23:59:59.999Z', false],
    ['0001-01-01T00:30:00+01:00', false],
    ['9999-12-31T23:30:00-01:00', false],
  ])('treats %s as storable: %s', (value, expected) => {
    expect(isStorableTimestamp(value)).toBe(expected);
  });

  it('leaves malformed timestamps to the ISO format check', () => {
    expect(isStorableTimestamp('yesterday')).toBe(true);
    expect(isStorableTimestamp(undefined)).toBe(true);
  });
});

describe('CreateEntryDto', () => {
  it('accepts a valid entry', async () => {
    await expect(failedProperties(entryPayload())).resolves.toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['a null character in the name', { name: 'Por\u0000ridge' }, 'name'],
    [
      'a null character in the description',
      { description: 'Big\u0000bowl' },
      'description',
    ],
    [
      'a null character in an item name',
      {
        items: [{ name: 'Oa\u0000ts', grams: 80, nutrients: zeroNutrients() }],
      },
      'items',
    ],
    [
      'a timestamp before year 1',
      { timestamp: '0000-06-01T00:00:00.000Z' },
      'timestamp',
    ],
  ])('rejects %s', async (_label, overrides, property) => {
    await expect(failedProperties(entryPayload(overrides))).resolves.toEqual([
      property,
    ]);
  });
});

describe('EntryListQueryDto', () => {
  it('trims search terms and rejects null characters', async () => {
    const valid = plainToInstance(EntryListQueryDto, { q: '  oats  ' });
    await expect(validate(valid)).resolves.toEqual([]);
    expect(valid.q).toBe('oats');

    const invalid = plainToInstance(EntryListQueryDto, { q: 'oa\u0000ts' });
    const errors = await validate(invalid);
    expect(errors.map((error) => error.property)).toEqual(['q']);
  });
});
