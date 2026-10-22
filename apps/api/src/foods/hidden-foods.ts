import { BadRequestException } from '@nestjs/common';
import { compareText } from './food-library.js';
import { normalizeFoodName } from './food-text.js';

export const HIDDEN_FOODS_MAX = 500;

export function hiddenFoodName(name: string): string {
  const normalized = normalizeFoodName(name);
  if (normalized === '') {
    throw new BadRequestException('name must contain letters or digits');
  }
  return normalized;
}

export function withHiddenName(
  names: readonly string[],
  hiddenName: string,
): string[] {
  if (names.includes(hiddenName)) {
    return [...names];
  }
  if (names.length >= HIDDEN_FOODS_MAX) {
    throw new BadRequestException(
      `At most ${HIDDEN_FOODS_MAX} names can be hidden; unhide some first`,
    );
  }
  return [...names, hiddenName].sort(compareText);
}

export function withoutHiddenName(
  names: readonly string[],
  name: string,
): string[] {
  const normalized = normalizeFoodName(name);
  return names.filter((stored) => stored !== name && stored !== normalized);
}

export function sameNames(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((name, index) => name === b[index]);
}
