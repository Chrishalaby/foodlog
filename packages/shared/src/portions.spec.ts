import { describe, expect, it } from 'vitest';
import {
  formatCount,
  formatPortion,
  isValidPortion,
  pluralizeUnit,
  portionFactor,
  scalePortion,
} from './portions.js';

const burgers = { count: 2, unit: 'burger', unitPlural: 'burgers' };

describe('portions', () => {
  it('formats counts with friendly fractions', () => {
    expect(formatCount(2)).toBe('2');
    expect(formatCount(1.5)).toBe('1½');
    expect(formatCount(0.5)).toBe('½');
    expect(formatCount(0.25)).toBe('¼');
    expect(formatCount(2.75)).toBe('2¾');
    expect(formatCount(1 / 3)).toBe('⅓');
    expect(formatCount(1.4)).toBe('1.4');
  });

  it('formats portions with singular and plural units', () => {
    expect(formatPortion(burgers)).toBe('2 burgers');
    expect(formatPortion({ ...burgers, count: 1 })).toBe('1 burger');
    expect(formatPortion({ ...burgers, count: 1.5 })).toBe('1½ burgers');
    expect(formatPortion({ ...burgers, count: 0.5 })).toBe('½ burger');
  });

  it('pluralizes common food units as a fallback', () => {
    expect(pluralizeUnit('patty')).toBe('patties');
    expect(pluralizeUnit('sandwich')).toBe('sandwiches');
    expect(pluralizeUnit('slice')).toBe('slices');
    expect(pluralizeUnit('egg')).toBe('eggs');
  });

  it('scales and converts between portions', () => {
    expect(scalePortion(burgers, 0.75)).toEqual({ ...burgers, count: 1.5 });
    expect(portionFactor(burgers, 1.5)).toBe(0.75);
    expect(portionFactor({ count: 0 }, 1)).toBe(0);
  });

  it('validates portions', () => {
    expect(isValidPortion(burgers)).toBe(true);
    expect(isValidPortion({ count: 0, unit: 'x', unitPlural: 'xs' })).toBe(false);
    expect(isValidPortion({ count: 2, unit: '', unitPlural: 'burgers' })).toBe(false);
    expect(isValidPortion(null)).toBe(false);
  });
});
