import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  DayDashboardResponse,
  DraftDto,
  FluidDayResponse,
  FoodSearchResponse,
  ProfileResponse,
  WeightSummaryResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { DEFAULT_DAY_START_HOUR, setDayStartHour } from '../../core/day-start';
import { DATA_REFRESH_DEBOUNCE_MS } from './data-watch';
import {
  TEST_TARGETS,
  makeDashboard,
  makeFluidDay,
  makeFluidDrink,
  makeWeightSummary,
} from './today-fixtures';
import { TodayPage } from './today-page';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createApi() {
  return {
    dayDashboard: vi
      .fn<(date: string) => Promise<DayDashboardResponse>>()
      .mockImplementation(async (date) => makeDashboard(date)),
    searchFoods: vi
      .fn<() => Promise<FoodSearchResponse>>()
      .mockResolvedValue({ query: '', results: [] }),
    getProfile: vi.fn().mockResolvedValue({
      profile: { goal: 'maintain', weightKg: 80, dayStartHour: 3 },
      targets: { ...TEST_TARGETS, complete: true },
    } as unknown as ProfileResponse),
    weights: vi
      .fn<(from: string, to: string) => Promise<WeightSummaryResponse>>()
      .mockImplementation(async (from, to) => makeWeightSummary(from, to)),
    putDay: vi.fn(),
    listDrafts: vi.fn<() => Promise<DraftDto[]>>().mockResolvedValue([]),
    fluidDay: vi
      .fn<(date: string) => Promise<FluidDayResponse>>()
      .mockImplementation(async (date) => makeFluidDay(date)),
    createFluid: vi.fn(),
    deleteFluid: vi.fn(),
  };
}

describe('TodayPage day start and fluids', () => {
  let api: ReturnType<typeof createApi>;

  beforeEach(() => {
    api = createApi();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    setDayStartHour(DEFAULT_DAY_START_HOUR, null);
  });

  function freezeClock(at: Date): void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
  }

  async function render() {
    const fixture = TestBed.createComponent(TodayPage);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function header(el: HTMLElement): string {
    return el.querySelector('app-day-header h1')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  it('keeps yesterday as Today at 00:56 and notes when the day ends', async () => {
    setDayStartHour(3, null);
    freezeClock(new Date(2026, 9, 2, 0, 56));
    const { el } = await render();

    expect(api.dayDashboard).toHaveBeenCalledWith('2026-10-01');
    expect(api.dayDashboard).not.toHaveBeenCalledWith('2026-10-02');
    expect(api.fluidDay).toHaveBeenCalledWith('2026-10-01');
    expect(header(el)).toContain('Today');
    expect(header(el)).toContain('Thu 1 Oct');
    expect(el.querySelector('[data-day-ends]')?.textContent).toContain('Day ends at 3 am');
    expect(el.querySelector('button[aria-label="Next day"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('moves to the calendar date from the day start on', async () => {
    setDayStartHour(3, null);
    freezeClock(new Date(2026, 9, 2, 3, 0));
    const { el } = await render();

    expect(api.dayDashboard).toHaveBeenCalledWith('2026-10-02');
    expect(header(el)).toContain('Fri 2 Oct');
    expect(el.querySelector('[data-day-ends]')).toBeNull();
  });

  it('starts the new day at midnight when the day start is midnight', async () => {
    setDayStartHour(0, null);
    api.getProfile.mockResolvedValue({
      profile: { goal: 'maintain', weightKg: 80, dayStartHour: 0 },
      targets: { ...TEST_TARGETS, complete: true },
    } as unknown as ProfileResponse);
    freezeClock(new Date(2026, 9, 2, 0, 56));
    const { el } = await render();

    expect(api.dayDashboard).toHaveBeenCalledWith('2026-10-02');
    expect(el.querySelector('[data-day-ends]')).toBeNull();
  });

  it('switches Today as soon as the day start changes', async () => {
    setDayStartHour(3, null);
    freezeClock(new Date(2026, 9, 2, 0, 56));
    const { fixture, el } = await render();
    expect(header(el)).toContain('Thu 1 Oct');

    setDayStartHour(0, null);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    expect(api.dayDashboard).toHaveBeenLastCalledWith('2026-10-02');
    expect(header(el)).toContain('Fri 2 Oct');
    expect(el.querySelector('[data-day-ends]')).toBeNull();
  });

  it('refreshes the fluids card when a meal with a drink is logged', async () => {
    const { fixture, el } = await render();
    const date = api.fluidDay.mock.calls.at(-1)![0];
    expect(el.querySelector('[data-fluid-drink]')).toBeNull();

    api.fluidDay.mockResolvedValue(
      makeFluidDay(date, [], [makeFluidDrink({ itemId: 'i1', name: 'Diet Pepsi', ml: 330 })]),
    );
    TestBed.inject(DataEventsService).notify('entries');
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    await fixture.whenStable();

    expect(el.querySelector('[data-fluid-drink]')?.textContent).toContain('Diet Pepsi');
    expect(el.querySelector('[data-fluids-progress]')?.textContent).toContain('0.33');
  });

  it('refreshes the day totals after a fluid change so caffeine stays current', async () => {
    const { fixture } = await render();
    const dashboards = api.dayDashboard.mock.calls.length;
    const fluids = api.fluidDay.mock.calls.length;
    TestBed.inject(DataEventsService).notify('fluids');
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    await fixture.whenStable();
    expect(api.dayDashboard.mock.calls.length).toBe(dashboards + 1);
    expect(api.fluidDay.mock.calls.length).toBe(fluids);
  });

  it('reloads the fluid target after marking a training day', async () => {
    api.putDay.mockImplementation(async (date: string, body: { trainingDay: boolean }) => ({
      date,
      trainingDay: body.trainingDay,
    }));
    const { fixture, el } = await render();
    const fluids = api.fluidDay.mock.calls.length;
    (el.querySelector('button[aria-label="Training day"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    await flush();
    expect(api.fluidDay.mock.calls.length).toBeGreaterThan(fluids);
  });
});
