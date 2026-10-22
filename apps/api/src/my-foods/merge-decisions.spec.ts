import { toFoodName } from './food-names.js';
import {
  areKeptApart,
  FOOD_MERGE_DECISIONS_MAX,
  type FoodMergeDecision,
  isDecidedItem,
  mergeDecisionsJson,
  newMergeDecision,
  normalizedFoodNames,
  parseMergeDecisions,
  toDecisionRules,
  withMergeDecision,
  withoutKeptApart,
} from './merge-decisions.js';

const SAVED_ID = '019a0000-0000-7000-8000-0000000000d1';
const OTHER_ID = '019a0000-0000-7000-8000-0000000000d2';
const MERGED_AT = new Date('2026-10-01T20:00:00.000Z');

function decision(
  overrides: Partial<FoodMergeDecision> = {},
): FoodMergeDecision {
  return {
    names: ['heinz mayo', 'mayo'],
    keptApart: ['garlic mayo sauce'],
    productId: SAVED_ID,
    at: MERGED_AT.toISOString(),
    ...overrides,
  };
}

function node(names: string[], foodId: string | null = null) {
  return {
    names: names.map(toFoodName),
    food: foodId === null ? null : { id: foodId },
  };
}

describe('newMergeDecision', () => {
  it('stores normalized, distinct names with the server time', () => {
    expect(
      newMergeDecision(
        ['Heinz mayonnaise, regular', 'Mayonnaise', 'Heinz Mayonnaise', '!!'],
        ['Garlic mayonnaise sauce', 'garlic  mayonnaise sauce'],
        SAVED_ID,
        MERGED_AT,
      ),
    ).toEqual({
      names: ['heinz mayo', 'mayo'],
      keptApart: ['garlic mayo sauce'],
      productId: SAVED_ID,
      at: '2026-10-01T20:00:00.000Z',
    });
  });

  it('never keeps apart a name that was merged', () => {
    expect(
      newMergeDecision(
        ['Tomato ketchup'],
        ['Ketchup, tomato', 'Ketchup packet'],
        SAVED_ID,
        MERGED_AT,
      ).keptApart,
    ).toEqual(['ketchup packet']);
  });

  it('drops names without letters or digits', () => {
    expect(normalizedFoodNames(['', '  ', '...', 'Bun'])).toEqual(['bun']);
  });
});

describe('withoutKeptApart', () => {
  it('drops names the user kept apart, however they are spelled', () => {
    expect(
      withoutKeptApart(
        ['Heinz tomato ketchup', 'Ketchup, tomato', 'Catsup', 'Ketchup packet'],
        ['Heinz tomato ketchup'],
        ['Tomato ketchup', 'ketchup packets'],
      ),
    ).toEqual(['Heinz tomato ketchup', 'Catsup']);
  });

  it('keeps a name that was both merged and unticked', () => {
    expect(
      withoutKeptApart(
        ['Tomato ketchup', 'Catsup'],
        ['Tomato ketchup'],
        ['Ketchup, tomato'],
      ),
    ).toEqual(['Tomato ketchup', 'Catsup']);
    expect(withoutKeptApart(['Catsup'], [], [])).toEqual(['Catsup']);
  });
});

describe('stored decisions', () => {
  it('reads back what it writes', () => {
    const stored = mergeDecisionsJson([decision()]);

    expect(parseMergeDecisions(stored)).toEqual([decision()]);
  });

  it('skips malformed entries instead of failing', () => {
    expect(
      parseMergeDecisions([
        decision(),
        null,
        'mayo',
        { names: ['mayo'], keptApart: [], at: 'not a date' },
        { names: 'mayo', keptApart: [], at: MERGED_AT.toISOString() },
        { names: ['mayo'], keptApart: [1], at: MERGED_AT.toISOString() },
        { names: ['bun'], keptApart: [], at: MERGED_AT.toISOString() },
      ]),
    ).toEqual([
      decision(),
      {
        names: ['bun'],
        keptApart: [],
        productId: null,
        at: MERGED_AT.toISOString(),
      },
    ]);
    expect(parseMergeDecisions({ names: [] })).toEqual([]);
    expect(parseMergeDecisions(null)).toEqual([]);
  });

  it(`keeps the newest ${FOOD_MERGE_DECISIONS_MAX} decisions`, () => {
    const full = Array.from({ length: FOOD_MERGE_DECISIONS_MAX }, (_, i) =>
      decision({ names: [`food ${i}`] }),
    );

    const next = withMergeDecision(full, decision({ names: ['latest'] }));

    expect(next).toHaveLength(FOOD_MERGE_DECISIONS_MAX);
    expect(next[0]?.names).toEqual(['food 1']);
    expect(next.at(-1)?.names).toEqual(['latest']);
    expect(withMergeDecision([], decision())).toEqual([decision()]);
  });
});

describe('isDecidedItem', () => {
  const rules = toDecisionRules([decision()]);

  it('covers merged and kept-apart names created up to the decision', () => {
    for (const name of [
      'Mayonnaise',
      'Heinz mayonnaise',
      'Garlic mayonnaise sauce',
    ]) {
      expect(isDecidedItem({ name, createdAt: MERGED_AT }, rules)).toBe(true);
    }
  });

  it('lets items created after the decision count again', () => {
    expect(
      isDecidedItem(
        { name: 'Mayonnaise', createdAt: new Date(MERGED_AT.getTime() + 1) },
        rules,
      ),
    ).toBe(false);
  });

  it('ignores names the decision did not mention', () => {
    expect(
      isDecidedItem({ name: 'Tomato ketchup', createdAt: MERGED_AT }, rules),
    ).toBe(false);
    expect(isDecidedItem({ name: '...', createdAt: MERGED_AT }, rules)).toBe(
      false,
    );
  });
});

describe('areKeptApart', () => {
  const rules = toDecisionRules([decision()]);

  it('keeps a kept-apart name away from the merged names and their saved food', () => {
    const garlic = node(['Garlic mayonnaise sauce']);

    expect(areKeptApart(garlic, node(['Mayonnaise']), rules)).toBe(true);
    expect(areKeptApart(node(['Mayonnaise']), garlic, rules)).toBe(true);
    expect(areKeptApart(garlic, node(['Mayo, light'], SAVED_ID), rules)).toBe(
      true,
    );
  });

  it('allows everything else to group as usual', () => {
    expect(
      areKeptApart(node(['Mayonnaise']), node(['Heinz mayonnaise']), rules),
    ).toBe(false);
    expect(
      areKeptApart(
        node(['Garlic mayonnaise sauce']),
        node(['Garlic mayo'], OTHER_ID),
        rules,
      ),
    ).toBe(false);
    expect(
      areKeptApart(node(['Garlic mayonnaise sauce']), node(['Mayonnaise']), []),
    ).toBe(false);
  });

  it('lets a later merge of the kept-apart name into the same food bring it back', () => {
    const garlic = node(['Garlic mayonnaise sauce']);
    const later = decision({
      names: ['heinz mayo', 'mayo', 'garlic mayo sauce'],
      keptApart: [],
      at: '2026-10-02T20:00:00.000Z',
    });

    expect(
      areKeptApart(
        garlic,
        node(['Mayonnaise']),
        toDecisionRules([decision(), later]),
      ),
    ).toBe(false);
    expect(
      areKeptApart(
        garlic,
        node(['Mayo, light'], SAVED_ID),
        toDecisionRules([decision(), later]),
      ),
    ).toBe(false);
    expect(
      areKeptApart(
        garlic,
        node(['Mayonnaise']),
        toDecisionRules([later, decision()]),
      ),
    ).toBe(true);
  });

  it('keeps a name apart when a later merge puts it into a different food', () => {
    const elsewhere = decision({
      names: ['garlic mayo sauce', 'toum'],
      keptApart: [],
      productId: OTHER_ID,
      at: '2026-10-02T20:00:00.000Z',
    });
    const rules = toDecisionRules([decision(), elsewhere]);

    expect(
      areKeptApart(
        node(['Garlic mayonnaise sauce']),
        node(['Mayonnaise']),
        rules,
      ),
    ).toBe(true);
    expect(
      isDecidedItem(
        { name: 'Garlic mayonnaise sauce', createdAt: MERGED_AT },
        rules,
      ),
    ).toBe(true);
  });

  it('stops keeping a name apart once it belongs to the saved food', () => {
    expect(
      areKeptApart(
        node(['Garlic mayonnaise sauce'], SAVED_ID),
        node(['Mayonnaise']),
        rules,
      ),
    ).toBe(false);
  });
});
