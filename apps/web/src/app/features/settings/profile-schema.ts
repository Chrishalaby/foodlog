import {
  type PathKind,
  type SchemaPath,
  type SchemaPathRules,
  type ValidationError,
  max,
  min,
  schema,
  validate,
} from '@angular/forms/signals';
import {
  API_LIMITS,
  BODY_BOUNDS,
  FLUID_LIMITS,
  type ProfileDto,
  TARGET_KEYS,
  TARGET_META,
  TARGET_OVERRIDE_BOUNDS,
  type TargetKey,
  isFiniteNumber,
} from '@food/shared';
import { type NumericBounds, PROFILE_FIELD_LABELS, type ProfileFormModel } from './profile-model';

export interface RangeRule {
  label: string;
  unit: string;
  bounds: NumericBounds;
  integer?: boolean;
}

export const BODY_RULES = {
  weightKg: { label: 'Weight', unit: 'kg', bounds: BODY_BOUNDS.weightKg },
  heightCm: { label: 'Height', unit: 'cm', bounds: BODY_BOUNDS.heightCm },
  age: { label: 'Age', unit: 'years', bounds: BODY_BOUNDS.age, integer: true },
  bodyFatPct: { label: 'Body fat', unit: '%', bounds: BODY_BOUNDS.bodyFatPct },
  tdeeOverride: {
    label: 'Daily calorie burn',
    unit: 'kcal',
    bounds: BODY_BOUNDS.tdeeOverride,
    integer: true,
  },
} as const satisfies Record<string, RangeRule>;

export const FLUID_TARGET_RULE: RangeRule = {
  label: 'Daily fluids',
  unit: 'L',
  bounds: { min: FLUID_LIMITS.targetMinMl / 1000, max: FLUID_LIMITS.targetMaxMl / 1000 },
};

export const LOCATION_MESSAGE = `Keep the location under ${API_LIMITS.locationMax} characters.`;

const formatBound = (value: number): string => value.toLocaleString('en-US');

export function rangeMessage(rule: RangeRule): string {
  return `${rule.label} must be between ${formatBound(rule.bounds.min)} and ${formatBound(rule.bounds.max)} ${rule.unit}.`;
}

export function rangeError(
  value: number | null,
  rule: RangeRule,
): ValidationError.WithoutFieldTree | undefined {
  if (value === null) {
    return undefined;
  }
  const { min: lower, max: upper } = rule.bounds;
  if (!isFiniteNumber(value) || value < lower || value > upper) {
    return { kind: 'range', message: rangeMessage(rule) };
  }
  if (rule.integer && !Number.isInteger(value)) {
    return { kind: 'integer', message: `${rule.label} must be a whole number.` };
  }
  return undefined;
}

export function targetRule(key: TargetKey): RangeRule {
  return {
    label: TARGET_META[key].label,
    unit: TARGET_META[key].unit,
    bounds: TARGET_OVERRIDE_BOUNDS[key],
  };
}

function validateRange<TKind extends PathKind>(
  path: SchemaPath<number | null, SchemaPathRules.Supported, TKind>,
  rule: RangeRule,
): void {
  validate(path, ({ value }) => rangeError(value(), rule));
}

export const profileSchema = schema<ProfileFormModel>((path) => {
  validateRange(path.weightKg, BODY_RULES.weightKg);
  validateRange(path.heightCm, BODY_RULES.heightCm);
  validateRange(path.age, BODY_RULES.age);
  validateRange(path.bodyFatPct, BODY_RULES.bodyFatPct);
  validateRange(path.tdeeOverride, BODY_RULES.tdeeOverride);
  min(path.trainingDaysPerWeek, BODY_BOUNDS.trainingDaysPerWeek.min);
  max(path.trainingDaysPerWeek, BODY_BOUNDS.trainingDaysPerWeek.max);
  for (const key of TARGET_KEYS) {
    validateRange(path.overrides[key], targetRule(key));
  }
  validate(path.location, ({ value }) => locationError(value()));
  validateRange(path.fluidTargetL, FLUID_TARGET_RULE);
});

export function locationError(location: string): ValidationError.WithoutFieldTree | undefined {
  return location.trim().length > API_LIMITS.locationMax
    ? { kind: 'tooLong', message: LOCATION_MESSAGE }
    : undefined;
}

export type ProfileErrorPath =
  Exclude<keyof ProfileFormModel, 'overrides'> | `overrides.${TargetKey}`;

export const INLINE_ERROR_PATHS: ReadonlySet<ProfileErrorPath> = new Set<ProfileErrorPath>([
  'weightKg',
  'heightCm',
  'age',
  'bodyFatPct',
  'tdeeOverride',
  'location',
  'aiModel',
  'fluidTargetL',
  ...TARGET_KEYS.map((key): ProfileErrorPath => `overrides.${key}`),
]);

export interface ProfileServerError {
  path: ProfileErrorPath | null;
  message: string;
}

const FORM_KEYS = new Set<string>([
  'weightKg',
  'heightCm',
  'age',
  'sex',
  'bodyFatPct',
  'tdeeOverride',
  'activityLevel',
  'goal',
  'trainingDaysPerWeek',
  'location',
  'aiModel',
  'aiDetailFood',
  'aiDetailLabel',
  'theme',
  'dayStartHour',
]);

function isTargetKey(value: string): value is TargetKey {
  return (TARGET_KEYS as readonly string[]).includes(value);
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') {
    return trimmed;
  }
  const capitalized = trimmed[0].toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

export function apiMessages(body: unknown): string[] {
  let parsed = body;
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      return body.trim() === '' ? [] : [body];
    }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return [];
  }
  const message = (parsed as { message?: unknown }).message;
  const list = Array.isArray(message) ? message : [message];
  return list.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

export function mapProfileServerError(raw: string): ProfileServerError {
  const match = /^([A-Za-z]+)(?:\.([A-Za-z]+))?\s+(.+)$/.exec(raw.trim());
  if (match) {
    const [, field, child, rest] = match;
    if (field === 'fluidTargetMl' && !child) {
      return { path: 'fluidTargetL', message: rangeMessage(FLUID_TARGET_RULE) };
    }
    if (field === 'targetOverrides' && child && isTargetKey(child)) {
      return {
        path: `overrides.${child}`,
        message: sentence(`${TARGET_META[child].label} ${rest}`),
      };
    }
    if (!child && FORM_KEYS.has(field)) {
      return {
        path: field as ProfileErrorPath,
        message: sentence(`${PROFILE_FIELD_LABELS[field as keyof ProfileDto]} ${rest}`),
      };
    }
  }
  return { path: null, message: sentence(raw) };
}

const JOINED_MESSAGE_SEPARATOR = /;\s+(?=[A-Za-z]+(?:\.[A-Za-z]+)?\s)/;

export function mapProfileServerErrors(messages: readonly string[]): ProfileServerError[] {
  return messages
    .flatMap((message) => message.split(JOINED_MESSAGE_SEPARATOR))
    .map(mapProfileServerError);
}
