import { PORTION_COUNT_MAX, PORTION_UNIT_MAX } from '@food/shared';
import {
  clampedPortion,
  itemCount,
  itemPortion,
  normalizeItemCount,
  portionColumns,
  portionFromColumns,
  portionUpdateColumns,
  scaledPortion,
  toPortion,
  withScaledCount,
} from './portions.js';

const BURGERS = { count: 2, unit: 'burger', unitPlural: 'burgers' };

describe('toPortion', () => {
  it('builds a clean portion and derives a missing plural', () => {
    expect(toPortion(1.5, '  burger ', 'burgers')).toEqual({
      count: 1.5,
      unit: 'burger',
      unitPlural: 'burgers',
    });
    expect(toPortion(3, 'slice', null)).toEqual({
      count: 3,
      unit: 'slice',
      unitPlural: 'slices',
    });
    expect(toPortion(2, 'sandwich', '  ')).toMatchObject({
      unitPlural: 'sandwiches',
    });
  });

  it('rounds counts to two decimals', () => {
    expect(toPortion(1.333333, 'slice', 'slices')?.count).toBe(1.33);
  });

  it('rejects missing, non-positive, oversized or unit-less counts', () => {
    expect(toPortion(null, 'burger', 'burgers')).toBeNull();
    expect(toPortion('2', 'burger', 'burgers')).toBeNull();
    expect(toPortion(0, 'burger', 'burgers')).toBeNull();
    expect(toPortion(0.004, 'burger', 'burgers')).toBeNull();
    expect(toPortion(Number.NaN, 'burger', 'burgers')).toBeNull();
    expect(toPortion(PORTION_COUNT_MAX + 1, 'burger', 'burgers')).toBeNull();
    expect(toPortion(2, '   ', 'burgers')).toBeNull();
    expect(toPortion(2, 42, 'burgers')).toBeNull();
  });

  it('collapses whitespace and cuts units to the maximum length', () => {
    const long = 'x'.repeat(PORTION_UNIT_MAX + 10);
    expect(toPortion(1, 'pizza   slice', 'pizza  slices')).toEqual({
      count: 1,
      unit: 'pizza slice',
      unitPlural: 'pizza slices',
    });
    expect(toPortion(1, long, long)).toEqual({
      count: 1,
      unit: 'x'.repeat(PORTION_UNIT_MAX),
      unitPlural: 'x'.repeat(PORTION_UNIT_MAX),
    });
  });
});

describe('portion columns', () => {
  it('maps a portion to columns and back', () => {
    const columns = portionColumns(BURGERS);
    expect(columns).toEqual({
      portionCount: 2,
      portionUnit: 'burger',
      portionUnitPlural: 'burgers',
    });
    expect(portionFromColumns(columns)).toEqual(BURGERS);
  });

  it('stores nulls for a missing or invalid portion', () => {
    const empty = {
      portionCount: null,
      portionUnit: null,
      portionUnitPlural: null,
    };
    expect(portionColumns(null)).toEqual(empty);
    expect(portionColumns(undefined)).toEqual(empty);
    expect(portionColumns({ ...BURGERS, count: -1 })).toEqual(empty);
    expect(portionFromColumns(empty)).toBeNull();
  });

  it('only writes update columns when a portion or null was sent', () => {
    expect(portionUpdateColumns(undefined)).toEqual({});
    expect(portionUpdateColumns(null)).toEqual({
      portionCount: null,
      portionUnit: null,
      portionUnitPlural: null,
    });
    expect(portionUpdateColumns(BURGERS)).toMatchObject({ portionCount: 2 });
  });
});

describe('item counts', () => {
  it('reads and writes item counts as nullable fields', () => {
    expect(itemPortion({ count: 2, unit: 'egg' })).toEqual({
      count: 2,
      unit: 'egg',
      unitPlural: 'eggs',
    });
    expect(itemPortion({})).toBeNull();
    expect(itemCount(null)).toEqual({
      count: null,
      unit: null,
      unitPlural: null,
    });
    expect(normalizeItemCount({ count: 2, unit: null })).toEqual({
      count: null,
      unit: null,
      unitPlural: null,
    });
  });
});

describe('scaledPortion', () => {
  it('scales the count and keeps the units', () => {
    expect(scaledPortion(BURGERS, 0.75)).toEqual({ ...BURGERS, count: 1.5 });
    expect(scaledPortion(BURGERS, 1 / 3)).toEqual({ ...BURGERS, count: 0.67 });
  });

  it('returns the same portion for factor 1 and null without a portion', () => {
    expect(scaledPortion(BURGERS, 1)).toBe(BURGERS);
    expect(scaledPortion(null, 2)).toBeNull();
  });

  it('drops portions that fall outside the valid range', () => {
    expect(scaledPortion(BURGERS, 60)).toBeNull();
    expect(scaledPortion(BURGERS, 0.001)).toBeNull();
    expect(scaledPortion(BURGERS, Number.NaN)).toBeNull();
  });
});

describe('withScaledCount', () => {
  it('scales a counted item', () => {
    expect(
      withScaledCount(
        { name: 'Eggs', count: 2, unit: 'egg', unitPlural: 'eggs' },
        1.5,
      ),
    ).toEqual({ name: 'Eggs', count: 3, unit: 'egg', unitPlural: 'eggs' });
  });

  it('leaves items without a count untouched', () => {
    const item = { name: 'Rice', count: null, unit: null };
    expect(withScaledCount(item, 2)).toBe(item);
  });
});

describe('clampedPortion', () => {
  it('caps model counts at the maximum', () => {
    expect(clampedPortion(250, 'piece', 'pieces')).toEqual({
      count: PORTION_COUNT_MAX,
      unit: 'piece',
      unitPlural: 'pieces',
    });
    expect(clampedPortion(null, 'piece', 'pieces')).toBeNull();
    expect(clampedPortion(2, null, null)).toBeNull();
  });
});
