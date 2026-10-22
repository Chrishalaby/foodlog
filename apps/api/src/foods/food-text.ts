const COMBINING_MARKS = /\p{M}+/gu;
const WHITESPACE = /\s+/gu;
const UNDECOMPOSED_LETTERS = /[ßæœøłđðþı]/gu;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const SERVINGS_SUFFIX = /\s*×\s*(\d+(?:[.,]\d+)?)$/u;

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

export interface ServingsSuffixSplit {
  base: string;
  suffix: string;
}

export interface SearchText {
  text: string;
  tokens: string[];
}

export function foldText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(UNDECOMPOSED_LETTERS, (letter) => LETTER_FOLDS[letter] ?? letter)
    .replace(WHITESPACE, ' ')
    .trim();
}

export function normalizeFoodName(name: string): string {
  const folded = foldText(name);
  const withoutServings = folded.replace(SERVINGS_SUFFIX, '').trimEnd();
  return withoutServings === '' ? folded : withoutServings;
}

export function splitServingsSuffix(name: string): ServingsSuffixSplit {
  const trimmed = name.trim();
  const match = SERVINGS_SUFFIX.exec(trimmed);
  const base = match ? trimmed.slice(0, match.index).trimEnd() : '';
  if (!match || base === '') {
    return { base: trimmed, suffix: '' };
  }
  return { base, suffix: ` ×${match[1]}` };
}

export function distinctDetail(
  name: string,
  detail: string | null,
): string | null {
  return detail === null ||
    normalizeFoodName(detail) === normalizeFoodName(name)
    ? null
    : detail;
}

export function singleItemDetail(
  name: string,
  items: readonly { name: string }[],
): string | null {
  const [only] = items;
  return only === undefined || items.length !== 1
    ? null
    : distinctDetail(name, only.name);
}

export function searchText(query: string): SearchText {
  const text = foldText(query);
  const tokens = text === '' ? [] : [...new Set(text.split(' '))];
  return { text, tokens };
}

function startsWordAt(text: string, index: number): boolean {
  return index === 0 || !WORD_CHARACTER.test(text.charAt(index - 1));
}

export function containsWordPrefix(text: string, token: string): boolean {
  let index = text.indexOf(token);
  while (index !== -1) {
    if (startsWordAt(text, index)) {
      return true;
    }
    index = text.indexOf(token, index + 1);
  }
  return false;
}
