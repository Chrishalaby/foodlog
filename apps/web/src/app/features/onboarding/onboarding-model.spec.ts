import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { form } from '@angular/forms/signals';
import type { ProfileDto } from '@food/shared';
import {
  DEFAULT_PROFILE,
  type ProfileFormModel,
  emptyOverrideDraft,
  toFormModel,
} from '../settings/profile-model';
import {
  REQUIRED_MESSAGES,
  firstInvalidStep,
  invalidStepFields,
  nextStep,
  onboardingProfile,
  onboardingSchema,
  previousStep,
  skippedProfile,
  weighInFor,
  withWeighIn,
} from './onboarding-model';

const CURRENT: ProfileDto = {
  ...DEFAULT_PROFILE,
  onboarded: false,
  location: 'Beirut, Lebanon',
  aiModel: 'gpt-6-sol',
  theme: 'light',
  targetOverrides: { sodiumMax: 2000 },
};

const ENTERED: ProfileFormModel = {
  ...toFormModel(CURRENT),
  weightKg: 72.5,
  heightCm: 178,
  age: 34,
  sex: 'female',
  bodyFatPct: 24,
  tdeeOverride: 2300,
  activityLevel: 'light',
  goal: 'cut',
  trainingDaysPerWeek: 3,
  overrides: { ...emptyOverrideDraft(), sodiumMax: 2000, protein: 150 },
};

function wizardFor(model: ProfileFormModel) {
  return TestBed.runInInjectionContext(() => form(signal(model), onboardingSchema));
}

function messages(model: ProfileFormModel, step: Parameters<typeof invalidStepFields>[1]) {
  return invalidStepFields(wizardFor(model), step).map((field) => field().errors()[0]?.message);
}

describe('onboarding steps', () => {
  it('walks through the steps in order', () => {
    expect(nextStep('welcome')).toBe('about');
    expect(nextStep('goal')).toBe('numbers');
    expect(nextStep('numbers')).toBeNull();
    expect(previousStep('about')).toBe('welcome');
    expect(previousStep('welcome')).toBeNull();
  });

  it('requires sex, age, height and weight on the about step', () => {
    expect(messages(toFormModel(DEFAULT_PROFILE), 'about')).toEqual([
      REQUIRED_MESSAGES.sex,
      REQUIRED_MESSAGES.age,
      REQUIRED_MESSAGES.heightCm,
      REQUIRED_MESSAGES.weightKg,
    ]);
    expect(messages(ENTERED, 'about')).toEqual([]);
  });

  it('validates body values against the shared bounds', () => {
    expect(messages({ ...ENTERED, age: 12, heightCm: 260, bodyFatPct: 80 }, 'about')).toEqual([
      'Age must be between 13 and 100 years.',
      'Height must be between 100 and 250 cm.',
      'Body fat must be between 3 and 70 %.',
    ]);
    expect(messages({ ...ENTERED, bodyFatPct: null }, 'about')).toEqual([]);
  });

  it('validates the daily burn and target overrides on the numbers step', () => {
    expect(messages({ ...ENTERED, tdeeOverride: 500 }, 'numbers')).toEqual([
      'Daily calorie burn must be between 800 and 8,000 kcal.',
    ]);
    const overrides = { ...emptyOverrideDraft(), calories: 50 };
    expect(invalidStepFields(wizardFor({ ...ENTERED, overrides }), 'numbers')).toHaveLength(1);
    expect(messages({ ...ENTERED, tdeeOverride: null }, 'numbers')).toEqual([]);
  });

  it('finds the first step that still needs attention', () => {
    expect(firstInvalidStep(wizardFor(toFormModel(DEFAULT_PROFILE)))).toBe('about');
    expect(firstInvalidStep(wizardFor({ ...ENTERED, tdeeOverride: 99999 }))).toBe('numbers');
    expect(firstInvalidStep(wizardFor(ENTERED))).toBeNull();
  });
});

describe('onboarding profile', () => {
  it('saves the entered fields on top of the current profile', () => {
    expect(onboardingProfile(CURRENT, ENTERED)).toEqual({
      ...CURRENT,
      weightKg: 72.5,
      heightCm: 178,
      age: 34,
      sex: 'female',
      bodyFatPct: 24,
      tdeeOverride: 2300,
      activityLevel: 'light',
      goal: 'cut',
      trainingDaysPerWeek: 3,
      targetOverrides: { sodiumMax: 2000, protein: 150 },
      onboarded: true,
    });
  });

  it('keeps settings the wizard does not show', () => {
    const next = onboardingProfile(CURRENT, { ...ENTERED, location: '', theme: 'dark' });
    expect(next.location).toBe('Beirut, Lebanon');
    expect(next.theme).toBe('light');
    expect(next.aiModel).toBe('gpt-6-sol');
  });

  it('only marks the profile as onboarded when skipping', () => {
    expect(skippedProfile(CURRENT)).toEqual({ ...CURRENT, onboarded: true });
  });
});

describe('weighInFor', () => {
  const next = onboardingProfile(CURRENT, ENTERED);

  it('logs the entered weight the first time', () => {
    expect(weighInFor(CURRENT, next)).toEqual({ weightKg: 72.5, bodyFatPct: 24 });
    expect(weighInFor(CURRENT, { ...next, bodyFatPct: null })).toEqual({
      weightKg: 72.5,
      bodyFatPct: null,
    });
  });

  it('only logs again on a redo when weight or body fat changed', () => {
    const onboarded = { ...next, onboarded: true };
    expect(weighInFor(onboarded, onboarded)).toBeNull();
    expect(weighInFor(onboarded, { ...onboarded, weightKg: 71.9 })).toEqual({
      weightKg: 71.9,
      bodyFatPct: 24,
    });
    expect(weighInFor(onboarded, { ...onboarded, bodyFatPct: 22 })).toEqual({
      weightKg: 72.5,
      bodyFatPct: 22,
    });
  });

  it('skips the weigh-in without a weight', () => {
    expect(weighInFor(CURRENT, { ...next, weightKg: null })).toBeNull();
  });
});

describe('withWeighIn', () => {
  it('mirrors what the server copies from a weigh-in into the profile', () => {
    expect(withWeighIn(CURRENT, { weightKg: 70.2, bodyFatPct: 21 })).toEqual({
      ...CURRENT,
      weightKg: 70.2,
      bodyFatPct: 21,
    });
  });

  it('keeps the known body fat when the weigh-in has none', () => {
    const current = { ...CURRENT, bodyFatPct: 25 };
    expect(withWeighIn(current, { weightKg: 70.2, bodyFatPct: null }).bodyFatPct).toBe(25);
    expect(withWeighIn(current, { weightKg: 70.2 }).bodyFatPct).toBe(25);
  });
});
