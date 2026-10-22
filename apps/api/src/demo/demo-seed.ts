import {
  addDays,
  catalogItemName,
  catalogMicros,
  catalogNutrients,
  API_LIMITS,
  type EntryItemInput,
  type FluidKind,
  type MealType,
  type Micros,
  type Nutrients,
  type Portion,
  roundNutrients,
  roundTo,
  sumNutrients,
  weekdayOf,
} from '@food/shared';

export interface DemoFood {
  name: string;
  per100: Nutrients;
  microsPer100: Micros | null;
}

export type DemoFoodLookup = (name: string) => DemoFood | undefined;

interface DemoItemTemplate {
  food: string;
  grams: number;
  count?: number;
  unit?: string;
  unitPlural?: string;
  fluidMl?: boolean;
}

interface DemoMealTemplate {
  name: string;
  mealType: MealType;
  time: string;
  items: readonly DemoItemTemplate[];
  portion?: Portion;
}

const CHICKEN =
  'Chicken breast, baked, broiled, or roasted, skin not eaten, from raw';
const RICE = 'Rice, white, cooked, no added fat';

export const DEMO_BREAKFASTS: readonly DemoMealTemplate[] = [
  {
    name: 'Greek yogurt with blueberries and honey',
    mealType: 'breakfast',
    time: '07:45',
    items: [
      { food: 'Yogurt, Greek, plain, whole milk', grams: 170 },
      { food: 'Blueberries, raw', grams: 75 },
      { food: 'Honey', grams: 21 },
    ],
  },
  {
    name: 'Oatmeal with banana and peanut butter',
    mealType: 'breakfast',
    time: '08:10',
    items: [
      {
        food: 'Oatmeal, regular or quick, made with water, no added fat',
        grams: 240,
      },
      {
        food: 'Banana, raw',
        grams: 118,
        count: 1,
        unit: 'banana',
        unitPlural: 'bananas',
      },
      { food: 'Peanut butter', grams: 16 },
    ],
  },
  {
    name: 'Eggs and avocado toast',
    mealType: 'breakfast',
    time: '08:30',
    items: [
      {
        food: 'Egg, whole, fried with oil',
        grams: 92,
        count: 2,
        unit: 'egg',
        unitPlural: 'eggs',
      },
      {
        food: 'Bread, whole wheat',
        grams: 64,
        count: 2,
        unit: 'slice',
        unitPlural: 'slices',
      },
      { food: 'Avocado, raw', grams: 50 },
    ],
  },
  {
    name: 'Hummus breakfast plate',
    mealType: 'breakfast',
    time: '09:00',
    items: [
      { food: 'Hummus, plain', grams: 60 },
      {
        food: 'Bread, pita',
        grams: 60,
        count: 1,
        unit: 'pita',
        unitPlural: 'pitas',
      },
      { food: 'Cucumber, raw', grams: 80 },
      { food: 'Tomatoes, raw', grams: 100 },
    ],
  },
];

export const DEMO_LUNCHES: readonly DemoMealTemplate[] = [
  {
    name: 'Chicken and rice bowl',
    mealType: 'lunch',
    time: '13:00',
    items: [
      { food: CHICKEN, grams: 150 },
      { food: RICE, grams: 180 },
      { food: 'Broccoli, cooked, as ingredient', grams: 90 },
      { food: 'Olive oil', grams: 10 },
    ],
  },
  {
    name: 'Falafel sandwich',
    mealType: 'lunch',
    time: '13:30',
    items: [
      {
        food: 'Falafel sandwich',
        grams: 215,
        count: 1,
        unit: 'sandwich',
        unitPlural: 'sandwiches',
      },
    ],
    portion: { count: 1, unit: 'sandwich', unitPlural: 'sandwiches' },
  },
  {
    name: 'Lentil soup with pita',
    mealType: 'lunch',
    time: '12:45',
    items: [
      { food: 'Soup, lentil', grams: 360 },
      {
        food: 'Bread, pita',
        grams: 60,
        count: 1,
        unit: 'pita',
        unitPlural: 'pitas',
      },
    ],
  },
  {
    name: 'Tabbouleh and grilled chicken',
    mealType: 'lunch',
    time: '13:15',
    items: [
      { food: 'Tabbouleh', grams: 160 },
      { food: CHICKEN, grams: 120 },
    ],
  },
];

export const DEMO_DINNERS: readonly DemoMealTemplate[] = [
  {
    name: 'Salmon, baked potato and salad',
    mealType: 'dinner',
    time: '19:30',
    items: [
      { food: 'Fish, salmon, baked or broiled', grams: 150 },
      { food: 'Potato, baked, NFS', grams: 200 },
      { food: 'Lettuce, raw', grams: 60 },
      { food: 'Olive oil', grams: 10 },
    ],
  },
  {
    name: 'Beef kabob with rice',
    mealType: 'dinner',
    time: '20:00',
    items: [
      {
        food: 'Beef shish kabob with vegetables, excluding potatoes',
        grams: 250,
      },
      { food: RICE, grams: 150 },
    ],
  },
  {
    name: 'Cheese pizza',
    mealType: 'dinner',
    time: '20:30',
    items: [
      {
        food: 'Pizza, cheese, from restaurant or fast food, medium crust',
        grams: 214,
        count: 2,
        unit: 'slice',
        unitPlural: 'slices',
      },
    ],
    portion: { count: 2, unit: 'slice', unitPlural: 'slices' },
  },
  {
    name: 'Chicken and rice bowl',
    mealType: 'dinner',
    time: '19:45',
    items: [
      { food: CHICKEN, grams: 170 },
      { food: RICE, grams: 160 },
      { food: 'Broccoli, cooked, as ingredient', grams: 100 },
    ],
  },
];

export const DEMO_SNACKS: readonly DemoMealTemplate[] = [
  {
    name: 'Apple and almonds',
    mealType: 'snack',
    time: '16:00',
    items: [
      {
        food: 'Apple, raw',
        grams: 182,
        count: 1,
        unit: 'apple',
        unitPlural: 'apples',
      },
      { food: 'Almonds, NFS', grams: 28 },
    ],
  },
  {
    name: 'Protein shake',
    mealType: 'snack',
    time: '17:30',
    items: [
      { food: 'Beverages, Protein powder whey based', grams: 30 },
      { food: 'Milk, low fat (1%)', grams: 250, fluidMl: true },
    ],
  },
  {
    name: 'Coffee latte',
    mealType: 'snack',
    time: '10:30',
    items: [{ food: 'Coffee, Latte', grams: 350, fluidMl: true }],
  },
  {
    name: 'Dark chocolate',
    mealType: 'snack',
    time: '21:30',
    items: [{ food: 'Dark chocolate candy', grams: 20 }],
  },
];

export const DEMO_FOOD_NAMES: readonly string[] = [
  ...new Set(
    [
      ...DEMO_BREAKFASTS,
      ...DEMO_LUNCHES,
      ...DEMO_DINNERS,
      ...DEMO_SNACKS,
    ].flatMap((meal) => meal.items.map((item) => item.food)),
  ),
];

export const DEMO_DAYS = 60;
export const DEMO_START_WEIGHT_KG = 84;
export const DEMO_WEEKLY_LOSS_KG = 0.35;
export const DEMO_TRAINING_WEEKDAYS: readonly number[] = [1, 3, 5];

export const DEMO_PROFILE = {
  heightCm: 180,
  age: 32,
  sex: 'male',
  activityLevel: 'moderate',
  goal: 'cut',
  trainingDaysPerWeek: 3,
} as const;

export interface DemoEntry {
  name: string;
  mealType: MealType;
  timestamp: Date;
  localDate: string;
  items: EntryItemInput[];
  totals: Nutrients;
  portion: Portion | null;
}

export interface DemoWeight {
  date: string;
  weightKg: number;
}

export interface DemoFluid {
  localDate: string;
  timestamp: Date;
  ml: number;
  kind: FluidKind;
}

export interface DemoFavorite {
  name: string;
  mealType: MealType;
  items: EntryItemInput[];
  totals: Nutrients;
  portion: Portion | null;
  useCount: number;
}

export interface DemoSeed {
  entries: DemoEntry[];
  weights: DemoWeight[];
  fluids: DemoFluid[];
  trainingDays: string[];
  favorites: DemoFavorite[];
  latestWeightKg: number;
}

export interface DemoSeedInput {
  today: string;
  utcOffsetMinutes: number;
  nowMinutes: number;
  random: () => number;
  lookup: DemoFoodLookup;
  days?: number;
}

export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) {
    state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  }
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function localMoment(
  localDate: string,
  time: string,
  utcOffsetMinutes: number,
): Date {
  const [year, month, day] = localDate.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return new Date(
    Date.UTC(year, month - 1, day, hours, minutes) - utcOffsetMinutes * 60_000,
  );
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(':').map(Number) as [number, number];
  return hours * 60 + minutes;
}

function shiftTime(time: string, deltaMinutes: number): string {
  const total = Math.min(
    23 * 60 + 50,
    Math.max(5 * 60, minutesOf(time) + deltaMinutes),
  );
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T];
  }
  return copy;
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length) % list.length] as T;
}

function buildItem(
  template: DemoItemTemplate,
  food: DemoFood,
  factor: number,
): EntryItemInput {
  const grams = roundTo(template.grams * factor, 0);
  const counted =
    template.count !== undefined && template.unit && template.unitPlural;
  return {
    name: catalogItemName(food.name, API_LIMITS.nameMax),
    grams,
    nutrients: catalogNutrients(food.per100, grams),
    confidence: 'high',
    count: counted ? template.count : null,
    unit: counted ? (template.unit ?? null) : null,
    unitPlural: counted ? (template.unitPlural ?? null) : null,
    productId: null,
    micros: catalogMicros(food.microsPer100, grams),
    fluidMl: template.fluidMl ? grams : null,
  };
}

export function buildMealItems(
  meal: DemoMealTemplate,
  lookup: DemoFoodLookup,
  factor: number,
): EntryItemInput[] {
  return meal.items.flatMap((template) => {
    const food = lookup(template.food);
    return food ? [buildItem(template, food, template.count ? 1 : factor)] : [];
  });
}

function totalsOf(items: readonly EntryItemInput[]): Nutrients {
  return roundNutrients(sumNutrients(items.map((item) => item.nutrients)));
}

function mealsForDay(
  isToday: boolean,
  nowMinutes: number,
  random: () => number,
): DemoMealTemplate[] {
  const meals = [
    pick(DEMO_BREAKFASTS, random),
    pick(DEMO_LUNCHES, random),
    pick(DEMO_DINNERS, random),
  ];
  const snackCount = random() < 0.5 ? 1 : 2;
  const snacks = shuffled(DEMO_SNACKS, random).slice(0, snackCount);
  const day = [...meals, ...snacks].sort(
    (a, b) => minutesOf(a.time) - minutesOf(b.time),
  );
  return isToday
    ? day.filter((meal) => minutesOf(meal.time) <= nowMinutes)
    : day;
}

export function buildDemoSeed(input: DemoSeedInput): DemoSeed {
  const days = input.days ?? DEMO_DAYS;
  const { random, lookup, today, utcOffsetMinutes } = input;
  const entries: DemoEntry[] = [];
  const weights: DemoWeight[] = [];
  const fluids: DemoFluid[] = [];
  const trainingDays: string[] = [];
  for (let back = days - 1; back >= 0; back--) {
    const date = addDays(today, -back);
    const isToday = back === 0;
    for (const meal of mealsForDay(isToday, input.nowMinutes, random)) {
      const items = buildMealItems(meal, lookup, 1.05 + random() * 0.3);
      if (items.length === 0) {
        continue;
      }
      const time = shiftTime(meal.time, Math.round((random() - 0.5) * 40));
      entries.push({
        name: meal.name,
        mealType: meal.mealType,
        timestamp: localMoment(date, time, utcOffsetMinutes),
        localDate: date,
        items,
        totals: totalsOf(items),
        portion: meal.portion ?? null,
      });
    }
    if (isToday || random() < 0.8) {
      const elapsedWeeks = (days - 1 - back) / 7;
      const noise = (random() - 0.5) * 0.8;
      weights.push({
        date,
        weightKg: roundTo(
          DEMO_START_WEIGHT_KG - elapsedWeeks * DEMO_WEEKLY_LOSS_KG + noise,
          1,
        ),
      });
    }
    const glasses = isToday ? 2 : 3 + Math.floor(random() * 3);
    for (let glass = 0; glass < glasses; glass++) {
      fluids.push({
        localDate: date,
        timestamp: localMoment(
          date,
          shiftTime('09:00', glass * 150 + Math.round(random() * 30)),
          utcOffsetMinutes,
        ),
        ml: random() < 0.5 ? 250 : 500,
        kind: 'water',
      });
    }
    if (DEMO_TRAINING_WEEKDAYS.includes(weekdayOf(date))) {
      trainingDays.push(date);
    }
  }
  const favorites = [DEMO_BREAKFASTS[0], DEMO_LUNCHES[0]].flatMap((meal) => {
    if (!meal) {
      return [];
    }
    const items = buildMealItems(meal, lookup, 1);
    return items.length === 0
      ? []
      : [
          {
            name: meal.name,
            mealType: meal.mealType,
            items,
            totals: totalsOf(items),
            portion: meal.portion ?? null,
            useCount: entries.filter((entry) => entry.name === meal.name)
              .length,
          },
        ];
  });
  const latest = weights[weights.length - 1]?.weightKg ?? DEMO_START_WEIGHT_KG;
  return {
    entries,
    weights,
    fluids,
    trainingDays,
    favorites,
    latestWeightKg: latest,
  };
}
