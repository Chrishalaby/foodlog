import { API_LIMITS } from '@food/shared';

export interface TextPart {
  text: string;
  match: boolean;
}

const DIACRITICS = /\p{M}+/gu;
const SPACE_OR_CONTROL = /[\s\p{Cc}]+/gu;

export function normalizeQuery(text: string): string {
  return text.replace(SPACE_OR_CONTROL, ' ').trim().slice(0, API_LIMITS.foodQueryMax).trim();
}

export function foldText(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

export function foodNameKey(name: string): string {
  return foldText(normalizeQuery(name));
}

export function sameFoodName(a: string, b: string): boolean {
  return foodNameKey(a) === foodNameKey(b);
}

export function queryTokens(query: string): string[] {
  return foldText(normalizeQuery(query))
    .split(' ')
    .filter((token) => token.length > 0);
}

interface SourceSpan {
  start: number;
  length: number;
}

interface FoldedText {
  folded: string;
  spans: SourceSpan[];
}

function foldWithIndex(text: string): FoldedText {
  let folded = '';
  const spans: SourceSpan[] = [];
  let offset = 0;
  let previous: SourceSpan | null = null;
  for (const char of Array.from(text)) {
    const piece = foldText(char);
    if (piece.length === 0) {
      if (previous) {
        previous.length += char.length;
      }
    } else {
      const span: SourceSpan = { start: offset, length: char.length };
      for (let i = 0; i < piece.length; i++) {
        spans.push(span);
      }
      folded += piece;
      previous = span;
    }
    offset += char.length;
  }
  return { folded, spans };
}

function matchedMask(text: string, tokens: readonly string[]): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  const { folded, spans } = foldWithIndex(text);
  for (const token of tokens) {
    let from = folded.indexOf(token);
    while (from >= 0) {
      for (const span of spans.slice(from, from + token.length)) {
        mask.fill(true, span.start, span.start + span.length);
      }
      from = folded.indexOf(token, from + token.length);
    }
  }
  return mask;
}

export function highlightParts(text: string, query: string): TextPart[] {
  const tokens = queryTokens(query);
  if (text.length === 0) {
    return [];
  }
  if (tokens.length === 0) {
    return [{ text, match: false }];
  }
  const mask = matchedMask(text, tokens);
  const parts: TextPart[] = [];
  for (let i = 0; i < text.length; i++) {
    const match = mask[i] === true;
    const last = parts[parts.length - 1];
    if (last && last.match === match) {
      last.text += text[i];
    } else {
      parts.push({ text: text[i] ?? '', match });
    }
  }
  return parts;
}
