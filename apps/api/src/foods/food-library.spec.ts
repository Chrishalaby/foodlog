import {
  buildLibrary,
  compareDatesDesc,
  type LibraryCandidate,
  type LibraryGroup,
  latestDate,
  mergeSameKind,
  standaloneOnly,
  withoutHiddenNames,
} from './food-library.js';

function candidate(overrides: Partial<LibraryCandidate>): LibraryCandidate {
  return {
    kind: 'meal',
    id: '019a0000-0000-7000-8000-000000000001',
    name: 'Yogurt',
    detail: null,
    useCount: 1,
    recentCount: 1,
    lastUsedAt: new Date('2026-09-20T08:00:00Z'),
    ...overrides,
  };
}

function groupNamed(groups: LibraryGroup[], name: string): LibraryGroup {
  const group = groups.find((g) => g.normalizedName === name);
  if (!group) {
    throw new Error(`missing group ${name}`);
  }
  return group;
}

describe('dates', () => {
  it('sorts later dates first and missing dates last', () => {
    const early = new Date('2026-09-01T00:00:00Z');
    const late = new Date('2026-09-02T00:00:00Z');
    expect(compareDatesDesc(late, early)).toBeLessThan(0);
    expect(compareDatesDesc(early, late)).toBeGreaterThan(0);
    expect(compareDatesDesc(null, early)).toBeGreaterThan(0);
    expect(compareDatesDesc(null, null)).toBe(0);
    expect(latestDate([early, null, late])).toBe(late);
    expect(latestDate([null])).toBeNull();
  });
});

describe('buildLibrary', () => {
  it('keeps one result per normalized name with favorite > meal > food', () => {
    const groups = buildLibrary([
      candidate({ kind: 'food', id: 'f1', name: 'protein shake', useCount: 9 }),
      candidate({ kind: 'meal', id: 'm1', name: 'Protein Shake', useCount: 4 }),
      candidate({
        kind: 'favorite',
        id: 'v1',
        name: '  PROTEIN   shake ',
        useCount: 0,
        recentCount: 0,
        lastUsedAt: null,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      normalizedName: 'protein shake',
      winner: { kind: 'favorite', id: 'v1' },
      useCount: 9,
      recentCount: 1,
      lastUsedAt: new Date('2026-09-20T08:00:00Z'),
      starred: true,
    });
  });

  it('ranks favorite > product > meal > food for the same name', () => {
    const members = [
      candidate({ kind: 'food', id: 'f1', name: 'Almarai laban', useCount: 9 }),
      candidate({ kind: 'meal', id: 'm1', name: 'Almarai Laban', useCount: 7 }),
      candidate({
        kind: 'product',
        id: 'p1',
        name: 'ALMARAI laban',
        useCount: 2,
        recentCount: 2,
      }),
      candidate({
        kind: 'product',
        id: 'p2',
        name: 'almarai laban',
        useCount: 5,
        recentCount: 0,
        lastUsedAt: null,
      }),
    ];

    const [withoutFavorite] = buildLibrary(members);
    const [withFavorite] = buildLibrary([
      ...members,
      candidate({ kind: 'favorite', id: 'v1', name: 'Almarai laban' }),
    ]);

    expect(withoutFavorite).toMatchObject({
      winner: { kind: 'product', id: 'p2' },
      useCount: 9,
      starred: false,
    });
    expect(withFavorite).toMatchObject({
      winner: { kind: 'favorite', id: 'v1' },
      starred: true,
    });
  });

  it('prefers a meal over a food of the same name', () => {
    const [group] = buildLibrary([
      candidate({
        kind: 'food',
        id: 'f1',
        name: 'Khoury strawberry yogurt',
        detail: 'Breakfast bowl',
        useCount: 6,
        lastUsedAt: new Date('2026-09-10T08:00:00Z'),
      }),
      candidate({
        kind: 'meal',
        id: 'm1',
        name: 'Khoury Strawberry Yogurt',
        useCount: 1,
        lastUsedAt: new Date('2026-09-27T08:00:00Z'),
      }),
    ]);

    expect(group).toMatchObject({
      winner: { kind: 'meal', id: 'm1', useCount: 1 },
      normalizedDetail: null,
      useCount: 6,
      lastUsedAt: new Date('2026-09-27T08:00:00Z'),
      starred: false,
    });
  });

  it('folds diacritics and favorite servings suffixes into the same name', () => {
    const groups = buildLibrary([
      candidate({ id: 'm1', name: 'Café latte' }),
      candidate({ id: 'm2', name: 'cafe latte ×2' }),
      candidate({ id: 'm3', name: 'Cafe mocha' }),
    ]);

    expect(groups.map((g) => g.normalizedName).sort()).toEqual([
      'cafe latte',
      'cafe mocha',
    ]);
  });

  it('keeps the detail of a winning food for matching', () => {
    const [group] = buildLibrary([
      candidate({
        kind: 'food',
        id: 'f1',
        name: 'Granola',
        detail: 'Breakfast Bowl',
      }),
    ]);

    expect(group?.normalizedDetail).toBe('breakfast bowl');
  });

  it('keeps the item-name detail of a meal shadowed by a favorite without one', () => {
    const [group] = buildLibrary([
      candidate({
        kind: 'favorite',
        id: 'v1',
        name: 'Strawberry Yogurt',
        detail: null,
        useCount: 0,
        recentCount: 0,
        lastUsedAt: null,
      }),
      candidate({
        kind: 'meal',
        id: 'm1',
        name: 'Strawberry yogurt',
        detail: 'Khoury strawberry yogurt',
      }),
    ]);

    expect(group).toMatchObject({
      winner: { kind: 'favorite', id: 'v1' },
      normalizedDetail: 'khoury strawberry yogurt',
    });
  });

  it('keeps the brand of a product shadowed by a favorite', () => {
    const [group] = buildLibrary([
      candidate({
        kind: 'product',
        id: 'p1',
        name: 'Almarai Laban',
        detail: 'Almarai',
      }),
      candidate({ kind: 'favorite', id: 'v1', name: 'almarai laban' }),
    ]);

    expect(group).toMatchObject({
      winner: { kind: 'favorite', id: 'v1' },
      normalizedDetail: 'almarai',
    });
  });

  it('prefers the winner detail over the details of other members', () => {
    const [group] = buildLibrary([
      candidate({
        kind: 'favorite',
        id: 'v1',
        name: 'Yogurt',
        detail: 'Khoury yogurt',
      }),
      candidate({ kind: 'meal', id: 'm1', name: 'Yogurt', detail: 'Other' }),
    ]);

    expect(group?.normalizedDetail).toBe('khoury yogurt');
  });

  it('never takes the detail of a food member, which names its parent meal', () => {
    const [group] = buildLibrary([
      candidate({ kind: 'meal', id: 'm1', name: 'Cafe latte' }),
      candidate({
        kind: 'food',
        id: 'f1',
        name: 'Cafe latte',
        detail: 'Brunch',
      }),
    ]);

    expect(group).toMatchObject({
      winner: { kind: 'meal', id: 'm1' },
      normalizedDetail: null,
    });
  });

  it('picks the most used favorite when two favorites share a name', () => {
    const groups = buildLibrary([
      candidate({ kind: 'favorite', id: 'v1', name: 'Oats', useCount: 1 }),
      candidate({ kind: 'favorite', id: 'v2', name: 'oats', useCount: 5 }),
    ]);

    expect(groupNamed(groups, 'oats').winner.id).toBe('v2');
  });
});

describe('mergeSameKind', () => {
  it('sums usage of meals and foods and keeps the latest representative', () => {
    const merged = mergeSameKind([
      candidate({
        id: 'm-old',
        name: 'Cafe latte',
        useCount: 3,
        recentCount: 1,
        lastUsedAt: new Date('2026-09-01T08:00:00Z'),
      }),
      candidate({
        id: 'm-new',
        name: 'Café latte',
        useCount: 2,
        recentCount: 2,
        lastUsedAt: new Date('2026-09-25T08:00:00Z'),
      }),
      candidate({
        kind: 'food',
        id: 'f1',
        name: 'cafe latte',
        detail: 'Brunch',
      }),
    ]);

    expect(merged).toEqual([
      candidate({
        id: 'm-new',
        name: 'Café latte',
        useCount: 5,
        recentCount: 3,
        lastUsedAt: new Date('2026-09-25T08:00:00Z'),
      }),
      candidate({
        kind: 'food',
        id: 'f1',
        name: 'cafe latte',
        detail: 'Brunch',
      }),
    ]);
  });

  it('breaks recency ties by the later id', () => {
    const [merged] = mergeSameKind([
      candidate({ id: '019a0000-0000-7000-8000-00000000000a' }),
      candidate({ id: '019a0000-0000-7000-8000-00000000000b' }),
    ]);

    expect(merged?.id).toBe('019a0000-0000-7000-8000-00000000000b');
  });

  it('never merges favorites', () => {
    const merged = mergeSameKind([
      candidate({ kind: 'favorite', id: 'v1' }),
      candidate({ kind: 'favorite', id: 'v2' }),
    ]);

    expect(merged.map((m) => m.id)).toEqual(['v1', 'v2']);
  });

  it('never merges products', () => {
    const merged = mergeSameKind([
      candidate({ kind: 'product', id: 'p1', useCount: 2 }),
      candidate({ kind: 'meal', id: 'm1' }),
      candidate({ kind: 'product', id: 'p2', useCount: 3 }),
    ]);

    expect(merged.map((m) => [m.id, m.useCount])).toEqual([
      ['p1', 2],
      ['p2', 3],
      ['m1', 1],
    ]);
  });
});

describe('withoutHiddenNames', () => {
  it('drops meals and foods whose normalized name is hidden', () => {
    const kept = withoutHiddenNames(
      [
        candidate({ kind: 'meal', id: 'm1', name: '  Café LATTE ×2' }),
        candidate({ kind: 'food', id: 'f1', name: 'Cafe latte' }),
        candidate({ kind: 'meal', id: 'm2', name: 'Cafe mocha' }),
        candidate({ kind: 'food', id: 'f2', name: 'Granola' }),
      ],
      ['cafe latte', 'granola'],
    );

    expect(kept.map((c) => c.id)).toEqual(['m2']);
  });

  it('never hides favorites or products', () => {
    const kept = withoutHiddenNames(
      [
        candidate({ kind: 'favorite', id: 'v1', name: 'Granola' }),
        candidate({ kind: 'product', id: 'p1', name: 'Granola' }),
      ],
      ['granola'],
    );

    expect(kept.map((c) => c.id)).toEqual(['v1', 'p1']);
  });

  it('keeps everything when nothing is hidden', () => {
    const all = [candidate({ id: 'm1' }), candidate({ id: 'm2' })];

    expect(withoutHiddenNames(all, [])).toEqual(all);
  });
});

describe('standaloneOnly', () => {
  it('drops meal parts and saved foods only used inside meals', () => {
    const kept = standaloneOnly(
      [
        candidate({ kind: 'favorite', id: 'v1', name: 'Protein bar' }),
        candidate({ kind: 'meal', id: 'm1', name: 'Burger' }),
        candidate({ kind: 'food', id: 'f1', name: 'Table salt' }),
        candidate({ kind: 'product', id: 'p1', name: 'Heinz ketchup' }),
        candidate({ kind: 'product', id: 'p2', name: 'Khoury yogurt' }),
      ],
      new Set(['p1']),
    );

    expect(kept.map((c) => c.id)).toEqual(['v1', 'm1', 'p2']);
  });

  it('keeps saved foods that were never logged', () => {
    const kept = standaloneOnly(
      [candidate({ kind: 'product', id: 'p1', useCount: 0 })],
      new Set(),
    );

    expect(kept.map((c) => c.id)).toEqual(['p1']);
  });
});
