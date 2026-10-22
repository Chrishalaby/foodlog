import type { WeightTrendPointDto } from '@food/shared';
import { readChartPalette } from '../../shared/charts/echarts';
import {
  buildWeightChartOption,
  trimLeadingGap,
  weightAxisBounds,
  weightChartAriaLabel,
  weightChartData,
  weightSymbolSize,
} from './weight-chart';

type Loose = Record<string, unknown>;

const palette = readChartPalette(document);

const points: WeightTrendPointDto[] = [
  { date: '2026-09-26', weightKg: null, trendKg: null },
  { date: '2026-09-27', weightKg: 80.4, trendKg: 80.4 },
  { date: '2026-09-28', weightKg: null, trendKg: 80.4 },
  { date: '2026-09-29', weightKg: 79.6, trendKg: 80.32 },
];

describe('weight chart data', () => {
  it('splits the trend response into aligned series', () => {
    const data = weightChartData(points);
    expect(data.labels).toEqual(['26 Sep', '27 Sep', '28 Sep', '29 Sep']);
    expect(data.weights).toEqual([null, 80.4, null, 79.6]);
    expect(data.trend).toEqual([null, 80.4, 80.4, 80.32]);
    expect(data.weighIns).toBe(2);
  });

  it('pads the axis around the data on half-kilo steps', () => {
    expect(weightAxisBounds(weightChartData(points))).toEqual({ min: 79, max: 81 });
    expect(
      weightAxisBounds(weightChartData([{ date: '2026-09-01', weightKg: null, trendKg: null }])),
    ).toBeNull();
  });

  it('drops the empty days before the first weigh-in but keeps a two-week window', () => {
    const empty = (day: number): WeightTrendPointDto => ({
      date: `2026-08-${String(day).padStart(2, '0')}`,
      weightKg: null,
      trendKg: null,
    });
    const year = [...Array.from({ length: 20 }, (_, i) => empty(i + 1)), ...points];
    expect(trimLeadingGap(year).map((point) => point.date)).toEqual(
      year.slice(year.length - 14).map((point) => point.date),
    );
    expect(trimLeadingGap(year, 3).map((point) => point.date)).toEqual([
      '2026-09-27',
      '2026-09-28',
      '2026-09-29',
    ]);
    expect(trimLeadingGap(points.slice(1))).toEqual(points.slice(1));
    expect(trimLeadingGap([empty(1), empty(2)])).toEqual([empty(1), empty(2)]);
  });

  it('shrinks dots as the range grows', () => {
    expect(weightSymbolSize(30)).toBe(6);
    expect(weightSymbolSize(90)).toBe(4);
    expect(weightSymbolSize(365)).toBe(3);
  });

  it('describes the chart for screen readers', () => {
    expect(weightChartAriaLabel(weightChartData(points), 30)).toBe(
      'Weight over the last 30 days. Trend from 80.4 to 80.3 kg, 2 weigh-ins.',
    );
    expect(
      weightChartAriaLabel(
        weightChartData([{ date: '2026-09-01', weightKg: null, trendKg: null }]),
        30,
      ),
    ).toBe('Weight over the last 30 days. 0 weigh-ins.');
  });
});

describe('buildWeightChartOption', () => {
  const data = weightChartData(points);
  const option = buildWeightChartOption(data, palette, '2026-09-29') as unknown as {
    series: Loose[];
    yAxis: Loose;
    tooltip: { formatter: (params: unknown) => string };
  };

  it('draws the smoothed trend under dots for the weigh-ins', () => {
    const [trend, dots] = option.series;
    expect(trend?.['name']).toBe('Trend');
    expect(trend?.['data']).toEqual(data.trend);
    expect(trend?.['connectNulls']).toBe(true);
    expect(trend?.['showSymbol']).toBe(false);
    expect(dots?.['name']).toBe('Weigh-in');
    expect(dots?.['data']).toEqual(data.weights);
    expect(dots?.['connectNulls']).toBe(false);
    expect((dots?.['lineStyle'] as Loose)['opacity']).toBe(0);
    expect(option.yAxis['min']).toBe(79);
    expect(option.yAxis['max']).toBe(81);
  });

  it('shows both the weigh-in and the trend in the tooltip', () => {
    const withWeight = option.tooltip.formatter([{ dataIndex: 3 }]);
    expect(withWeight).toContain('Tue 29 Sep');
    expect(withWeight).toContain('Weigh-in');
    expect(withWeight).toContain('79.6 kg');
    expect(withWeight).toContain('Trend');
    expect(withWeight).toContain('80.3 kg');

    const without = option.tooltip.formatter([{ dataIndex: 2 }]);
    expect(without).toContain('No weigh-in');
    expect(without).toContain('80.4 kg');
    expect(option.tooltip.formatter([{ dataIndex: 99 }])).toBe('');
  });
});
