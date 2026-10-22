import {
  compareDatesDesc,
  latestDate,
  type LibraryCandidate,
} from './food-library.js';

export interface FoldedLibrary {
  candidates: LibraryCandidate[];
  linkedItems: Map<string, string>;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function withFoldedUsage(
  product: LibraryCandidate,
  foods: readonly LibraryCandidate[],
): LibraryCandidate {
  return {
    ...product,
    useCount: Math.max(
      product.useCount,
      sum(foods.map((food) => food.useCount)),
    ),
    recentCount: Math.max(
      product.recentCount,
      sum(foods.map((food) => food.recentCount)),
    ),
    lastUsedAt: latestDate([
      product.lastUsedAt,
      ...foods.map((food) => food.lastUsedAt),
    ]),
  };
}

function latestFood(
  foods: readonly LibraryCandidate[],
): LibraryCandidate | null {
  const [latest] = [...foods].sort((a, b) =>
    compareDatesDesc(a.lastUsedAt, b.lastUsedAt),
  );
  return latest ?? null;
}

export function foldLinkedFoods(
  products: readonly LibraryCandidate[],
  others: readonly LibraryCandidate[],
): FoldedLibrary {
  const productIds = new Set(products.map((product) => product.id));
  const folded = new Map<string, LibraryCandidate[]>();
  const kept: LibraryCandidate[] = [];
  for (const candidate of others) {
    const productId = candidate.linkedProductId;
    if (candidate.kind !== 'food' || !productId || !productIds.has(productId)) {
      kept.push(candidate);
      continue;
    }
    folded.set(productId, [...(folded.get(productId) ?? []), candidate]);
  }
  const linkedItems = new Map<string, string>();
  for (const [productId, foods] of folded) {
    const latest = latestFood(foods);
    if (latest) {
      linkedItems.set(productId, latest.id);
    }
  }
  return {
    candidates: [
      ...products.map((product) => {
        const foods = folded.get(product.id);
        return foods ? withFoldedUsage(product, foods) : product;
      }),
      ...kept,
    ],
    linkedItems,
  };
}
