export const MAX_EXTRA_TOKENS = 2;

const COMBINING_MARKS = /\p{M}+/gu;
const WHITESPACE = /\s+/gu;
const UNDECOMPOSED_LETTERS = /[ßæœøłđðþı]/gu;
const SERVINGS_SUFFIX = /\s*×\s*\d+(?:[.,]\d+)?$/u;
const APOSTROPHES = /['’`´]/gu;
const NON_WORD = /[^\p{L}\p{N}]+/gu;
const LETTERS_ONLY = /^\p{L}+$/u;
const DIGIT = /\p{N}/u;
const MIN_SINGULAR_LENGTH = 4;
const ES_PLURAL_ENDINGS = ['ches', 'shes', 'sses', 'xes', 'zes', 'oes'];
const KEPT_S_ENDINGS = ['ss', 'us', 'is'];

const LETTER_FOLDS: Readonly<Record<string, string>> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

const SYNONYMS: Readonly<Record<string, string>> = {
  mayonnaise: 'mayo',
  mayonaise: 'mayo',
  catsup: 'ketchup',
  yoghurt: 'yogurt',
  yoghourt: 'yogurt',
  yogourt: 'yogurt',
  chilli: 'chili',
  chile: 'chili',
  doughnut: 'donut',
  aubergine: 'eggplant',
  courgette: 'zucchini',
  prawn: 'shrimp',
  coriander: 'cilantro',
  skimmed: 'skim',
  lite: 'light',
  fillet: 'filet',
  hamburger: 'burger',
  wholemeal: 'wholewheat',
};

const FILLER_WORDS: ReadonlySet<string> = new Set([
  'of',
  'with',
  'the',
  'a',
  'an',
  'and',
  'some',
  'fresh',
  'homemade',
  'regular',
  'plain',
  'original',
]);

const QUALIFIER_WORDS: ReadonlySet<string> = new Set([
  'light',
  'low',
  'reduced',
  'zero',
  'diet',
  'free',
  'skim',
  'whole',
  'full',
  'sugar',
  'protein',
  'vegan',
  'sweetened',
  'unsweetened',
  'salted',
  'unsalted',
  'yolk',
  'spicy',
]);

const STATE_WORDS: ReadonlySet<string> = new Set([
  'dry',
  'raw',
  'uncooked',
  'cooked',
  'boiled',
  'fried',
  'dried',
  'powder',
  'juice',
  'pickle',
  'pickled',
  'smoked',
]);

const BASE_FOODS: ReadonlySet<string> = new Set([
  'chicken',
  'beef',
  'turkey',
  'fish',
  'pork',
  'lamb',
  'mutton',
  'veal',
  'duck',
  'goat',
  'egg',
  'cheese',
  'salmon',
  'tuna',
  'shrimp',
  'cod',
  'ham',
  'bacon',
  'tofu',
  'milk',
  'yogurt',
  'ketchup',
  'mayo',
  'mustard',
  'garlic',
  'honey',
  'chocolate',
  'vanilla',
  'caramel',
  'strawberry',
  'banana',
  'coffee',
  'peanut',
  'almond',
]);

export interface MatchableFood {
  id: string;
  name: string;
  brand: string | null;
  aliases: readonly string[];
}

const candidateCache = new WeakMap<MatchableFood, readonly (readonly string[])[]>();

export function foldFoodText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(UNDECOMPOSED_LETTERS, (letter) => LETTER_FOLDS[letter] ?? letter)
    .replace(WHITESPACE, ' ')
    .trim();
}

function endsWithAny(word: string, endings: readonly string[]): boolean {
  return endings.some((ending) => word.endsWith(ending));
}

export function singularize(word: string): string {
  if (!LETTERS_ONLY.test(word) || word.length < MIN_SINGULAR_LENGTH) {
    return word;
  }
  if (word.endsWith('ies')) {
    return word.length > MIN_SINGULAR_LENGTH ? `${word.slice(0, -3)}y` : word.slice(0, -1);
  }
  if (word.endsWith('ie')) {
    return `${word.slice(0, -2)}y`;
  }
  if (endsWithAny(word, ES_PLURAL_ENDINGS)) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !endsWithAny(word, KEPT_S_ENDINGS)) {
    return word.slice(0, -1);
  }
  return word;
}

export function foodTokens(name: string): string[] {
  const folded = foldFoodText(name);
  const base = folded.replace(SERVINGS_SUFFIX, '').trimEnd() || folded;
  const tokens: string[] = [];
  for (const word of base.replace(APOSTROPHES, '').replace(NON_WORD, ' ').split(' ')) {
    if (!word) {
      continue;
    }
    const singular = singularize(word);
    const token = SYNONYMS[singular] ?? singular;
    if (!FILLER_WORDS.has(token) && !tokens.includes(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

export function normalizeFoodName(name: string): string {
  return foodTokens(name).join(' ');
}

function conflicting(token: string): boolean {
  return (
    DIGIT.test(token) ||
    QUALIFIER_WORDS.has(token) ||
    STATE_WORDS.has(token) ||
    BASE_FOODS.has(token)
  );
}

export function extraTokens(a: readonly string[], b: readonly string[]): string[] | null {
  const first = new Set(a);
  const second = new Set(b);
  const [small, large] = first.size <= second.size ? [first, second] : [second, first];
  if (small.size === 0) {
    return null;
  }
  for (const token of small) {
    if (!large.has(token)) {
      return null;
    }
  }
  return [...large].filter((token) => !small.has(token));
}

function compatibleExtra(a: readonly string[], b: readonly string[]): number | null {
  const extra = extraTokens(a, b);
  if (extra === null || extra.length > MAX_EXTRA_TOKENS) {
    return null;
  }
  return extra.some(conflicting) ? null : extra.length;
}

export function compatibleNames(a: string, b: string): boolean {
  return compatibleExtra(foodTokens(a), foodTokens(b)) !== null;
}

export function sameNormalizedName(a: string, b: string): boolean {
  const left = normalizeFoodName(a);
  return left.length > 0 && left === normalizeFoodName(b);
}

function candidateNames(food: MatchableFood): string[] {
  const brand = food.brand?.trim();
  return [food.name, ...(brand ? [`${brand} ${food.name}`] : []), ...food.aliases];
}

function candidateTokens(food: MatchableFood): readonly (readonly string[])[] {
  const cached = candidateCache.get(food);
  if (cached) {
    return cached;
  }
  const tokens = candidateNames(food)
    .map(foodTokens)
    .filter((list) => list.length > 0);
  candidateCache.set(food, tokens);
  return tokens;
}

export function exactSavedFood<T extends MatchableFood>(
  name: string,
  foods: readonly T[],
): T | null {
  const key = normalizeFoodName(name);
  if (!key) {
    return null;
  }
  return (
    foods.find((food) => candidateTokens(food).some((tokens) => tokens.join(' ') === key)) ?? null
  );
}

export function findSavedFood<T extends MatchableFood>(
  name: string,
  foods: readonly T[],
): T | null {
  const exact = exactSavedFood(name, foods);
  if (exact) {
    return exact;
  }
  const tokens = foodTokens(name);
  if (tokens.length === 0) {
    return null;
  }
  let best: { food: T; extra: number } | null = null;
  for (const food of foods) {
    for (const candidate of candidateTokens(food)) {
      const extra = compatibleExtra(tokens, candidate);
      if (extra !== null && (!best || extra < best.extra)) {
        best = { food, extra };
      }
    }
  }
  return best?.food ?? null;
}

export function searchSavedFoods<T extends MatchableFood>(foods: readonly T[], query: string): T[] {
  const tokens = foldFoodText(query)
    .split(' ')
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return [...foods];
  }
  return foods.filter((food) => {
    const haystack = foldFoodText([food.name, food.brand ?? '', ...food.aliases].join(' '));
    return tokens.every((token) => haystack.includes(token));
  });
}
