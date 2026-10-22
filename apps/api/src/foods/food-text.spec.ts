import {
  containsWordPrefix,
  distinctDetail,
  foldText,
  normalizeFoodName,
  searchText,
  singleItemDetail,
  splitServingsSuffix,
} from './food-text.js';

describe('foldText', () => {
  it.each([
    ['  Café   Latte ', 'cafe latte'],
    ['Crème Brûlée', 'creme brulee'],
    ['JALAPEÑO\tpoppers\n', 'jalapeno poppers'],
    ['Straße', 'strasse'],
    ['Smørrebrød', 'smorrebrod'],
    ['Œufs à la neige', 'oeufs a la neige'],
    ['Łosoś', 'losos'],
    ['ﬁlet ５ pieces', 'filet 5 pieces'],
    ['Labneh لبنة', 'labneh لبنة'],
  ])('folds %j to %j', (input, expected) => {
    expect(foldText(input)).toBe(expected);
  });
});

describe('normalizeFoodName', () => {
  it('strips the servings suffix added when logging favorites', () => {
    expect(normalizeFoodName('Overnight oats ×1.5')).toBe('overnight oats');
    expect(normalizeFoodName('Overnight oats ×2')).toBe('overnight oats');
    expect(normalizeFoodName('Overnight oats×0.25')).toBe('overnight oats');
  });

  it('keeps names that only consist of a multiplier', () => {
    expect(normalizeFoodName('×2')).toBe('×2');
  });

  it('keeps multipliers that are not a trailing suffix', () => {
    expect(normalizeFoodName('2× espresso')).toBe('2× espresso');
    expect(normalizeFoodName('Twix 2')).toBe('twix 2');
  });
});

describe('splitServingsSuffix', () => {
  it.each([
    ['Yogurt ×2', 'Yogurt', ' ×2'],
    ['Oats×0.25', 'Oats', ' ×0.25'],
    ['Oats × 1,5', 'Oats', ' ×1,5'],
    ['  Yogurt  ', 'Yogurt', ''],
    ['×2', '×2', ''],
    ['2× espresso', '2× espresso', ''],
  ])('splits %j into %j and %j', (name, base, suffix) => {
    const split = splitServingsSuffix(name);

    expect(split).toEqual({ base, suffix });
    expect(normalizeFoodName(split.base + split.suffix)).toBe(
      normalizeFoodName(split.base),
    );
  });
});

describe('distinctDetail', () => {
  it('keeps a detail that names something else', () => {
    expect(
      distinctDetail('Strawberry yogurt cup', 'Khoury strawberry yogurt'),
    ).toBe('Khoury strawberry yogurt');
  });

  it('drops a missing detail or one that only repeats the name', () => {
    expect(distinctDetail('Granola', null)).toBeNull();
    expect(distinctDetail('Café latte', ' cafe  LATTE ×2')).toBeNull();
  });
});

describe('singleItemDetail', () => {
  it('uses the name of the only item when it differs', () => {
    expect(
      singleItemDetail('Strawberry Yogurt', [
        { name: 'Khoury strawberry yogurt' },
      ]),
    ).toBe('Khoury strawberry yogurt');
  });

  it('has no detail for several items, no items or an item named like the whole', () => {
    expect(
      singleItemDetail('Breakfast', [{ name: 'Granola' }, { name: 'Milk' }]),
    ).toBeNull();
    expect(singleItemDetail('Breakfast', [])).toBeNull();
    expect(
      singleItemDetail('Oat clusters', [{ name: ' OAT clusters ' }]),
    ).toBeNull();
  });
});

describe('searchText', () => {
  it('splits a folded query into unique tokens', () => {
    expect(searchText('  Straw  YOG  straw ')).toEqual({
      text: 'straw yog straw',
      tokens: ['straw', 'yog'],
    });
  });

  it('has no tokens for blank queries', () => {
    expect(searchText('   ')).toEqual({ text: '', tokens: [] });
    expect(searchText('́')).toEqual({ text: '', tokens: [] });
  });
});

describe('containsWordPrefix', () => {
  it.each([
    ['khoury strawberry yogurt', 'straw', true],
    ['khoury strawberry yogurt', 'khoury', true],
    ['khoury strawberry yogurt', 'berry', false],
    ['m&m peanut', 'm&m', true],
    ['chicken (grilled)', 'grill', true],
    ['double-chocolate cookie', 'choc', true],
    ['banana', 'ana', false],
    ['banana ana', 'ana', true],
  ])('%j contains a word starting with %j: %s', (text, token, expected) => {
    expect(containsWordPrefix(text, token)).toBe(expected);
  });
});
