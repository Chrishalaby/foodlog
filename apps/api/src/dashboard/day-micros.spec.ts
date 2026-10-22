import {
  averageMicros,
  CAFFEINATED_FLUID_KINDS,
  emptyCoverage,
  isMicrosDay,
  microsByDate,
  sumCoverage,
} from './day-micros.js';

const MONDAY = '2026-09-28';
const TUESDAY = '2026-09-29';

describe('microsByDate', () => {
  it('sums item micros per day and counts the items that have them', () => {
    const days = microsByDate(
      [
        { localDate: MONDAY, micros: { vitaminD: 125 } },
        { localDate: MONDAY, micros: { calcium: 300.4, caffeine: 35 } },
        { localDate: MONDAY, micros: null },
        { localDate: TUESDAY, micros: { calcium: 100 } },
      ],
      [],
    );

    expect(days.get(MONDAY)).toEqual({
      micros: { vitaminD: 125, calcium: 300, caffeine: 35 },
      coverage: { items: 3, withMicros: 2 },
    });
    expect(days.get(TUESDAY)).toEqual({
      micros: { calcium: 100 },
      coverage: { items: 1, withMicros: 1 },
    });
  });

  it('adds caffeine from coffee and tea logs', () => {
    const days = microsByDate(
      [{ localDate: MONDAY, micros: { caffeine: 35, iron: 2 } }],
      [
        { localDate: MONDAY, kind: 'coffee', ml: 250 },
        { localDate: MONDAY, kind: 'tea', ml: 300 },
        { localDate: MONDAY, kind: 'water', ml: 500 },
        { localDate: TUESDAY, kind: 'coffee', ml: 100 },
      ],
    );

    expect(days.get(MONDAY)?.micros).toEqual({ caffeine: 195, iron: 2 });
    expect(days.get(TUESDAY)).toEqual({
      micros: { caffeine: 40 },
      coverage: { items: 0, withMicros: 0 },
    });
  });

  it('ignores stored micros that are unknown, invalid or empty', () => {
    const days = microsByDate(
      [
        { localDate: MONDAY, micros: { omega3: 3, iron: -1 } },
        { localDate: MONDAY, micros: 'lots' },
        { localDate: MONDAY, micros: {} },
        { localDate: MONDAY, micros: { zinc: 1.04 } },
      ],
      [{ localDate: MONDAY, kind: 'water', ml: 1000 }],
    );

    expect(days.get(MONDAY)).toEqual({
      micros: { zinc: 1 },
      coverage: { items: 4, withMicros: 1 },
    });
  });

  it('returns nothing for days without items or logs', () => {
    expect(microsByDate([], []).size).toBe(0);
  });
});

describe('micros days', () => {
  it('needs at least half of the items to have micros', () => {
    expect(isMicrosDay({ items: 4, withMicros: 2 })).toBe(true);
    expect(isMicrosDay({ items: 5, withMicros: 2 })).toBe(false);
    expect(isMicrosDay({ items: 1, withMicros: 1 })).toBe(true);
    expect(isMicrosDay(emptyCoverage())).toBe(false);
  });

  it('averages each nutrient over the days that report it', () => {
    expect(
      averageMicros([
        { vitaminD: 130, calcium: 900 },
        { vitaminD: 10 },
        { calcium: 500, caffeine: 33.3 },
      ]),
    ).toEqual({ vitaminD: 70, calcium: 700, caffeine: 33 });
    expect(averageMicros([])).toEqual({});
  });

  it('adds up coverage', () => {
    expect(
      sumCoverage([
        { items: 3, withMicros: 2 },
        { items: 0, withMicros: 0 },
        { items: 5, withMicros: 5 },
      ]),
    ).toEqual({ items: 8, withMicros: 7 });
    expect(sumCoverage([])).toEqual(emptyCoverage());
  });

  it('only reads caffeinated fluid logs', () => {
    expect(CAFFEINATED_FLUID_KINDS).toEqual(['coffee', 'tea']);
  });
});
