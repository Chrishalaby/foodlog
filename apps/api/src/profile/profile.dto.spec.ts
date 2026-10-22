import { BODY_BOUNDS, FLUID_LIMITS } from '@food/shared';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from './profile.dto.js';

const VALID = {
  weightKg: 80,
  heightCm: 180,
  age: 35,
  sex: 'male',
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 3,
  targetOverrides: {},
  location: null,
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'dark',
};

async function invalidProperties(patch: object): Promise<string[]> {
  const errors = await validate(
    plainToInstance(UpdateProfileDto, { ...VALID, ...patch }),
    { whitelist: true, forbidNonWhitelisted: true },
  );
  return errors.map((error) => error.property);
}

describe('UpdateProfileDto', () => {
  it('accepts a profile without the optional body fields', async () => {
    await expect(invalidProperties({})).resolves.toEqual([]);
  });

  it.each([
    [{ bodyFatPct: null, tdeeOverride: null, onboarded: false }],
    [{ bodyFatPct: BODY_BOUNDS.bodyFatPct.min }],
    [{ bodyFatPct: BODY_BOUNDS.bodyFatPct.max }],
    [{ bodyFatPct: 18.4 }],
    [{ tdeeOverride: BODY_BOUNDS.tdeeOverride.min }],
    [{ tdeeOverride: BODY_BOUNDS.tdeeOverride.max }],
    [{ onboarded: true }],
    [{ weightKg: BODY_BOUNDS.weightKg.max, age: BODY_BOUNDS.age.min }],
    [{ heightCm: BODY_BOUNDS.heightCm.min, trainingDaysPerWeek: 7 }],
    [{ dayStartHour: 0 }],
    [{ dayStartHour: 3 }],
    [{ dayStartHour: 6 }],
    [{ fluidTargetMl: null }],
    [{ fluidTargetMl: FLUID_LIMITS.targetMinMl }],
    [{ fluidTargetMl: FLUID_LIMITS.targetMaxMl }],
    [{ dayStartHour: 1, fluidTargetMl: 2750 }],
  ])('accepts %j', async (patch) => {
    await expect(invalidProperties(patch)).resolves.toEqual([]);
  });

  it.each([
    ['bodyFatPct', { bodyFatPct: 2.9 }],
    ['bodyFatPct', { bodyFatPct: 70.1 }],
    ['bodyFatPct', { bodyFatPct: '20' }],
    ['tdeeOverride', { tdeeOverride: 799 }],
    ['tdeeOverride', { tdeeOverride: 8001 }],
    ['tdeeOverride', { tdeeOverride: 2500.5 }],
    ['onboarded', { onboarded: null }],
    ['onboarded', { onboarded: 'true' }],
    ['weightKg', { weightKg: BODY_BOUNDS.weightKg.min - 0.1 }],
    ['heightCm', { heightCm: BODY_BOUNDS.heightCm.max + 1 }],
    ['age', { age: BODY_BOUNDS.age.max + 1 }],
    ['trainingDaysPerWeek', { trainingDaysPerWeek: 8 }],
    ['dayStartHour', { dayStartHour: -1 }],
    ['dayStartHour', { dayStartHour: 7 }],
    ['dayStartHour', { dayStartHour: 2.5 }],
    ['dayStartHour', { dayStartHour: '3' }],
    ['dayStartHour', { dayStartHour: null }],
    ['fluidTargetMl', { fluidTargetMl: FLUID_LIMITS.targetMinMl - 1 }],
    ['fluidTargetMl', { fluidTargetMl: FLUID_LIMITS.targetMaxMl + 1 }],
    ['fluidTargetMl', { fluidTargetMl: 2500.5 }],
    ['fluidTargetMl', { fluidTargetMl: '2500' }],
  ])('rejects an invalid %s', async (property, patch) => {
    await expect(invalidProperties(patch)).resolves.toEqual([property]);
  });
});
