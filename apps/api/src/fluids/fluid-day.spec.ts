import type { FluidLogDto } from '@food/shared';
import {
  buildFluidDay,
  type FluidDrinkRow,
  fluidLogsCaffeineMg,
  toFluidDrinks,
} from './fluid-day.js';

const DATE = '2026-10-01';
const LUNCH_ID = '019a0000-0000-7000-8000-0000000000e1';
const DINNER_ID = '019a0000-0000-7000-8000-0000000000e2';

function log(overrides: Partial<FluidLogDto>): FluidLogDto {
  return {
    id: '019a0000-0000-7000-8000-0000000000a1',
    localDate: DATE,
    timestamp: '2026-10-01T08:00:00.000Z',
    ml: 250,
    kind: 'water',
    createdAt: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function drinkRow(overrides: Partial<FluidDrinkRow>): FluidDrinkRow {
  return {
    id: 'item-1',
    name: 'Diet Pepsi',
    position: 0,
    fluidMl: 330,
    entry: {
      id: LUNCH_ID,
      name: 'Chicken burger meal',
      timestamp: new Date('2026-10-01T10:30:00.000Z'),
    },
    ...overrides,
  };
}

describe('toFluidDrinks', () => {
  it('lists the drinks inside meals with their meal name and time', () => {
    expect(toFluidDrinks([drinkRow({})])).toEqual([
      {
        entryId: LUNCH_ID,
        itemId: 'item-1',
        entryName: 'Chicken burger meal',
        name: 'Diet Pepsi',
        ml: 330,
        timestamp: '2026-10-01T10:30:00.000Z',
      },
    ]);
  });

  it('orders drinks by meal time, then meal, then position', () => {
    const dinner = {
      id: DINNER_ID,
      name: 'Dinner',
      timestamp: new Date('2026-10-01T18:00:00.000Z'),
    };
    const drinks = toFluidDrinks([
      drinkRow({
        id: 'soy-milk',
        name: 'Soy milk',
        entry: dinner,
        position: 1,
      }),
      drinkRow({ id: 'water', name: 'Water', entry: dinner, position: 0 }),
      drinkRow({ id: 'pepsi' }),
    ]);

    expect(drinks.map(({ itemId }) => itemId)).toEqual([
      'pepsi',
      'water',
      'soy-milk',
    ]);
  });

  it('skips items that are not drinks and rounds to whole millilitres', () => {
    const drinks = toFluidDrinks([
      drinkRow({ id: 'soup', fluidMl: null }),
      drinkRow({ id: 'zero', fluidMl: 0 }),
      drinkRow({ id: 'huge', fluidMl: 1e9 }),
      drinkRow({ id: 'shake', fluidMl: 299.6 }),
    ]);

    expect(drinks.map(({ itemId, ml }) => [itemId, ml])).toEqual([
      ['shake', 300],
    ]);
  });
});

describe('fluidLogsCaffeineMg', () => {
  it('counts caffeine from coffee and tea logs only', () => {
    expect(
      fluidLogsCaffeineMg([
        { kind: 'coffee', ml: 200 },
        { kind: 'tea', ml: 250 },
        { kind: 'water', ml: 500 },
        { kind: 'other', ml: 330 },
      ]),
    ).toBe(130);
    expect(fluidLogsCaffeineMg([])).toBe(0);
  });
});

describe('buildFluidDay', () => {
  it('adds the logs and the drinks inside meals', () => {
    const logs = [
      log({ id: 'a', ml: 250 }),
      log({ id: 'b', ml: 250, timestamp: '2026-10-01T12:00:00.000Z' }),
      log({ id: 'c', ml: 200, kind: 'coffee' }),
    ];
    const drinks = toFluidDrinks([drinkRow({})]);

    expect(buildFluidDay({ date: DATE, targetMl: 2800, logs, drinks })).toEqual(
      {
        date: DATE,
        targetMl: 2800,
        totalMl: 1030,
        logsMl: 700,
        foodMl: 330,
        caffeineMg: 80,
        logs,
        drinks,
      },
    );
  });

  it('reports an empty day against its target', () => {
    expect(
      buildFluidDay({ date: DATE, targetMl: 2500, logs: [], drinks: [] }),
    ).toEqual({
      date: DATE,
      targetMl: 2500,
      totalMl: 0,
      logsMl: 0,
      foodMl: 0,
      caffeineMg: 0,
      logs: [],
      drinks: [],
    });
  });
});
