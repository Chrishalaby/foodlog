import { contrastRatio, relativeLuminance } from './contrast';
import {
  DARK_CHART_PALETTE,
  LIGHT_CHART_PALETTE,
  baseChartOption,
  readChartPalette,
} from './echarts';

const SERIES_KEYS = [
  'brand',
  'accent',
  'warn',
  'danger',
  'ok',
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'satFat',
  'sugar',
  'sodium',
  'alcohol',
] as const;

const NUTRIENT_COLOR_KEYS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'fiber',
  'satFat',
  'sugar',
  'sodium',
  'alcohol',
] as const;

function linear(value: number): number {
  const srgb = value / 255;
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
}

function toLab(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  const r = linear((value >> 16) & 255);
  const g = linear((value >> 8) & 255);
  const b = linear(value & 255);
  const f = (t: number): number =>
    t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116;
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

function labDistance(a: string, b: string): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

describe('chart palette', () => {
  afterEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('red')).toBeNull();
    expect(contrastRatio('#fff', '#000000')).toBeNull();
  });

  for (const [name, palette] of [
    ['dark', DARK_CHART_PALETTE],
    ['light', LIGHT_CHART_PALETTE],
  ] as const) {
    it(`keeps ${name} text at AA and series marks at 3:1 against every surface`, () => {
      for (const background of [palette.bg, palette.surface, palette.surface2, palette.elevated]) {
        expect(contrastRatio(palette.fg, background)!).toBeGreaterThanOrEqual(7);
        expect(contrastRatio(palette.muted, background)!).toBeGreaterThanOrEqual(4.5);
        for (const key of SERIES_KEYS) {
          expect(contrastRatio(palette[key], background)!, key).toBeGreaterThanOrEqual(3);
        }
      }
    });

    it(`keeps ${name} accent colours readable as text on cards`, () => {
      for (const key of SERIES_KEYS) {
        expect(contrastRatio(palette[key], palette.surface2)!, key).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`keeps ${name} nutrient colours at AA as text on every surface`, () => {
      for (const background of [palette.bg, palette.surface, palette.surface2, palette.elevated]) {
        for (const key of NUTRIENT_COLOR_KEYS) {
          expect(contrastRatio(palette[key], background)!, key).toBeGreaterThanOrEqual(4.5);
        }
      }
    });

    it(`keeps ${name} carbs clearly apart from calories and the warning colour`, () => {
      expect(labDistance(palette.carbs, palette.calories)).toBeGreaterThanOrEqual(32);
      expect(labDistance(palette.carbs, palette.warn)).toBeGreaterThanOrEqual(15);
    });
  }

  it('falls back to the palette of the active theme when tokens are unavailable', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    const light = readChartPalette(document);
    expect(light.dark).toBe(false);
    expect(light.surface).toBe(LIGHT_CHART_PALETTE.surface);
    document.documentElement.setAttribute('data-theme', 'dark');
    expect(readChartPalette(document).brand).toBe(DARK_CHART_PALETTE.brand);
  });

  it('turns chart animation off for reduced motion', () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: (query: string) => ({ matches: query.includes('reduce') }),
    });
    const palette = readChartPalette(document);
    expect(palette.reducedMotion).toBe(true);
    expect(baseChartOption(palette)['animation']).toBe(false);
  });
});

describe('baseChartOption', () => {
  const palette = readChartPalette(document);

  it('hides the legend by default and lets callers enable it', () => {
    const hidden = baseChartOption(palette).legend as { show: boolean; textStyle: object };
    expect(hidden.show).toBe(false);
    expect(hidden.textStyle).toEqual({ color: palette.muted, fontSize: 12 });
    const shown = baseChartOption(palette, { legend: true }).legend as { show: boolean };
    expect(shown.show).toBe(true);
  });

  it('styles tooltips from the palette and animates by default', () => {
    const option = baseChartOption(palette);
    const tooltip = option.tooltip as { backgroundColor: string; textStyle: { color: string } };
    expect(tooltip.backgroundColor).toBe(palette.elevated);
    expect(tooltip.textStyle.color).toBe(palette.fg);
    expect(option['animation']).toBe(true);
    expect(option['backgroundColor']).toBe('transparent');
  });
});
