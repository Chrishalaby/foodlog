import type { ProfileDto, TargetOverrides } from '@food/shared';
import type { Profile } from '../generated/prisma/client.js';
import { profileData, toProfileDto } from './profile.mapper.js';
import type { UpdateProfileDto } from './profile.dto.js';

function row(overrides: Partial<Profile> = {}): Profile {
  return {
    userId: '0199a1b2-0000-7000-8000-000000000001',
    weightKg: null,
    heightCm: null,
    age: null,
    sex: null,
    bodyFatPct: null,
    tdeeOverride: null,
    onboardedAt: null,
    activityLevel: 'moderate',
    goal: 'maintain',
    trainingDaysPerWeek: 0,
    targetOverrides: {},
    hiddenFoods: [],
    dismissedFoodMerges: [],
    foodMergeDecisions: [],
    dayStartHour: 3,
    fluidTargetMl: null,
    location: null,
    aiModel: null,
    aiDetailFood: 'high',
    aiDetailLabel: 'high',
    theme: 'dark',
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...overrides,
  };
}

describe('toProfileDto', () => {
  it('reports onboarded once onboardedAt is set and maps the body fields', () => {
    const dto = toProfileDto(
      row({
        bodyFatPct: 17.5,
        tdeeOverride: 2450,
        onboardedAt: new Date('2026-09-02T08:00:00Z'),
      }),
    );
    expect(dto).toMatchObject({
      bodyFatPct: 17.5,
      tdeeOverride: 2450,
      onboarded: true,
    });
  });

  it('maps a default row', () => {
    expect(toProfileDto(row())).toEqual({
      weightKg: null,
      heightCm: null,
      age: null,
      sex: null,
      bodyFatPct: null,
      tdeeOverride: null,
      onboarded: false,
      activityLevel: 'moderate',
      goal: 'maintain',
      trainingDaysPerWeek: 0,
      targetOverrides: {},
      location: null,
      aiModel: null,
      aiDetailFood: 'high',
      aiDetailLabel: 'high',
      theme: 'dark',
      dayStartHour: 3,
      fluidTargetMl: null,
    });
  });

  it('maps the day start and the fluids target', () => {
    expect(
      toProfileDto(row({ dayStartHour: 0, fluidTargetMl: 3200 })),
    ).toMatchObject({ dayStartHour: 0, fluidTargetMl: 3200 });
    expect(toProfileDto(row({ dayStartHour: 6 })).dayStartHour).toBe(6);
  });

  it.each([-1, 7, 24])(
    'falls back to a 3 am day start for a stored hour of %s',
    (dayStartHour) => {
      expect(toProfileDto(row({ dayStartHour })).dayStartHour).toBe(3);
    },
  );

  it.each([0, 499, 8001])(
    'treats a stored fluids target of %s ml as automatic',
    (fluidTargetMl) => {
      expect(toProfileDto(row({ fluidTargetMl })).fluidTargetMl).toBeNull();
    },
  );

  it('falls back to defaults for unexpected stored strings and sanitizes overrides', () => {
    const dto = toProfileDto(
      row({
        aiDetailFood: 'ultra',
        aiDetailLabel: 'low',
        theme: 'neon',
        targetOverrides: { calories: 2500, bogus: 1, protein: 'lots' },
      }),
    );
    expect(dto.aiDetailFood).toBe('high');
    expect(dto.aiDetailLabel).toBe('low');
    expect(dto.theme).toBe('dark');
    expect(dto.targetOverrides).toEqual({ calories: 2500 });
  });
});

describe('profileData', () => {
  it('passes body fat and the burn override through, leaving absent values undefined', () => {
    const base: ProfileDto = {
      ...toProfileDto(row()),
      bodyFatPct: 18.5,
      tdeeOverride: 2600,
      onboarded: true,
    };
    const data = profileData(base);
    expect(data).toMatchObject({ bodyFatPct: 18.5, tdeeOverride: 2600 });
    expect(data).not.toHaveProperty('onboarded');
    expect(data).not.toHaveProperty('onboardedAt');

    const { bodyFatPct: _bodyFat, tdeeOverride: _override, ...absent } = base;
    const partial = profileData(absent);
    expect(partial.bodyFatPct).toBeUndefined();
    expect(partial.tdeeOverride).toBeUndefined();

    const cleared = profileData({
      ...base,
      bodyFatPct: null,
      tdeeOverride: null,
    });
    expect(cleared).toMatchObject({ bodyFatPct: null, tdeeOverride: null });
  });

  it('keeps the stored day start and fluids target when a client omits them', () => {
    const {
      dayStartHour: _dayStart,
      fluidTargetMl: _fluids,
      ...older
    } = toProfileDto(row());
    const data = profileData(older);

    expect(data.dayStartHour).toBeUndefined();
    expect(data.fluidTargetMl).toBeUndefined();
    expect(
      profileData({ ...older, dayStartHour: 0, fluidTargetMl: 2800 }),
    ).toMatchObject({ dayStartHour: 0, fluidTargetMl: 2800 });
    expect(profileData({ ...older, fluidTargetMl: null }).fluidTargetMl).toBe(
      null,
    );
  });

  it('stores only valid, non-null overrides', () => {
    const dto: UpdateProfileDto = {
      ...toProfileDto(row()),
      targetOverrides: {
        calories: 2400,
        protein: null,
      } as unknown as TargetOverrides,
    };
    expect(profileData(dto).targetOverrides).toEqual({ calories: 2400 });
  });
});
