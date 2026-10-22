import {
  DEFAULT_BASE_TARGETS,
  zeroNutrients,
  type DayDashboardResponse,
  type EntryDto,
  type FavoriteDto,
  type FluidDayResponse,
  type FluidFoodDrinkDto,
  type FluidLogDto,
  type FoodSearchResult,
  type MealType,
  type Nutrients,
  type ProductDto,
  type TargetsDto,
  type WeightLogDto,
  type WeightSummaryResponse,
} from '@food/shared';

export { installDialogShim } from '../../shared/testing/dialog-shim';

export function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

export function makeEntry(overrides: Partial<EntryDto> & { id: string }): EntryDto {
  const timestamp = overrides.timestamp ?? '2026-09-28T08:00:00.000Z';
  return {
    name: `Entry ${overrides.id}`,
    description: null,
    mealType: 'breakfast' as MealType,
    source: 'food_photo',
    localDate: '2026-09-28',
    items: [],
    totals: nutrients({ calories: 400, protein: 20, carbs: 40, fat: 15 }),
    portion: null,
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
    timestamp,
  };
}

export function makeDashboard(
  date: string,
  entries: EntryDto[] = [],
  trainingDay = false,
): DayDashboardResponse {
  const totals = entries.reduce<Nutrients>((acc, entry) => {
    const out = { ...acc };
    for (const key of Object.keys(out) as (keyof Nutrients)[]) {
      out[key] = acc[key] + entry.totals[key];
    }
    return out;
  }, zeroNutrients());
  return {
    day: {
      date,
      trainingDay,
      targets: { ...DEFAULT_BASE_TARGETS },
      totals,
      entryCount: entries.length,
      micros: {},
      microsCoverage: { items: 0, withMicros: 0 },
      fluidsMl: 0,
      fluidTargetMl: 2500,
    },
    entries,
  };
}

export function makeFavorite(overrides: Partial<FavoriteDto> & { id: string }): FavoriteDto {
  return {
    name: `Favorite ${overrides.id}`,
    mealType: null,
    items: [],
    totals: nutrients({ calories: 250, protein: 10 }),
    portion: null,
    photo: null,
    useCount: 0,
    lastUsedAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

export const TEST_TARGETS: Pick<TargetsDto, 'trainingDay' | 'restDay'> = {
  trainingDay: { ...DEFAULT_BASE_TARGETS, calories: 2400, carbs: 325 },
  restDay: { ...DEFAULT_BASE_TARGETS, calories: 1800, carbs: 175 },
};

export function makeFood(overrides: Partial<FoodSearchResult> & { key: string }): FoodSearchResult {
  return {
    kind: 'meal',
    name: `Food ${overrides.key}`,
    detail: null,
    items: [],
    totals: nutrients({ calories: 120, protein: 6 }),
    grams: 150,
    portion: null,
    mealType: null,
    photo: null,
    favoriteId: null,
    entryId: null,
    useCount: 1,
    lastUsedAt: null,
    productId: null,
    starred: false,
    ...overrides,
  };
}

export function makeProduct(overrides: Partial<ProductDto> = {}): ProductDto {
  return {
    id: 'product-1',
    barcode: '5281234567896',
    name: 'Yaourt fraise',
    brand: 'Khoury',
    aliases: [],
    unitName: null,
    unitGrams: null,
    basisUnit: 'g',
    per100: nutrients({ calories: 88, protein: 3.5, carbs: 13, fat: 2.5, sugar: 12 }),
    microsPer100: null,
    servingSizeG: 170,
    packSizeG: 170,
    source: 'openfoodfacts',
    imageUrl: null,
    missingNutrients: [],
    useCount: 3,
    lastUsedAt: null,
    ...overrides,
  };
}

export function makeWeightSummary(
  from: string,
  to: string,
  logs: WeightLogDto[] = [],
  overrides: Partial<WeightSummaryResponse> = {},
): WeightSummaryResponse {
  const byDate = new Map(logs.map((log) => [log.date, log.weightKg]));
  const trend: WeightSummaryResponse['trend'] = [];
  let current: number | null = null;
  for (let date = from; date <= to;) {
    const weight = byDate.get(date) ?? null;
    if (weight !== null) {
      current = current === null ? weight : current + 0.1 * (weight - current);
    }
    trend.push({
      date,
      weightKg: weight,
      trendKg: current === null ? null : Math.round(current * 100) / 100,
    });
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const next = new Date(Date.UTC(y, m - 1, d + 1));
    date = next.toISOString().slice(0, 10);
  }
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date));
  return {
    from,
    to,
    logs: sorted,
    trend,
    latest: sorted.at(-1) ?? null,
    weeklyChangeKg: null,
    adaptiveTdee: null,
    ...overrides,
  };
}

export function makeFluidLog(overrides: Partial<FluidLogDto> & { id: string }): FluidLogDto {
  const timestamp = overrides.timestamp ?? '2026-09-28T08:00:00.000Z';
  return {
    localDate: '2026-09-28',
    ml: 250,
    kind: 'water',
    createdAt: timestamp,
    ...overrides,
    timestamp,
  };
}

export function makeFluidDrink(
  overrides: Partial<FluidFoodDrinkDto> & { itemId: string },
): FluidFoodDrinkDto {
  return {
    entryId: `entry-${overrides.itemId}`,
    entryName: 'Chicken burger meal',
    name: 'Diet Pepsi',
    ml: 330,
    timestamp: '2026-09-28T12:30:00.000Z',
    ...overrides,
  };
}

export function makeFluidDay(
  date: string,
  logs: FluidLogDto[] = [],
  drinks: FluidFoodDrinkDto[] = [],
  targetMl = 2800,
): FluidDayResponse {
  const logsMl = logs.reduce((sum, log) => sum + log.ml, 0);
  const foodMl = drinks.reduce((sum, drink) => sum + drink.ml, 0);
  const caffeineMg = logs.reduce(
    (sum, log) =>
      sum + Math.round(log.ml * (log.kind === 'coffee' ? 0.4 : log.kind === 'tea' ? 0.2 : 0)),
    0,
  );
  return {
    date,
    targetMl,
    totalMl: logsMl + foodMl,
    logsMl,
    foodMl,
    caffeineMg,
    logs,
    drinks,
  };
}
