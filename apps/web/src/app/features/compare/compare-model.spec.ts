import {
  zeroNutrients,
  type AnalyzeResponse,
  type FoodSearchResult,
  type MenuDish,
  type Nutrients,
  type ProductDto,
} from '@food/shared';
import {
  COMPARE_MAX_AGE_MS,
  MAX_OPTIONS,
  canStepDown,
  logAmount,
  optionFromAnalysis,
  optionFromDish,
  optionFromLibrary,
  optionFromProduct,
  optionGrams,
  optionItems,
  optionNutrients,
  optionPortion,
  parsePersisted,
  portionFactor,
  portionLabel,
  reviveDish,
  reviveOption,
  stepPortion,
  withPortion,
  type CompareOption,
  type PersistedCompare,
} from './compare-model';

function n(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

const YOGURT: FoodSearchResult = {
  portion: null,
  key: 'meal:entry-1',
  kind: 'meal',
  name: 'Greek yogurt',
  detail: null,
  items: [
    {
      name: 'Greek yogurt',
      grams: 170,
      nutrients: n({ calories: 150, protein: 17, carbs: 6, fat: 4, sodium: 60 }),
      confidence: 'high',
    },
  ],
  totals: n({ calories: 150, protein: 17, carbs: 6, fat: 4, sodium: 60 }),
  grams: 170,
  mealType: 'snack',
  photo: {
    id: 'p1',
    url: '/api/photos/p1',
    thumbUrl: '/api/photos/p1/thumb',
    width: 1,
    height: 1,
  },
  favoriteId: null,
  entryId: 'entry-1',
  productId: null,
  useCount: 3,
  lastUsedAt: null,
  starred: false,
};

const PLATE: FoodSearchResult = {
  ...YOGURT,
  key: 'favorite:fav-1',
  kind: 'favorite',
  name: 'Chicken plate',
  items: [
    { name: 'Chicken', grams: 180, nutrients: n({ calories: 300, protein: 50 }) },
    { name: 'Rice', grams: 200, nutrients: n({ calories: 260, carbs: 56 }) },
  ],
  totals: n({ calories: 560, protein: 50, carbs: 56 }),
  grams: 380,
  mealType: 'lunch',
  favoriteId: 'fav-1',
  entryId: null,
  starred: true,
};

const PRODUCT: ProductDto = {
  id: 'prod-1',
  barcode: '5281234567890',
  name: 'Protein bar',
  brand: 'Acme',
  aliases: [],
  unitName: null,
  unitGrams: null,
  basisUnit: 'g',
  per100: n({ calories: 400, protein: 30, carbs: 40, fat: 12, sugar: 8 }),
  microsPer100: null,
  servingSizeG: 50,
  packSizeG: 50,
  source: 'openfoodfacts',
  imageUrl: null,
  missingNutrients: [],
  useCount: 0,
  lastUsedAt: null,
};

function analysis(overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse {
  return {
    analysisId: 'an-1',
    mode: 'food_photo',
    description: null,
    result: {
      inputType: 'food_photo',
      mealName: 'Shawarma plate',
      portion: null,
      scaleCues: '',
      items: [
        {
          count: null,
          unit: null,
          unitPlural: null,
          name: 'Chicken shawarma',
          grams: 250,
          nutrients: n({ calories: 500, protein: 45, fat: 25, sodium: 900 }),
          per100g: n({ calories: 200, protein: 18, fat: 10, sodium: 360 }),
          micros: null,
          microsPer100g: null,
          fluidMl: null,
          confidence: 'medium',
          amountSource: 'visual_estimate',
          state: 'as_served',
          portionBasis: '',
          flags: [],
          savedFood: null,
          suggestedFood: null,
        },
      ],
      label: null,
      totals: n({ calories: 500, protein: 45, fat: 25, sodium: 900 }),
      assumptions: [],
      followUpQuestion: null,
      followUpOptions: [],
      warnings: [],
    },
    photo: {
      id: 'ph-9',
      url: '/api/photos/ph-9',
      thumbUrl: '/api/photos/ph-9/thumb',
      width: 1,
      height: 1,
    },
    photos: [],
    usage: {
      model: 'mock',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      durationMs: 0,
      attempts: 1,
    },
    precise: false,
    ...overrides,
  };
}

const DISH: MenuDish = {
  portion: null,
  name: 'Grilled halloumi salad',
  description: 'Halloumi, greens, pomegranate',
  grams: 320,
  nutrients: n({ calories: 480, protein: 24, fat: 34, satFat: 16, sodium: 1400 }),
  confidence: 'medium',
  notes: null,
};

describe('building options', () => {
  it('compares a single-food library result by weight', () => {
    const option = optionFromLibrary(YOGURT, 'o1');
    expect(option.portion).toEqual({ mode: 'grams', grams: 170 });
    expect(option.badge).toBe('My foods');
    expect(option.thumbUrl).toBe('/api/photos/p1/thumb');
    expect(option.log).toEqual({
      kind: 'library',
      key: 'meal:entry-1',
      resultKind: 'meal',
      mealType: 'snack',
    });
  });

  it('compares favorites and multi-item meals by servings', () => {
    const favorite = optionFromLibrary(PLATE, 'o2');
    expect(favorite.portion).toEqual({ mode: 'servings', servings: 1 });
    expect(favorite.badge).toBe('Favorite');
    const meal = optionFromLibrary({ ...PLATE, kind: 'meal', key: 'meal:e2' }, 'o3');
    expect(meal.portion).toEqual({ mode: 'servings', servings: 1 });
  });

  it('compares library products by servings', () => {
    const option = optionFromLibrary(
      { ...YOGURT, kind: 'product', key: 'product:prod-1', productId: 'prod-1' },
      'o4',
    );
    expect(option.portion).toEqual({ mode: 'servings', servings: 1 });
    expect(option.badge).toBe('Product');
  });

  it('uses one serving for a scanned product', () => {
    const option = optionFromProduct(PRODUCT, 'o5');
    expect(option.name).toBe('Acme Protein bar');
    expect(option.portion).toEqual({ mode: 'servings', servings: 1 });
    expect(option.base.grams).toBe(50);
    expect(optionNutrients(option)).toMatchObject({ calories: 200, protein: 15, sugar: 4 });
    expect(option.log).toEqual({ kind: 'product', productId: 'prod-1' });
    expect(option.note).toBeNull();
  });

  it('falls back to grams for a product without a serving size', () => {
    const option = optionFromProduct({ ...PRODUCT, servingSizeG: null, packSizeG: 250 }, 'o6');
    expect(option.portion).toEqual({ mode: 'grams', grams: 250 });
    expect(optionNutrients(option).calories).toBe(1000);
  });

  it('notes nutrients a product does not provide', () => {
    const option = optionFromProduct({ ...PRODUCT, missingNutrients: ['sodium', 'fiber'] }, 'o7');
    expect(option.note).toBe('No fiber and sodium data for this product');
  });

  it('keeps saved-food links on the items of every kind of option', () => {
    const linked = optionFromLibrary(
      {
        ...PLATE,
        items: [{ ...PLATE.items[0]!, productId: 'food-chicken' }, PLATE.items[1]!],
      },
      'o20',
    );
    expect(linked.base.items.map((item) => item.productId)).toEqual(['food-chicken', undefined]);
    expect(optionItems(withPortion(linked, { mode: 'servings', servings: 2 }))[0]).toMatchObject({
      productId: 'food-chicken',
      grams: 360,
    });
    expect(optionFromProduct(PRODUCT, 'o21').base.items[0]?.productId).toBe('prod-1');
    const base = analysis();
    const saved = {
      id: 'food-shawarma',
      name: 'Chicken shawarma',
      brand: null,
      basisUnit: 'g' as const,
      per100: base.result.items[0]!.per100g,
      microsPer100: null,
      unitName: null,
      unitGrams: null,
    };
    const fromAi = optionFromAnalysis(
      analysis({
        result: { ...base.result, items: [{ ...base.result.items[0]!, savedFood: saved }] },
      }),
      'o22',
    );
    expect(fromAi.base.items[0]?.productId).toBe('food-shawarma');
    const fromLabel = optionFromAnalysis(
      analysis({
        mode: 'nutrition_label',
        result: {
          ...base.result,
          inputType: 'nutrition_label',
          items: [{ ...base.result.items[0]!, savedFood: saved }],
        },
      }),
      'o23',
    );
    expect(fromLabel.base.items[0]?.productId).toBeUndefined();
    const revived = reviveOption(JSON.parse(JSON.stringify(linked)) as Record<string, unknown>);
    expect(revived?.base.items[0]?.productId).toBe('food-chicken');
  });

  it('carries vitamins and drink ml on every kind of option and scales them with the portion', () => {
    const drinkResult: FoodSearchResult = {
      ...YOGURT,
      grams: 250,
      items: [
        {
          ...YOGURT.items[0]!,
          name: 'Soy milk',
          grams: 250,
          micros: { calcium: 300, vitaminD: 2.5 },
          fluidMl: 250,
        },
      ],
    };
    const library = optionFromLibrary(drinkResult, 'o30');
    expect(library.base.items[0]).toMatchObject({
      micros: { calcium: 300, vitaminD: 2.5 },
      fluidMl: 250,
    });
    expect(optionItems(withPortion(library, { mode: 'grams', grams: 500 }))[0]).toMatchObject({
      micros: { calcium: 600, vitaminD: 5 },
      fluidMl: 500,
    });

    const milk = optionFromProduct(
      { ...PRODUCT, basisUnit: 'ml', servingSizeG: 250, microsPer100: { calcium: 120 } },
      'o31',
    );
    expect(milk.base.items[0]).toMatchObject({ micros: { calcium: 300 }, fluidMl: 250 });
    expect(optionFromProduct(PRODUCT, 'o32').base.items[0]).not.toHaveProperty('fluidMl');
    expect(optionFromProduct(PRODUCT, 'o32').base.items[0]).not.toHaveProperty('micros');

    const base = analysis();
    const fromAi = optionFromAnalysis(
      analysis({
        result: {
          ...base.result,
          items: [{ ...base.result.items[0]!, micros: { iron: 3.4 }, fluidMl: null }],
        },
      }),
      'o33',
    );
    expect(fromAi.base.items[0]).toMatchObject({ micros: { iron: 3.4 } });

    const revived = reviveOption(JSON.parse(JSON.stringify(library)) as Record<string, unknown>);
    expect(revived?.base.items[0]).toMatchObject({
      micros: { calcium: 300, vitaminD: 2.5 },
      fluidMl: 250,
    });
    const tampered = JSON.parse(JSON.stringify(library)) as {
      base: { items: Record<string, unknown>[] };
    };
    tampered.base.items[0]!['micros'] = { calcium: -5 };
    tampered.base.items[0]!['fluidMl'] = 'lots';
    const cleaned = reviveOption(tampered as unknown as Record<string, unknown>);
    expect(cleaned?.base.items[0]).not.toHaveProperty('micros');
    expect(cleaned?.base.items[0]).not.toHaveProperty('fluidMl');
  });

  it('turns a single-item analysis into a weighable option', () => {
    const option = optionFromAnalysis(analysis(), 'o8');
    expect(option.name).toBe('Shawarma plate');
    expect(option.source).toBe('food_photo');
    expect(option.badge).toBe('Photo');
    expect(option.portion).toEqual({ mode: 'grams', grams: 250 });
    expect(option.thumbUrl).toBe('/api/photos/ph-9/thumb');
    expect(option.log).toEqual({
      kind: 'analysis',
      analysisId: 'an-1',
      mode: 'food_photo',
      description: null,
      photoId: 'ph-9',
    });
  });

  it('uses servings for multi-item analyses and names them from the items when needed', () => {
    const base = analysis();
    const second = { ...base.result.items[0], name: 'Fries', grams: 150 };
    const option = optionFromAnalysis(
      analysis({
        mode: 'text',
        description: 'shawarma and fries',
        photo: null,
        result: { ...base.result, mealName: '  ', items: [base.result.items[0], second] },
      }),
      'o9',
    );
    expect(option.portion).toEqual({ mode: 'servings', servings: 1 });
    expect(option.name).toBe('Chicken shawarma & Fries');
    expect(option.detail).toBe('shawarma and fries');
    expect(option.base.grams).toBe(400);
    expect(optionNutrients(option).calories).toBe(1000);
  });

  it('flags low-confidence analyses', () => {
    const base = analysis();
    const option = optionFromAnalysis(
      analysis({
        result: { ...base.result, items: [{ ...base.result.items[0], confidence: 'low' }] },
      }),
      'o10',
    );
    expect(option.note).toBe('Rough estimate, the AI was unsure');
  });

  it('turns a menu dish into a single-item option', () => {
    const option = optionFromDish(DISH, 'Café Nour', 'o11');
    expect(option.detail).toBe('Café Nour');
    expect(option.portion).toEqual({ mode: 'grams', grams: 320 });
    expect(option.log).toEqual({ kind: 'menu', description: 'Halloumi, greens, pomegranate' });
    expect(optionItems(option)).toEqual([
      {
        name: 'Grilled halloumi salad',
        grams: 320,
        nutrients: DISH.nutrients,
        confidence: 'medium',
        count: null,
        unit: null,
        unitPlural: null,
      },
    ]);
  });

  it('compares counted dishes and meals by how many units', () => {
    const burgers = { count: 2, unit: 'burger', unitPlural: 'burgers' };
    const dish = optionFromDish(
      { ...DISH, name: 'Black Angus burger', portion: burgers },
      null,
      'o13',
    );
    expect(dish.portion).toEqual({ mode: 'count', count: 2 });
    const half = withPortion(dish, { mode: 'count', count: 1.5 });
    expect(portionFactor(half)).toBe(0.75);
    expect(optionGrams(half)).toBe(240);
    expect(optionNutrients(half).calories).toBe(360);
    expect(optionPortion(half)).toEqual({ ...burgers, count: 1.5 });
    expect(optionItems(half)[0]).toMatchObject({ grams: 240, count: 1.5, unit: 'burger' });
    expect(portionLabel(half.portion, half.base.portion)).toBe('1½ burgers');
    expect(stepPortion(half.portion, 1)).toEqual({ mode: 'count', count: 2 });
    expect(canStepDown({ mode: 'count', count: 0.5 })).toBe(false);

    const meal = optionFromLibrary({ ...PLATE, portion: burgers }, 'o14');
    expect(meal.portion).toEqual({ mode: 'count', count: 2 });
    expect(logAmount({ ...meal, portion: { mode: 'count', count: 1.5 } })).toEqual({
      portionCount: 1.5,
    });
  });

  it('uses servings for a dish without a weight and notes rough estimates', () => {
    const option = optionFromDish({ ...DISH, grams: 0, confidence: 'low' }, null, 'o12');
    expect(option.portion).toEqual({ mode: 'servings', servings: 1 });
    expect(option.detail).toBe('Halloumi, greens, pomegranate');
    expect(option.note).toBe('Rough estimate');
  });
});

describe('portions', () => {
  it('rescales a single item proportionally by grams', () => {
    const option = withPortion(optionFromDish(DISH, null, 'o1'), { mode: 'grams', grams: 160 });
    expect(portionFactor(option)).toBe(0.5);
    expect(optionNutrients(option)).toMatchObject({
      calories: 240,
      protein: 12,
      fat: 17,
      satFat: 8,
      sodium: 700,
    });
    expect(optionItems(option)[0].grams).toBe(160);
    expect(optionGrams(option)).toBe(160);
  });

  it('scales every item by servings', () => {
    const option = withPortion(optionFromLibrary(PLATE, 'o2'), { mode: 'servings', servings: 1.5 });
    expect(optionNutrients(option)).toMatchObject({ calories: 840, protein: 75, carbs: 84 });
    expect(optionItems(option).map((item) => item.grams)).toEqual([270, 300]);
    expect(optionGrams(option)).toBe(570);
  });

  it('clamps portions to sensible bounds', () => {
    const option = optionFromDish(DISH, null, 'o3');
    expect(withPortion(option, { mode: 'grams', grams: 0 }).portion).toEqual({
      mode: 'grams',
      grams: 1,
    });
    expect(withPortion(option, { mode: 'grams', grams: 50_000 }).portion).toEqual({
      mode: 'grams',
      grams: 10_000,
    });
    expect(withPortion(option, { mode: 'servings', servings: 99 }).portion).toEqual({
      mode: 'servings',
      servings: 20,
    });
  });

  it('steps grams and servings in friendly increments', () => {
    expect(stepPortion({ mode: 'grams', grams: 150 }, 1)).toEqual({ mode: 'grams', grams: 160 });
    expect(stepPortion({ mode: 'grams', grams: 150 }, -1)).toEqual({ mode: 'grams', grams: 140 });
    expect(stepPortion({ mode: 'grams', grams: 1 }, -1)).toEqual({ mode: 'grams', grams: 1 });
    expect(stepPortion({ mode: 'servings', servings: 1 }, 1)).toEqual({
      mode: 'servings',
      servings: 1.25,
    });
    expect(stepPortion({ mode: 'servings', servings: 0.25 }, -1)).toEqual({
      mode: 'servings',
      servings: 0.25,
    });
    expect(canStepDown({ mode: 'servings', servings: 0.25 })).toBe(false);
    expect(canStepDown({ mode: 'grams', grams: 1 })).toBe(false);
    expect(canStepDown({ mode: 'grams', grams: 90 })).toBe(true);
  });

  it('labels portions', () => {
    expect(portionLabel({ mode: 'grams', grams: 150 })).toBe('150 g');
    expect(portionLabel({ mode: 'servings', servings: 1 })).toBe('1 serving');
    expect(portionLabel({ mode: 'servings', servings: 1.5 })).toBe('1½ servings');
    expect(portionLabel({ mode: 'servings', servings: 0.5 })).toBe('½ servings');
  });

  it('logs grams or servings as chosen', () => {
    const base = optionFromLibrary(PLATE, 'o9').base;
    expect(logAmount({ base, portion: { mode: 'grams', grams: 212.5 } })).toEqual({ grams: 212.5 });
    expect(logAmount({ base, portion: { mode: 'servings', servings: 2 } })).toEqual({
      servings: 2,
    });
  });
});

describe('persistence', () => {
  const NOW = Date.UTC(2026, 8, 30, 12);
  const options: CompareOption[] = [
    optionFromLibrary(YOGURT, 'o1'),
    optionFromAnalysis(analysis(), 'o2'),
    { ...optionFromDish(DISH, 'Café Nour', 'o3'), loggedEntryId: 'entry-7' },
    optionFromProduct(PRODUCT, 'o4'),
  ];

  function stored(overrides: Partial<PersistedCompare> = {}): string {
    const payload: PersistedCompare = {
      v: 1,
      userId: 'user-1',
      savedAt: NOW - 1000,
      options,
      menu: {
        restaurant: 'Café Nour',
        dishes: [DISH],
        warnings: ['Prices hidden'],
        scannedAt: NOW,
      },
      ...overrides,
    };
    return JSON.stringify(payload);
  }

  it('restores options and the last menu for the same user', () => {
    const parsed = parsePersisted(stored(), 'user-1', NOW);
    expect(parsed?.options).toEqual(options);
    expect(parsed?.menu?.dishes).toEqual([DISH]);
    expect(parsed?.menu?.warnings).toEqual(['Prices hidden']);
  });

  it('ignores another user, stale data and broken JSON', () => {
    expect(parsePersisted(stored(), 'user-2', NOW)).toBeNull();
    expect(parsePersisted(stored(), null, NOW)).toBeNull();
    expect(
      parsePersisted(stored({ savedAt: NOW - COMPARE_MAX_AGE_MS - 1 }), 'user-1', NOW),
    ).toBeNull();
    expect(parsePersisted('{nope', 'user-1', NOW)).toBeNull();
    expect(parsePersisted(null, 'user-1', NOW)).toBeNull();
    expect(parsePersisted(JSON.stringify({ v: 2 }), 'user-1', NOW)).toBeNull();
  });

  it('drops invalid options and keeps at most four', () => {
    const raw = JSON.parse(stored()) as { options: unknown[] };
    raw.options = [{ id: 'bad' }, ...raw.options, raw.options[0]];
    const parsed = parsePersisted(JSON.stringify(raw), 'user-1', NOW);
    expect(parsed?.options).toHaveLength(MAX_OPTIONS);
    expect(parsed?.options[0].id).toBe('o1');
  });

  it('rejects options with unknown log targets or portions', () => {
    const valid = JSON.parse(JSON.stringify(options[0])) as Record<string, unknown>;
    expect(reviveOption(valid)).toEqual(options[0]);
    expect(reviveOption({ ...valid, log: { kind: 'teleport' } })).toBeNull();
    expect(reviveOption({ ...valid, portion: { mode: 'cups', cups: 2 } })).toBeNull();
    expect(reviveOption({ ...valid, source: 'fridge' })).toBeNull();
  });

  it('sanitises dishes', () => {
    expect(reviveDish(DISH)).toEqual(DISH);
    expect(reviveDish({ ...DISH, confidence: 'certain' })).toBeNull();
    expect(reviveDish({ ...DISH, grams: 'lots' })).toBeNull();
    expect(reviveDish({ ...DISH, nutrients: { calories: -5, protein: 'x' } })?.nutrients).toEqual(
      zeroNutrients(),
    );
  });

  it('drops a broken menu but keeps the options', () => {
    const parsed = parsePersisted(
      stored({ menu: { restaurant: 1 } as unknown as PersistedCompare['menu'] }),
      'user-1',
      NOW,
    );
    expect(parsed?.menu).toBeNull();
    expect(parsed?.options).toHaveLength(4);
  });
});
