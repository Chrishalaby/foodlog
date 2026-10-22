import { DOCUMENT, type Provider, type Signal, computed, inject } from '@angular/core';
import { provideEchartsCore } from 'ngx-echarts';
import { ThemeService } from '../../core/theme.service';
import type { ChartOption } from './chart-types';

export interface ChartPalette {
  dark: boolean;
  reducedMotion?: boolean;
  bg: string;
  surface: string;
  surface2: string;
  elevated: string;
  fg: string;
  muted: string;
  line: string;
  brand: string;
  accent: string;
  warn: string;
  danger: string;
  ok: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
  fiber: string;
  satFat: string;
  sugar: string;
  sodium: string;
  alcohol: string;
}

type PaletteColorKey = Exclude<keyof ChartPalette, 'dark' | 'reducedMotion'>;

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

const TOKEN_VARIABLES: Record<PaletteColorKey, string> = {
  bg: '--app-bg',
  surface: '--app-surface',
  surface2: '--app-surface-2',
  elevated: '--app-elevated',
  fg: '--app-fg',
  muted: '--app-muted',
  line: '--app-line',
  brand: '--app-brand',
  accent: '--app-accent',
  warn: '--app-warn',
  danger: '--app-danger',
  ok: '--app-ok',
  calories: '--app-calories',
  protein: '--app-protein',
  carbs: '--app-carbs',
  fat: '--app-fat',
  fiber: '--app-fiber',
  satFat: '--app-satfat',
  sugar: '--app-sugar',
  sodium: '--app-sodium',
  alcohol: '--app-alcohol',
};

export const DARK_CHART_PALETTE: Record<PaletteColorKey, string> = {
  bg: '#0a0d12',
  surface: '#12161d',
  surface2: '#1a1f28',
  elevated: '#20262f',
  fg: '#eef1f5',
  muted: '#9aa4b2',
  line: '#262d38',
  brand: '#4ade80',
  accent: '#8b9cff',
  warn: '#fbbf4a',
  danger: '#ff6b6b',
  ok: '#34d6a0',
  calories: '#ff9f43',
  protein: '#ff6b8b',
  carbs: '#ffe066',
  fat: '#5cb8ff',
  fiber: '#8bd77a',
  satFat: '#c792ff',
  sugar: '#ff8fd1',
  sodium: '#5ee0e0',
  alcohol: '#b3a4ff',
};

export const LIGHT_CHART_PALETTE: Record<PaletteColorKey, string> = {
  bg: '#f4f6f9',
  surface: '#ffffff',
  surface2: '#eef1f5',
  elevated: '#ffffff',
  fg: '#0d131a',
  muted: '#556070',
  line: '#e0e5ec',
  brand: '#127336',
  accent: '#4955d4',
  warn: '#a24a08',
  danger: '#bb2536',
  ok: '#0e7254',
  calories: '#b0520a',
  protein: '#b82851',
  carbs: '#786600',
  fat: '#1b64b6',
  fiber: '#2e7225',
  satFat: '#7e3dd4',
  sugar: '#a93580',
  sodium: '#096e74',
  alcohol: '#6951c2',
};

export interface BaseChartOptions {
  legend?: boolean;
}

export function provideLazyEcharts(): Provider {
  return provideEchartsCore({
    echarts: () => import('./echarts-setup').then((m) => m.echarts),
  });
}

export function readChartPalette(doc: Document): ChartPalette {
  const root = doc.documentElement;
  const view = doc.defaultView;
  const styles = view ? view.getComputedStyle(root) : null;
  const dark = root.getAttribute('data-theme') !== 'light';
  const palette = { ...(dark ? DARK_CHART_PALETTE : LIGHT_CHART_PALETTE) };
  for (const key of Object.keys(TOKEN_VARIABLES) as PaletteColorKey[]) {
    const value = styles?.getPropertyValue(TOKEN_VARIABLES[key]).trim();
    if (value) {
      palette[key] = value;
    }
  }
  const reducedMotion =
    typeof view?.matchMedia === 'function' && view.matchMedia(REDUCED_MOTION_QUERY).matches;
  return { ...palette, dark, reducedMotion };
}

export function injectChartPalette(): Signal<ChartPalette> {
  const doc = inject(DOCUMENT);
  const theme = inject(ThemeService);
  return computed(() => {
    theme.isDark();
    return readChartPalette(doc);
  });
}

export function echartsThemeName(palette: ChartPalette): 'dark' | 'default' {
  return palette.dark ? 'dark' : 'default';
}

export function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) {
    return hex;
  }
  const value = Number.parseInt(match[1], 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

export function baseChartOption(
  palette: ChartPalette,
  options: BaseChartOptions = {},
): ChartOption {
  const shadow = palette.dark ? 'rgba(0,0,0,.45)' : 'rgba(13,19,26,.16)';
  return {
    backgroundColor: 'transparent',
    animation: palette.reducedMotion !== true,
    animationDuration: 500,
    textStyle: {
      color: palette.muted,
      fontFamily:
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    },
    grid: { left: 8, right: 8, top: 24, bottom: 8 },
    tooltip: {
      backgroundColor: palette.elevated,
      borderColor: palette.line,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: palette.fg, fontSize: 12 },
      extraCssText: `border-radius: 12px; box-shadow: 0 12px 32px -12px ${shadow};`,
    },
    legend: {
      show: options.legend ?? false,
      textStyle: { color: palette.muted, fontSize: 12 },
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 10,
    },
  };
}

export function axisStyle(palette: ChartPalette) {
  return {
    axisLine: { lineStyle: { color: palette.line } },
    axisTick: { show: false },
    axisLabel: { color: palette.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: withAlpha(palette.line, 0.7), type: 'dashed' as const } },
  };
}
