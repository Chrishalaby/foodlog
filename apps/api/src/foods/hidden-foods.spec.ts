import { BadRequestException } from '@nestjs/common';
import {
  HIDDEN_FOODS_MAX,
  hiddenFoodName,
  sameNames,
  withHiddenName,
  withoutHiddenName,
} from './hidden-foods.js';

describe('hiddenFoodName', () => {
  it('stores names the way the library compares them', () => {
    expect(hiddenFoodName('  Café   LATTE ×2 ')).toBe('cafe latte');
  });

  it('rejects names without any letter or digit left', () => {
    expect(() => hiddenFoodName('́')).toThrow(BadRequestException);
  });
});

describe('withHiddenName', () => {
  it('adds a name once and keeps the list sorted', () => {
    const names = withHiddenName(['granola', 'toast'], 'lentil soup');

    expect(names).toEqual(['granola', 'lentil soup', 'toast']);
    expect(withHiddenName(names, 'toast')).toEqual(names);
  });

  it(`refuses more than ${HIDDEN_FOODS_MAX} names but still accepts known ones`, () => {
    const full = Array.from(
      { length: HIDDEN_FOODS_MAX },
      (_, index) => `food ${String(index).padStart(3, '0')}`,
    );

    expect(() => withHiddenName(full, 'one more')).toThrow(BadRequestException);
    expect(withHiddenName(full, 'food 000')).toEqual(full);
  });
});

describe('withoutHiddenName', () => {
  it('removes a name given as shown or as stored', () => {
    expect(
      withoutHiddenName(['cafe latte', 'granola'], ' Café Latte '),
    ).toEqual(['granola']);
    expect(withoutHiddenName(['oats ×2', 'granola'], 'oats ×2')).toEqual([
      'granola',
    ]);
  });

  it('ignores names that are not hidden', () => {
    expect(withoutHiddenName(['granola'], 'toast')).toEqual(['granola']);
  });
});

describe('sameNames', () => {
  it('compares names in order', () => {
    expect(sameNames(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameNames(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameNames(['a'], ['a', 'b'])).toBe(false);
  });
});
