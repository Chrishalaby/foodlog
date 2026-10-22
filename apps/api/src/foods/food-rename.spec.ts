import { API_LIMITS } from '@food/shared';
import {
  type FoodRenamePlan,
  planFoodRename,
  type RenameEntry,
  type RenameFavorite,
  renamedFoodName,
  renameSummary,
} from './food-rename.js';

function entry(
  id: string,
  name: string,
  itemNames: readonly string[] = [name],
): RenameEntry {
  return {
    id,
    name,
    items: itemNames.map((itemName, index) => ({
      id: `${id}-i${index}`,
      name: itemName,
    })),
  };
}

function favorite(
  id: string,
  name: string,
  itemNames: readonly string[] = [name],
): RenameFavorite {
  return {
    id,
    name,
    items: itemNames.map((itemName) => ({
      name: itemName,
      grams: 150,
      nutrients: { calories: 120 },
      confidence: 'high',
    })),
  };
}

describe('planFoodRename', () => {
  it('renames every entry with the normalized name and the matching single items', () => {
    const plan = planFoodRename(
      [
        entry('e1', 'Khoury strawberry yogurt'),
        entry('e2', '  khoury  STRAWBERRY yogurt ×2'),
        entry('e3', 'Khoury strawberry yogurt', ['Yogurt', 'Granola']),
        entry('e4', 'Khoury strawberry yogurt', ['Khoury yogurt 170 g']),
        entry('e5', 'Strawberry yogurt cup'),
      ],
      [],
      'Khoury Strawberry Yogurt',
      'Strawberry yogurt cup',
    );

    expect(plan).toEqual<FoodRenamePlan>({
      matchedEntries: 4,
      renamedEntries: 4,
      renamedItems: 2,
      entryRenames: [
        { name: 'Strawberry yogurt cup', ids: ['e1', 'e3', 'e4'] },
        { name: 'Strawberry yogurt cup ×2', ids: ['e2'] },
      ],
      itemIds: ['e1-i0', 'e2-i0'],
      itemName: 'Strawberry yogurt cup',
      matchedFavorites: 0,
      favoriteRenames: [],
    });
  });

  it('keeps the servings suffix of each matched entry and never adds one to items', () => {
    const plan = planFoodRename(
      [
        entry('e1', 'Yogurt'),
        entry('e2', 'Yogurt ×2', ['Yogurt', 'Honey']),
        entry('e3', 'Yogurt ×1.5', ['Granola', 'Milk']),
        entry('e4', 'Yogurt ×2', ['Yogurt']),
      ],
      [],
      'Yogurt',
      'Strawberry yogurt',
    );

    expect(plan).toMatchObject({
      renamedEntries: 4,
      entryRenames: [
        { name: 'Strawberry yogurt', ids: ['e1'] },
        { name: 'Strawberry yogurt ×2', ids: ['e2', 'e4'] },
        { name: 'Strawberry yogurt ×1.5', ids: ['e3'] },
      ],
      itemIds: ['e1-i0', 'e4-i0'],
      itemName: 'Strawberry yogurt',
    });
  });

  it('ignores a servings suffix typed on the new name', () => {
    const plan = planFoodRename(
      [entry('e1', 'Yogurt'), entry('e2', 'Yogurt ×2')],
      [],
      'Yogurt ×2',
      'Strawberry yogurt ×2',
    );

    expect(plan.entryRenames).toEqual([
      { name: 'Strawberry yogurt', ids: ['e1'] },
      { name: 'Strawberry yogurt ×2', ids: ['e2'] },
    ]);
    expect(plan.itemName).toBe('Strawberry yogurt');
  });

  it('does not count an entry that already carries the new name and its suffix', () => {
    const plan = planFoodRename(
      [
        entry('e1', 'Yogurt ×2', ['Yogurt', 'Honey']),
        entry('e2', 'yogurt ×2', ['Yogurt', 'Honey']),
      ],
      [],
      'yogurt',
      'Yogurt',
    );

    expect(plan).toMatchObject({
      matchedEntries: 2,
      renamedEntries: 1,
      entryRenames: [{ name: 'Yogurt ×2', ids: ['e2'] }],
    });
  });

  it('keeps renamed names with a suffix within the name limit', () => {
    const to = `${'a'.repeat(API_LIMITS.nameMax - 4)}😀bbb`;

    const plan = planFoodRename([entry('e1', 'Oats ×2')], [], 'Oats', to);

    const name = plan.entryRenames[0]?.name ?? '';
    expect(name).toBe(`${'a'.repeat(API_LIMITS.nameMax - 4)}😀 ×2`);
    expect(Array.from(name)).toHaveLength(API_LIMITS.nameMax);
  });

  it('never renames items of entries with several items', () => {
    const plan = planFoodRename(
      [entry('e1', 'Protein shake', ['Protein shake', 'Banana'])],
      [],
      'Protein shake',
      'Smoothie',
    );

    expect(plan).toMatchObject({
      matchedEntries: 1,
      renamedEntries: 1,
      renamedItems: 0,
      itemIds: [],
    });
  });

  it('changes only the display casing when both names normalize alike', () => {
    const plan = planFoodRename(
      [
        entry('e1', 'khoury yogurt'),
        entry('e2', 'Khoury Yogurt', ['khoury yogurt']),
        entry('e3', 'Khoury Yogurt'),
      ],
      [],
      'khoury yogurt',
      'Khoury Yogurt',
    );

    expect(plan).toMatchObject({
      matchedEntries: 3,
      renamedEntries: 1,
      renamedItems: 2,
      entryRenames: [{ name: 'Khoury Yogurt', ids: ['e1'] }],
      itemIds: ['e1-i0', 'e2-i0'],
    });
  });

  it('matches nothing when no entry or favorite has the name', () => {
    expect(
      planFoodRename(
        [entry('e1', 'Granola')],
        [favorite('v1', 'Granola')],
        'Oats',
        'Porridge',
      ),
    ).toEqual<FoodRenamePlan>({
      matchedEntries: 0,
      renamedEntries: 0,
      renamedItems: 0,
      entryRenames: [],
      itemIds: [],
      itemName: 'Porridge',
      matchedFavorites: 0,
      favoriteRenames: [],
    });
  });

  it('renames favorites with the normalized name and the matching single item', () => {
    const plan = planFoodRename(
      [entry('e1', 'Crunchy Oat Clusters')],
      [
        favorite('v1', 'crunchy  OAT clusters'),
        favorite('v2', 'Granola'),
        favorite('v3', 'Crunchy oat clusters', [
          'Crunchy Oat Clusters cereal with honey',
        ]),
      ],
      'Crunchy Oat Clusters',
      'Oat clusters cereal',
    );

    expect(plan.matchedFavorites).toBe(2);
    expect(plan.favoriteRenames).toEqual([
      {
        id: 'v1',
        name: 'Oat clusters cereal',
        items: [
          {
            name: 'Oat clusters cereal',
            grams: 150,
            nutrients: { calories: 120 },
            confidence: 'high',
          },
        ],
      },
      { id: 'v3', name: 'Oat clusters cereal', items: null },
    ]);
  });

  it('never touches the items of a favorite with several items', () => {
    const plan = planFoodRename(
      [],
      [favorite('v1', 'Protein shake', ['Protein shake', 'Banana'])],
      'Protein shake',
      'Smoothie',
    );

    expect(plan.favoriteRenames).toEqual([
      { id: 'v1', name: 'Smoothie', items: null },
    ]);
  });

  it('counts a favorite already named like the target as matched but not renamed', () => {
    const plan = planFoodRename(
      [entry('e1', 'yogurt')],
      [favorite('v1', 'Yogurt')],
      'yogurt',
      'Yogurt',
    );

    expect(plan).toMatchObject({ matchedFavorites: 1, favoriteRenames: [] });
  });

  it('only fixes the single item of a favorite that already has the new name', () => {
    const plan = planFoodRename(
      [],
      [favorite('v1', 'Yogurt', ['yogurt'])],
      'yogurt',
      'Yogurt',
    );

    expect(plan.favoriteRenames).toEqual([
      {
        id: 'v1',
        name: 'Yogurt',
        items: [expect.objectContaining({ name: 'Yogurt', grams: 150 })],
      },
    ]);
  });

  it('keeps the servings suffix of a favorite name', () => {
    const plan = planFoodRename(
      [],
      [favorite('v1', 'Yogurt ×2', ['Yogurt'])],
      'Yogurt',
      'Strawberry yogurt',
    );

    expect(plan.favoriteRenames).toEqual([
      {
        id: 'v1',
        name: 'Strawberry yogurt ×2',
        items: [expect.objectContaining({ name: 'Strawberry yogurt' })],
      },
    ]);
  });

  it('skips favorite items that are not plain objects with a name', () => {
    const broken: RenameFavorite = { id: 'v1', name: 'Oats', items: ['Oats'] };
    const unnamed: RenameFavorite = {
      id: 'v2',
      name: 'Oats',
      items: [{ grams: 40 }],
    };
    const notAList: RenameFavorite = { id: 'v3', name: 'Oats', items: null };

    const plan = planFoodRename(
      [],
      [broken, unnamed, notAList],
      'Oats',
      'Porridge',
    );

    expect(plan.favoriteRenames).toEqual([
      { id: 'v1', name: 'Porridge', items: null },
      { id: 'v2', name: 'Porridge', items: null },
      { id: 'v3', name: 'Porridge', items: null },
    ]);
  });
});

describe('renamedFoodName', () => {
  it.each([
    ['Yogurt', 'Strawberry yogurt', 'Strawberry yogurt'],
    ['Yogurt ×2', 'Strawberry yogurt', 'Strawberry yogurt ×2'],
    ['Oats × 1,5', 'Porridge', 'Porridge ×1,5'],
    ['×2', 'Porridge', 'Porridge'],
  ])('renames %j to %j as %j', (name, base, expected) => {
    expect(renamedFoodName(name, base)).toBe(expected);
  });
});

describe('renameSummary', () => {
  it('reports only the counts', () => {
    expect(
      renameSummary({
        matchedEntries: 3,
        renamedEntries: 2,
        renamedItems: 1,
        entryRenames: [{ name: 'Oats', ids: ['e1', 'e2'] }],
        itemIds: ['i1'],
        itemName: 'Oats',
        matchedFavorites: 1,
        favoriteRenames: [{ id: 'v1', name: 'Oats', items: null }],
      }),
    ).toEqual({ matchedEntries: 3, renamedEntries: 2, renamedItems: 1 });
  });
});
