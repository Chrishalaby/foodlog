import { buildLibrary, type LibraryCandidate } from './food-library.js';
import {
  defaultWindowStart,
  frequencyBoost,
  RANKING,
  rankDefault,
  rankForQuery,
  recencyBoost,
} from './food-ranking.js';
import { searchText } from './food-text.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const DAY_MS = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

let sequence = 0;

function candidate(overrides: Partial<LibraryCandidate>): LibraryCandidate {
  sequence += 1;
  return {
    kind: 'meal',
    id: `id-${String(sequence).padStart(4, '0')}`,
    name: 'Yogurt',
    detail: null,
    useCount: 1,
    recentCount: 1,
    lastUsedAt: daysAgo(10),
    ...overrides,
  };
}

function names(
  candidates: LibraryCandidate[],
  rank: (
    groups: ReturnType<typeof buildLibrary>,
  ) => ReturnType<typeof buildLibrary>,
): string[] {
  return rank(buildLibrary(candidates)).map((group) => group.winner.name);
}

describe('score components', () => {
  it('grows logarithmically with use', () => {
    expect(frequencyBoost(0)).toBe(0);
    expect(frequencyBoost(1)).toBeCloseTo(Math.log(2));
    expect(frequencyBoost(100) - frequencyBoost(10)).toBeLessThan(
      frequencyBoost(10) - frequencyBoost(0),
    );
    expect(frequencyBoost(-3)).toBe(0);
  });

  it('halves the recency boost every half-life and ignores unknown dates', () => {
    expect(recencyBoost(NOW, NOW)).toBe(RANKING.recencyWeight);
    expect(recencyBoost(daysAgo(RANKING.recencyHalfLifeDays), NOW)).toBeCloseTo(
      RANKING.recencyWeight / 2,
    );
    expect(recencyBoost(new Date(NOW.getTime() + DAY_MS), NOW)).toBe(
      RANKING.recencyWeight,
    );
    expect(recencyBoost(null, NOW)).toBe(0);
  });

  it('opens the default window 90 days back', () => {
    expect(defaultWindowStart(NOW)).toEqual(daysAgo(RANKING.defaultWindowDays));
  });
});

describe('rankForQuery', () => {
  const rank = (query: string) => (groups: ReturnType<typeof buildLibrary>) =>
    rankForQuery(groups, searchText(query), NOW);

  it('ranks by match tier before usage', () => {
    const ranked = names(
      [
        candidate({ name: 'Soyogurt', useCount: 90, lastUsedAt: daysAgo(0) }),
        candidate({
          name: 'Greek yogurt',
          useCount: 40,
          lastUsedAt: daysAgo(1),
        }),
        candidate({
          name: 'Yogurt parfait',
          useCount: 5,
          lastUsedAt: daysAgo(2),
        }),
        candidate({ name: 'Yogurt', useCount: 1, lastUsedAt: daysAgo(80) }),
        candidate({
          kind: 'food',
          name: 'Granola',
          detail: 'Yogurt bowl',
          useCount: 99,
          lastUsedAt: daysAgo(0),
        }),
        candidate({ name: 'Granola', useCount: 99 }),
      ],
      rank('yogurt'),
    );

    expect(ranked).toEqual([
      'Yogurt',
      'Yogurt parfait',
      'Greek yogurt',
      'Soyogurt',
    ]);
  });

  it('matches foods through their detail after all name matches', () => {
    const ranked = names(
      [
        candidate({
          kind: 'food',
          name: 'Khoury strawberry yogurt',
          detail: 'Breakfast bowl',
          useCount: 20,
        }),
        candidate({ name: 'Breakfast bowl', useCount: 1 }),
        candidate({ name: 'Big breakfast', useCount: 1 }),
      ],
      rank('breakfast'),
    );

    expect(ranked).toEqual([
      'Breakfast bowl',
      'Big breakfast',
      'Khoury strawberry yogurt',
    ]);
  });

  it('matches a meal through the name of its single item after all name matches', () => {
    const ranked = names(
      [
        candidate({
          name: 'Strawberry yogurt cup',
          detail: 'Khoury strawberry yogurt',
          useCount: 30,
        }),
        candidate({ name: 'Khoury labneh', useCount: 1 }),
        candidate({ name: 'Plain yogurt', useCount: 1 }),
      ],
      rank('khoury'),
    );

    expect(ranked).toEqual(['Khoury labneh', 'Strawberry yogurt cup']);
  });

  it('orders equal tiers by frequency, then recency, then starred', () => {
    expect(
      names(
        [
          candidate({ name: 'Oat bar', useCount: 1, lastUsedAt: daysAgo(1) }),
          candidate({ name: 'Oat milk', useCount: 30, lastUsedAt: daysAgo(5) }),
        ],
        rank('oat'),
      ),
    ).toEqual(['Oat milk', 'Oat bar']);

    expect(
      names(
        [
          candidate({ name: 'Oat bar', useCount: 3, lastUsedAt: daysAgo(40) }),
          candidate({ name: 'Oat milk', useCount: 3, lastUsedAt: daysAgo(2) }),
        ],
        rank('oat'),
      ),
    ).toEqual(['Oat milk', 'Oat bar']);

    expect(
      names(
        [
          candidate({ name: 'Oat bar', useCount: 3, lastUsedAt: daysAgo(2) }),
          candidate({
            kind: 'favorite',
            name: 'Oat milk',
            useCount: 3,
            lastUsedAt: daysAgo(2),
          }),
        ],
        rank('oat'),
      ),
    ).toEqual(['Oat milk', 'Oat bar']);
  });

  it('uses the combined usage of deduplicated names', () => {
    const ranked = rankForQuery(
      buildLibrary([
        candidate({ name: 'Yogurt bowl', useCount: 3, lastUsedAt: daysAgo(3) }),
        candidate({ name: 'Yogurt cup', useCount: 1, lastUsedAt: daysAgo(3) }),
        candidate({
          kind: 'food',
          name: 'yogurt cup',
          detail: 'Breakfast',
          useCount: 12,
          lastUsedAt: daysAgo(3),
        }),
      ]),
      searchText('yog'),
      NOW,
    );

    expect(ranked.map((g) => [g.winner.kind, g.winner.name])).toEqual([
      ['meal', 'Yogurt cup'],
      ['meal', 'Yogurt bowl'],
    ]);
  });

  it('breaks full ties deterministically by name', () => {
    const lastUsedAt = daysAgo(3);
    expect(
      names(
        [
          candidate({ name: 'Tea b', lastUsedAt }),
          candidate({ name: 'Tea a', lastUsedAt }),
        ],
        rank('tea'),
      ),
    ).toEqual(['Tea a', 'Tea b']);
  });
});

describe('rankDefault', () => {
  const rank = (groups: ReturnType<typeof buildLibrary>) =>
    rankDefault(groups, NOW);

  it('lists favorites by use first, then frequent and recent meals and foods of the last 90 days', () => {
    const ranked = names(
      [
        candidate({ name: 'Frequent', recentCount: 6, lastUsedAt: daysAgo(3) }),
        candidate({ name: 'Recent', recentCount: 1, lastUsedAt: daysAgo(0) }),
        candidate({
          name: 'Ancient',
          recentCount: 0,
          useCount: 50,
          lastUsedAt: daysAgo(91),
        }),
        candidate({
          kind: 'food',
          name: 'Banana',
          detail: 'Snack',
          recentCount: 2,
          lastUsedAt: daysAgo(20),
        }),
        candidate({
          kind: 'favorite',
          name: 'Rarely starred',
          useCount: 1,
          recentCount: 0,
          lastUsedAt: daysAgo(200),
        }),
        candidate({
          kind: 'favorite',
          name: 'Never used star',
          useCount: 0,
          recentCount: 0,
          lastUsedAt: null,
        }),
        candidate({
          kind: 'favorite',
          name: 'Popular star',
          useCount: 9,
          recentCount: 0,
          lastUsedAt: daysAgo(4),
        }),
      ],
      rank,
    );

    expect(ranked).toEqual([
      'Popular star',
      'Rarely starred',
      'Never used star',
      'Frequent',
      'Recent',
      'Banana',
    ]);
  });

  it('lists a meal before the foods logged inside it', () => {
    const lastUsedAt = daysAgo(1);
    const ranked = rankDefault(
      buildLibrary([
        candidate({
          kind: 'food',
          name: 'Asparagus',
          detail: 'Salmon plate',
          lastUsedAt,
        }),
        candidate({ name: 'Salmon plate', lastUsedAt }),
        candidate({
          kind: 'food',
          name: 'Salmon',
          detail: 'Salmon plate',
          lastUsedAt,
        }),
      ]),
      NOW,
    );

    expect(ranked.map((g) => [g.winner.kind, g.winner.name])).toEqual([
      ['meal', 'Salmon plate'],
      ['food', 'Asparagus'],
      ['food', 'Salmon'],
    ]);
  });

  it('includes items exactly at the window start', () => {
    expect(
      names(
        [candidate({ name: 'Edge', lastUsedAt: defaultWindowStart(NOW) })],
        rank,
      ),
    ).toEqual(['Edge']);
  });
});
