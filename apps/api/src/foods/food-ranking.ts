import {
  compareDatesDesc,
  compareKinds,
  compareText,
  type LibraryGroup,
} from './food-library.js';
import { matchTier } from './food-match.js';
import type { SearchText } from './food-text.js';

export const RANKING = {
  frequencyWeight: 1,
  recencyWeight: 1.5,
  recencyHalfLifeDays: 14,
  starredBoost: 1,
  defaultWindowDays: 90,
} as const;

const DAY_MS = 86_400_000;

interface ScoredGroup {
  group: LibraryGroup;
  tier: number;
  score: number;
}

export function frequencyBoost(count: number): number {
  return RANKING.frequencyWeight * Math.log1p(Math.max(0, count));
}

export function recencyBoost(lastUsedAt: Date | null, now: Date): number {
  if (lastUsedAt === null) {
    return 0;
  }
  const ageDays = Math.max(0, (now.getTime() - lastUsedAt.getTime()) / DAY_MS);
  return RANKING.recencyWeight * 0.5 ** (ageDays / RANKING.recencyHalfLifeDays);
}

export function relevanceScore(group: LibraryGroup, now: Date): number {
  return (
    frequencyBoost(group.useCount) +
    recencyBoost(group.lastUsedAt, now) +
    (group.starred ? RANKING.starredBoost : 0)
  );
}

export function habitScore(group: LibraryGroup, now: Date): number {
  return (
    frequencyBoost(group.recentCount) + recencyBoost(group.lastUsedAt, now)
  );
}

export function defaultWindowStart(now: Date): Date {
  return new Date(now.getTime() - RANKING.defaultWindowDays * DAY_MS);
}

function compareIdentity(a: LibraryGroup, b: LibraryGroup): number {
  return (
    compareKinds(a.winner.kind, b.winner.kind) ||
    compareText(a.normalizedName, b.normalizedName) ||
    compareText(a.winner.id, b.winner.id)
  );
}

function compareScored(a: ScoredGroup, b: ScoredGroup): number {
  return (
    b.tier - a.tier ||
    b.score - a.score ||
    compareDatesDesc(a.group.lastUsedAt, b.group.lastUsedAt) ||
    compareIdentity(a.group, b.group)
  );
}

function compareFavorites(a: LibraryGroup, b: LibraryGroup): number {
  return (
    b.winner.useCount - a.winner.useCount ||
    compareDatesDesc(a.winner.lastUsedAt, b.winner.lastUsedAt) ||
    compareIdentity(a, b)
  );
}

export function rankForQuery(
  groups: readonly LibraryGroup[],
  query: SearchText,
  now: Date,
): LibraryGroup[] {
  return groups
    .flatMap((group): ScoredGroup[] => {
      const tier = matchTier(
        {
          name: group.normalizedName,
          detail: group.normalizedDetail,
          aliases: group.normalizedAliases,
        },
        query,
      );
      return tier === null
        ? []
        : [{ group, tier, score: relevanceScore(group, now) }];
    })
    .sort(compareScored)
    .map(({ group }) => group);
}

export function rankDefault(
  groups: readonly LibraryGroup[],
  now: Date,
): LibraryGroup[] {
  const since = defaultWindowStart(now).getTime();
  const favorites = groups
    .filter((group) => group.winner.kind === 'favorite')
    .sort(compareFavorites);
  const habits = groups
    .filter(
      (group) =>
        group.winner.kind !== 'favorite' &&
        group.lastUsedAt !== null &&
        group.lastUsedAt.getTime() >= since,
    )
    .map((group): ScoredGroup => ({
      group,
      tier: 0,
      score: habitScore(group, now),
    }))
    .sort(compareScored)
    .map(({ group }) => group);
  return [...favorites, ...habits];
}
