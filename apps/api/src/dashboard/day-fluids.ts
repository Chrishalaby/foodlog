import { fluidTargetMl, isFiniteNumber } from '@food/shared';
import { itemFluidMl } from '../common/micros.js';

export type FluidTargetProfile = Parameters<typeof fluidTargetMl>[0];

export interface DayFluids {
  ml: number;
  targetMl: number;
}

export interface DayFluidContext {
  profile: FluidTargetProfile;
  mlByDate: ReadonlyMap<string, number>;
}

export interface FluidItemRow {
  localDate: string;
  fluidMl: number | null;
}

export interface FluidLogAmountRow {
  localDate: string;
  ml: number;
}

function logMl(value: number): number {
  return isFiniteNumber(value) && value > 0 ? value : 0;
}

export function fluidsMlByDate(
  items: readonly FluidItemRow[],
  logs: readonly FluidLogAmountRow[],
): Map<string, number> {
  const sums = new Map<string, number>();
  const add = (localDate: string, ml: number): void => {
    if (ml > 0) {
      sums.set(localDate, (sums.get(localDate) ?? 0) + ml);
    }
  };
  for (const item of items) {
    add(item.localDate, itemFluidMl(item.fluidMl) ?? 0);
  }
  for (const log of logs) {
    add(log.localDate, logMl(log.ml));
  }
  return new Map([...sums].map(([date, ml]) => [date, Math.round(ml)]));
}

export function dayFluids(
  profile: FluidTargetProfile,
  trainingDay: boolean,
  ml = 0,
): DayFluids {
  return { ml, targetMl: fluidTargetMl(profile, trainingDay) };
}
