import {
  ACTIVITY_FACTOR,
  type ActivityLevel,
  BODY_BOUNDS,
  type BmrFormula,
  type Goal,
  type ImageDetail,
  type ProfileDto,
  type Sex,
  TARGET_KEYS,
  TARGET_OVERRIDE_BOUNDS,
  type TargetKey,
  type TargetOverrides,
  type TargetProfileInput,
  type TargetValues,
  type TargetsResult,
  type ThemePreference,
  computeTargets,
  isFiniteNumber,
  roundTo,
} from '@food/shared';
import { DEFAULT_DAY_START_HOUR, normalizeDayStartHour } from '../../core/day-start';

export type OverrideDraft = Record<TargetKey, number | null>;

export interface ProfileFormModel {
  weightKg: number | null;
  heightCm: number | null;
  age: number | null;
  sex: Sex | '';
  bodyFatPct: number | null;
  tdeeOverride: number | null;
  activityLevel: ActivityLevel;
  goal: Goal;
  trainingDaysPerWeek: number;
  overrides: OverrideDraft;
  location: string;
  aiModel: string;
  aiDetailFood: ImageDetail;
  aiDetailLabel: ImageDetail;
  theme: ThemePreference;
  dayStartHour: number;
  fluidTargetL: number | null;
}

export interface NumericBounds {
  min: number;
  max: number;
}

export const DEFAULT_PROFILE: ProfileDto = {
  weightKg: null,
  heightCm: null,
  age: null,
  sex: null,
  bodyFatPct: null,
  tdeeOverride: null,
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 0,
  targetOverrides: {},
  location: null,
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'dark',
  dayStartHour: DEFAULT_DAY_START_HOUR,
  fluidTargetMl: null,
};

export const PROFILE_FIELD_LABELS: Record<keyof ProfileDto, string> = {
  weightKg: 'Weight',
  heightCm: 'Height',
  age: 'Age',
  sex: 'Sex',
  bodyFatPct: 'Body fat',
  tdeeOverride: 'Daily calorie burn',
  onboarded: 'Onboarding',
  activityLevel: 'Activity level',
  goal: 'Goal',
  trainingDaysPerWeek: 'Training days',
  targetOverrides: 'Target overrides',
  location: 'Location',
  aiModel: 'AI model',
  aiDetailFood: 'Food photo detail',
  aiDetailLabel: 'Label detail',
  theme: 'Theme',
  dayStartHour: 'Day starts at',
  fluidTargetMl: 'Daily fluids',
};

const UNTRACKED_PROFILE_KEYS: ReadonlySet<keyof ProfileDto> = new Set<keyof ProfileDto>([
  'onboarded',
]);

export const BMR_FORMULA_LABELS: Record<BmrFormula, string> = {
  mifflin_st_jeor: 'Mifflin-St Jeor',
  katch_mcardle: 'Katch-McArdle',
};

const kcal = (value: number): string =>
  `${Math.abs(Math.round(value)).toLocaleString('en-US')} kcal`;

const PROFILE_KEYS = (Object.keys(PROFILE_FIELD_LABELS) as (keyof ProfileDto)[]).filter(
  (key) => !UNTRACKED_PROFILE_KEYS.has(key),
);

export function fluidLitresFromMl(ml: number | null | undefined): number | null {
  return isFiniteNumber(ml) && ml > 0 ? roundTo(ml / 1000, 2) : null;
}

export function fluidMlFromLitres(litres: number | null): number | null {
  return litres !== null && isFiniteNumber(litres) ? Math.round(litres * 1000) : null;
}

export function isWithin(value: number, bounds: NumericBounds): boolean {
  return isFiniteNumber(value) && value >= bounds.min && value <= bounds.max;
}

export function emptyOverrideDraft(): OverrideDraft {
  return {
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
    satFatMax: null,
    fiberMin: null,
    sugarMax: null,
    sodiumMax: null,
  };
}

export function overrideDraftFrom(overrides: TargetOverrides | null | undefined): OverrideDraft {
  const draft = emptyOverrideDraft();
  for (const key of TARGET_KEYS) {
    const value = overrides?.[key];
    draft[key] = isFiniteNumber(value) ? value : null;
  }
  return draft;
}

export function overridesFromDraft(draft: OverrideDraft, onlyValid = false): TargetOverrides {
  const overrides: TargetOverrides = {};
  for (const key of TARGET_KEYS) {
    const value = draft[key];
    if (value === null || !isFiniteNumber(value)) {
      continue;
    }
    if (onlyValid && !isWithin(value, TARGET_OVERRIDE_BOUNDS[key])) {
      continue;
    }
    overrides[key] = value;
  }
  return overrides;
}

export function overriddenKeys(overrides: TargetOverrides): TargetKey[] {
  return TARGET_KEYS.filter((key) => isFiniteNumber(overrides[key]));
}

export function sameOverrides(a: TargetOverrides, b: TargetOverrides): boolean {
  return TARGET_KEYS.every((key) => (a[key] ?? null) === (b[key] ?? null));
}

export function toFormModel(profile: ProfileDto): ProfileFormModel {
  return {
    weightKg: profile.weightKg,
    heightCm: profile.heightCm,
    age: profile.age,
    sex: profile.sex ?? '',
    bodyFatPct: profile.bodyFatPct ?? null,
    tdeeOverride: profile.tdeeOverride ?? null,
    activityLevel: profile.activityLevel,
    goal: profile.goal,
    trainingDaysPerWeek: profile.trainingDaysPerWeek,
    overrides: overrideDraftFrom(profile.targetOverrides),
    location: profile.location ?? '',
    aiModel: profile.aiModel ?? '',
    aiDetailFood: profile.aiDetailFood,
    aiDetailLabel: profile.aiDetailLabel,
    theme: profile.theme,
    dayStartHour: normalizeDayStartHour(profile.dayStartHour),
    fluidTargetL: fluidLitresFromMl(profile.fluidTargetMl),
  };
}

export function toProfileDto(model: ProfileFormModel): ProfileDto {
  const location = model.location.trim();
  return {
    weightKg: model.weightKg,
    heightCm: model.heightCm,
    age: model.age,
    sex: model.sex === '' ? null : model.sex,
    bodyFatPct: model.bodyFatPct,
    tdeeOverride: model.tdeeOverride,
    activityLevel: model.activityLevel,
    goal: model.goal,
    trainingDaysPerWeek: model.trainingDaysPerWeek,
    targetOverrides: overridesFromDraft(model.overrides),
    location: location === '' ? null : location,
    aiModel: model.aiModel === '' ? null : model.aiModel,
    aiDetailFood: model.aiDetailFood,
    aiDetailLabel: model.aiDetailLabel,
    theme: model.theme,
    dayStartHour: normalizeDayStartHour(model.dayStartHour),
    fluidTargetMl: fluidMlFromLitres(model.fluidTargetL),
  };
}

function sameField(a: ProfileDto, b: ProfileDto, key: keyof ProfileDto): boolean {
  if (key === 'targetOverrides') {
    return sameOverrides(a.targetOverrides, b.targetOverrides);
  }
  if (key === 'dayStartHour') {
    return normalizeDayStartHour(a.dayStartHour) === normalizeDayStartHour(b.dayStartHour);
  }
  return (a[key] ?? null) === (b[key] ?? null);
}

export function changedProfileFields(saved: ProfileDto, current: ProfileDto): (keyof ProfileDto)[] {
  return PROFILE_KEYS.filter((key) => !sameField(saved, current, key));
}

export function sameProfile(a: ProfileDto, b: ProfileDto): boolean {
  return changedProfileFields(a, b).length === 0;
}

function copyField<K extends keyof ProfileDto>(
  target: ProfileDto,
  source: ProfileDto,
  key: K,
): void {
  target[key] = source[key];
}

export function rebaseProfile(base: ProfileDto, draft: ProfileDto, server: ProfileDto): ProfileDto {
  const merged: ProfileDto = { ...server };
  for (const key of changedProfileFields(base, draft)) {
    copyField(merged, draft, key);
  }
  return merged;
}

function withinOrNull(value: number | null, bounds: NumericBounds): number | null {
  return value !== null && isWithin(value, bounds) ? value : null;
}

export function previewInput(model: ProfileFormModel): TargetProfileInput {
  return {
    weightKg: withinOrNull(model.weightKg, BODY_BOUNDS.weightKg),
    heightCm: withinOrNull(model.heightCm, BODY_BOUNDS.heightCm),
    age: withinOrNull(model.age, BODY_BOUNDS.age),
    sex: model.sex === '' ? null : model.sex,
    bodyFatPct: withinOrNull(model.bodyFatPct, BODY_BOUNDS.bodyFatPct),
    tdeeOverride: withinOrNull(model.tdeeOverride, BODY_BOUNDS.tdeeOverride),
    activityLevel: model.activityLevel,
    goal: model.goal,
    trainingDaysPerWeek: isWithin(model.trainingDaysPerWeek, BODY_BOUNDS.trainingDaysPerWeek)
      ? model.trainingDaysPerWeek
      : 0,
    targetOverrides: overridesFromDraft(model.overrides, true),
  };
}

export function missingProfileFields(input: TargetProfileInput): string[] {
  const missing: string[] = [];
  if (input.weightKg === null) {
    missing.push('weight');
  }
  if (input.heightCm === null) {
    missing.push('height');
  }
  if (input.age === null) {
    missing.push('age');
  }
  if (input.sex === null) {
    missing.push('sex');
  }
  return missing;
}

export function formulaTdee(input: TargetProfileInput): number | null {
  return computeTargets({ ...input, tdeeOverride: null }).tdee;
}

export function burnExplanation(result: TargetsResult, input: TargetProfileInput): string {
  const formula = formulaTdee(input);
  if (result.tdeeSource === 'override') {
    return formula === null
      ? 'Using your own daily burn.'
      : `Using your own value. The formula estimate is ${kcal(formula)}.`;
  }
  if (result.bmr === null || result.bmrFormula === null || formula === null) {
    return 'Add your details to estimate how many calories you burn per day.';
  }
  return `Resting burn ${kcal(result.bmr)} (${BMR_FORMULA_LABELS[result.bmrFormula]}) × ${ACTIVITY_FACTOR[input.activityLevel]} for your activity level.`;
}

export function autoTargetValues(input: TargetProfileInput): TargetValues {
  const auto: TargetValues = { ...computeTargets(input).base };
  for (const key of overriddenKeys(input.targetOverrides)) {
    const others: TargetOverrides = { ...input.targetOverrides };
    delete others[key];
    auto[key] = computeTargets({ ...input, targetOverrides: others }).base[key];
  }
  return auto;
}

export type PreviewColumnKind = 'base' | 'training' | 'rest';

export interface PreviewColumn {
  kind: PreviewColumnKind;
  label: string;
  values: TargetValues;
}

export function previewColumns(
  result: TargetsResult,
  trainingDaysPerWeek: number,
): PreviewColumn[] {
  if (result.trainingDeltaKcal === 0 && result.restDeltaKcal === 0) {
    return [
      {
        kind: 'base',
        label: trainingDaysPerWeek >= 7 ? 'Every day' : 'Daily',
        values: result.base,
      },
    ];
  }
  if (trainingDaysPerWeek === 0) {
    return [
      { kind: 'rest', label: 'Normal day', values: result.restDay },
      { kind: 'training', label: 'Training day', values: result.trainingDay },
    ];
  }
  return [
    { kind: 'base', label: 'Average', values: result.base },
    { kind: 'training', label: 'Training', values: result.trainingDay },
    { kind: 'rest', label: 'Rest', values: result.restDay },
  ];
}

export function trainingDaysExplanation(
  trainingDaysPerWeek: number,
  trainingDeltaKcal: number,
  restDeltaKcal: number,
): string {
  if (trainingDaysPerWeek <= 0) {
    return `No fixed schedule: mark a day as a training day on Today to add +${kcal(trainingDeltaKcal)} (10 %) as carbs.`;
  }
  if (trainingDaysPerWeek >= 7) {
    return 'You train every day, so every day gets the same targets.';
  }
  const restDays = 7 - trainingDaysPerWeek;
  if (trainingDeltaKcal === 0) {
    return 'Weekly calorie cycling is off because your calories are already at the safe minimum.';
  }
  const trainingLabel =
    trainingDaysPerWeek === 1 ? '1 training day gets' : `${trainingDaysPerWeek} training days get`;
  const restLabel = restDays === 1 ? '1 rest day gets' : `${restDays} rest days get`;
  return `Weekly calorie cycling: ${trainingLabel} +${kcal(trainingDeltaKcal)} as carbs, ${restLabel} −${kcal(restDeltaKcal)}. Your weekly total stays the same.`;
}

export interface LabelParts {
  title: string;
  detail: string;
}

export function labelParts(label: string): LabelParts {
  const match = /^(.*?)\s*\((.*)\)\s*$/.exec(label);
  return match ? { title: match[1], detail: match[2] } : { title: label, detail: '' };
}
