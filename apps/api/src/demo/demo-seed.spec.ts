import {
  addDays,
  roundNutrients,
  sumNutrients,
  weekdayOf,
  zeroNutrients,
} from '@food/shared';
import {
  buildDemoSeed,
  DEMO_DAYS,
  DEMO_FOOD_NAMES,
  DEMO_START_WEIGHT_KG,
  DEMO_TRAINING_WEEKDAYS,
  type DemoFood,
  localMoment,
  seededRandom,
} from './demo-seed.js';
import { uuidV7 } from '../common/uuid-v7.js';

const TODAY = '2026-10-22';

function fakeFood(name: string): DemoFood {
  return {
    name,
    per100: {
      ...zeroNutrients(),
      calories: 200,
      protein: 10,
      carbs: 20,
      fat: 8,
      fiber: 2,
    },
    microsPer100: { calcium: 50 },
  };
}

const ALL_FOODS = new Map(
  DEMO_FOOD_NAMES.map((name) => [name, fakeFood(name)]),
);

function seed(overrides: Partial<Parameters<typeof buildDemoSeed>[0]> = {}) {
  return buildDemoSeed({
    today: TODAY,
    utcOffsetMinutes: 180,
    nowMinutes: 14 * 60,
    random: seededRandom('visitor-1'),
    lookup: (name) => ALL_FOODS.get(name),
    ...overrides,
  });
}

describe('buildDemoSeed', () => {
  it('fills 60 days of meals, weigh-ins and water ending today', () => {
    const result = seed();
    const dates = new Set(result.entries.map((entry) => entry.localDate));
    expect(dates.size).toBe(DEMO_DAYS);
    expect([...dates].sort()[0]).toBe(addDays(TODAY, -(DEMO_DAYS - 1)));
    expect(result.entries.length).toBeGreaterThan(DEMO_DAYS * 3);
    expect(result.weights.length).toBeGreaterThan(DEMO_DAYS * 0.6);
    expect(result.weights.at(-1)?.date).toBe(TODAY);
    expect(result.fluids.length).toBeGreaterThan(DEMO_DAYS * 3);
    expect(result.entries.every((entry) => entry.items.length > 0)).toBe(true);
  });

  it('is the same for the same visitor and different for another', () => {
    expect(seed()).toEqual(seed());
    const other = seed({ random: seededRandom('visitor-2') });
    expect(other.entries.map((entry) => entry.name)).not.toEqual(
      seed().entries.map((entry) => entry.name),
    );
  });

  it('only logs today what would already have been eaten', () => {
    const result = seed({ nowMinutes: 9 * 60 + 30 });
    const today = result.entries.filter((entry) => entry.localDate === TODAY);
    expect(today.length).toBeGreaterThanOrEqual(1);
    expect(
      today.every(
        (entry) => entry.mealType === 'breakfast' || entry.mealType === 'snack',
      ),
    ).toBe(true);
    expect(
      seed({ nowMinutes: 5 * 60 }).entries.some(
        (entry) => entry.localDate === TODAY,
      ),
    ).toBe(false);
  });

  it('places meals at the visitor’s local time', () => {
    const result = seed({ utcOffsetMinutes: 180 });
    for (const entry of result.entries.slice(0, 20)) {
      const local = new Date(entry.timestamp.getTime() + 180 * 60_000);
      expect(local.toISOString().slice(0, 10)).toBe(entry.localDate);
    }
    expect(localMoment('2026-10-22', '08:00', 180).toISOString()).toBe(
      '2026-10-22T05:00:00.000Z',
    );
    expect(localMoment('2026-10-22', '08:00', -300).toISOString()).toBe(
      '2026-10-22T13:00:00.000Z',
    );
  });

  it('keeps totals equal to the sum of the items', () => {
    for (const entry of seed().entries) {
      expect(entry.totals).toEqual(
        roundNutrients(sumNutrients(entry.items.map((item) => item.nutrients))),
      );
    }
  });

  it('shows a slow weight loss and marks training days', () => {
    const result = seed();
    const first = result.weights[0]?.weightKg ?? 0;
    const last = result.weights.at(-1)?.weightKg ?? 0;
    expect(first).toBeGreaterThan(DEMO_START_WEIGHT_KG - 1);
    expect(first - last).toBeGreaterThan(1.5);
    expect(first - last).toBeLessThan(4.5);
    expect(result.latestWeightKg).toBe(last);
    expect(result.trainingDays.length).toBeGreaterThan(20);
    expect(
      result.trainingDays.every((date) =>
        DEMO_TRAINING_WEEKDAYS.includes(weekdayOf(date)),
      ),
    ).toBe(true);
  });

  it('keeps counted foods exact and records drinks as fluids', () => {
    const items = seed().entries.flatMap((entry) => entry.items);
    const eggs = items.find((item) => item.unit === 'egg');
    expect(eggs).toMatchObject({ count: 2, grams: 92, unitPlural: 'eggs' });
    const latte = items.find((item) => item.name === 'Coffee, Latte');
    expect(latte?.fluidMl).toBe(latte?.grams);
    expect(
      items.every((item) => item.confidence === 'high' && item.micros !== null),
    ).toBe(true);
  });

  it('skips foods the database does not have and still builds favorites', () => {
    const lookup = (name: string) =>
      name.startsWith('Rice') ? undefined : ALL_FOODS.get(name);
    const result = seed({ lookup });
    const names = result.entries.flatMap((entry) =>
      entry.items.map((item) => item.name),
    );
    expect(names.some((name) => name.startsWith('Rice'))).toBe(false);
    expect(result.favorites.map((favorite) => favorite.name)).toEqual([
      'Greek yogurt with blueberries and honey',
      'Chicken and rice bowl',
    ]);
    expect(result.favorites[0]?.useCount).toBeGreaterThan(0);
    expect(seed({ lookup: () => undefined }).entries).toEqual([]);
  });
});

describe('uuidV7', () => {
  it('makes time-ordered version 7 ids', () => {
    const early = uuidV7(Date.UTC(2026, 0, 1));
    const late = uuidV7(Date.UTC(2026, 9, 22));
    expect(early).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(early < late).toBe(true);
    expect(uuidV7(1)).not.toBe(uuidV7(1));
  });
});
