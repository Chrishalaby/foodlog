import { containsWordPrefix, type SearchText } from './food-text.js';

export const MATCH_TIERS = {
  exact: 5,
  prefix: 4,
  wordPrefix: 3,
  substring: 2,
  detail: 1,
} as const;

export type MatchTier = (typeof MATCH_TIERS)[keyof typeof MATCH_TIERS];

export interface MatchTarget {
  name: string;
  detail: string | null;
  aliases?: readonly string[];
}

function everyToken(
  tokens: readonly string[],
  test: (token: string) => boolean,
): boolean {
  return tokens.length > 0 && tokens.every(test);
}

export function matchTier(
  target: MatchTarget,
  query: SearchText,
): MatchTier | null {
  return [
    targetTier(target, query),
    ...(target.aliases ?? []).map((alias) =>
      targetTier({ name: alias, detail: null }, query),
    ),
  ].reduce<MatchTier | null>(
    (best, tier) =>
      tier !== null && (best === null || tier > best) ? tier : best,
    null,
  );
}

function targetTier(target: MatchTarget, query: SearchText): MatchTier | null {
  const { name, detail } = target;
  if (query.tokens.length === 0) {
    return null;
  }
  if (name === query.text) {
    return MATCH_TIERS.exact;
  }
  if (name.startsWith(query.text)) {
    return MATCH_TIERS.prefix;
  }
  if (everyToken(query.tokens, (token) => containsWordPrefix(name, token))) {
    return MATCH_TIERS.wordPrefix;
  }
  if (everyToken(query.tokens, (token) => name.includes(token))) {
    return MATCH_TIERS.substring;
  }
  if (
    detail !== null &&
    everyToken(
      query.tokens,
      (token) => name.includes(token) || detail.includes(token),
    )
  ) {
    return MATCH_TIERS.detail;
  }
  return null;
}
