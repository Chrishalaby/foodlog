import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  MICRO_META,
  type Micros,
  NUTRIENT_KEYS,
  PORTION_COUNT_MAX,
  PORTION_UNIT_MAX,
  zeroNutrients,
} from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  EntryItemInputDto,
  IsEntryItems,
  IsIsoTimestamp,
  IsLocalDate,
  IsOptionalMicrosPer100,
  IsOptionalPortion,
  isIsoTimestamp,
  NutrientsDto,
  PortionDto,
} from './dto.js';

class DatedDto {
  @IsLocalDate()
  localDate: string;

  @IsIsoTimestamp()
  timestamp: string;
}

class ItemsDto {
  @IsEntryItems()
  items: EntryItemInputDto[];
}

class PortionedDto {
  @IsOptionalPortion()
  portion?: PortionDto | null;
}

class Per100MicrosDto {
  @IsOptionalMicrosPer100()
  microsPer100?: Micros | null;
}

async function errorsFor<T extends object>(
  cls: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const collect = (list: typeof errors, prefix: string): string[] =>
    list.flatMap((error) => [
      ...Object.keys(error.constraints ?? {}).map(
        () => `${prefix}${error.property}`,
      ),
      ...collect(error.children ?? [], `${prefix}${error.property}.`),
    ]);
  return collect(errors, '');
}

function validItem(overrides: object = {}): object {
  return { name: 'Rice', grams: 150, nutrients: zeroNutrients(), ...overrides };
}

describe('dto validation', () => {
  it('accepts valid nutrients and rejects out-of-range values', async () => {
    await expect(errorsFor(NutrientsDto, zeroNutrients())).resolves.toEqual([]);
    await expect(
      errorsFor(NutrientsDto, {
        ...zeroNutrients(),
        calories: -1,
        sodium: 200_001,
      }),
    ).resolves.toEqual(['calories', 'sodium']);
    await expect(
      errorsFor(NutrientsDto, { ...zeroNutrients(), protein: 'a lot' }),
    ).resolves.toContain('protein');
    const missing = await errorsFor(NutrientsDto, {});
    expect(new Set(missing)).toEqual(new Set(NUTRIENT_KEYS));
  });

  it('trims item names and validates item fields', async () => {
    const dto = plainToInstance(
      EntryItemInputDto,
      validItem({ name: '  Rice  ' }),
    );
    expect(dto.name).toBe('Rice');
    expect(dto.nutrients).toBeInstanceOf(NutrientsDto);

    await expect(
      errorsFor(EntryItemInputDto, validItem({ confidence: null })),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(
        EntryItemInputDto,
        validItem({
          name: '   ',
          grams: MAX_ITEM_GRAMS + 1,
          confidence: 'certain',
        }),
      ),
    ).resolves.toEqual(['name', 'grams', 'confidence']);
    await expect(
      errorsFor(EntryItemInputDto, validItem({ nutrients: undefined })),
    ).resolves.toContain('nutrients');
    await expect(
      errorsFor(
        EntryItemInputDto,
        validItem({ nutrients: { ...zeroNutrients(), fat: -2 } }),
      ),
    ).resolves.toEqual(['nutrients.fat']);
    await expect(
      errorsFor(EntryItemInputDto, validItem({ per100g: zeroNutrients() })),
    ).resolves.toEqual(['per100g']);
  });

  it('accepts item counts only together with a unit', async () => {
    await expect(
      errorsFor(
        EntryItemInputDto,
        validItem({ count: 2, unit: 'egg', unitPlural: 'eggs' }),
      ),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(
        EntryItemInputDto,
        validItem({ count: 1.5, unit: ' slice ', unitPlural: null }),
      ),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(
        EntryItemInputDto,
        validItem({ count: null, unit: null, unitPlural: null }),
      ),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(EntryItemInputDto, validItem({ count: null, unit: '' })),
    ).resolves.toEqual([]);
    expect(
      new Set(await errorsFor(EntryItemInputDto, validItem({ count: 2 }))),
    ).toEqual(new Set(['unit']));
    expect(
      new Set(await errorsFor(EntryItemInputDto, validItem({ unit: 'egg' }))),
    ).toEqual(new Set(['count']));
    await expect(
      errorsFor(
        EntryItemInputDto,
        validItem({
          count: PORTION_COUNT_MAX + 1,
          unit: 'x'.repeat(PORTION_UNIT_MAX + 1),
          unitPlural: 'y'.repeat(PORTION_UNIT_MAX + 1),
        }),
      ),
    ).resolves.toEqual(['count', 'unit', 'unitPlural']);
    await expect(
      errorsFor(EntryItemInputDto, validItem({ count: 0, unit: 'egg' })),
    ).resolves.toEqual(['count']);
  });

  it('accepts known item micros up to their maximum and a drink volume', async () => {
    await expect(
      errorsFor(
        EntryItemInputDto,
        validItem({
          micros: {
            vitaminD: MICRO_META.vitaminD.max,
            calcium: 0,
            caffeine: 35,
            iron: null,
          },
          fluidMl: 330,
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(EntryItemInputDto, validItem({ micros: null, fluidMl: null })),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(EntryItemInputDto, validItem({ micros: {}, fluidMl: 0 })),
    ).resolves.toEqual([]);
  });

  it.each([
    ['an unknown key', { omega3: 2 }],
    ['a negative amount', { iron: -1 }],
    ['an amount above the item maximum', { vitaminD: 2501 }],
    ['text', { calcium: 'lots' }],
    ['an infinite amount', { calcium: Number.POSITIVE_INFINITY }],
    ['a list', [1, 2]],
    ['a number', 5],
  ])('rejects item micros with %s', async (_label, micros) => {
    await expect(
      errorsFor(EntryItemInputDto, validItem({ micros })),
    ).resolves.toEqual(['micros']);
  });

  it('explains which vitamin or mineral is wrong', async () => {
    const errors = await validate(
      plainToInstance(EntryItemInputDto, validItem({ micros: { zinc: 600 } })),
    );

    expect(errors[0]?.constraints).toEqual({
      isMicros: 'micros.zinc must be a number between 0 and 500, or null',
    });
  });

  it.each([-1, 5001, '330', Number.NaN])(
    'rejects the drink volume %s',
    async (fluidMl) => {
      expect(
        new Set(await errorsFor(EntryItemInputDto, validItem({ fluidMl }))),
      ).toEqual(new Set(['fluidMl']));
    },
  );

  it('allows per-100 g micros above the item maximum but not junk', async () => {
    await expect(
      errorsFor(Per100MicrosDto, { microsPer100: { vitaminD: 12500 } }),
    ).resolves.toEqual([]);
    await expect(errorsFor(Per100MicrosDto, {})).resolves.toEqual([]);
    await expect(
      errorsFor(Per100MicrosDto, { microsPer100: null }),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(Per100MicrosDto, { microsPer100: { calcium: 100_001 } }),
    ).resolves.toEqual(['microsPer100']);
    await expect(
      errorsFor(Per100MicrosDto, { microsPer100: { vitaminQ: 1 } }),
    ).resolves.toEqual(['microsPer100']);
  });

  it('validates an optional meal portion', async () => {
    await expect(errorsFor(PortionedDto, {})).resolves.toEqual([]);
    await expect(errorsFor(PortionedDto, { portion: null })).resolves.toEqual(
      [],
    );
    await expect(
      errorsFor(PortionedDto, {
        portion: { count: 1.5, unit: ' burger ', unitPlural: 'burgers' },
      }),
    ).resolves.toEqual([]);
    expect(
      plainToInstance(PortionedDto, {
        portion: { count: 2, unit: ' burger ', unitPlural: ' burgers' },
      }).portion,
    ).toEqual({ count: 2, unit: 'burger', unitPlural: 'burgers' });
    await expect(
      errorsFor(PortionedDto, {
        portion: { count: 0, unit: '  ', unitPlural: '' },
      }),
    ).resolves.toEqual(['portion.count', 'portion.unit', 'portion.unitPlural']);
    await expect(
      errorsFor(PortionedDto, {
        portion: { count: 2, unit: 'burger', unitPlural: 'burgers', x: 1 },
      }),
    ).resolves.toEqual(['portion.x']);
    await expect(
      errorsFor(PortionedDto, { portion: '2 burgers' }),
    ).resolves.toContain('portion');
    await expect(
      errorsFor(PortionedDto, {
        portion: [{ count: 2, unit: 'burger', unitPlural: 'burgers' }],
      }),
    ).resolves.toContain('portion');
  });

  it('validates item arrays', async () => {
    await expect(
      errorsFor(ItemsDto, { items: [validItem()] }),
    ).resolves.toEqual([]);
    await expect(errorsFor(ItemsDto, { items: [] })).resolves.toEqual([
      'items',
    ]);
    await expect(
      errorsFor(ItemsDto, {
        items: Array.from({ length: API_LIMITS.itemsMax + 1 }, validItem),
      }),
    ).resolves.toEqual(['items']);
    await expect(
      errorsFor(ItemsDto, { items: [validItem({ grams: -1 })] }),
    ).resolves.toEqual(['items.0.grams']);
  });

  it('validates local dates and ISO timestamps', async () => {
    await expect(
      errorsFor(DatedDto, {
        localDate: '2026-09-28',
        timestamp: '2026-09-28T12:30:00.000Z',
      }),
    ).resolves.toEqual([]);
    await expect(
      errorsFor(DatedDto, {
        localDate: '2026-02-30',
        timestamp: '2026-09-28 12:30',
      }),
    ).resolves.toEqual(['localDate', 'timestamp']);
  });

  it.each([
    ['2026-09-28T12:30:00Z', true],
    ['2026-09-28T12:30:00.123+02:00', true],
    ['2026-09-28T12:30-05:00', true],
    ['2026-09-28T12:30:00', false],
    ['2026-09-28', false],
    ['2026-13-28T12:30:00Z', false],
    [1_790_000_000_000, false],
  ])('isIsoTimestamp(%j) is %s', (value, expected) => {
    expect(isIsoTimestamp(value)).toBe(expected);
  });
});
