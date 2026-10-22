import { foldLinkedFoods } from './food-folding.js';
import type { LibraryCandidate } from './food-library.js';

const NOW = new Date('2026-09-28T12:00:00Z');
const DAY_MS = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

function candidate(overrides: Partial<LibraryCandidate>): LibraryCandidate {
  return {
    kind: 'food',
    id: 'f1',
    name: 'Tomato ketchup',
    detail: null,
    useCount: 1,
    recentCount: 1,
    lastUsedAt: daysAgo(5),
    ...overrides,
  };
}

describe('foldLinkedFoods', () => {
  const product = candidate({
    kind: 'product',
    id: 'p1',
    name: 'Heinz tomato ketchup',
    useCount: 2,
    recentCount: 0,
    lastUsedAt: daysAgo(30),
  });

  it('folds foods linked to a saved food into it and remembers the latest item', () => {
    const folded = foldLinkedFoods(
      [product],
      [
        candidate({
          id: 'f1',
          useCount: 3,
          recentCount: 3,
          linkedProductId: 'p1',
        }),
        candidate({
          id: 'f2',
          name: 'Ketchup packet',
          lastUsedAt: daysAgo(1),
          linkedProductId: 'p1',
        }),
        candidate({ id: 'f3', name: 'Mustard', linkedProductId: null }),
        candidate({ kind: 'meal', id: 'm1', linkedProductId: 'p1' }),
      ],
    );

    expect(folded.candidates.map(({ id }) => id)).toEqual(['p1', 'f3', 'm1']);
    expect(folded.candidates[0]).toMatchObject({
      kind: 'product',
      useCount: 4,
      recentCount: 4,
      lastUsedAt: daysAgo(1),
    });
    expect(folded.linkedItems).toEqual(new Map([['p1', 'f2']]));
  });

  it('keeps the usage of a saved food that is used more than its folded foods', () => {
    const folded = foldLinkedFoods(
      [{ ...product, useCount: 10, recentCount: 6, lastUsedAt: daysAgo(0) }],
      [candidate({ linkedProductId: 'p1' })],
    );

    expect(folded.candidates[0]).toMatchObject({
      useCount: 10,
      recentCount: 6,
      lastUsedAt: daysAgo(0),
    });
  });

  it('keeps foods linked to saved foods that are not in the library', () => {
    const folded = foldLinkedFoods(
      [],
      [candidate({ linkedProductId: 'gone' })],
    );

    expect(folded.candidates.map(({ id }) => id)).toEqual(['f1']);
    expect(folded.linkedItems.size).toBe(0);
  });
});
