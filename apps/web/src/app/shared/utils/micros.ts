import {
  MICRO_KEYS,
  MICRO_META,
  isFiniteNumber,
  microsPer100From,
  roundMicros,
  roundTo,
  sanitizeMicros,
  sanitizeMicrosPer100,
  scaleMicros,
  type Micros,
} from '@food/shared';

export const FLUID_ITEM_MAX_ML = 5000;
export const MICROS_PER100_EXTRA_DECIMALS = 2;

export function hasMicros(micros: Micros | null | undefined): micros is Micros {
  return !!micros && MICRO_KEYS.some((key) => isFiniteNumber(micros[key]));
}

export function cleanMicros(input: unknown): Micros | null {
  return roundMicros(sanitizeMicros(input));
}

export function cleanMicrosPer100(input: unknown): Micros | null {
  const clean = sanitizeMicrosPer100(input);
  if (!clean) {
    return null;
  }
  const out: Micros = {};
  for (const key of MICRO_KEYS) {
    const value = clean[key];
    if (value !== undefined) {
      out[key] = roundTo(value, MICRO_META[key].decimals + MICROS_PER100_EXTRA_DECIMALS);
    }
  }
  return out;
}

export function itemMicrosPer100(micros: unknown, grams: number): Micros | null {
  return cleanMicrosPer100(microsPer100From(sanitizeMicros(micros), grams));
}

export function sanitizeFluidMl(value: unknown): number | null {
  if (!isFiniteNumber(value) || value <= 0) {
    return null;
  }
  const ml = Math.round(Math.min(value, FLUID_ITEM_MAX_ML));
  return ml > 0 ? ml : null;
}

export interface ItemExtras {
  micros?: Micros;
  fluidMl?: number;
}

export function itemExtras(item: { micros?: Micros | null; fluidMl?: number | null }): ItemExtras {
  const micros = cleanMicros(item.micros);
  const fluidMl = sanitizeFluidMl(item.fluidMl);
  return {
    ...(micros ? { micros } : {}),
    ...(fluidMl !== null ? { fluidMl } : {}),
  };
}

export function scaledItemExtras(
  item: { micros?: Micros | null; fluidMl?: number | null },
  factor: number,
): ItemExtras {
  const safe = isFiniteNumber(factor) && factor > 0 ? factor : 1;
  const fluidMl = isFiniteNumber(item.fluidMl) && item.fluidMl > 0 ? item.fluidMl * safe : null;
  return itemExtras({ micros: scaleMicros(sanitizeMicros(item.micros), safe), fluidMl });
}
