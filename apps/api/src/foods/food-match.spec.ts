import { MATCH_TIERS, type MatchTarget, matchTier } from './food-match.js';
import { searchText } from './food-text.js';

function target(name: string, detail: string | null = null): MatchTarget {
  return { name, detail };
}

describe('matchTier', () => {
  it('ranks exact, prefix, word prefix and substring matches', () => {
    const query = searchText('yogurt');
    expect(matchTier(target('yogurt'), query)).toBe(MATCH_TIERS.exact);
    expect(matchTier(target('yogurt parfait'), query)).toBe(MATCH_TIERS.prefix);
    expect(matchTier(target('greek yogurt'), query)).toBe(
      MATCH_TIERS.wordPrefix,
    );
    expect(matchTier(target('soyogurt'), query)).toBe(MATCH_TIERS.substring);
    expect(matchTier(target('granola'), query)).toBeNull();
  });

  it('orders the tiers from exact to detail', () => {
    expect(MATCH_TIERS.exact).toBeGreaterThan(MATCH_TIERS.prefix);
    expect(MATCH_TIERS.prefix).toBeGreaterThan(MATCH_TIERS.wordPrefix);
    expect(MATCH_TIERS.wordPrefix).toBeGreaterThan(MATCH_TIERS.substring);
    expect(MATCH_TIERS.substring).toBeGreaterThan(MATCH_TIERS.detail);
  });

  it('treats a multi-word query as a prefix only when it starts the name', () => {
    expect(
      matchTier(target('strawberry yogurt'), searchText('strawberry yog')),
    ).toBe(MATCH_TIERS.prefix);
    expect(
      matchTier(target('strawberry yogurt'), searchText('yog straw')),
    ).toBe(MATCH_TIERS.wordPrefix);
  });

  it('requires every token to match', () => {
    const name = target('khoury strawberry yogurt');
    expect(matchTier(name, searchText('straw yog'))).toBe(
      MATCH_TIERS.wordPrefix,
    );
    expect(matchTier(name, searchText('berry gurt'))).toBe(
      MATCH_TIERS.substring,
    );
    expect(matchTier(name, searchText('straw banana'))).toBeNull();
  });

  it('falls back to the detail when a token only matches there', () => {
    const food = target('khoury strawberry yogurt', 'breakfast bowl');
    expect(matchTier(food, searchText('breakfast'))).toBe(MATCH_TIERS.detail);
    expect(matchTier(food, searchText('bowl yogurt'))).toBe(MATCH_TIERS.detail);
    expect(matchTier(food, searchText('bowl banana'))).toBeNull();
    expect(matchTier(food, searchText('yogurt'))).toBe(MATCH_TIERS.wordPrefix);
  });

  it('never matches an empty query', () => {
    expect(matchTier(target('yogurt'), searchText(''))).toBeNull();
  });
});
