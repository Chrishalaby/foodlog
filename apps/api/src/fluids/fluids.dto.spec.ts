import { FLUID_KINDS, FLUID_LIMITS } from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateFluidLogDto,
  FluidDayQueryDto,
  UpdateFluidLogDto,
} from './fluids.dto.js';

const VALID = {
  ml: 250,
  kind: 'water',
  timestamp: '2026-10-01T22:30:00.000+03:00',
  localDate: '2026-10-01',
};

async function invalidProperties<T extends object>(
  cls: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((error) => error.property);
}

describe('FluidDayQueryDto', () => {
  it('accepts a logical local date', async () => {
    await expect(
      invalidProperties(FluidDayQueryDto, { date: '2026-10-01' }),
    ).resolves.toEqual([]);
  });

  it.each(['2026-02-30', '2026-10-1', 'today', '', undefined])(
    'rejects the date %s',
    async (date) => {
      await expect(
        invalidProperties(FluidDayQueryDto, { date }),
      ).resolves.toEqual(['date']);
    },
  );
});

describe('CreateFluidLogDto', () => {
  it.each(FLUID_KINDS.map((kind) => [kind]))(
    'accepts a %s log',
    async (kind) => {
      await expect(
        invalidProperties(CreateFluidLogDto, { ...VALID, kind }),
      ).resolves.toEqual([]);
    },
  );

  it.each([[FLUID_LIMITS.logMinMl], [FLUID_LIMITS.logMaxMl], [330.5]])(
    'accepts %s ml',
    async (ml) => {
      await expect(
        invalidProperties(CreateFluidLogDto, { ...VALID, ml }),
      ).resolves.toEqual([]);
    },
  );

  it.each<[string, object]>([
    ['ml', { ml: FLUID_LIMITS.logMinMl - 1 }],
    ['ml', { ml: FLUID_LIMITS.logMaxMl + 1 }],
    ['ml', { ml: '250' }],
    ['ml', { ml: null }],
    ['ml', { ml: Number.NaN }],
    ['kind', { kind: 'juice' }],
    ['kind', { kind: null }],
    ['timestamp', { timestamp: '2026-10-01 22:30' }],
    ['timestamp', { timestamp: '2026-10-01T22:30:00' }],
    ['localDate', { localDate: '2026-13-01' }],
  ])('rejects an invalid %s', async (property, patch) => {
    await expect(
      invalidProperties(CreateFluidLogDto, { ...VALID, ...patch }),
    ).resolves.toEqual([property]);
  });

  it('requires every field', async () => {
    await expect(invalidProperties(CreateFluidLogDto, {})).resolves.toEqual([
      'ml',
      'kind',
      'timestamp',
      'localDate',
    ]);
  });

  it('rejects unknown properties', async () => {
    await expect(
      invalidProperties(CreateFluidLogDto, { ...VALID, userId: 'someone' }),
    ).resolves.toEqual(['userId']);
  });
});

describe('UpdateFluidLogDto', () => {
  it('accepts an empty or partial change', async () => {
    await expect(invalidProperties(UpdateFluidLogDto, {})).resolves.toEqual([]);
    await expect(
      invalidProperties(UpdateFluidLogDto, { ml: 500, kind: 'coffee' }),
    ).resolves.toEqual([]);
    await expect(invalidProperties(UpdateFluidLogDto, VALID)).resolves.toEqual(
      [],
    );
  });

  it.each<[string, object]>([
    ['ml', { ml: null }],
    ['ml', { ml: 5 }],
    ['kind', { kind: null }],
    ['kind', { kind: 'soda' }],
    ['timestamp', { timestamp: null }],
    ['localDate', { localDate: null }],
    ['localDate', { localDate: '01-10-2026' }],
  ])('rejects an invalid %s', async (property, patch) => {
    await expect(invalidProperties(UpdateFluidLogDto, patch)).resolves.toEqual([
      property,
    ]);
  });
});
