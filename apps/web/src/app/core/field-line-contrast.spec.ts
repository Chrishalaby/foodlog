import { contrastRatio } from '../shared/charts/contrast';
import { DARK_CHART_PALETTE, LIGHT_CHART_PALETTE } from '../shared/charts/echarts';

const FIELD_LINE = { dark: '#6b7585', light: '#7e8896' } as const;
const SWITCH_KNOB = '#ffffff';

describe('field boundary colour', () => {
  for (const [theme, palette] of [
    ['dark', DARK_CHART_PALETTE],
    ['light', LIGHT_CHART_PALETTE],
  ] as const) {
    it(`stands out at 3:1 on every ${theme} surface a field can sit on`, () => {
      const line = FIELD_LINE[theme];
      for (const surface of [palette.bg, palette.surface, palette.surface2, palette.elevated]) {
        expect(contrastRatio(line, surface)!, `${line} on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`keeps the ${theme} off-switch knob visible on its track`, () => {
      expect(contrastRatio(SWITCH_KNOB, FIELD_LINE[theme])!).toBeGreaterThanOrEqual(3);
    });

    it(`is stronger than the ${theme} divider colour it replaces on fields`, () => {
      expect(contrastRatio(FIELD_LINE[theme], palette.bg)!).toBeGreaterThan(
        contrastRatio(palette.line, palette.bg)!,
      );
    });
  }
});
