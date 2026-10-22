import {
  areComparableNames,
  foodNameTokens,
  headToken,
  isConflictingToken,
  normalizeFoodKey,
  sameFoodName,
  singularize,
} from './food-names.js';

describe('normalizeFoodKey', () => {
  it.each([
    ['Heinz tomato ketchup', 'heinz tomato ketchup'],
    ['Tomato ketchup', 'tomato ketchup'],
    ['Heinz mayonnaise, regular', 'heinz mayo'],
    ['Mayonnaise, regular', 'mayo'],
    ['Garlic mayonnaise sauce', 'garlic mayo sauce'],
    ['Sofisoft potato bun', 'sofisoft potato bun'],
    ['Sofisoft potato bun, top hollowed', 'sofisoft potato bun top hollowed'],
    ['Cabbage, raw shredded', 'cabbage raw shredded'],
    ['Cabbage, raw, shredded', 'cabbage raw shredded'],
    ['Chicken breast, cooked, skinless', 'chicken breast cooked skinless'],
    ['Added table salt', 'added table salt'],
    ['Cucumber pickles', 'cucumber pickle'],
    ['Cucumber, raw, with peel', 'cucumber raw peel'],
    [
      'Khoury strawberry Greek yogurt, low fat',
      'khoury strawberry greek yogurt low fat',
    ],
  ])('normalizes the owner name %j to %j', (name, expected) => {
    expect(normalizeFoodKey(name)).toBe(expected);
  });

  it('folds case, accents and punctuation', () => {
    expect(normalizeFoodKey('  CRÈME   fraîche!! ')).toBe('creme fraiche');
    expect(normalizeFoodKey("Hershey's chocolate-bar")).toBe(
      'hershey chocolate bar',
    );
    expect(normalizeFoodKey('Beef patty 80/20')).toBe('beef patty 80 20');
  });

  it('applies synonyms', () => {
    expect(normalizeFoodKey('Yoghurt')).toBe('yogurt');
    expect(normalizeFoodKey('Catsup')).toBe('ketchup');
    expect(normalizeFoodKey('Prawns')).toBe('shrimp');
    expect(normalizeFoodKey('Skimmed milk')).toBe('skim milk');
  });

  it('drops filler words', () => {
    expect(
      normalizeFoodKey('Some fresh homemade bread with the butter, plain'),
    ).toBe('bread butter');
    expect(normalizeFoodKey('Beer, regular')).toBe('beer');
    expect(normalizeFoodKey('Original glazed doughnut')).toBe('glazed donut');
  });

  it('ignores a servings suffix and repeated words', () => {
    expect(normalizeFoodKey('Burger ×2')).toBe('burger');
    expect(normalizeFoodKey('Mayo mayonnaise')).toBe('mayo');
  });

  it('returns an empty key for names without words', () => {
    expect(normalizeFoodKey('  ,.;  ')).toBe('');
    expect(normalizeFoodKey('the and of')).toBe('');
  });
});

describe('singularize', () => {
  it.each([
    ['tomatoes', 'tomato'],
    ['berries', 'berry'],
    ['cookies', 'cooky'],
    ['cookie', 'cooky'],
    ['pies', 'pie'],
    ['peaches', 'peach'],
    ['sandwiches', 'sandwich'],
    ['glasses', 'glass'],
    ['buns', 'bun'],
    ['eggs', 'egg'],
    ['bananas', 'banana'],
    ['hummus', 'hummus'],
    ['couscous', 'couscous'],
    ['skinless', 'skinless'],
    ['oats', 'oat'],
    ['egg', 'egg'],
    ['bun', 'bun'],
    ['80s', '80s'],
  ])('maps %j to %j', (word, expected) => {
    expect(singularize(word)).toBe(expected);
  });

  it('maps singular and plural forms to the same token', () => {
    expect(foodNameTokens('Cherry tomatoes')).toEqual(
      foodNameTokens('cherry tomato'),
    );
    expect(sameFoodName('Brownies', 'brownie')).toBe(true);
    expect(sameFoodName('Potatoes, boiled', 'potato boiled')).toBe(true);
  });
});

describe('sameFoodName', () => {
  it('matches names that normalize identically', () => {
    expect(sameFoodName('Cabbage, raw shredded', 'cabbage raw, shredded')).toBe(
      true,
    );
    expect(sameFoodName('Mayonnaise, regular', 'Mayo')).toBe(true);
  });

  it('never matches empty names', () => {
    expect(sameFoodName('', '')).toBe(false);
    expect(sameFoodName('the', 'a')).toBe(false);
  });
});

describe('areComparableNames', () => {
  it.each<[string, string]>([
    ['Tomato ketchup', 'Heinz tomato ketchup'],
    ['Heinz mayonnaise, regular', 'Mayonnaise, regular'],
    ['Sofisoft potato bun', 'Sofisoft potato bun, top hollowed'],
    ['Added table salt', 'Table salt'],
    ['Cabbage, raw shredded', 'Cabbage, raw, shredded'],
    ['Burger', 'Chicken burger'],
    ['Greek yogurt', 'Yogurt'],
    ['Ketchup', 'Tomato ketchup'],
    ['Ketchup', 'Heinz tomato ketchup'],
    ['Mayo', 'Heinz mayonnaise, regular'],
    ['Ketchup', 'Ketchup packet'],
    ['Potato bun', 'Potato bun toasted'],
    ['Pizza', 'Slice of pizza'],
  ])('treats %j and %j as the same food', (a, b) => {
    expect(areComparableNames(a, b)).toBe(true);
    expect(areComparableNames(b, a)).toBe(true);
  });

  it.each<[string, string, string]>([
    [
      'Chicken breast, grilled',
      'Chicken breast, cooked, skinless',
      'neither contains the other',
    ],
    ['Mayonnaise, regular', 'Garlic mayonnaise sauce', 'a different base food'],
    [
      'Heinz mayonnaise, regular',
      'Garlic mayonnaise sauce',
      'neither contains the other',
    ],
    [
      'Cucumber pickles',
      'Cucumber, raw, with peel',
      'neither contains the other',
    ],
    [
      'Potato bun',
      'Sofisoft potato bun, top hollowed',
      'more than 2 extra words',
    ],
    ['Milk', 'Skimmed milk', 'a fat qualifier'],
    ['Milk', 'Whole milk', 'a fat qualifier'],
    ['Greek yogurt', 'Greek yogurt, low fat', 'a low-fat qualifier'],
    ['Cola', 'Cola zero', 'a zero qualifier'],
    ['Cola', 'Diet cola', 'a diet qualifier'],
    ['Rice', 'Rice, cooked', 'a state word'],
    ['Oats', 'Oats, dry', 'a state word'],
    ['Orange', 'Orange juice', 'juice'],
    ['Beef patty', 'Beef patty 80/20', 'numbers'],
    ['Beef burger', 'Beef cheese burger', 'a second base food'],
    ['Yogurt', 'Strawberry yogurt', 'a flavour naming another food'],
    ['Ketchup and mayo', 'Mayo', 'a second base food'],
    ['Peanut butter', 'Peanut butter, sugar free', 'sugar-free'],
    ['Tomato', 'Tomato ketchup', 'the extra word is the food itself'],
    ['Tomato', 'Heinz tomato ketchup', 'the extra word is the food itself'],
    ['Potato', 'Potato bun', 'the extra word is the food itself'],
    ['Egg', 'Egg white', 'the extra word is the food itself'],
    ['Apple', 'Apple pie', 'the extra word is the food itself'],
    ['Chicken', 'Chicken burger', 'the extra word is the food itself'],
    ['Cheese', 'Cream cheese', 'a second base food'],
    ['Butter', 'Peanut butter', 'a second base food'],
    ['Milk', 'Coconut milk', 'a second base food'],
    ['Milk', 'Oat milk', 'a second base food'],
    ['Rice', 'Chicken rice', 'a second base food'],
    ['Bread', 'Garlic bread', 'a second base food'],
    ['Water', 'Coconut water', 'a second base food'],
  ])('keeps %j and %j apart (%s)', (a, b) => {
    expect(areComparableNames(a, b)).toBe(false);
    expect(areComparableNames(b, a)).toBe(false);
  });

  it('never compares names without words', () => {
    expect(areComparableNames('', 'Ketchup')).toBe(false);
  });
});

describe('headToken', () => {
  it.each<[string, string | null]>([
    ['Heinz tomato ketchup', 'ketchup'],
    ['Heinz mayonnaise, regular', 'mayo'],
    ['Sofisoft potato bun, top hollowed', 'bun'],
    ['Cabbage, raw shredded', 'cabbage'],
    ['Burger (beef)', 'burger'],
    ['Ketchup packet', 'ketchup'],
    ['Heinz tomato ketchup squeeze', 'ketchup'],
    ['Glass of milk', 'milk'],
    ['Potato bun toasted', 'bun'],
    ['Garlic bread', 'bread'],
    ['Chia seed', 'seed'],
    ['Coke 330 ml', 'coke'],
    ['Cucumber pickles', 'pickle'],
    [', ketchup', 'ketchup'],
    ['Fresh, homemade', null],
    ['', null],
  ])('finds the food named by %j', (name, expected) => {
    expect(headToken(name)).toBe(expected);
  });
});

describe('isConflictingToken', () => {
  it('flags base foods only when the other side names a base food', () => {
    expect(isConflictingToken('chicken', new Set(['burger']))).toBe(false);
    expect(isConflictingToken('chicken', new Set(['beef', 'burger']))).toBe(
      true,
    );
  });

  it('always flags qualifiers, state words and numbers', () => {
    expect(isConflictingToken('light', new Set(['mayo']))).toBe(true);
    expect(isConflictingToken('raw', new Set(['cabbage']))).toBe(true);
    expect(isConflictingToken('2', new Set(['milk']))).toBe(true);
    expect(isConflictingToken('heinz', new Set(['ketchup']))).toBe(false);
  });
});
