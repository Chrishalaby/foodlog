import {
  CATALOG_FUZZY_THRESHOLD,
  CATALOG_SHORT_FUZZY_THRESHOLD,
  CATALOG_TOKENS_MAX,
  planCatalogQuery,
} from './catalog-search.js';

describe('planCatalogQuery', () => {
  it('returns no plan for an empty or punctuation-only query', () => {
    expect(planCatalogQuery(undefined)).toBeNull();
    expect(planCatalogQuery('   ')).toBeNull();
    expect(planCatalogQuery('%_*')).toBeNull();
  });

  it('normalizes the query into safe word and substring patterns', () => {
    expect(planCatalogQuery('  Chicken BREAST, roasted ')).toEqual({
      normalized: 'chicken breast roasted',
      fuzzyThreshold: CATALOG_FUZZY_THRESHOLD,
      tokens: ['chicken', 'breast', 'roasted'],
      containsPatterns: ['%chicken%', '%breast%', '%roasted%'],
      wordPatterns: ['\\mchicken\\M', '\\mbreast\\M', '\\mroasted\\M'],
      firstWordsPattern: 'chicken breast roasted %',
      prefixPattern: 'chicken breast roasted%',
    });
  });

  it('strips characters that would act as wildcards', () => {
    const plan = planCatalogQuery('100% juice_drink');
    expect(plan?.tokens).toEqual(['100', 'juice', 'drink']);
    expect(plan?.containsPatterns.join('')).not.toMatch(/_/);
  });

  it('maps common synonyms to the words the database uses', () => {
    expect(planCatalogQuery('Coke')?.normalized).toBe('cola');
    expect(planCatalogQuery('prawns curry')?.tokens).toEqual(['shrimp', 'curry']);
    expect(planCatalogQuery('soda')?.tokens).toEqual(['soft', 'drink']);
  });

  it('is stricter about typos in very short queries', () => {
    expect(planCatalogQuery('milc')?.fuzzyThreshold).toBe(CATALOG_SHORT_FUZZY_THRESHOLD);
    expect(planCatalogQuery('bananna')?.fuzzyThreshold).toBe(CATALOG_FUZZY_THRESHOLD);
  });

  it('dedupes words and caps how many are used', () => {
    expect(planCatalogQuery('egg egg EGG')?.tokens).toEqual(['egg']);
    const many = Array.from({ length: 12 }, (_, index) => `w${index}`).join(' ');
    expect(planCatalogQuery(many)?.tokens).toHaveLength(CATALOG_TOKENS_MAX);
  });
});
