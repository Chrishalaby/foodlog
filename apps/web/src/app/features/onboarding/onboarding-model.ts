import { type FieldTree, apply, required, schema } from '@angular/forms/signals';
import type { ProfileDto, UpsertWeightRequest } from '@food/shared';
import { type ProfileFormModel, toProfileDto } from '../settings/profile-model';
import { profileSchema } from '../settings/profile-schema';

export const ONBOARDING_STEPS = ['welcome', 'about', 'activity', 'goal', 'numbers'] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const PROGRESS_STEPS: readonly OnboardingStep[] = ONBOARDING_STEPS.slice(1);

export interface StepCopy {
  title: string;
  subtitle: string;
}

export const STEP_COPY: Record<OnboardingStep, StepCopy> = {
  welcome: {
    title: 'Welcome to FoodLog',
    subtitle: 'Snap a photo of any meal and get calories and macros in seconds.',
  },
  about: {
    title: 'About you',
    subtitle: 'Your body stats decide how much energy you burn. Only you can see them.',
  },
  activity: {
    title: 'How active are you?',
    subtitle: 'Think of a typical week, not your best one.',
  },
  goal: {
    title: 'What is your goal?',
    subtitle: 'Your calories and protein follow from it. You can change it anytime.',
  },
  numbers: {
    title: 'Your numbers',
    subtitle: 'Estimated from your answers. Adjust anything that does not look right.',
  },
};

export const STEP_FIELDS: Record<OnboardingStep, readonly (keyof ProfileFormModel)[]> = {
  welcome: [],
  about: ['sex', 'age', 'heightCm', 'weightKg', 'bodyFatPct'],
  activity: ['activityLevel', 'trainingDaysPerWeek'],
  goal: ['goal'],
  numbers: ['tdeeOverride', 'overrides'],
};

export const REQUIRED_MESSAGES = {
  sex: 'Choose one so the formula fits you.',
  age: 'Enter your age.',
  heightCm: 'Enter your height.',
  weightKg: 'Enter your weight.',
} as const;

export const onboardingSchema = schema<ProfileFormModel>((path) => {
  apply(path, profileSchema);
  required(path.sex, { message: REQUIRED_MESSAGES.sex });
  required(path.age, { message: REQUIRED_MESSAGES.age });
  required(path.heightCm, { message: REQUIRED_MESSAGES.heightCm });
  required(path.weightKg, { message: REQUIRED_MESSAGES.weightKg });
});

export const WIZARD_PROFILE_KEYS = [
  'weightKg',
  'heightCm',
  'age',
  'sex',
  'bodyFatPct',
  'tdeeOverride',
  'activityLevel',
  'goal',
  'trainingDaysPerWeek',
  'targetOverrides',
] as const satisfies readonly (keyof ProfileDto)[];

export function stepIndex(step: OnboardingStep): number {
  return ONBOARDING_STEPS.indexOf(step);
}

export function nextStep(step: OnboardingStep): OnboardingStep | null {
  return ONBOARDING_STEPS[stepIndex(step) + 1] ?? null;
}

export function previousStep(step: OnboardingStep): OnboardingStep | null {
  const index = stepIndex(step);
  return index > 0 ? ONBOARDING_STEPS[index - 1] : null;
}

export function stepFieldTrees(
  wizard: FieldTree<ProfileFormModel>,
  step: OnboardingStep,
): FieldTree<unknown>[] {
  return STEP_FIELDS[step].map((key) => wizard[key] as FieldTree<unknown>);
}

export function invalidStepFields(
  wizard: FieldTree<ProfileFormModel>,
  step: OnboardingStep,
): FieldTree<unknown>[] {
  return stepFieldTrees(wizard, step).filter((field) => field().invalid());
}

export function firstInvalidStep(wizard: FieldTree<ProfileFormModel>): OnboardingStep | null {
  return ONBOARDING_STEPS.find((step) => invalidStepFields(wizard, step).length > 0) ?? null;
}

function copyKey<K extends keyof ProfileDto>(target: ProfileDto, source: ProfileDto, key: K): void {
  target[key] = source[key];
}

export function onboardingProfile(current: ProfileDto, model: ProfileFormModel): ProfileDto {
  const entered = toProfileDto(model);
  const next: ProfileDto = { ...current, onboarded: true };
  for (const key of WIZARD_PROFILE_KEYS) {
    copyKey(next, entered, key);
  }
  return next;
}

export function skippedProfile(current: ProfileDto): ProfileDto {
  return { ...current, onboarded: true };
}

export function weighInFor(current: ProfileDto, next: ProfileDto): UpsertWeightRequest | null {
  if (next.weightKg === null) {
    return null;
  }
  const bodyFatPct = next.bodyFatPct ?? null;
  const unchanged =
    current.weightKg === next.weightKg && (current.bodyFatPct ?? null) === bodyFatPct;
  if (current.onboarded === true && unchanged) {
    return null;
  }
  return { weightKg: next.weightKg, bodyFatPct };
}

export function withWeighIn(profile: ProfileDto, weighIn: UpsertWeightRequest): ProfileDto {
  const bodyFatPct = weighIn.bodyFatPct ?? null;
  return {
    ...profile,
    weightKg: weighIn.weightKg,
    bodyFatPct: bodyFatPct === null ? (profile.bodyFatPct ?? null) : bodyFatPct,
  };
}
