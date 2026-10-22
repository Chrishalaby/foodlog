import type { FoodResultKind } from '@food/shared';
import { foldText, normalizeFoodName } from './food-text.js';

export interface LibraryCandidate {
  kind: FoodResultKind;
  id: string;
  name: string;
  detail: string | null;
  useCount: number;
  recentCount: number;
  lastUsedAt: Date | null;
  aliases?: readonly string[];
  linkedProductId?: string | null;
}

export interface LibraryGroup {
  normalizedName: string;
  normalizedDetail: string | null;
  normalizedAliases: string[];
  winner: LibraryCandidate;
  useCount: number;
  recentCount: number;
  lastUsedAt: Date | null;
  starred: boolean;
}

const KIND_PRECEDENCE: Record<FoodResultKind, number> = {
  favorite: 0,
  product: 1,
  meal: 2,
  food: 3,
};

const LOGGED_KINDS = ['meal', 'food'] as const satisfies FoodResultKind[];

function isLoggedKind(kind: FoodResultKind): boolean {
  return (LOGGED_KINDS as readonly FoodResultKind[]).includes(kind);
}

export function withoutHiddenNames(
  candidates: readonly LibraryCandidate[],
  hiddenNames: readonly string[],
): LibraryCandidate[] {
  const hidden = new Set(hiddenNames);
  return candidates.filter(
    (candidate) =>
      !isLoggedKind(candidate.kind) ||
      !hidden.has(normalizeFoodName(candidate.name)),
  );
}

export function standaloneOnly(
  candidates: readonly LibraryCandidate[],
  componentProductIds: ReadonlySet<string>,
): LibraryCandidate[] {
  return candidates.filter(
    (candidate) =>
      candidate.kind !== 'food' &&
      (candidate.kind !== 'product' || !componentProductIds.has(candidate.id)),
  );
}

export function compareKinds(a: FoodResultKind, b: FoodResultKind): number {
  return KIND_PRECEDENCE[a] - KIND_PRECEDENCE[b];
}

export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function timeOf(date: Date | null): number {
  return date === null ? Number.NEGATIVE_INFINITY : date.getTime();
}

export function compareDatesDesc(a: Date | null, b: Date | null): number {
  const left = timeOf(a);
  const right = timeOf(b);
  return left > right ? -1 : left < right ? 1 : 0;
}

export function latestDate(dates: readonly (Date | null)[]): Date | null {
  return dates.reduce<Date | null>(
    (latest, date) => (compareDatesDesc(date, latest) < 0 ? date : latest),
    null,
  );
}

function compareRecency(a: LibraryCandidate, b: LibraryCandidate): number {
  return (
    compareDatesDesc(a.lastUsedAt, b.lastUsedAt) || compareText(b.id, a.id)
  );
}

function comparePrecedence(a: LibraryCandidate, b: LibraryCandidate): number {
  return (
    compareKinds(a.kind, b.kind) ||
    b.useCount - a.useCount ||
    compareRecency(a, b)
  );
}

function mergeUsage(
  a: LibraryCandidate,
  b: LibraryCandidate,
): LibraryCandidate {
  const latest = compareRecency(a, b) <= 0 ? a : b;
  return {
    ...latest,
    useCount: a.useCount + b.useCount,
    recentCount: a.recentCount + b.recentCount,
    lastUsedAt: latestDate([a.lastUsedAt, b.lastUsedAt]),
  };
}

export function mergeSameKind(
  members: readonly LibraryCandidate[],
): LibraryCandidate[] {
  const distinct = members.filter((member) => !isLoggedKind(member.kind));
  const merged = LOGGED_KINDS.flatMap((kind) => {
    const ofKind = members.filter((member) => member.kind === kind);
    const [first, ...rest] = ofKind;
    return first === undefined ? [] : [rest.reduce(mergeUsage, first)];
  });
  return [...distinct, ...merged];
}

function toGroup(
  normalizedName: string,
  members: readonly LibraryCandidate[],
): LibraryGroup | null {
  const ranked = mergeSameKind(members).sort(comparePrecedence);
  const [winner] = ranked;
  if (winner === undefined) {
    return null;
  }
  const detail =
    winner.detail ??
    ranked.find((member) => member.kind !== 'food' && member.detail !== null)
      ?.detail ??
    null;
  return {
    normalizedName,
    normalizedDetail: detail === null ? null : foldText(detail),
    normalizedAliases: [
      ...new Set(
        ranked.flatMap((member) => (member.aliases ?? []).map(foldText)),
      ),
    ].filter((alias) => alias !== '' && alias !== normalizedName),
    winner,
    useCount: Math.max(...ranked.map((member) => member.useCount)),
    recentCount: Math.max(...ranked.map((member) => member.recentCount)),
    lastUsedAt: latestDate(ranked.map((member) => member.lastUsedAt)),
    starred: ranked.some((member) => member.kind === 'favorite'),
  };
}

export function buildLibrary(
  candidates: readonly LibraryCandidate[],
): LibraryGroup[] {
  const byName = new Map<string, LibraryCandidate[]>();
  for (const candidate of candidates) {
    const name = normalizeFoodName(candidate.name);
    const members = byName.get(name);
    if (members) {
      members.push(candidate);
    } else {
      byName.set(name, [candidate]);
    }
  }
  return [...byName].flatMap(([name, members]) => {
    const group = toGroup(name, members);
    return group ? [group] : [];
  });
}
