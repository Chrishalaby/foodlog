import type { FoodSearchResponse, FoodSearchResult } from '@food/shared';
import { Injectable } from '@nestjs/common';
import type { FavoriteWithPhoto } from '../common/mappers.js';
import type { Product } from '../generated/prisma/client.js';
import { foldLinkedFoods } from './food-folding.js';
import {
  favoriteCandidate,
  FoodLibraryRepository,
  productCandidate,
} from './food-library.repository.js';
import {
  buildLibrary,
  type LibraryCandidate,
  standaloneOnly,
  withoutHiddenNames,
} from './food-library.js';
import {
  defaultWindowStart,
  rankDefault,
  rankForQuery,
} from './food-ranking.js';
import { toSearchResult } from './food-results.js';
import { searchText } from './food-text.js';
import {
  DEFAULT_FOOD_SEARCH_LIMIT,
  type FoodSearchQueryDto,
} from './foods.dto.js';

function idsOf(
  candidates: readonly LibraryCandidate[],
  kind: LibraryCandidate['kind'],
): string[] {
  return candidates
    .filter((candidate) => candidate.kind === kind)
    .map((candidate) => candidate.id);
}

function byId<T extends { id: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}

interface LoadedLibrary {
  favorites: readonly FavoriteWithPhoto[];
  products: readonly Product[];
  linkedItems: ReadonlyMap<string, string>;
}

interface LinkedItemRef {
  productId: string;
  itemId: string;
}

function productGrams(
  linked: readonly LinkedItemRef[],
  grams: ReadonlyMap<string, number>,
): Map<string, number> {
  return new Map(
    linked.flatMap(({ productId, itemId }) => {
      const value = grams.get(itemId);
      return value === undefined ? [] : [[productId, value] as const];
    }),
  );
}

@Injectable()
export class FoodSearchService {
  constructor(private readonly library: FoodLibraryRepository) {}

  async search(
    userId: string,
    query: FoodSearchQueryDto,
  ): Promise<FoodSearchResponse> {
    const q = query.q ?? '';
    const limit = query.limit ?? DEFAULT_FOOD_SEARCH_LIMIT;
    const now = new Date();
    const since = defaultWindowStart(now);
    const standalone = query.scope === 'standalone';
    const [favorites, products, meals, foods, hiddenNames, components] =
      await Promise.all([
        this.library.favorites(userId),
        this.library.products(userId),
        this.library.mealUsage(userId, since),
        this.library.foodUsage(userId, since),
        this.library.hiddenNames(userId),
        standalone
          ? this.library.componentProductIds(userId)
          : new Set<string>(),
      ]);
    const folded = foldLinkedFoods(
      products.map(productCandidate(since)),
      withoutHiddenNames([...meals, ...foods], hiddenNames),
    );
    const groups = buildLibrary([
      ...favorites.map(favoriteCandidate),
      ...(standalone
        ? standaloneOnly(folded.candidates, components)
        : folded.candidates),
    ]);
    const text = searchText(q);
    const ranked =
      text.tokens.length > 0
        ? rankForQuery(groups, text, now)
        : rankDefault(groups, now);
    const winners = ranked.slice(0, limit).map((group) => group.winner);
    return {
      query: q,
      results: await this.resolve(userId, winners, {
        favorites,
        products,
        linkedItems: folded.linkedItems,
      }),
    };
  }

  private async resolve(
    userId: string,
    winners: readonly LibraryCandidate[],
    loaded: LoadedLibrary,
  ): Promise<FoodSearchResult[]> {
    const linked = idsOf(winners, 'product').flatMap((productId) => {
      const itemId = loaded.linkedItems.get(productId);
      return itemId ? [{ productId, itemId }] : [];
    });
    const [meals, foods, grams] = await Promise.all([
      this.library.meals(userId, idsOf(winners, 'meal')),
      this.library.foods(userId, idsOf(winners, 'food')),
      this.library.itemGrams(
        userId,
        linked.map(({ itemId }) => itemId),
      ),
    ]);
    const rows = {
      favorites: byId(loaded.favorites),
      products: byId(loaded.products),
      meals: byId(meals),
      foods: byId(foods),
      productGrams: productGrams(linked, grams),
    };
    return winners.flatMap((candidate) => {
      const result = toSearchResult(candidate, rows);
      return result ? [result] : [];
    });
  }
}
