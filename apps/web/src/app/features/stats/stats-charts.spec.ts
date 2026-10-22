import { DEFAULT_BASE_TARGETS, zeroNutrients, type DaySummary } from '@food/shared';
import { baseChartOption, readChartPalette } from '../../shared/charts/echarts';
import {
  buildMacroDonutOption,
  buildTrendOption,
  buildWeekCaloriesOption,
  buildWeekdayOption,
  compactNumber,
  targetTickWidth,
  weekCaloriesAriaLabel,
} from './stats-charts';
import { buildTrendSeries, weekdayRows } from './trend-series';
import { macroShares, weekRows } from './week-summary';
import { buildWeightChartOption, weightChartData } from './weight-chart';

type Loose = Record<string, unknown>;

const palette = readChartPalette(document);

function seriesOf(option: unknown): Loose[] {
  return (option as { series: Loose[] }).series;
}

function tooltipFormatter(option: unknown): (params: unknown) => string {
  return (option as { tooltip: { formatter: (params: unknown) => string } }).tooltip.formatter;
}

function summary(date: string, calories: number | null, trainingDay = false): DaySummary {
  return {
    date,
    trainingDay,
    targets: { ...DEFAULT_BASE_TARGETS },
    totals: { ...zeroNutrients(), calories: calories ?? 0, protein: 100 },
    entryCount: calories === null ? 0 : 1,
    micros: {},
    microsCoverage: { items: 0, withMicros: 0 },
    fluidsMl: 0,
    fluidTargetMl: 2500,
  };
}

describe('targetTickWidth', () => {
  it('sizes target ticks to the number of days shown', () => {
    expect(targetTickWidth(7)).toBe(22);
    expect(targetTickWidth(30)).toBe(6);
    expect(targetTickWidth(90)).toBe(2);
    expect(targetTickWidth(0)).toBe(22);
  });
});

describe('compactNumber', () => {
  it('shortens thousands', () => {
    expect(compactNumber(950)).toBe('950');
    expect(compactNumber(2000)).toBe('2k');
    expect(compactNumber(2450)).toBe('2.5k');
  });
});

describe('week calories chart', () => {
  const rows = weekRows(
    ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'],
    [summary('2026-09-28', 2500, true), summary('2026-09-29', 1950), summary('2026-09-30', null)],
    '2026-09-30',
  );
  const option = buildWeekCaloriesOption(rows, palette);

  it('draws status-coloured bars, gaps for empty days and target markers', () => {
    const [bars, targets] = seriesOf(option);
    expect(bars['type']).toBe('bar');
    const data = bars['data'] as ({ value: number; itemStyle: { color: string } } | null)[];
    expect(data[0]?.value).toBe(2500);
    expect(data[0]?.itemStyle.color).toBe(palette.danger);
    expect(data[1]?.itemStyle.color).toBe(palette.ok);
    expect(data[2]).toBeNull();
    expect(data[3]).toBeNull();
    expect(targets['type']).toBe('line');
    expect(targets['data']).toEqual([2000, 2000, 2000, null]);
    expect((targets['lineStyle'] as Loose)['opacity']).toBe(0);
    expect(option['backgroundColor']).toBe('transparent');
  });

  it('marks training days on the axis and explains each day in the tooltip', () => {
    const xAxis = option.xAxis as { axisLabel: { formatter: (v: string, i: number) => string } };
    expect(xAxis.axisLabel.formatter('Mon', 0)).toContain('{training|');
    expect(xAxis.axisLabel.formatter('Tue', 1)).not.toContain('{training|');
    const format = tooltipFormatter(option);
    const monday = format([{ dataIndex: 0 }]);
    expect(monday).toContain('Mon 28 Sep');
    expect(monday).toContain('2,500 kcal');
    expect(monday).toContain('500 kcal over');
    expect(monday).toContain('Training day');
    expect(format([{ dataIndex: 1 }])).toContain('On target');
    expect(format([{ dataIndex: 2 }])).toContain('Nothing logged');
    expect(format([{ dataIndex: 3 }])).toContain('Upcoming');
    expect(format([])).toBe('');
  });

  it('treats an unfinished today as progress rather than a miss', () => {
    const todayRows = weekRows(
      ['2026-09-29', '2026-09-30'],
      [summary('2026-09-29', 900), summary('2026-09-30', 900)],
      '2026-09-30',
    );
    const chart = buildWeekCaloriesOption(todayRows, palette);
    const data = seriesOf(chart)[0]['data'] as { itemStyle: { color: string } }[];
    expect(data[0].itemStyle.color).toBe(palette.calories);
    expect(data[1].itemStyle.color).not.toBe(palette.calories);
    const format = tooltipFormatter(chart);
    expect(format([{ dataIndex: 0 }])).toContain('1,100 kcal under');
    expect(format([{ dataIndex: 1 }])).toContain('Eaten so far');
    expect(format([{ dataIndex: 1 }])).toContain('1,100 kcal to go');
    expect(weekCaloriesAriaLabel(todayRows)).toBe(
      'Daily calories. Tue 29 Sep: 900 kcal of 2,000, under target; Wed 30 Sep: 900 kcal of 2,000, so far',
    );
  });

  it('describes empty and upcoming days for screen readers', () => {
    expect(weekCaloriesAriaLabel(rows)).toContain('Wed 30 Sep: nothing logged');
    expect(weekCaloriesAriaLabel(rows)).toContain('Thu 1 Oct: upcoming');
    expect(weekCaloriesAriaLabel(rows)).toContain('Mon 28 Sep: 2,500 kcal of 2,000, over target');
  });
});

describe('macro donut chart', () => {
  it('skips empty slices and colours by macro', () => {
    const shares = macroShares({ protein: 30, carbs: 70, fat: 0, alcohol: 0 }, null);
    const option = buildMacroDonutOption(shares, palette);
    const [pie] = seriesOf(option);
    const data = pie['data'] as { name: string; value: number; itemStyle: { color: string } }[];
    expect(data.map((d) => d.name)).toEqual(['Protein', 'Carbs']);
    expect(data[1].itemStyle.color).toBe(palette.carbs);
    expect(tooltipFormatter(option)({ dataIndex: 1 })).toContain('70%');
  });
});

describe('trend chart', () => {
  const series = buildTrendSeries(
    [summary('2026-09-01', 2100), summary('2026-09-02', null), summary('2026-09-03', 1900)],
    'calories',
  );
  const option = buildTrendOption(series, palette);

  it('plots daily values with gaps, a moving average and a dashed target', () => {
    const [target, daily, average] = seriesOf(option);
    expect(target['name']).toBe('Target');
    expect(target['symbol']).toBe('rect');
    expect((target['lineStyle'] as Loose)['opacity']).toBe(0);
    expect(target['data']).toEqual([2000, 2000, 2000]);
    expect(daily['data']).toEqual([2100, null, 1900]);
    expect(daily['connectNulls']).toBe(false);
    expect(daily['showAllSymbol']).toBe(true);
    expect(average['name']).toBe('7-day average');
    expect(average['data']).toEqual([2100, 2100, 2000]);
  });

  it('describes a day in the tooltip, including unlogged days', () => {
    const format = tooltipFormatter(option);
    expect(format([{ dataIndex: 0 }])).toContain('2,100 kcal');
    expect(format([{ dataIndex: 1 }])).toContain('Not logged');
    expect(format([{ dataIndex: 1 }])).toContain('7-day avg');
  });

  it('uses the limit wording for capped nutrients', () => {
    const sodium = buildTrendOption(
      buildTrendSeries([summary('2026-09-01', 2000)], 'sodium'),
      palette,
    );
    expect(seriesOf(sodium)[0]['name']).toBe('Limit');
  });
});

describe('weekday chart', () => {
  const rows = weekdayRows(
    [{ weekday: 1, loggedDays: 2, calories: 2100, protein: 120, carbs: 200, fat: 70 }],
    'calories',
  );

  it('shows one bar per weekday with a target line', () => {
    const option = buildWeekdayOption(rows, 'calories', 2000, palette);
    const [bars] = seriesOf(option);
    expect(bars['data']).toEqual([2100, null, null, null, null, null, null]);
    const markLine = bars['markLine'] as { data: { yAxis: number }[] };
    expect(markLine.data[0].yAxis).toBe(2000);
    expect(tooltipFormatter(option)([{ dataIndex: 0 }])).toContain('2 logged days');
    expect(tooltipFormatter(option)([{ dataIndex: 3 }])).toContain('No data');
  });

  it('omits the target line when there is no target', () => {
    const option = buildWeekdayOption(rows, 'calories', null, palette);
    expect(seriesOf(option)[0]['markLine']).toBeUndefined();
  });
});

describe('chart legends', () => {
  it('rely on the shared base option, which keeps the built-in legend hidden', () => {
    const rows = weekRows(['2026-09-28'], [summary('2026-09-28', 2000)], '2026-09-28');
    const trend = buildTrendSeries([summary('2026-09-01', 2100)], 'calories');
    const weekday = weekdayRows(
      [{ weekday: 1, loggedDays: 1, calories: 2100, protein: 120, carbs: 200, fat: 70 }],
      'calories',
    );
    const weight = weightChartData([{ date: '2026-09-01', weightKg: 80, trendKg: 80 }]);
    const expected = baseChartOption(palette).legend;
    const options = [
      buildWeekCaloriesOption(rows, palette),
      buildMacroDonutOption(
        macroShares({ protein: 30, carbs: 70, fat: 0, alcohol: 0 }, null),
        palette,
      ),
      buildTrendOption(trend, palette),
      buildWeekdayOption(weekday, 'calories', 2000, palette),
      buildWeightChartOption(weight, palette, '2026-09-01'),
    ];
    for (const option of options) {
      expect(option.legend).toEqual(expected);
      expect((option.legend as { show: boolean }).show).toBe(false);
    }
  });
});
