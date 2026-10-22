import { normalizeCatalogText } from '@food/shared';

export const CATALOG_TOKENS_MAX = 8;
export const CATALOG_FUZZY_THRESHOLD = 0.45;
export const CATALOG_SHORT_FUZZY_THRESHOLD = 0.7;
const SHORT_QUERY_LENGTH = 4;

export const CATALOG_SYNONYMS: Readonly<Record<string, string>> = {
  aubergine: 'eggplant',
  capsicum: 'pepper',
  coke: 'cola',
  coriander: 'cilantro',
  courgette: 'zucchini',
  crisps: 'potato chips',
  maize: 'corn',
  mince: 'ground',
  minced: 'ground',
  porridge: 'oatmeal',
  prawn: 'shrimp',
  prawns: 'shrimp',
  rocket: 'arugula',
  soda: 'soft drink',
  yoghurt: 'yogurt',
};
export const DEFAULT_CATALOG_LIMIT = 20;

export const CATALOG_PLAIN_WORDS = [
  'a',
  'added',
  'all',
  'and',
  'as',
  'baked',
  'boiled',
  'brewed',
  'broiled',
  'commercially',
  'cooked',
  'drained',
  'eaten',
  'enriched',
  'fish',
  'fresh',
  'from',
  'grilled',
  'home',
  'in',
  'made',
  'meat',
  'nfs',
  'no',
  'not',
  'ns',
  'of',
  'only',
  'or',
  'plain',
  'prepared',
  'raw',
  'ready',
  'regular',
  'roasted',
  'salt',
  'skin',
  'steamed',
  'the',
  'to',
  'type',
  'types',
  'unenriched',
  'whole',
  'with',
  'without',
] as const;

export interface CatalogQueryPlan {
  normalized: string;
  fuzzyThreshold: number;
  tokens: string[];
  containsPatterns: string[];
  wordPatterns: string[];
  firstWordsPattern: string;
  prefixPattern: string;
}

export function planCatalogQuery(query: string | undefined): CatalogQueryPlan | null {
  const normalized = normalizeCatalogText(query ?? '')
    .split(' ')
    .map((word) => CATALOG_SYNONYMS[word] ?? word)
    .join(' ');
  if (normalized === '') {
    return null;
  }
  const tokens = [...new Set(normalized.split(' '))].slice(0, CATALOG_TOKENS_MAX);
  return {
    normalized,
    fuzzyThreshold:
      normalized.length <= SHORT_QUERY_LENGTH ? CATALOG_SHORT_FUZZY_THRESHOLD : CATALOG_FUZZY_THRESHOLD,
    tokens,
    containsPatterns: tokens.map((token) => `%${token}%`),
    wordPatterns: tokens.map((token) => `\\m${token}\\M`),
    firstWordsPattern: `${normalized} %`,
    prefixPattern: `${normalized}%`,
  };
}
