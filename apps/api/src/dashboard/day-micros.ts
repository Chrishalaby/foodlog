import {
  addMicros,
  FLUID_CAFFEINE_MG_PER_ML,
  FLUID_KINDS,
  fluidCaffeineMg,
  type FluidKind,
  isFiniteNumber,
  MICRO_KEYS,
  type Micros,
  type MicrosCoverage,
  roundMicros,
} from '@food/shared';
import { itemMicros } from '../common/micros.js';

export const MICROS_DAY_MIN_COVERAGE = 0.5;

export const CAFFEINATED_FLUID_KINDS: FluidKind[] = FLUID_KINDS.filter(
  (kind) => FLUID_CAFFEINE_MG_PER_ML[kind] > 0,
);

export interface DayMicros {
  micros: Micros;
  coverage: MicrosCoverage;
}

export interface MicrosItemRow {
  localDate: string;
  micros: unknown;
}

export interface CaffeineLogRow {
  localDate: string;
  kind: FluidKind;
  ml: number;
}

interface DayMicrosSum {
  micros: Micros;
  caffeineMg: number;
  coverage: MicrosCoverage;
}

export function emptyCoverage(): MicrosCoverage {
  return { items: 0, withMicros: 0 };
}

function newSum(): DayMicrosSum {
  return { micros: {}, caffeineMg: 0, coverage: emptyCoverage() };
}

function sumFor(
  sums: Map<string, DayMicrosSum>,
  localDate: string,
): DayMicrosSum {
  const existing = sums.get(localDate);
  if (existing) {
    return existing;
  }
  const created = newSum();
  sums.set(localDate, created);
  return created;
}

function finishDay(sum: DayMicrosSum): DayMicros {
  const caffeine: Micros =
    sum.caffeineMg > 0 ? { caffeine: sum.caffeineMg } : {};
  return {
    micros: roundMicros(addMicros(sum.micros, caffeine)),
    coverage: { ...sum.coverage },
  };
}

export function microsByDate(
  items: readonly MicrosItemRow[],
  logs: readonly CaffeineLogRow[],
): Map<string, DayMicros> {
  const sums = new Map<string, DayMicrosSum>();
  for (const item of items) {
    const sum = sumFor(sums, item.localDate);
    const micros = itemMicros(item.micros);
    sum.coverage.items += 1;
    if (micros) {
      sum.coverage.withMicros += 1;
      sum.micros = addMicros(sum.micros, micros);
    }
  }
  for (const log of logs) {
    sumFor(sums, log.localDate).caffeineMg += fluidCaffeineMg(log.kind, log.ml);
  }
  return new Map(
    [...sums].map(([localDate, sum]) => [localDate, finishDay(sum)]),
  );
}

export function isMicrosDay(coverage: MicrosCoverage): boolean {
  return (
    coverage.items > 0 &&
    coverage.withMicros >= coverage.items * MICROS_DAY_MIN_COVERAGE
  );
}

export function averageMicros(list: readonly Micros[]): Micros {
  const average: Micros = {};
  for (const key of MICRO_KEYS) {
    const values = list.flatMap((micros) => {
      const value = micros[key];
      return isFiniteNumber(value) ? [value] : [];
    });
    if (values.length > 0) {
      average[key] =
        values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }
  return roundMicros(average);
}

export function sumCoverage(list: readonly MicrosCoverage[]): MicrosCoverage {
  return list.reduce<MicrosCoverage>(
    (total, coverage) => ({
      items: total.items + coverage.items,
      withMicros: total.withMicros + coverage.withMicros,
    }),
    emptyCoverage(),
  );
}
