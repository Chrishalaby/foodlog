import { diffDays, type FoodResultKind, type FoodSearchResult } from '@food/shared';
import { localDateOf } from '../../core/time';
import { foldText, highlightParts, queryTokens, type TextPart } from '../../shared/utils/text-match';

export {
  foldText,
  foodNameKey,
  highlightParts,
  normalizeQuery,
  queryTokens,
  sameFoodName,
  type TextPart,
} from '../../shared/utils/text-match';

export interface ResultSections {
  starred: FoodSearchResult[];
  recent: FoodSearchResult[];
}

export type MatchQuality = 'none' | 'weak' | 'good';

const MINUTE_MS = 60_000;

export function timeAgo(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) {
    return null;
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return null;
  }
  const elapsed = Math.max(0, now.getTime() - then);
  if (elapsed < MINUTE_MS) {
    return 'just now';
  }
  if (elapsed < 60 * MINUTE_MS) {
    return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  }
  const days = Math.max(0, diffDays(localDateOf(new Date(then)), localDateOf(now)));
  if (days === 0) {
    return 'today';
  }
  if (days === 1) {
    return 'yesterday';
  }
  if (days < 14) {
    return `${days} days ago`;
  }
  if (days < 60) {
    return `${Math.floor(days / 7)} weeks ago`;
  }
  if (days < 365) {
    return `${Math.floor(days / 30)} months ago`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? 'a year ago' : `${years} years ago`;
}

function timesLabel(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  return count === 1 ? 'Logged once' : `Logged ${count}×`;
}

interface DetailSpan {
  text: string;
  matchable: boolean;
}

type DetailPiece = readonly DetailSpan[];

const DETAIL_SEPARATOR = ' · ';

function leadDetail(result: FoodSearchResult): string | null {
  return result.kind === 'product' || result.kind === 'meal' ? result.detail?.trim() || null : null;
}

function sourcePiece(result: FoodSearchResult): DetailPiece | null {
  if (result.kind === 'food' && result.detail) {
    return [
      { text: 'from ', matchable: false },
      { text: result.detail, matchable: true },
    ];
  }
  const times = timesLabel(result.useCount);
  return times ? [{ text: times, matchable: false }] : null;
}

function detailPieces(result: FoodSearchResult, now: Date): DetailPiece[] {
  const lead = leadDetail(result);
  const ago = timeAgo(result.lastUsedAt, now);
  return [
    lead ? [{ text: lead, matchable: true }] : null,
    sourcePiece(result),
    ago ? [{ text: ago, matchable: false }] : null,
  ].filter((piece): piece is DetailPiece => piece !== null);
}

export function resultDetail(result: FoodSearchResult, now: Date = new Date()): string {
  const text = detailPieces(result, now)
    .map((piece) => piece.map((span) => span.text).join(''))
    .join(DETAIL_SEPARATOR);
  return text || KIND_FALLBACK[result.kind];
}

function appendPart(parts: TextPart[], part: TextPart): void {
  const last = parts[parts.length - 1];
  if (last && last.match === part.match) {
    last.text += part.text;
  } else if (part.text.length > 0) {
    parts.push({ ...part });
  }
}

export function resultDetailParts(
  result: FoodSearchResult,
  query: string,
  now: Date = new Date(),
): TextPart[] {
  const pieces = detailPieces(result, now);
  if (pieces.length === 0) {
    return [{ text: KIND_FALLBACK[result.kind], match: false }];
  }
  const parts: TextPart[] = [];
  pieces.forEach((piece, index) => {
    if (index > 0) {
      appendPart(parts, { text: DETAIL_SEPARATOR, match: false });
    }
    for (const span of piece) {
      const spanParts = span.matchable
        ? highlightParts(span.text, query)
        : [{ text: span.text, match: false }];
      spanParts.forEach((part) => appendPart(parts, part));
    }
  });
  return parts;
}

const KIND_FALLBACK: Record<FoodResultKind, string> = {
  favorite: 'Starred',
  meal: 'Meal',
  food: 'Food',
  product: 'Product',
};

export function splitSections(results: readonly FoodSearchResult[]): ResultSections {
  return {
    starred: results.filter((result) => result.starred),
    recent: results.filter((result) => !result.starred),
  };
}

function wordPrefixMatch(name: string, token: string): boolean {
  return foldText(name)
    .split(/[^\p{L}\p{N}]+/u)
    .some((word) => word.startsWith(token));
}

export function matchQuality(results: readonly FoodSearchResult[], query: string): MatchQuality {
  if (results.length === 0) {
    return 'none';
  }
  const tokens = queryTokens(query);
  if (tokens.length === 0) {
    return 'good';
  }
  const strong = results.some((result) => {
    const detail = leadDetail(result);
    return tokens.every(
      (token) =>
        wordPrefixMatch(result.name, token) || (detail !== null && wordPrefixMatch(detail, token)),
    );
  });
  return strong ? 'good' : 'weak';
}
