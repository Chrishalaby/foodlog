import { BODY_BOUNDS } from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  isFutureWeighIn,
  latestLocalDate,
  UpsertWeightDto,
  WEIGHT_RANGE_MAX_DAYS,
  WeightDateParamDto,
  weightRangeProblem,
  WeightsQueryDto,
} from './weights.dto.js';

async function problems<T extends object>(
  cls: new () => T,
  plain: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('weightRangeProblem', () => {
  it('accepts a single day and the maximum span', () => {
    expect(weightRangeProblem('2026-09-28', '2026-09-28')).toBeNull();
    expect(WEIGHT_RANGE_MAX_DAYS).toBe(400);
    expect(weightRangeProblem('2025-08-25', '2026-09-28')).toBeNull();
  });

  it('rejects reversed and too long ranges', () => {
    expect(weightRangeProblem('2026-09-28', '2026-09-27')).toBe(
      'to must be on or after from',
    );
    expect(weightRangeProblem('2025-08-24', '2026-09-28')).toBe(
      'the range from..to must span at most 400 days',
    );
  });

  it('leaves invalid dates to the date validator', () => {
    expect(weightRangeProblem('2026-02-30', '2026-09-28')).toBeNull();
    expect(weightRangeProblem('2026-09-01', undefined)).toBeNull();
  });
});

describe('latestLocalDate', () => {
  it('is the day after the UTC date, the furthest any time zone can be ahead', () => {
    expect(latestLocalDate(new Date('2026-09-28T00:00:00.000Z'))).toBe(
      '2026-09-29',
    );
    expect(latestLocalDate(new Date('2026-12-31T23:59:59.999Z'))).toBe(
      '2027-01-01',
    );
  });
});

describe('isFutureWeighIn', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');

  it('allows past dates, today and the latest local date', () => {
    expect(isFutureWeighIn('2020-01-01', now)).toBe(false);
    expect(isFutureWeighIn('2026-09-28', now)).toBe(false);
    expect(isFutureWeighIn('2026-09-29', now)).toBe(false);
  });

  it('flags dates no time zone has reached yet', () => {
    expect(isFutureWeighIn('2026-09-30', now)).toBe(true);
    expect(isFutureWeighIn('2062-09-28', now)).toBe(true);
  });

  it('accepts the eating day of a weigh-in logged after midnight', () => {
    const beirutLateNight = new Date('2026-10-01T21:56:00.000Z');
    const kiribatiLateNight = new Date('2026-10-01T12:30:00.000Z');

    expect(isFutureWeighIn('2026-10-01', beirutLateNight)).toBe(false);
    expect(isFutureWeighIn('2026-10-02', beirutLateNight)).toBe(false);
    expect(isFutureWeighIn('2026-10-01', kiribatiLateNight)).toBe(false);
  });
});

describe('WeightsQueryDto', () => {
  it('accepts a valid range', async () => {
    await expect(
      problems(WeightsQueryDto, { from: '2026-09-01', to: '2026-09-28' }),
    ).resolves.toEqual([]);
  });

  it('reports invalid dates and bad ranges', async () => {
    await expect(
      problems(WeightsQueryDto, { from: '2026-9-1', to: '2026-09-28' }),
    ).resolves.toEqual(['from must be a valid date formatted as YYYY-MM-DD']);
    await expect(
      problems(WeightsQueryDto, { from: '2026-09-28', to: '2026-09-01' }),
    ).resolves.toEqual(['to must be on or after from']);
    await expect(problems(WeightsQueryDto, {})).resolves.toHaveLength(2);
  });
});

describe('WeightDateParamDto', () => {
  it('validates the date parameter', async () => {
    await expect(
      problems(WeightDateParamDto, { date: '2026-09-28' }),
    ).resolves.toEqual([]);
    await expect(
      problems(WeightDateParamDto, { date: '2026-02-29' }),
    ).resolves.toEqual(['date must be a valid date formatted as YYYY-MM-DD']);
  });
});

describe('UpsertWeightDto', () => {
  it('accepts the bounds and an absent or null body fat', async () => {
    for (const body of [
      { weightKg: BODY_BOUNDS.weightKg.min },
      { weightKg: BODY_BOUNDS.weightKg.max, bodyFatPct: null },
      { weightKg: 80, bodyFatPct: BODY_BOUNDS.bodyFatPct.min },
      { weightKg: 80, bodyFatPct: BODY_BOUNDS.bodyFatPct.max },
    ]) {
      await expect(problems(UpsertWeightDto, body)).resolves.toEqual([]);
    }
  });

  it.each([
    [{}],
    [{ weightKg: 24.9 }],
    [{ weightKg: 400.1 }],
    [{ weightKg: '80' }],
    [{ weightKg: null }],
    [{ weightKg: 80, bodyFatPct: 2.9 }],
    [{ weightKg: 80, bodyFatPct: 70.1 }],
    [{ weightKg: 80, bodyFatPct: '20' }],
    [{ weightKg: 80, date: '2026-09-28' }],
  ])('rejects %j', async (body) => {
    await expect(problems(UpsertWeightDto, body)).resolves.not.toEqual([]);
  });
});
