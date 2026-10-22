import {
  FOOD_KEY_MESSAGE,
  FOOD_KEY_PATTERN,
  foodKey,
  parseFoodKey,
} from './food-key.js';

const ID = '019a0000-0000-7000-8000-0000000000c1';

describe('food keys', () => {
  it.each(['favorite', 'product', 'meal', 'food'] as const)(
    'round-trips %s keys',
    (kind) => {
      expect(parseFoodKey(foodKey(kind, ID))).toEqual({ kind, id: ID });
    },
  );

  it('names every key kind in the validation message', () => {
    expect(FOOD_KEY_MESSAGE).toBe(
      'key must be favorite:<id>, product:<id>, meal:<id> or food:<id>',
    );
  });

  it('accepts upper-case keys and normalizes them to lower case', () => {
    expect(parseFoodKey(`MEAL:${ID.toUpperCase()}`)).toEqual({
      kind: 'meal',
      id: ID,
    });
  });

  it.each([
    '',
    'meal',
    `meal:${ID} `,
    ` meal:${ID}`,
    `drink:${ID}`,
    'meal:not-a-uuid',
    `meal:${ID}:extra`,
    `meal-${ID}`,
    `meal:${ID.replaceAll('-', '')}`,
  ])('rejects %j', (value) => {
    expect(parseFoodKey(value)).toBeNull();
    expect(FOOD_KEY_PATTERN.test(value)).toBe(false);
  });
});
