import {
  type Micros,
  type Nutrients,
  nutrientsFromPer100g,
  roundNutrients,
  zeroNutrients,
} from '@food/shared';
import {
  buildMergeSuggestions,
  type LoggedFoodItem,
  type SavedFoodInfo,
  SUGGESTION_RULES,
  suggestionWindowStart,
} from './merge-suggestions.js';
import type { FoodMergeDecision } from './merge-decisions.js';

const DAY_1 = new Date('2026-09-20T12:00:00.000Z');
const DAY_2 = new Date('2026-09-21T12:00:00.000Z');
const DAY_3 = new Date('2026-09-22T12:00:00.000Z');
const MERGED_AT = new Date('2026-09-23T12:00:00.000Z');
const DAY_4 = new Date('2026-09-24T12:00:00.000Z');
const SAVED_ID = '019a0000-0000-7000-8000-0000000000d1';
const OTHER_SAVED_ID = '019a0000-0000-7000-8000-0000000000d2';

let nextId = 1;

interface ItemSpec {
  name: string;
  kcal: number;
  grams?: number;
  entry: string;
  at?: Date;
  createdAt?: Date;
  productId?: string | null;
  fromLabel?: boolean;
  nutrients?: Partial<Nutrients>;
  micros?: Micros | null;
}

function item(spec: ItemSpec): LoggedFoodItem {
  const grams = spec.grams ?? 100;
  nextId += 1;
  return {
    id: `item-${String(nextId).padStart(4, '0')}`,
    entryId: spec.entry,
    name: spec.name,
    grams,
    nutrients: {
      ...zeroNutrients(),
      calories: (spec.kcal * grams) / 100,
      ...spec.nutrients,
    },
    micros: spec.micros ?? null,
    productId: spec.productId ?? null,
    loggedAt: spec.at ?? DAY_1,
    createdAt: spec.createdAt ?? spec.at ?? DAY_1,
    fromLabel: spec.fromLabel ?? false,
  };
}

function ownerItems(): LoggedFoodItem[] {
  const beef = { entry: 'beef-burger', at: DAY_1 };
  const chicken = { entry: 'chicken-burger', at: DAY_2 };
  const sandwich = { entry: 'chicken-sandwich', at: DAY_3 };
  return [
    item({
      ...beef,
      name: 'Sofisoft potato bun, top hollowed',
      kcal: 272,
      grams: 55,
    }),
    item({ ...beef, name: 'Heinz tomato ketchup', kcal: 103, grams: 26 }),
    item({ ...beef, name: 'Heinz mayonnaise, regular', kcal: 673, grams: 12 }),
    item({ ...beef, name: 'Cabbage, raw shredded', kcal: 27, grams: 30 }),
    item({ ...beef, name: 'Added table salt', kcal: 0, grams: 1 }),
    item({ ...beef, name: 'Cucumber pickles', kcal: 10, grams: 20 }),
    item({
      ...chicken,
      name: 'Sofisoft potato bun, top hollowed',
      kcal: 272,
      grams: 55,
    }),
    item({ ...chicken, name: 'Heinz tomato ketchup', kcal: 118, grams: 26 }),
    item({
      ...chicken,
      name: 'Heinz mayonnaise, regular',
      kcal: 680,
      grams: 12,
    }),
    item({ ...chicken, name: 'Cabbage, raw shredded', kcal: 26, grams: 30 }),
    item({ ...chicken, name: 'Added table salt', kcal: 0, grams: 1 }),
    item({
      ...chicken,
      name: 'Chicken breast, cooked, skinless',
      kcal: 165,
      grams: 120,
    }),
    item({ ...chicken, name: 'Cucumber, raw, with peel', kcal: 15, grams: 40 }),
    item({ ...sandwich, name: 'Sofisoft potato bun', kcal: 272, grams: 70 }),
    item({ ...sandwich, name: 'Tomato ketchup', kcal: 110, grams: 30 }),
    item({ ...sandwich, name: 'Mayonnaise, regular', kcal: 685, grams: 12 }),
    item({
      ...sandwich,
      name: 'Garlic mayonnaise sauce',
      kcal: 680,
      grams: 10,
    }),
    item({ ...sandwich, name: 'Cabbage, raw, shredded', kcal: 23, grams: 30 }),
    item({ ...sandwich, name: 'Table salt', kcal: 0, grams: 1 }),
    item({
      ...sandwich,
      name: 'Chicken breast, grilled',
      kcal: 165,
      grams: 120,
    }),
    item({
      ...sandwich,
      name: 'Cucumber, raw, with peel',
      kcal: 15,
      grams: 40,
    }),
    ...[DAY_1, DAY_2, DAY_3].map((at, index) =>
      item({
        entry: `yogurt-${index}`,
        at,
        name: 'Khoury strawberry Greek yogurt, low fat',
        kcal: 88,
        grams: 170,
        fromLabel: true,
      }),
    ),
  ];
}

function savedKetchup(overrides: Partial<SavedFoodInfo> = {}): SavedFoodInfo {
  return {
    id: SAVED_ID,
    displayName: 'Heinz tomato ketchup',
    names: ['Heinz tomato ketchup', 'Tomato ketchup'],
    basisUnit: 'g',
    per100: { ...zeroNutrients(), calories: 110, carbs: 25 },
    microsPer100: null,
    servingGrams: 15,
    lastUsedAt: DAY_1,
    ...overrides,
  };
}

function build(
  items: LoggedFoodItem[],
  foods: SavedFoodInfo[] = [],
  dismissed: string[] = [],
  decisions: FoodMergeDecision[] = [],
) {
  return buildMergeSuggestions(
    items,
    new Map(foods.map((food) => [food.id, food])),
    dismissed,
    decisions,
  );
}

describe('buildMergeSuggestions with the owner data', () => {
  it('suggests ketchup first, then mayo without garlic mayo, then the bun', () => {
    const suggestions = build(ownerItems());

    expect(suggestions.map(({ key }) => key)).toEqual([
      'tomato ketchup',
      'mayo',
      'sofisoft potato bun',
    ]);
    expect(
      suggestions.map(({ variants }) => variants.map(({ name }) => name)),
    ).toEqual([
      ['Heinz tomato ketchup', 'Tomato ketchup'],
      ['Heinz mayonnaise, regular', 'Mayonnaise, regular'],
      ['Sofisoft potato bun, top hollowed', 'Sofisoft potato bun'],
    ]);
  });

  it('describes the ketchup group', () => {
    const [ketchup] = build(ownerItems());

    expect(ketchup).toMatchObject({
      key: 'tomato ketchup',
      label: 'Tomato ketchup',
      itemCount: 3,
      entryCount: 3,
      kcalPer100Min: 103,
      kcalPer100Max: 118,
    });
    expect(ketchup?.variants).toEqual([
      {
        name: 'Heinz tomato ketchup',
        productId: null,
        timesLogged: 2,
        typicalGrams: 26,
        lastUsedAt: DAY_2.toISOString(),
        basisUnit: 'g',
        per100: { ...zeroNutrients(), calories: 118 },
        microsPer100: null,
        kcalPer100Min: 103,
        kcalPer100Max: 118,
        valueSource: 'estimate',
        recommended: true,
      },
      {
        name: 'Tomato ketchup',
        productId: null,
        timesLogged: 1,
        typicalGrams: 30,
        lastUsedAt: DAY_3.toISOString(),
        basisUnit: 'g',
        per100: { ...zeroNutrients(), calories: 110 },
        microsPer100: null,
        kcalPer100Min: 110,
        kcalPer100Max: 110,
        valueSource: 'estimate',
        recommended: false,
      },
    ]);
  });

  it('never suggests salt, chicken, cabbage, cucumbers or the labelled yogurt', () => {
    const names = build(ownerItems()).flatMap(({ variants }) =>
      variants.map(({ name }) => name),
    );

    for (const name of [
      'Added table salt',
      'Table salt',
      'Chicken breast, grilled',
      'Chicken breast, cooked, skinless',
      'Cabbage, raw shredded',
      'Cucumber pickles',
      'Cucumber, raw, with peel',
      'Garlic mayonnaise sauce',
      'Khoury strawberry Greek yogurt, low fat',
    ]) {
      expect(names).not.toContain(name);
    }
  });

  it('keeps plain tomatoes out of the ketchup group', () => {
    const tomatoes = ['beef-burger', 'chicken-burger'].map((entry) =>
      item({ entry, name: 'Tomato', kcal: 18, grams: 40 }),
    );

    const [ketchup] = build([...ownerItems(), ...tomatoes]);

    expect(ketchup?.variants.map(({ name }) => name)).toEqual([
      'Heinz tomato ketchup',
      'Tomato ketchup',
    ]);
  });

  it('shows one variant for names that only differ in punctuation', () => {
    const items = [
      item({ entry: 'a', name: 'Cabbage, raw shredded', kcal: 27 }),
      item({ entry: 'b', name: 'Cabbage, raw shredded', kcal: 60, at: DAY_2 }),
      item({ entry: 'c', name: 'cabbage raw, shredded', kcal: 23, at: DAY_3 }),
    ];

    const [cabbage] = build(items);

    expect(cabbage?.variants).toHaveLength(1);
    expect(cabbage?.variants[0]).toMatchObject({
      name: 'cabbage raw, shredded',
      timesLogged: 3,
      kcalPer100Min: 23,
      kcalPer100Max: 60,
    });
  });
});

describe('buildMergeSuggestions thresholds', () => {
  it('needs at least two entries', () => {
    const items = [
      item({ entry: 'a', name: 'Heinz tomato ketchup', kcal: 103 }),
      item({ entry: 'a', name: 'Tomato ketchup', kcal: 118 }),
    ];
    expect(build(items)).toEqual([]);
  });

  it(`skips foods under ${SUGGESTION_RULES.minKcalPer100} kcal per 100 g`, () => {
    const items = [
      item({ entry: 'a', name: 'Sparkling water', kcal: 0 }),
      item({ entry: 'b', name: 'Water', kcal: 4 }),
    ];
    expect(build(items)).toEqual([]);
  });

  it('suggests one name with a spread of at least 10 % and 5 kcal', () => {
    const items = [
      item({ entry: 'a', name: 'Hummus', kcal: 166 }),
      item({ entry: 'b', name: 'Hummus', kcal: 250 }),
    ];
    expect(build(items).map(({ key }) => key)).toEqual(['hummus']);
  });

  it('ignores small spreads for one name', () => {
    const underFive = [
      item({ entry: 'a', name: 'Cabbage', kcal: 27 }),
      item({ entry: 'b', name: 'Cabbage', kcal: 23 }),
    ];
    const underTenPercent = [
      item({ entry: 'a', name: 'Mayonnaise', kcal: 673 }),
      item({ entry: 'b', name: 'Mayonnaise', kcal: 685 }),
    ];
    expect(build(underFive)).toEqual([]);
    expect(build(underTenPercent)).toEqual([]);
  });

  it('ignores differences caused by rounding item calories', () => {
    const items = [
      item({
        entry: 'a',
        name: 'Salsa',
        kcal: 0,
        grams: 3,
        nutrients: { calories: 2 },
      }),
      item({
        entry: 'b',
        name: 'Salsa',
        kcal: 0,
        grams: 7,
        nutrients: { calories: 4 },
      }),
    ];
    expect(build(items)).toEqual([]);
  });

  it('skips dismissed groups by any variant name', () => {
    expect(
      build(ownerItems(), [], ['mayo', 'Heinz tomato ketchup']).map(
        ({ key }) => key,
      ),
    ).toEqual(['sofisoft potato bun']);
  });

  it('returns at most five suggestions sorted by impact', () => {
    const names = ['Apple', 'Pear', 'Plum', 'Fig', 'Kiwi', 'Mango'];
    const items = names.flatMap((name, index) => [
      item({ entry: `${name}-1`, name, kcal: 50 }),
      item({ entry: `${name}-2`, name, kcal: 60 + index * 10 }),
    ]);

    expect(build(items).map(({ key }) => key)).toEqual([
      'mango',
      'kiwi',
      'fig',
      'plum',
      'pear',
    ]);
  });

  it('breaks impact ties by item count', () => {
    const items = [
      item({ entry: 'a', name: 'Bun', kcal: 272 }),
      item({ entry: 'b', name: 'Potato bun', kcal: 272 }),
      item({ entry: 'c', name: 'Potato bun', kcal: 272 }),
      item({ entry: 'd', name: 'Ketchup', kcal: 110 }),
      item({ entry: 'e', name: 'Tomato ketchup', kcal: 110 }),
    ];
    expect(build(items).map(({ key }) => key)).toEqual(['bun', 'ketchup']);
  });
});

describe('buildMergeSuggestions with saved foods', () => {
  it('shows a linked saved food as the recommended variant', () => {
    const items = [
      item({
        entry: 'a',
        name: 'Heinz tomato ketchup',
        kcal: 110,
        grams: 20,
        productId: SAVED_ID,
      }),
      item({ entry: 'b', name: 'Ketchup', kcal: 130, at: DAY_2 }),
      item({ entry: 'c', name: 'Ketchup', kcal: 125, at: DAY_3 }),
    ];

    const [suggestion] = build(items, [savedKetchup()]);

    expect(suggestion?.key).toBe('ketchup');
    expect(suggestion?.variants.map((variant) => variant.name)).toEqual([
      'Heinz tomato ketchup',
      'Ketchup',
    ]);
    expect(suggestion?.variants[0]).toMatchObject({
      productId: SAVED_ID,
      valueSource: 'saved',
      recommended: true,
      per100: savedKetchup().per100,
      timesLogged: 1,
    });
  });

  it('prefers label values over more logged estimates', () => {
    const items = [
      item({
        entry: 'a',
        name: 'Greek yogurt',
        kcal: 97,
        fromLabel: true,
        at: DAY_2,
      }),
      item({ entry: 'b', name: 'Yogurt, greek', kcal: 120, at: DAY_1 }),
      item({ entry: 'c', name: 'Yogurt', kcal: 61 }),
      item({ entry: 'd', name: 'Yogurt', kcal: 61 }),
      item({ entry: 'e', name: 'Yogurt', kcal: 61 }),
    ];

    const [suggestion] = build(items);

    expect(
      suggestion?.variants.map(({ name, valueSource, timesLogged }) => [
        name,
        valueSource,
        timesLogged,
      ]),
    ).toEqual([
      ['Greek yogurt', 'label', 2],
      ['Yogurt', 'estimate', 3],
    ]);
    expect(suggestion?.key).toBe('yogurt');
  });

  it('stays quiet when every item already uses the saved food', () => {
    const food = savedKetchup();
    const linked = (entry: string, grams: number) =>
      item({
        entry,
        name: 'Heinz tomato ketchup',
        kcal: 0,
        grams,
        productId: SAVED_ID,
        nutrients: roundNutrients(nutrientsFromPer100g(food.per100, grams)),
      });
    expect(
      build([linked('a', 3), linked('b', 7), linked('c', 26)], [food]),
    ).toEqual([]);
  });

  it('keeps word order variants of one name together', () => {
    const items = [
      item({ entry: 'a', name: 'Yogurt, greek', kcal: 97 }),
      item({ entry: 'b', name: 'Greek yogurt', kcal: 130, at: DAY_2 }),
    ];

    const [suggestion] = build(items);

    expect(suggestion?.variants.map(({ name }) => name)).toEqual([
      'Greek yogurt',
    ]);
    expect(build(items, [], ['yogurt greek'])).toEqual([]);
  });

  it('suggests fixing linked items with outdated values', () => {
    const items = [
      item({
        entry: 'a',
        name: 'Heinz tomato ketchup',
        kcal: 150,
        productId: SAVED_ID,
      }),
      item({
        entry: 'b',
        name: 'Heinz tomato ketchup',
        kcal: 150,
        productId: SAVED_ID,
      }),
    ];

    const [suggestion] = build(items, [savedKetchup()]);

    expect(suggestion).toMatchObject({
      key: 'heinz tomato ketchup',
      kcalPer100Min: 110,
      kcalPer100Max: 150,
    });
    expect(suggestion?.variants).toHaveLength(1);
  });
});

describe('buildMergeSuggestions micros', () => {
  it('derives the micros per 100 g of each variant from its latest item', () => {
    const items = [
      item({
        entry: 'a',
        name: 'Heinz tomato ketchup',
        kcal: 103,
        grams: 20,
        at: DAY_1,
        micros: { potassium: 40 },
      }),
      item({
        entry: 'b',
        name: 'Heinz tomato ketchup',
        kcal: 118,
        grams: 25,
        at: DAY_2,
        micros: { potassium: 70, vitaminA: 5 },
      }),
      item({ entry: 'c', name: 'Tomato ketchup', kcal: 110, grams: 30 }),
    ];

    const [ketchup] = build(items);

    expect(
      ketchup?.variants.map(({ name, microsPer100 }) => [name, microsPer100]),
    ).toEqual([
      ['Heinz tomato ketchup', { potassium: 280, vitaminA: 20 }],
      ['Tomato ketchup', null],
    ]);
  });

  it('uses the micros of a linked saved food over item micros', () => {
    const food = savedKetchup({ microsPer100: { potassium: 281 } });
    const items = [
      item({
        entry: 'a',
        name: 'Heinz tomato ketchup',
        kcal: 110,
        grams: 20,
        productId: SAVED_ID,
        micros: { potassium: 50 },
      }),
      item({ entry: 'b', name: 'Tomato ketchup', kcal: 130, grams: 20 }),
    ];

    const [ketchup] = build(items, [food]);

    expect(ketchup?.variants[0]).toMatchObject({
      productId: SAVED_ID,
      microsPer100: { potassium: 281 },
    });
  });
});

describe('buildMergeSuggestions with saved foods outside the window', () => {
  it('offers an unused saved food as the recommended variant', () => {
    const food = savedKetchup({
      id: OTHER_SAVED_ID,
      displayName: 'Ketchup',
      names: ['Ketchup'],
    });

    const [ketchup] = build(ownerItems(), [food]);

    expect(ketchup?.key).toBe('ketchup');
    expect(ketchup?.itemCount).toBe(3);
    expect(ketchup?.variants.map(({ name }) => name)).toEqual([
      'Ketchup',
      'Heinz tomato ketchup',
      'Tomato ketchup',
    ]);
    expect(ketchup?.variants[0]).toEqual({
      name: 'Ketchup',
      productId: OTHER_SAVED_ID,
      timesLogged: 0,
      typicalGrams: 15,
      lastUsedAt: DAY_1.toISOString(),
      basisUnit: 'g',
      per100: food.per100,
      microsPer100: null,
      kcalPer100Min: 110,
      kcalPer100Max: 110,
      valueSource: 'saved',
      recommended: true,
    });
  });

  it('suggests an unused saved food for one logged name only when the values disagree', () => {
    const items = [
      item({ entry: 'a', name: 'Tomato ketchup', kcal: 110, grams: 20 }),
      item({ entry: 'b', name: 'Tomato ketchup', kcal: 110, grams: 20 }),
    ];
    const richer = savedKetchup({
      per100: { ...zeroNutrients(), calories: 150 },
    });

    expect(build(items, [savedKetchup()])).toEqual([]);
    expect(
      build(items, [richer]).map(({ variants }) =>
        variants.map(({ productId }) => productId),
      ),
    ).toEqual([[SAVED_ID, null]]);
  });

  it('never offers a saved food that conflicts with any variant', () => {
    const light = savedKetchup({
      displayName: 'Tomato ketchup, light',
      names: ['Tomato ketchup, light'],
    });

    const [ketchup] = build(ownerItems(), [light]);

    expect(ketchup?.variants.map(({ productId }) => productId)).toEqual([
      null,
      null,
    ]);
  });

  it('stays quiet about identical logs of an unused saved food', () => {
    const yogurt = (entry: string) =>
      item({
        entry,
        name: 'Khoury strawberry Greek yogurt, low fat',
        kcal: 88,
        grams: 170,
        fromLabel: true,
      });
    const food = savedKetchup({
      displayName: 'Khoury strawberry Greek yogurt, low fat',
      names: ['Khoury strawberry Greek yogurt, low fat'],
      per100: { ...zeroNutrients(), calories: 88 },
    });

    expect(build([yogurt('a'), yogurt('b'), yogurt('c')], [food])).toEqual([]);
  });

  it('stays quiet when an unused saved food looks like one already in use', () => {
    const food = savedKetchup();
    const linked = (entry: string) =>
      item({
        entry,
        name: 'Heinz tomato ketchup',
        kcal: 0,
        grams: 20,
        productId: SAVED_ID,
        nutrients: roundNutrients(nutrientsFromPer100g(food.per100, 20)),
      });
    const unused = savedKetchup({
      id: OTHER_SAVED_ID,
      displayName: 'Ketchup',
      names: ['Ketchup'],
      per100: { ...zeroNutrients(), calories: 130 },
    });

    expect(build([linked('a'), linked('b')], [food, unused])).toEqual([]);
  });

  it('keeps an unused saved food for groups that were not dismissed', () => {
    const items = [
      item({ entry: 'a', name: 'Chicken burger', kcal: 250 }),
      item({ entry: 'b', name: 'Chicken burger', kcal: 250 }),
      item({ entry: 'c', name: 'Beef burger', kcal: 280 }),
      item({ entry: 'd', name: 'Beef burger', kcal: 280 }),
      item({ entry: 'e', name: 'Beef burger', kcal: 280 }),
    ];
    const burger = savedKetchup({
      displayName: 'Burger',
      names: ['Burger'],
      per100: { ...zeroNutrients(), calories: 300 },
    });

    expect(
      build(items, [burger], ['beef burger']).map(({ key, variants }) => [
        key,
        variants.map(({ productId }) => productId),
      ]),
    ).toEqual([['burger', [SAVED_ID, null]]]);
  });

  it('offers each unused saved food to one group only', () => {
    const items = [
      item({ entry: 'a', name: 'Chicken burger', kcal: 250 }),
      item({ entry: 'b', name: 'Chicken burger', kcal: 300 }),
      item({ entry: 'c', name: 'Beef burger', kcal: 280 }),
      item({ entry: 'd', name: 'Beef burger', kcal: 330 }),
      item({ entry: 'e', name: 'Beef burger', kcal: 330 }),
    ];
    const burger = savedKetchup({
      displayName: 'Burger',
      names: ['Burger'],
      per100: { ...zeroNutrients(), calories: 260 },
    });

    const suggestions = build(items, [burger]);

    expect(
      suggestions.map(({ key, variants }) => [
        key,
        variants.map(({ productId }) => productId),
      ]),
    ).toEqual([
      ['burger', [SAVED_ID, null]],
      ['chicken burger', [null]],
    ]);
  });
});

describe('buildMergeSuggestions after a merge', () => {
  function savedBun(overrides: Partial<SavedFoodInfo> = {}): SavedFoodInfo {
    return savedKetchup({
      displayName: 'Sofisoft potato bun',
      names: ['Sofisoft potato bun'],
      per100: { ...zeroNutrients(), calories: 272 },
      servingGrams: 70,
      ...overrides,
    });
  }

  function bunDecision(
    overrides: Partial<FoodMergeDecision> = {},
  ): FoodMergeDecision {
    return {
      names: ['sofisoft potato bun'],
      keptApart: ['sofisoft potato bun top hollowed'],
      productId: SAVED_ID,
      at: MERGED_AT.toISOString(),
      ...overrides,
    };
  }

  function keys(suggestions: ReturnType<typeof build>): string[] {
    return suggestions.map(({ key }) => key);
  }

  it('never brings back a partial merge for the names it covered or kept apart', () => {
    expect(keys(build(ownerItems(), [savedBun()]))).toContain(
      'sofisoft potato bun',
    );

    expect(
      keys(build(ownerItems(), [savedBun()], [], [bunDecision()])),
    ).toEqual(['tomato ketchup', 'mayo']);
  });

  it('keeps a kept-apart name out of the merged food even when it is logged again', () => {
    const items = [
      ...ownerItems(),
      ...['x', 'y'].map((entry) =>
        item({
          entry,
          at: DAY_4,
          name: 'Sofisoft potato bun, top hollowed',
          kcal: 220,
          grams: 55,
        }),
      ),
    ];

    expect(keys(build(items, [savedBun()]))).toContain('sofisoft potato bun');
    expect(keys(build(items, [savedBun()], [], [bunDecision()]))).toEqual([
      'tomato ketchup',
      'mayo',
    ]);
  });

  it('keeps a kept-apart name away from the saved food after it was renamed', () => {
    const items = ['x', 'y'].map((entry) =>
      item({ entry, at: DAY_4, name: 'Heinz tomato ketchup', kcal: 130 }),
    );
    const renamed = savedKetchup({
      displayName: 'Ketchup',
      names: ['Ketchup'],
    });
    const decision: FoodMergeDecision = {
      names: ['tomato ketchup'],
      keptApart: ['heinz tomato ketchup'],
      productId: SAVED_ID,
      at: MERGED_AT.toISOString(),
    };

    expect(build(items, [renamed])).toHaveLength(1);
    expect(build(items, [renamed], [], [decision])).toEqual([]);
  });

  it('suggests a genuinely new duplicate logged after the merge', () => {
    const items = [
      ...ownerItems(),
      ...['x', 'y'].map((entry) =>
        item({
          entry,
          at: DAY_4,
          name: 'Sofisoft potato bun',
          kcal: 320,
          grams: 70,
        }),
      ),
    ];

    const bun = build(items, [savedBun()], [], [bunDecision()]).find(
      ({ key }) => key === 'sofisoft potato bun',
    );

    expect(
      bun?.variants.map(({ name, productId, timesLogged }) => [
        name,
        productId,
        timesLogged,
      ]),
    ).toEqual([
      ['Sofisoft potato bun', SAVED_ID, 0],
      ['Sofisoft potato bun', null, 2],
    ]);
  });

  it('ignores decided items whether or not past items were fixed', () => {
    const decision: FoodMergeDecision = {
      names: ['heinz tomato ketchup', 'tomato ketchup'],
      keptApart: [],
      productId: SAVED_ID,
      at: MERGED_AT.toISOString(),
    };

    expect(keys(build(ownerItems(), [], [], [decision]))).toEqual([
      'mayo',
      'sofisoft potato bun',
    ]);
  });

  it('counts items created after the decision even when they were eaten before it', () => {
    const decision: FoodMergeDecision = {
      names: ['heinz tomato ketchup', 'tomato ketchup'],
      keptApart: [],
      productId: SAVED_ID,
      at: MERGED_AT.toISOString(),
    };
    const items = [
      ...ownerItems(),
      item({
        entry: 'late-1',
        at: DAY_1,
        createdAt: DAY_4,
        name: 'Tomato ketchup',
        kcal: 140,
      }),
      item({
        entry: 'late-2',
        at: DAY_2,
        createdAt: MERGED_AT,
        name: 'Heinz tomato ketchup',
        kcal: 100,
      }),
      item({
        entry: 'late-3',
        at: DAY_2,
        createdAt: DAY_4,
        name: 'Heinz tomato ketchup',
        kcal: 100,
      }),
    ];

    const ketchup = build(items, [], [], [decision]).find(
      ({ key }) => key === 'tomato ketchup',
    );

    expect(ketchup).toMatchObject({ itemCount: 2, entryCount: 2 });
  });

  describe('the owner’s partial ketchup merge', () => {
    const heinz = savedKetchup({ names: ['Heinz tomato ketchup'] });
    const decision: FoodMergeDecision = {
      names: ['heinz tomato ketchup'],
      keptApart: ['tomato ketchup'],
      productId: SAVED_ID,
      at: MERGED_AT.toISOString(),
    };

    function loggedAfter(name: string, kcal: number): LoggedFoodItem[] {
      return ['first', 'second'].map((entry) =>
        item({ entry: `${name}-${entry}`, at: DAY_4, name, kcal }),
      );
    }

    function variantsOf(
      suggestions: ReturnType<typeof build>,
      key: string,
    ): [string, string | null, number][] | undefined {
      return suggestions
        .find((suggestion) => suggestion.key === key)
        ?.variants.map(({ name, productId, timesLogged }) => [
          name,
          productId,
          timesLogged,
        ]);
    }

    it('never suggests ketchup again from the items logged before the merge', () => {
      expect(keys(build(ownerItems(), [heinz]))).toContain('tomato ketchup');

      expect(keys(build(ownerItems(), [heinz], [], [decision]))).toEqual([
        'mayo',
        'sofisoft potato bun',
      ]);
    });

    it('keeps a new unlinked Tomato ketchup away from the saved Heinz ketchup', () => {
      const items = [...ownerItems(), ...loggedAfter('Tomato ketchup', 130)];

      expect(variantsOf(build(items, [heinz]), 'tomato ketchup')).toEqual([
        ['Heinz tomato ketchup', SAVED_ID, 0],
        ['Tomato ketchup', null, 3],
        ['Heinz tomato ketchup', null, 2],
      ]);
      expect(keys(build(items, [heinz], [], [decision]))).toEqual([
        'mayo',
        'sofisoft potato bun',
      ]);
    });

    it('suggests a new unlinked Ketchup with different values together with the saved food', () => {
      const items = [...ownerItems(), ...loggedAfter('Ketchup', 125)];

      expect(
        variantsOf(build(items, [heinz], [], [decision]), 'ketchup'),
      ).toEqual([
        ['Heinz tomato ketchup', SAVED_ID, 0],
        ['Ketchup', null, 2],
      ]);
    });

    it('groups a new unlinked Tomato ketchup with the saved food once a later merge added it', () => {
      const items = [...ownerItems(), ...loggedAfter('Tomato ketchup', 130)];
      const addedLater: FoodMergeDecision = {
        names: ['heinz tomato ketchup', 'tomato ketchup'],
        keptApart: [],
        productId: SAVED_ID,
        at: '2026-09-24T00:00:00.000Z',
      };

      expect(
        variantsOf(
          build(items, [savedKetchup()], [], [decision, addedLater]),
          'tomato ketchup',
        ),
      ).toEqual([
        ['Heinz tomato ketchup', SAVED_ID, 0],
        ['Tomato ketchup', null, 2],
      ]);
      expect(build(items, [savedKetchup()], [], [decision])).toEqual([
        expect.objectContaining({ key: 'mayo' }),
        expect.objectContaining({ key: 'sofisoft potato bun' }),
      ]);
    });

    it('never adds the saved food to a group that holds a kept-apart name', () => {
      const items = [
        ...ownerItems(),
        ...loggedAfter('Tomato ketchup', 130),
        ...loggedAfter('Ketchup', 125),
      ];

      const suggestions = build(items, [heinz], [], [decision]);
      const ketchup = suggestions.find(({ key }) => key === 'ketchup');

      expect(ketchup?.variants.map(({ name }) => name).sort()).toEqual([
        'Ketchup',
        'Tomato ketchup',
      ]);
      expect(
        suggestions.some(({ variants }) =>
          variants.some(({ productId }) => productId === SAVED_ID),
        ),
      ).toBe(false);
    });
  });
});

describe('suggestionWindowStart', () => {
  it('looks back 120 days', () => {
    expect(suggestionWindowStart(new Date('2026-09-30T00:00:00.000Z'))).toEqual(
      new Date('2026-06-02T00:00:00.000Z'),
    );
  });
});
