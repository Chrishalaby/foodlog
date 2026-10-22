import { DAY_START_OPTIONS, autoFluidsText } from './day-section';

describe('day section', () => {
  it('offers midnight to 6 am', () => {
    expect(DAY_START_OPTIONS.map((option) => option.label)).toEqual([
      'Midnight',
      '1 am',
      '2 am',
      '3 am',
      '4 am',
      '5 am',
      '6 am',
    ]);
    expect(DAY_START_OPTIONS.map((option) => option.value)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('explains the automatic daily fluids from weight and training days', () => {
    expect(autoFluidsText(80)).toBe('Auto 2.8 L (from your weight), 3.3 L on training days');
    expect(autoFluidsText(78.5)).toBe('Auto 2.75 L (from your weight), 3.25 L on training days');
    expect(autoFluidsText(null)).toBe(
      'Auto 2.5 L (add your weight for a personal value), 3.0 L on training days',
    );
    expect(autoFluidsText(0)).toContain('add your weight');
  });

  it('says a custom target stays the same on training days', () => {
    expect(autoFluidsText(80, true)).toBe('Same every day · auto 2.8 L');
    expect(autoFluidsText(null, true)).toBe('Same every day · auto 2.5 L');
  });
});
