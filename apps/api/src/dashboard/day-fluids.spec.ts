import { dayFluids, fluidsMlByDate } from './day-fluids.js';

describe('fluidsMlByDate', () => {
  it('adds fluid logs and drinks inside meals per logical date', () => {
    const totals = fluidsMlByDate(
      [
        { localDate: '2026-10-01', fluidMl: 330 },
        { localDate: '2026-10-01', fluidMl: null },
        { localDate: '2026-10-02', fluidMl: 250.4 },
      ],
      [
        { localDate: '2026-10-01', ml: 250 },
        { localDate: '2026-10-01', ml: 250 },
        { localDate: '2026-09-30', ml: 200 },
      ],
    );

    expect(Object.fromEntries(totals)).toEqual({
      '2026-10-01': 830,
      '2026-10-02': 250,
      '2026-09-30': 200,
    });
  });

  it('ignores items without a usable drink amount and broken log amounts', () => {
    const totals = fluidsMlByDate(
      [
        { localDate: '2026-10-01', fluidMl: 0 },
        { localDate: '2026-10-01', fluidMl: -50 },
        { localDate: '2026-10-01', fluidMl: 1e9 },
      ],
      [
        { localDate: '2026-10-01', ml: Number.NaN },
        { localDate: '2026-10-01', ml: -10 },
      ],
    );

    expect(totals.size).toBe(0);
  });
});

describe('dayFluids', () => {
  it('pairs the day total with the automatic target for the day type', () => {
    expect(dayFluids({ weightKg: 80 }, false, 830)).toEqual({
      ml: 830,
      targetMl: 2800,
    });
    expect(dayFluids({ weightKg: 80 }, true)).toEqual({
      ml: 0,
      targetMl: 3300,
    });
  });

  it('uses a custom target without the training bonus', () => {
    expect(
      dayFluids({ weightKg: 80, fluidTargetMl: 3000 }, true, 1200),
    ).toEqual({ ml: 1200, targetMl: 3000 });
  });
});
