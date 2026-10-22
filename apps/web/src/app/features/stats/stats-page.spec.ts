import { Directive, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import {
  DEFAULT_BASE_TARGETS,
  addDays,
  diffDays,
  zeroNutrients,
  type DaySummary,
  type InsightsResponse,
  type RangeDashboardResponse,
  type RangeStats,
} from '@food/shared';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { todayLocalDate } from '../../core/time';
import { DATA_REFRESH_DEBOUNCE_MS } from '../today/data-watch';
import { makeWeightSummary } from '../today/today-fixtures';
import { StatsInsights } from './stats-insights';
import { StatsPage } from './stats-page';
import { STATS_STALE_MS, StatsState } from './stats-state';
import { StatsTrends } from './stats-trends';
import { StatsWeek } from './stats-week';
import { StatsWeight } from './stats-weight';
import { currentWeekStart, formatDateRange, weekRange } from './week-range';

@Directive({ selector: '[echarts]' })
class FakeEcharts {
  readonly options = input<unknown>();
  readonly theme = input<unknown>();
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function stats(overrides: Partial<RangeStats> = {}): RangeStats {
  return {
    loggedDays: 2,
    totalDays: 3,
    avgTotals: { ...zeroNutrients(), calories: 2100, protein: 125, carbs: 210, fat: 70 },
    avgTargets: { ...DEFAULT_BASE_TARGETS },
    macroSplit: { protein: 24, carbs: 43, fat: 33, alcohol: 0 },
    proteinHitDays: 2,
    calorieOnTargetDays: 1,
    satFatOverDays: 1,
    sodiumOverDays: 0,
    fiberHitDays: 0,
    weekdayAverages: [],
    avgMicros: {},
    microsCoverage: { items: 0, withMicros: 0 },
    microsDays: 0,
    avgFluidsMl: 0,
    fluidDays: 0,
    fluidHitDays: 0,
    ...overrides,
  };
}

function rangeResponse(from: string, to: string, logged = true): RangeDashboardResponse {
  const days: DaySummary[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    days.push({
      date,
      trainingDay: false,
      targets: { ...DEFAULT_BASE_TARGETS },
      totals: { ...zeroNutrients(), calories: logged ? 2100 : 0 },
      entryCount: logged ? 1 : 0,
      micros: {},
      microsCoverage: { items: 0, withMicros: 0 },
      fluidsMl: 0,
      fluidTargetMl: 2500,
    });
  }
  return {
    from,
    to,
    days,
    stats: logged
      ? stats()
      : stats({ loggedDays: 0, macroSplit: { protein: 0, carbs: 0, fat: 0, alcohol: 0 } }),
  };
}

describe('Stats', () => {
  const today = todayLocalDate();
  let api: {
    rangeDashboard: ReturnType<
      typeof vi.fn<(from: string, to: string) => Promise<RangeDashboardResponse>>
    >;
    insights: ReturnType<typeof vi.fn<() => Promise<InsightsResponse>>>;
    weights: ReturnType<typeof vi.fn>;
    getProfile: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      rangeDashboard: vi.fn(),
      insights: vi.fn(),
      weights: vi.fn(async (from: string, to: string) => makeWeightSummary(from, to)),
      getProfile: vi.fn().mockRejectedValue(new Error('offline')),
    };
    api.rangeDashboard.mockImplementation(async (from, to) => rangeResponse(from, to));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
    for (const component of [StatsWeek, StatsTrends, StatsWeight]) {
      TestBed.overrideComponent(component, {
        remove: { imports: [NgxEchartsDirective] },
        add: { imports: [FakeEcharts] },
      });
    }
  });

  async function render(tab?: string) {
    const fixture = TestBed.createComponent(StatsPage);
    if (tab) {
      fixture.componentRef.setInput('tab', tab);
    }
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('opens on the current week with charts, averages, split and consistency', async () => {
    const { fixture, el } = await render();
    const week = weekRange(currentWeekStart(today), today);
    expect(api.rangeDashboard).toHaveBeenCalledWith(week.start, week.to);
    expect(el.textContent).toContain('This week');
    expect(el.textContent).toContain('Daily averages');
    expect(el.textContent).toContain('Macro split');
    expect(el.textContent).toContain('Protein target hit');
    const charts = fixture.debugElement.queryAll(By.directive(FakeEcharts));
    expect(charts).toHaveLength(2);
    const option = charts[0].injector.get(FakeEcharts).options() as { series: unknown[] };
    expect(option.series).toHaveLength(2);
    expect(el.querySelector('button[aria-label="Next week"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('shows the 7-day vitamin and mineral average with coverage and the upper-limit note', async () => {
    api.rangeDashboard.mockImplementation(async (from, to) => ({
      ...rangeResponse(from, to),
      stats: stats({
        avgMicros: { vitaminD: 130, potassium: 2100, caffeine: 180 },
        microsDays: 5,
        microsCoverage: { items: 40, withMicros: 31 },
      }),
    }));
    const { el } = await render();
    const card = el.querySelector<HTMLElement>('section[aria-labelledby="week-micros-title"]')!;
    expect(card.querySelector('h2')?.textContent?.trim()).toBe(
      'Vitamins & minerals — 7-day average',
    );
    expect(card.textContent).toContain('Averaged over 5 days with enough data');
    expect(Array.from(card.querySelectorAll('h3')).map((h) => h.textContent?.trim())).toEqual([
      'Vitamins',
      'Minerals',
      'Other',
    ]);
    expect(card.querySelector('[data-micro="vitaminD"]')?.textContent).toContain(
      'Above the usual upper limit (100 µg/day)',
    );
    expect(card.querySelector('[data-micro="potassium"]')?.textContent).toContain('2,100 mg');
    expect(card.querySelector('[data-micro="zinc"]')?.textContent).toContain('—');
    expect(card.querySelector('[data-micros-coverage]')?.textContent).toBe(
      'Estimated for 31 of 40 foods; older logs have no vitamin data',
    );
    expect(card.querySelectorAll('[data-micros-disclaimer]')).toHaveLength(1);
  });

  it('explains the vitamin average until a week has enough data', async () => {
    api.rangeDashboard.mockImplementation(async (from, to) => ({
      ...rangeResponse(from, to),
      stats: stats({ microsDays: 0, microsCoverage: { items: 12, withMicros: 2 } }),
    }));
    const { el } = await render();
    const card = el.querySelector<HTMLElement>('section[aria-labelledby="week-micros-title"]')!;
    expect(card.textContent).toContain('Not enough vitamin data this week yet');
    expect(card.querySelector('app-micros-panel')).toBeNull();
    expect(card.querySelector('[data-micros-coverage]')?.textContent).toBe(
      'Estimated for 2 of 12 foods; older logs have no vitamin data',
    );
  });

  it('shows fluids per day against the target and the week average', async () => {
    api.rangeDashboard.mockImplementation(async (from, to) => {
      const response = rangeResponse(from, to);
      return {
        ...response,
        days: response.days.map((day, index) => ({
          ...day,
          fluidsMl: index === 0 ? 2800 : 1400,
          fluidTargetMl: 2500,
        })),
        stats: stats({
          avgFluidsMl: 1900,
          fluidDays: response.days.length,
          fluidHitDays: 1,
        }),
      };
    });
    const { el } = await render();
    const [from, to] = api.rangeDashboard.mock.calls.at(-1)!;
    const shown = diffDays(from, to) + 1;
    const card = el.querySelector<HTMLElement>('[data-week-fluids]')!;
    expect(card.querySelector('h2')?.textContent?.trim()).toBe('Fluids');
    expect(card.textContent).toContain('1.9');
    expect(card.textContent).toContain('L/day');
    expect(card.textContent).toContain('target 2.5 L');
    expect(card.textContent).toContain(
      `Target reached 1 of ${shown} ${shown === 1 ? 'day' : 'days'} with drinks logged`,
    );
    const bars = card.querySelectorAll('li[aria-label]');
    expect(bars).toHaveLength(7);
    expect(bars[0]!.getAttribute('aria-label')).toMatch(/: 2\.8 of 2\.5 L, target reached$/);
    expect(bars[0]!.querySelector('[data-fluid-value]')?.textContent?.trim()).toBe('2.8');
    const fill = bars[0]!.querySelector<HTMLElement>('[data-fluid-bar]')!;
    expect(fill.style.height).toBe('93.3%');
    expect(fill.className).toContain('bg-fluid');
    expect(bars[0]!.querySelector<HTMLElement>('[data-fluid-target]')!.style.bottom).toBe('83.3%');
    if (shown > 1) {
      expect(bars[1]!.getAttribute('aria-label')).toMatch(/: 1\.4 of 2\.5 L$/);
      expect(bars[1]!.querySelector('[data-fluid-bar]')!.className).toContain('bg-fluid/55');
    }
  });

  it('explains the fluids card until drinks are logged', async () => {
    const { el } = await render();
    const card = el.querySelector<HTMLElement>('[data-week-fluids]')!;
    expect(card.textContent).toContain('No drinks logged this week yet');
    expect(card.textContent).not.toContain('L/day');
  });

  it('navigates to the previous week and back', async () => {
    const { fixture, el } = await render();
    const subtitle = () => el.querySelector('app-page-header')?.textContent ?? '';
    expect(subtitle()).toContain('How this week is going');
    (el.querySelector('button[aria-label="Previous week"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    const previous = addDays(currentWeekStart(today), -7);
    expect(api.rangeDashboard).toHaveBeenLastCalledWith(previous, addDays(previous, 6));
    expect(el.textContent).toContain('Last week');
    expect(subtitle()).toContain('How your week went');
    expect(subtitle()).not.toContain('How this week is going');
    const next = el.querySelector('button[aria-label="Next week"]') as HTMLButtonElement;
    expect(next.hasAttribute('disabled')).toBe(false);
    next.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('This week');
    expect(subtitle()).toContain('How this week is going');
    expect(api.rangeDashboard).toHaveBeenCalledTimes(2);
  });

  it('keeps the other tab subtitles when a past week is selected', async () => {
    const { fixture, el } = await render('trends');
    const state = fixture.debugElement.injector.get(StatsState);
    state.weekStart.set(addDays(currentWeekStart(today), -14));
    await fixture.whenStable();
    expect(el.querySelector('app-page-header')?.textContent).toContain('Your nutrition over time');
  });

  it('refetches the shown week once the data has gone stale', async () => {
    const { fixture } = await render();
    const week = weekRange(currentWeekStart(today), today);
    const state = fixture.debugElement.injector.get(StatsState);
    state.refreshIfStale(new Date(Date.now() + STATS_STALE_MS + 1000));
    await fixture.whenStable();
    await flush();
    expect(api.rangeDashboard).toHaveBeenCalledTimes(2);
    expect(api.rangeDashboard).toHaveBeenLastCalledWith(week.start, week.to);
  });

  it('shows an empty week and a retryable error', async () => {
    api.rangeDashboard.mockImplementationOnce(async (from, to) => rangeResponse(from, to, false));
    const { fixture, el } = await render();
    expect(el.textContent).toContain('Nothing logged this week yet');

    api.rangeDashboard.mockRejectedValueOnce(new Error('Stats are down'));
    (el.querySelector('button[aria-label="Previous week"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Stats are down');
    const retry = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Try again'),
    ) as HTMLButtonElement;
    retry.click();
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.textContent).toContain('Last week');
  });

  it('shows trends for the selected nutrient and range', async () => {
    const { fixture, el } = await render('trends');
    expect(api.rangeDashboard).toHaveBeenCalledWith(addDays(today, -29), today);
    expect(el.querySelector('#trend-title')?.textContent).toContain('Calories');

    const protein = Array.from(el.querySelectorAll('button[aria-pressed]')).find((b) =>
      b.textContent?.includes('Protein'),
    ) as HTMLButtonElement;
    protein.click();
    await fixture.whenStable();
    expect(protein.getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('#trend-title')?.textContent).toContain('Protein');
    expect(el.textContent).toContain('Average protein by weekday');

    const ninety = Array.from(el.querySelectorAll('button[role="radio"]')).find((b) =>
      b.textContent?.includes('90 days'),
    ) as HTMLButtonElement;
    ninety.click();
    await fixture.whenStable();
    await flush();
    expect(api.rangeDashboard).toHaveBeenCalledWith(addDays(today, -89), today);
    expect(api.rangeDashboard).toHaveBeenCalledWith(addDays(today, -95), addDays(today, -90));
    const chart = fixture.debugElement.queryAll(By.directive(FakeEcharts))[0];
    const option = chart.injector.get(FakeEcharts).options() as { series: unknown[] };
    expect(option.series).toHaveLength(3);
  });

  it('labels the insights period as ending yesterday', async () => {
    api.insights.mockResolvedValue({
      from: addDays(today, -7),
      to: addDays(today, -1),
      insights: [{ id: 'fiber-good', severity: 'good', title: 'Fiber on track', detail: 'Nice.' }],
    });
    const { el } = await render('insights');
    const period = el.querySelector('app-stats-insights p.tabular-nums')?.textContent ?? '';
    expect(period).toContain(formatDateRange(addDays(today, -7), addDays(today, -1), today));
    expect(period).toContain('today not included');
  });

  it('groups insights by severity and switches the window', async () => {
    api.insights.mockResolvedValue({
      from: addDays(today, -6),
      to: today,
      insights: [
        {
          id: 'protein-hit',
          severity: 'good',
          title: 'Protein target hit 6 of 7 days',
          detail: 'Nice.',
        },
        {
          id: 'sodium-over',
          severity: 'warning',
          title: 'Sodium over limit 4 of 7 days',
          detail: 'Watch sauces.',
        },
      ],
    });
    const { fixture, el } = await render('insights');
    expect(api.insights).toHaveBeenCalledWith({ to: addDays(today, -1), days: 7 });
    const headings = Array.from(el.querySelectorAll('h2.section-title')).map((h) =>
      h.textContent?.trim(),
    );
    expect(headings).toEqual(['Needs attention', 'Going well']);
    expect(el.textContent).toContain('Watch sauces.');
    expect(el.textContent).not.toContain('today not included');

    const insights = fixture.debugElement.query(By.directive(StatsInsights));
    expect(insights).not.toBeNull();
    api.insights.mockResolvedValueOnce({ from: today, to: today, insights: [] });
    const thirty = Array.from(el.querySelectorAll('button[role="radio"]')).find((b) =>
      b.textContent?.includes('Last 30 days'),
    ) as HTMLButtonElement;
    thirty.click();
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    expect(api.insights).toHaveBeenLastCalledWith({ to: addDays(today, -1), days: 30 });
    expect(el.textContent).toContain('Not enough data yet');
  });

  it('writes the selected tab to the query string', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { el } = await render();
    const trends = Array.from(el.querySelectorAll('button[role="radio"]')).find((b) =>
      b.textContent?.includes('Trends'),
    ) as HTMLButtonElement;
    trends.click();
    expect(navigate.mock.calls[0][1]?.queryParams).toEqual({ tab: 'trends' });
  });

  it('offers a Weight tab that loads the last 30 days of weigh-ins', async () => {
    const { el } = await render('weight');
    const tabs = Array.from(el.querySelectorAll('button[role="radio"]')).map((b) =>
      b.textContent?.trim(),
    );
    expect(tabs.slice(0, 4)).toEqual(['Week', 'Trends', 'Insights', 'Weight']);
    expect(el.textContent).toContain('Your weight trend and daily burn');
    expect(api.weights).toHaveBeenCalledWith(addDays(today, -29), today);
    expect(el.textContent).toContain('No weigh-ins yet');
  });

  it('refreshes the shown week when entries change elsewhere', async () => {
    const { fixture } = await render();
    expect(api.rangeDashboard).toHaveBeenCalledTimes(1);
    TestBed.inject(DataEventsService).notify('entries');
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, DATA_REFRESH_DEBOUNCE_MS + 20));
    await fixture.whenStable();
    expect(api.rangeDashboard).toHaveBeenCalledTimes(2);
  });
});
