import {
  FLUID_LIMITS,
  IMAGE_DETAILS,
  type ImageDetail,
  type ProfileDto,
  THEMES,
  type ThemePreference,
} from '@food/shared';
import type { Prisma, Profile } from '../generated/prisma/client.js';
import { DAY_START_HOUR, type UpdateProfileDto } from './profile.dto.js';
import { normalizeTargetOverrides } from './target-overrides.js';

const DEFAULT_IMAGE_DETAIL: ImageDetail = 'high';
const DEFAULT_THEME: ThemePreference = 'dark';

function isOneOf<T extends string>(
  options: readonly T[],
  value: string,
): value is T {
  return (options as readonly string[]).includes(value);
}

function imageDetail(value: string): ImageDetail {
  return isOneOf(IMAGE_DETAILS, value) ? value : DEFAULT_IMAGE_DETAIL;
}

function theme(value: string): ThemePreference {
  return isOneOf(THEMES, value) ? value : DEFAULT_THEME;
}

function isIntegerBetween(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export function storedDayStartHour(value: number): number {
  return isIntegerBetween(value, DAY_START_HOUR.min, DAY_START_HOUR.max)
    ? value
    : DAY_START_HOUR.default;
}

export function storedFluidTargetMl(value: number | null): number | null {
  return value !== null &&
    isIntegerBetween(value, FLUID_LIMITS.targetMinMl, FLUID_LIMITS.targetMaxMl)
    ? value
    : null;
}

export function toProfileDto(row: Profile): ProfileDto {
  return {
    weightKg: row.weightKg,
    heightCm: row.heightCm,
    age: row.age,
    sex: row.sex,
    bodyFatPct: row.bodyFatPct,
    tdeeOverride: row.tdeeOverride,
    onboarded: row.onboardedAt !== null,
    activityLevel: row.activityLevel,
    goal: row.goal,
    trainingDaysPerWeek: row.trainingDaysPerWeek,
    targetOverrides: normalizeTargetOverrides(row.targetOverrides),
    location: row.location,
    aiModel: row.aiModel,
    aiDetailFood: imageDetail(row.aiDetailFood),
    aiDetailLabel: imageDetail(row.aiDetailLabel),
    theme: theme(row.theme),
    dayStartHour: storedDayStartHour(row.dayStartHour),
    fluidTargetMl: storedFluidTargetMl(row.fluidTargetMl),
  };
}

export type ProfileWriteData = Omit<
  Prisma.ProfileUncheckedCreateInput,
  'userId' | 'createdAt' | 'updatedAt'
>;

export function profileData(dto: UpdateProfileDto): ProfileWriteData {
  return {
    weightKg: dto.weightKg,
    heightCm: dto.heightCm,
    age: dto.age,
    sex: dto.sex,
    bodyFatPct: dto.bodyFatPct,
    tdeeOverride: dto.tdeeOverride,
    activityLevel: dto.activityLevel,
    goal: dto.goal,
    trainingDaysPerWeek: dto.trainingDaysPerWeek,
    targetOverrides: normalizeTargetOverrides(
      dto.targetOverrides,
    ) as Prisma.InputJsonValue,
    location: dto.location,
    aiModel: dto.aiModel,
    aiDetailFood: dto.aiDetailFood,
    aiDetailLabel: dto.aiDetailLabel,
    theme: dto.theme,
    dayStartHour: dto.dayStartHour,
    fluidTargetMl: dto.fluidTargetMl,
  };
}
