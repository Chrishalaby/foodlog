import { FOOD_RESULT_KINDS, type FoodResultKind } from '@food/shared';

export interface FoodKey {
  kind: FoodResultKind;
  id: string;
}

const UUID_SOURCE =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export const FOOD_KEY_MESSAGE =
  'key must be favorite:<id>, product:<id>, meal:<id> or food:<id>';

export const FOOD_KEY_PATTERN = new RegExp(
  `^(${FOOD_RESULT_KINDS.join('|')}):(${UUID_SOURCE})$`,
  'i',
);

function isFoodResultKind(value: string): value is FoodResultKind {
  return (FOOD_RESULT_KINDS as readonly string[]).includes(value);
}

export function foodKey(kind: FoodResultKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseFoodKey(value: string): FoodKey | null {
  const match = FOOD_KEY_PATTERN.exec(value);
  const kind = match?.[1]?.toLowerCase();
  const id = match?.[2]?.toLowerCase();
  if (kind === undefined || id === undefined || !isFoodResultKind(kind)) {
    return null;
  }
  return { kind, id };
}
