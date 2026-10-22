import {
  amountLine,
  amountSummary,
  canStepCount,
  clampCount,
  countChips,
  countLabel,
  itemPortion,
  makePortion,
  parsePortionJson,
  pluralizeUnitPhrase,
  renamePortion,
  scaledCount,
  scaledPortion,
  singularizeUnitPhrase,
  stepCount,
  sumGrams,
  toPortion,
  unitsFromText,
} from './portion';

const BURGERS = { count: 2, unit: 'burger', unitPlural: 'burgers' };

describe('portion display', () => {
  it('shows the count before the grams and calories', () => {
    expect(amountSummary(BURGERS, 780, 1450)).toBe('2 burgers · 780 g · 1,450 kcal');
    expect(amountSummary(null, 780.4, 1450)).toBe('780 g · 1,450 kcal');
    expect(amountSummary({ ...BURGERS, count: 1.5 }, 0, 1087.5)).toBe('1½ burgers · 1,088 kcal');
    expect(amountSummary(null, 0, 90)).toBe('90 kcal');
  });

  it('builds the amount line from the portion and the grams', () => {
    expect(amountLine(BURGERS, 780)).toBe('2 burgers · 780 g');
    expect(amountLine({ ...BURGERS, count: 1 }, 390)).toBe('1 burger · 390 g');
    expect(amountLine(null, 250)).toBe('250 g');
    expect(amountLine(null, 0)).toBe('');
    expect(sumGrams([{ grams: 400 }, { grams: 380.04 }, { grams: -3 }])).toBe(780);
  });

  it('labels counts with the right unit', () => {
    expect(countLabel(BURGERS, 0.5)).toBe('½ burger');
    expect(countLabel(BURGERS, 3)).toBe('3 burgers');
  });
});

describe('count stepping', () => {
  it('steps in halves on a half grid', () => {
    expect(stepCount(2, 1)).toBe(2.5);
    expect(stepCount(2, -1)).toBe(1.5);
    expect(stepCount(1.3, 1)).toBe(1.5);
    expect(stepCount(1.3, -1)).toBe(1);
    expect(stepCount(0.5, -1)).toBe(0.5);
    expect(canStepCount(0.5, -1)).toBe(false);
    expect(canStepCount(1, -1)).toBe(true);
    expect(clampCount(0)).toBe(0.01);
    expect(clampCount(0.2)).toBe(0.2);
    expect(clampCount(250)).toBe(100);
    expect(clampCount(1.337)).toBe(1.34);
  });

  it('offers ½ to 3 and includes the counted amount', () => {
    expect(countChips(2)).toEqual([0.5, 1, 1.5, 2, 3]);
    expect(countChips(4)).toEqual([0.5, 1, 1.5, 2, 3, 4]);
    expect(countChips(null)).toEqual([0.5, 1, 1.5, 2, 3]);
  });

  it('scales counts to two decimals', () => {
    expect(scaledCount(2, 0.75)).toBe(1.5);
    expect(scaledCount(3, 1 / 3)).toBe(1);
    expect(scaledCount(null, 2)).toBeNull();
    expect(scaledPortion(BURGERS, 0.5)).toEqual({ ...BURGERS, count: 1 });
    expect(scaledPortion(null, 0.5)).toBeNull();
  });
});

describe('typed units', () => {
  it('reads the unit whether it was typed singular or plural', () => {
    expect(unitsFromText('burgers')).toEqual({ unit: 'burger', unitPlural: 'burgers' });
    expect(unitsFromText('burger')).toEqual({ unit: 'burger', unitPlural: 'burgers' });
    expect(unitsFromText('patties')).toEqual({ unit: 'patty', unitPlural: 'patties' });
    expect(unitsFromText('sandwiches')).toEqual({ unit: 'sandwich', unitPlural: 'sandwiches' });
    expect(unitsFromText('slice of pizza')).toEqual({
      unit: 'slice of pizza',
      unitPlural: 'slices of pizza',
    });
    expect(unitsFromText('slices of pizza')).toEqual({
      unit: 'slice of pizza',
      unitPlural: 'slices of pizza',
    });
    expect(unitsFromText('  ')).toBeNull();
    expect(singularizeUnitPhrase('glasses of milk')).toBe('glass of milk');
  });

  it('handles common food words that do not follow the simple rules', () => {
    expect(unitsFromText('cookies')).toEqual({ unit: 'cookie', unitPlural: 'cookies' });
    expect(unitsFromText('pies')).toEqual({ unit: 'pie', unitPlural: 'pies' });
    expect(unitsFromText('quiches')).toEqual({ unit: 'quiche', unitPlural: 'quiches' });
    expect(unitsFromText('loaf')).toEqual({ unit: 'loaf', unitPlural: 'loaves' });
    expect(unitsFromText('Potatoes')).toEqual({ unit: 'Potato', unitPlural: 'Potatoes' });
    expect(unitsFromText('glass')).toEqual({ unit: 'glass', unitPlural: 'glasses' });
    expect(unitsFromText('hummus')).toEqual({ unit: 'hummus', unitPlural: 'hummuses' });
    expect(pluralizeUnitPhrase('half of a bagel')).toBe('halves of a bagel');
  });

  it('makes a valid portion or nothing', () => {
    expect(makePortion(2, 'burgers')).toEqual(BURGERS);
    expect(makePortion(2, 'burger')).toEqual(BURGERS);
    expect(makePortion(1, 'burgers')).toEqual({ ...BURGERS, count: 1 });
    expect(makePortion(0, 'burgers')).toBeNull();
    expect(makePortion(2, '')).toBeNull();
  });

  it('keeps the portion when the unit is unchanged and renames it otherwise', () => {
    expect(renamePortion(BURGERS, 'burgers')).toBe(BURGERS);
    expect(renamePortion(BURGERS, 'sliders')).toEqual({
      count: 2,
      unit: 'slider',
      unitPlural: 'sliders',
    });
    expect(renamePortion(BURGERS, '')).toBeNull();
  });
});

describe('portion values', () => {
  it('accepts only valid portions', () => {
    expect(toPortion(BURGERS)).toEqual(BURGERS);
    expect(toPortion({ count: 0, unit: 'x', unitPlural: 'xs' })).toBeNull();
    expect(toPortion(undefined)).toBeNull();
    expect(parsePortionJson(JSON.stringify(BURGERS))).toEqual(BURGERS);
    expect(parsePortionJson('{oops')).toBeNull();
    expect(parsePortionJson(undefined)).toBeNull();
  });

  it('reads item counts and fills a missing plural', () => {
    expect(itemPortion({ count: 2, unit: 'egg', unitPlural: null })).toEqual({
      count: 2,
      unit: 'egg',
      unitPlural: 'eggs',
    });
    expect(itemPortion({ count: 2, unit: null })).toBeNull();
    expect(itemPortion({ count: null, unit: 'egg' })).toBeNull();
  });
});
