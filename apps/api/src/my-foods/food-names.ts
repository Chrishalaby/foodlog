import { normalizeFoodName } from '../foods/food-text.js';

export const MAX_EXTRA_TOKENS = 2;

const APOSTROPHES = /['’`´]/gu;
const NON_WORD = /[^\p{L}\p{N}]+/gu;
const HEAD_SEPARATOR = /[,(;]/u;
const PARTICIPLE = /^\p{L}{3,}ed$/u;
const PARTICIPLE_LOOKALIKES = ['eed', 'bread'];
const LETTERS_ONLY = /^\p{L}+$/u;
const DIGIT = /\p{N}/u;
const MIN_SINGULAR_LENGTH = 4;
const ES_PLURAL_ENDINGS = ['ches', 'shes', 'sses', 'xes', 'zes', 'oes'];
const KEPT_S_ENDINGS = ['ss', 'us', 'is'];

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
  'butter',
  'cream',
  'oat',
  'soy',
  'coconut',
  'rice',
  'bread',
  'pasta',
  'water',
]);

const MEASURE_WORDS: ReadonlySet<string> = new Set([
  'g',
  'gr',
  'gram',
  'kg',
  'ml',
  'l',
  'oz',
  'lb',
  'slice',
  'piece',
  'packet',
  'sachet',
  'bottle',
  'can',
  'cup',
  'glass',
  'serving',
  'portion',
  'pack',
  'box',
  'bowl',
  'plate',
  'scoop',
  'spoon',
  'tablespoon',
  'teaspoon',
  'tbsp',
  'tsp',
  'handful',
  'squeeze',
  'jar',
  'tub',
  'carton',
  'bag',
  'pouch',
  'wedge',
  'cube',
]);

export interface FoodName {
  key: string;
  tokens: ReadonlySet<string>;
  head: string | null;
}

function endsWithAny(word: string, endings: readonly string[]): boolean {
  return endings.some((ending) => word.endsWith(ending));
}

export function singularize(word: string): string {
  if (!LETTERS_ONLY.test(word) || word.length < MIN_SINGULAR_LENGTH) {
    return word;
  }
  if (word.endsWith('ies')) {
    return word.length > MIN_SINGULAR_LENGTH
      ? `${word.slice(0, -3)}y`
      : word.slice(0, -1);
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

function normalizeToken(word: string): string | null {
  const singular = singularize(word);
  const token = SYNONYMS[singular] ?? singular;
  return FILLER_WORDS.has(token) ? null : token;
}

function textTokens(text: string): string[] {
  const words = text
    .replace(APOSTROPHES, '')
    .replace(NON_WORD, ' ')
    .split(' ')
    .filter(Boolean);
  const tokens: string[] = [];
  for (const word of words) {
    const token = normalizeToken(word);
    if (token !== null && !tokens.includes(token)) {
      tokens.push(token);
    }
  }
  return tokens;
}

export function foodNameTokens(name: string): string[] {
  return textTokens(normalizeFoodName(name));
}

function isDescriptor(token: string): boolean {
  return (
    MEASURE_WORDS.has(token) ||
    DIGIT.test(token) ||
    (PARTICIPLE.test(token) &&
      !PARTICIPLE_LOOKALIKES.some((ending) => token.endsWith(ending)))
  );
}

function lastFoodToken(tokens: readonly string[]): string | null {
  const food = [...tokens].reverse().find((token) => !isDescriptor(token));
  return food ?? tokens.at(-1) ?? null;
}

export function headToken(
  name: string,
  tokens: readonly string[] = foodNameTokens(name),
): string | null {
  const [lead = ''] = normalizeFoodName(name).split(HEAD_SEPARATOR);
  const leadTokens = textTokens(lead);
  return lastFoodToken(leadTokens.length > 0 ? leadTokens : tokens);
}

export function normalizeFoodKey(name: string): string {
  return foodNameTokens(name).join(' ');
}

export function toFoodName(name: string): FoodName {
  const tokens = foodNameTokens(name);
  return {
    key: tokens.join(' '),
    tokens: new Set(tokens),
    head: headToken(name, tokens),
  };
}

export function foodNameSignature(tokens: ReadonlySet<string>): string {
  return [...tokens].sort().join(' ');
}

export function sameFoodName(a: string, b: string): boolean {
  const key = normalizeFoodKey(a);
  return key !== '' && key === normalizeFoodKey(b);
}

function namesBaseFood(tokens: ReadonlySet<string>): boolean {
  return [...tokens].some((token) => BASE_FOODS.has(token));
}

export function isConflictingToken(
  token: string,
  other: ReadonlySet<string>,
): boolean {
  return (
    DIGIT.test(token) ||
    QUALIFIER_WORDS.has(token) ||
    STATE_WORDS.has(token) ||
    (BASE_FOODS.has(token) && namesBaseFood(other))
  );
}

export function extraTokens(
  small: ReadonlySet<string>,
  large: ReadonlySet<string>,
): string[] | null {
  for (const token of small) {
    if (!large.has(token)) {
      return null;
    }
  }
  return [...large].filter((token) => !small.has(token));
}

export function containedExtraTokens(
  a: FoodName,
  b: FoodName,
): string[] | null {
  if (a.tokens.size === 0 || b.tokens.size === 0) {
    return null;
  }
  const [small, large] = a.tokens.size <= b.tokens.size ? [a, b] : [b, a];
  const extra = extraTokens(small.tokens, large.tokens);
  if (
    extra === null ||
    extra.length > MAX_EXTRA_TOKENS ||
    (large.head !== null && extra.includes(large.head))
  ) {
    return null;
  }
  return extra.some((token) => isConflictingToken(token, small.tokens))
    ? null
    : extra;
}

export function areComparableFoodNames(a: FoodName, b: FoodName): boolean {
  return containedExtraTokens(a, b) !== null;
}

export function areComparableNames(a: string, b: string): boolean {
  return areComparableFoodNames(toFoodName(a), toFoodName(b));
}
