import {
  type EntryItemInput,
  isFiniteNumber,
  MICRO_KEYS,
  MICRO_META,
  MICRO_PER100_CEILING,
  type MicroKey,
  type Micros,
  microsFromPer100,
  roundMicros,
  roundTo,
  sanitizeMicros,
  sanitizeMicrosPer100,
  scaleMicros,
} from '@food/shared';
import { Prisma } from '../generated/prisma/client.js';

export const FLUID_ITEM_MAX_ML = 5000;

export const MICROS_PER100_EXTRA_DECIMALS = 2;

export type MicrosCeiling = (key: MicroKey) => number;

export type ItemExtras = Required<Pick<EntryItemInput, 'micros' | 'fluidMl'>>;

const MICRO_KEY_SET: ReadonlySet<string> = new Set(MICRO_KEYS);

export const ITEM_MICROS_CEILING: MicrosCeiling = (key) => MICRO_META[key].max;

export const PER100_MICROS_CEILING: MicrosCeiling = (key) =>
  MICRO_PER100_CEILING[MICRO_META[key].unit];

function isMicroKey(key: string): key is MicroKey {
  return MICRO_KEY_SET.has(key);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function itemMicros(value: unknown): Micros | null {
  return roundMicros(sanitizeMicros(value));
}

export function per100Micros(value: unknown): Micros | null {
  const sanitized = sanitizeMicrosPer100(value);
  if (sanitized === null) {
    return null;
  }
  const out: Micros = {};
  for (const key of MICRO_KEYS) {
    const amount = sanitized[key];
    if (amount !== undefined) {
      out[key] = roundTo(
        amount,
        MICRO_META[key].decimals + MICROS_PER100_EXTRA_DECIMALS,
      );
    }
  }
  return out;
}

export function microsForGrams(
  per100: Micros | null | undefined,
  grams: number,
): Micros | null {
  return itemMicros(microsFromPer100(per100, grams));
}

export function scaleItemMicros(
  micros: Micros | null | undefined,
  factor: number,
): Micros | null {
  return itemMicros(scaleMicros(micros, factor));
}

export function itemFluidMl(value: unknown): number | null {
  if (!isFiniteNumber(value) || value <= 0 || value > FLUID_ITEM_MAX_ML) {
    return null;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

export function scaleFluidMl(
  fluidMl: number | null | undefined,
  factor: number,
): number | null {
  return isFiniteNumber(fluidMl) && isFiniteNumber(factor) && factor > 0
    ? itemFluidMl(fluidMl * factor)
    : null;
}

export function scaledItemExtras(
  item: Pick<EntryItemInput, 'micros' | 'fluidMl'>,
  factor: number,
): ItemExtras {
  return {
    micros: scaleItemMicros(item.micros, factor),
    fluidMl: scaleFluidMl(item.fluidMl, factor),
  };
}

export function sameMicros(
  a: Micros | null | undefined,
  b: Micros | null | undefined,
): boolean {
  return MICRO_KEYS.every((key) => (a?.[key] ?? null) === (b?.[key] ?? null));
}

export function microsJson(
  micros: Micros | null | undefined,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
  return micros ? { ...micros } : Prisma.DbNull;
}

export function microsProblems(
  property: string,
  value: unknown,
  ceiling: MicrosCeiling,
): string[] {
  if (value === null || value === undefined) {
    return [];
  }
  if (!isPlainObject(value)) {
    return [`${property} must be an object`];
  }
  return Object.entries(value).flatMap(([key, amount]) => {
    if (!isMicroKey(key)) {
      return [`${property}.${key} is not a known vitamin or mineral`];
    }
    if (
      amount === null ||
      (isFiniteNumber(amount) && amount >= 0 && amount <= ceiling(key))
    ) {
      return [];
    }
    return [
      `${property}.${key} must be a number between 0 and ${ceiling(key)}, or null`,
    ];
  });
}
