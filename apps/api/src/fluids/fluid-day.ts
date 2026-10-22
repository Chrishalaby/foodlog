import {
  type FluidDayResponse,
  type FluidFoodDrinkDto,
  fluidCaffeineMg,
  type FluidKind,
  type FluidLogDto,
} from '@food/shared';
import { itemFluidMl } from '../common/micros.js';
import type { Prisma } from '../generated/prisma/client.js';

export const FLUID_DRINK_SELECT = {
  id: true,
  name: true,
  position: true,
  fluidMl: true,
  entry: { select: { id: true, name: true, timestamp: true } },
} as const satisfies Prisma.EntryItemSelect;

export interface FluidDrinkRow {
  id: string;
  name: string;
  position: number;
  fluidMl: number | null;
  entry: { id: string; name: string; timestamp: Date };
}

export interface FluidDayInput {
  date: string;
  targetMl: number;
  logs: readonly FluidLogDto[];
  drinks: readonly FluidFoodDrinkDto[];
}

interface SortableDrink {
  drink: FluidFoodDrinkDto;
  position: number;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareDrinks(a: SortableDrink, b: SortableDrink): number {
  return (
    compareText(a.drink.timestamp, b.drink.timestamp) ||
    compareText(a.drink.entryId, b.drink.entryId) ||
    a.position - b.position
  );
}

function toSortableDrink(row: FluidDrinkRow): SortableDrink[] {
  const ml = itemFluidMl(row.fluidMl);
  if (ml === null) {
    return [];
  }
  return [
    {
      drink: {
        entryId: row.entry.id,
        itemId: row.id,
        entryName: row.entry.name,
        name: row.name,
        ml,
        timestamp: row.entry.timestamp.toISOString(),
      },
      position: row.position,
    },
  ];
}

export function toFluidDrinks(
  rows: readonly FluidDrinkRow[],
): FluidFoodDrinkDto[] {
  return rows
    .flatMap(toSortableDrink)
    .sort(compareDrinks)
    .map(({ drink }) => drink);
}

function sumMl(values: readonly { ml: number }[]): number {
  return Math.round(values.reduce((total, { ml }) => total + ml, 0));
}

export function fluidLogsCaffeineMg(
  logs: readonly { kind: FluidKind; ml: number }[],
): number {
  return logs.reduce(
    (total, log) => total + fluidCaffeineMg(log.kind, log.ml),
    0,
  );
}

export function buildFluidDay(input: FluidDayInput): FluidDayResponse {
  const logsMl = sumMl(input.logs);
  const foodMl = sumMl(input.drinks);
  return {
    date: input.date,
    targetMl: input.targetMl,
    totalMl: logsMl + foodMl,
    logsMl,
    foodMl,
    caffeineMg: fluidLogsCaffeineMg(input.logs),
    logs: [...input.logs],
    drinks: [...input.drinks],
  };
}
