import { HttpErrorResponse } from '@angular/common/http';
import { Directive, input } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import {
  addDays,
  type AdaptiveTdeeDto,
  type ProfileResponse,
  type UpsertWeightRequest,
  type WeightLogDto,
  type WeightSummaryResponse,
} from '@food/shared';
import { NgxEchartsDirective } from 'ngx-echarts';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { OFFLINE_MESSAGE } from '../../core/errors';
import { shortDateLabel, todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { installDialogShim } from '../../shared/testing/dialog-shim';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { DATA_REFRESH_DEBOUNCE_MS } from '../today/data-watch';
import { makeWeightSummary } from '../today/today-fixtures';
import { StatsState } from './stats-state';
import { StatsWeight } from './stats-weight';

@Directive({ selector: '[echarts]' })
class FakeEcharts {
  readonly options = input<unknown>();
  readonly theme = input<unknown>();
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function profile(overrides: Partial<ProfileResponse['targets']> = {}): ProfileResponse {
  return {
    profile: {
      weightKg: 80,
      heightCm: 180,
      age: 35,
      sex: 'male',
      bodyFatPct: null,
      tdeeOverride: null,
      onboarded: true,
      activityLevel: 'moderate',
      goal: 'cut',
      trainingDaysPerWeek: 3,
      targetOverrides: {},
      location: null,
      aiModel: null,
      aiDetailFood: 'high',
      aiDetailLabel: 'high',
      theme: 'dark',
    },
    targets: { tdee: 2300, tdeeSource: 'formula', ...overrides },
  } as unknown as ProfileResponse;
}

const adaptive: AdaptiveTdeeDto = {
  kcal: 2480,
  windowDays: 28,
  loggedDays: 26,
  weighIns: 14,
  avgIntakeKcal: 2190,
  weightChangeKg: -1.05,
  confidence: 'medium',
};

describe('StatsWeight', () => {
  const today = todayLocalDate();
  const from30 = addDays(today, -29);
  let restoreDialog: () => void;
  let api: {
    weights: ReturnType<typeof vi.fn<(from: string, to: string) => Promise<WeightSummaryResponse>>>;
    getProfile: ReturnType<typeof vi.fn<() => Promise<ProfileResponse>>>;
    putProfile: ReturnType<
      typeof vi.fn<(body: ProfileResponse['profile']) => Promise<ProfileResponse>>
    >;
    putWeight: ReturnType<
      typeof vi.fn<(date: string, body: UpsertWeightRequest) => Promise<WeightLogDto>>
    >;
    deleteWeight: ReturnType<typeof vi.fn<(date: string) => Promise<void>>>;
  };

  const log = (
    daysAgo: number,
    weightKg: number,
    bodyFatPct: number | null = null,
  ): WeightLogDto => ({
    date: addDays(today, -daysAgo),
    weightKg,
    bodyFatPct,
  });

  const standardLogs = [log(20, 82), log(13, 81.4), log(6, 80.8), log(1, 80.2, 18.5)];

  beforeAll(() => {
    restoreDialog = installDialogShim();
  });

  afterAll(() => restoreDialog());

  beforeEach(() => {
    api = {
      weights: vi.fn(async (from: string, to: string) =>
        makeWeightSummary(from, to, standardLogs, {
          weeklyChangeKg: -0.42,
          adaptiveTdee: adaptive,
        }),
      ),
      getProfile: vi.fn(async () => profile()),
      putProfile: vi.fn(async (body) => ({
        ...profile({
          tdee: body.tdeeOverride ?? 2300,
          tdeeSource: body.tdeeOverride ? 'override' : 'formula',
        }),
        profile: body,
      })),
      putWeight: vi.fn(async (date, body) => ({
        date,
        weightKg: body.weightKg,
        bodyFatPct:
          body.bodyFatPct === undefined
            ? (standardLogs.find((item) => item.date === date)?.bodyFatPct ?? null)
            : body.bodyFatPct,
      })),
      deleteWeight: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), StatsState, { provide: ApiService, useValue: api }],
    });
    TestBed.overrideComponent(StatsWeight, {
      remove: { imports: [NgxEchartsDirective] },
      add: { imports: [FakeEcharts] },
    });
  });

  async function settle(fixture: ComponentFixture<StatsWeight>, ms = 0): Promise<void> {
    await fixture.whenStable();
    await sleep(ms);
    await fixture.whenStable();
  }

  async function render(): Promise<{ fixture: ComponentFixture<StatsWeight>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(StatsWeight);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function buttonWithText(root: Element, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.replace(/\s+/g, ' ').includes(text),
    );
    if (!found) {
      throw new Error(`No button with "${text}"`);
    }
    return found as HTMLButtonElement;
  }

  function text(el: Element): string {
    return el.textContent?.replace(/\s+/g, ' ') ?? '';
  }

  it('summarises the trend, the weekly rate and the latest weigh-in over 30 days', async () => {
    const { fixture, el } = await render();
    expect(api.weights).toHaveBeenCalledWith(from30, today);
    const hero = el.querySelector('section[aria-labelledby="weight-title"]')!;
    expect(text(hero)).toContain('Trend weight');
    const since = shortDateLabel(addDays(today, -20), today);
    expect(text(hero)).toMatch(new RegExp(`−0\\.3 kg\\s*since ${since}`));
    expect(text(hero)).toContain('−0.42 kg/wk');
    expect(text(hero)).toContain('−0.5% of body weight');
    expect(text(hero)).toMatch(/80\.2 kg\s*Yesterday/);
    const weekly = Array.from(hero.querySelectorAll('dd')).find((dd) =>
      dd.textContent?.includes('/wk'),
    );
    expect(weekly?.className).toContain('text-ok');

    const chart = fixture.debugElement.query(By.directive(FakeEcharts));
    const option = chart.injector.get(FakeEcharts).options() as { series: { name: string }[] };
    expect(option.series.map((s) => s.name)).toEqual(['Trend', 'Weigh-in']);
    expect(chart.nativeElement.getAttribute('aria-label')).toContain('4 weigh-ins');
  });

  it('switches between 30 days, 90 days and a year', async () => {
    const { fixture, el } = await render();
    buttonWithText(el, '90 days').click();
    await settle(fixture);
    expect(api.weights).toHaveBeenLastCalledWith(addDays(today, -89), today);
    buttonWithText(el, '1 year').click();
    await settle(fixture);
    expect(api.weights).toHaveBeenLastCalledWith(addDays(today, -364), today);
    expect(buttonWithText(el, '1 year').getAttribute('aria-checked')).toBe('true');
    const chart = fixture.debugElement.query(By.directive(FakeEcharts));
    expect(chart.nativeElement.getAttribute('aria-label')).toContain('over the last 21 days');
  });

  it('measures the change over the whole range when earlier weigh-ins warm up the trend', async () => {
    api.weights.mockImplementation(async (from, to) => {
      const warm = makeWeightSummary(addDays(from, -10), to, [log(35, 83), ...standardLogs]);
      return { ...warm, from, trend: warm.trend.slice(10) };
    });
    const { el } = await render();
    const hero = el.querySelector('section[aria-labelledby="weight-title"]')!;
    expect(text(hero)).toMatch(/kg\s*last 30 days/);
  });

  it('compares the measured burn and adopts it as the daily burn with undo', async () => {
    const { fixture, el } = await render();
    const card = el.querySelector('app-adaptive-burn-card')!;
    expect(text(card)).toMatch(/≈ 2,480\s*kcal\/day/);
    expect(text(card)).toContain('Medium confidence');
    expect(text(card)).toContain('26 logged days and 14 weigh-ins over the last 28 days');
    expect(text(card)).toContain('2,190 kcal');
    expect(text(card)).toMatch(/Current daily burn · from your profile\s*2,300 kcal/);
    expect(text(card)).toContain('+180 kcal (+8%)');

    const events = TestBed.inject(DataEventsService);
    buttonWithText(card, 'Use as my daily burn').click();
    await settle(fixture);
    expect(api.putProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tdeeOverride: 2480, goal: 'cut', weightKg: 80 }),
    );
    expect(events.profile()).toBe(1);
    expect(text(card)).toContain('Used as your daily burn');
    const toasts = TestBed.inject(ToastService);
    const toast = toasts.toasts().at(-1)!;
    expect(toast.message).toBe('Daily burn set to 2,480 kcal. Targets updated.');

    toasts.runAction(toast.id);
    await settle(fixture);
    expect(api.putProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ tdeeOverride: null }),
    );
    expect(events.profile()).toBe(2);
  });

  it('adopts and undoes the burn from the shared profile without fetching it again', async () => {
    const { fixture, el } = await render();
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    const card = el.querySelector('app-adaptive-burn-card')!;
    buttonWithText(card, 'Use as my daily burn').click();
    await settle(fixture);
    const toasts = TestBed.inject(ToastService);
    toasts.runAction(toasts.toasts().at(-1)!.id);
    await settle(fixture);
    expect(api.putProfile).toHaveBeenCalledTimes(2);
    expect(api.getProfile).toHaveBeenCalledTimes(1);
    expect(toasts.toasts().at(-1)?.message).toBe('Daily burn restored');
  });

  it('waits for a profile reload in flight so a fresh weigh-in is not overwritten', async () => {
    const { fixture, el } = await render();
    let release!: () => void;
    api.getProfile.mockImplementationOnce(
      () =>
        new Promise<ProfileResponse>((resolve) => {
          release = () =>
            resolve({ ...profile(), profile: { ...profile().profile, weightKg: 79.4 } });
        }),
    );
    TestBed.inject(DataEventsService).notify('profile');
    await settle(fixture);
    expect(api.getProfile).toHaveBeenCalledTimes(2);

    buttonWithText(el.querySelector('app-adaptive-burn-card')!, 'Use as my daily burn').click();
    await settle(fixture);
    expect(api.putProfile).not.toHaveBeenCalled();

    release();
    await settle(fixture);
    expect(api.putProfile).toHaveBeenCalledTimes(1);
    expect(api.putProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tdeeOverride: 2480, weightKg: 79.4 }),
    );
  });

  it('waits for a profile change announced right before adopting the burn', async () => {
    const { fixture, el } = await render();
    api.getProfile.mockResolvedValueOnce({
      ...profile(),
      profile: { ...profile().profile, weightKg: 79.4 },
    });
    TestBed.inject(DataEventsService).notify('profile');
    buttonWithText(el.querySelector('app-adaptive-burn-card')!, 'Use as my daily burn').click();
    await settle(fixture);
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(api.putProfile).toHaveBeenCalledTimes(1);
    expect(api.putProfile).toHaveBeenCalledWith(
      expect.objectContaining({ tdeeOverride: 2480, weightKg: 79.4 }),
    );
  });

  it('retries the profile once when the reload in flight fails', async () => {
    const { fixture, el } = await render();
    let fail!: () => void;
    api.getProfile.mockImplementationOnce(
      () =>
        new Promise<ProfileResponse>((_, reject) => {
          fail = () => reject(new HttpErrorResponse({ status: 0 }));
        }),
    );
    TestBed.inject(DataEventsService).notify('profile');
    await settle(fixture);
    buttonWithText(el.querySelector('app-adaptive-burn-card')!, 'Use as my daily burn').click();
    await settle(fixture);
    expect(api.putProfile).not.toHaveBeenCalled();

    fail();
    await settle(fixture);
    expect(api.getProfile).toHaveBeenCalledTimes(3);
    expect(api.putProfile).toHaveBeenCalledTimes(1);
    expect(api.putProfile).toHaveBeenCalledWith(expect.objectContaining({ tdeeOverride: 2480 }));
  });

  it('restores a previous daily burn override on undo', async () => {
    api.getProfile.mockResolvedValue({
      ...profile({ tdee: 2600, tdeeSource: 'override' }),
      profile: { ...profile().profile, tdeeOverride: 2600 },
    });
    const { fixture, el } = await render();
    buttonWithText(el.querySelector('app-adaptive-burn-card')!, 'Use as my daily burn').click();
    await settle(fixture);
    const toasts = TestBed.inject(ToastService);
    toasts.runAction(toasts.toasts().at(-1)!.id);
    await settle(fixture);
    expect(api.putProfile).toHaveBeenLastCalledWith(
      expect.objectContaining({ tdeeOverride: 2600 }),
    );
  });

  it('loads the profile on demand when it was unavailable at first', async () => {
    api.getProfile.mockRejectedValueOnce(new Error('offline'));
    const { fixture, el } = await render();
    buttonWithText(el.querySelector('app-adaptive-burn-card')!, 'Use as my daily burn').click();
    await settle(fixture);
    expect(api.getProfile).toHaveBeenCalledTimes(2);
    expect(api.putProfile).toHaveBeenCalledWith(expect.objectContaining({ tdeeOverride: 2480 }));
  });

  it('reports a failure without saving when the profile cannot be loaded', async () => {
    api.getProfile.mockRejectedValue(new HttpErrorResponse({ status: 0 }));
    const { fixture, el } = await render();
    buttonWithText(el.querySelector('app-adaptive-burn-card')!, 'Use as my daily burn').click();
    await settle(fixture);
    expect(api.putProfile).not.toHaveBeenCalled();
    const toast = TestBed.inject(ToastService).toasts().at(-1);
    expect(toast?.kind).toBe('error');
    expect(toast?.message).toBe(OFFLINE_MESSAGE);
  });

  it('explains what is needed when the burn cannot be measured yet', async () => {
    api.weights.mockImplementation(async (from, to) =>
      makeWeightSummary(from, to, standardLogs, { adaptiveTdee: null }),
    );
    const { el } = await render();
    const card = el.querySelector('app-adaptive-burn-card')!;
    expect(text(card)).toContain('Not enough data yet');
    expect(text(card)).toContain('weigh in 3+ times a week for 2–4 weeks');
    expect(text(card)).toContain('1 / week (aim for 3+)');
    expect(card.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('1');
    expect(text(el)).toContain('Needs more data');
  });

  async function openInlineEditor(fixture: ComponentFixture<StatsWeight>, el: HTMLElement) {
    const list = el.querySelector('app-weigh-in-list')!;
    list.querySelector<HTMLButtonElement>('li > button')!.click();
    await settle(fixture);
    const date = addDays(today, -1);
    const fat = list.querySelector<HTMLInputElement>(`#weigh-in-fat-${date}`)!;
    const submit = async () => {
      list.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(fixture);
    };
    return { list, date, fat, submit };
  }

  it('edits only the weight inline and keeps the stored body fat out of the request', async () => {
    const { fixture, el } = await render();
    const list = el.querySelector('app-weigh-in-list')!;
    const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('li > button'));
    expect(rows).toHaveLength(4);
    expect(text(rows[0]!).trim()).toMatch(/^Yesterday/);
    expect(text(rows[0]!)).toContain('18.5% body fat');
    expect(text(rows[0]!)).toContain('−0.6');

    rows[0]!.click();
    await settle(fixture);
    const weight = list.querySelector<HTMLInputElement>(`#weigh-in-weight-${addDays(today, -1)}`)!;
    expect(weight.value).toBe('80.2');
    expect(list.querySelector<HTMLInputElement>(`#weigh-in-fat-${addDays(today, -1)}`)!.value).toBe(
      '18.5',
    );
    (list.querySelector('button[aria-label="Decrease by 0.1 kg"]') as HTMLButtonElement).click();
    await settle(fixture);
    list.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);

    expect(api.putWeight).toHaveBeenCalledWith(addDays(today, -1), { weightKg: 80.1 });
    expect('bodyFatPct' in api.putWeight.mock.calls[0]![1]).toBe(false);
    const events = TestBed.inject(DataEventsService);
    expect(events.weights()).toBe(1);
    expect(events.profile()).toBe(1);
    expect(list.querySelector('form')).toBeNull();
    expect(text(list)).toContain('80.1');
    expect(text(list)).toContain('18.5% body fat');
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
      'Saved 80.1 kg for yesterday',
    );
  });

  it('sends a body fat reading typed into the inline editor', async () => {
    const { fixture, el } = await render();
    const { date, fat, submit } = await openInlineEditor(fixture, el);
    fat.value = '17';
    fat.dispatchEvent(new Event('input'));
    await submit();
    expect(api.putWeight).toHaveBeenCalledWith(date, { weightKg: 80.2, bodyFatPct: 17 });
  });

  it('clears a body fat reading emptied in the inline editor', async () => {
    const { fixture, el } = await render();
    const { date, fat, submit } = await openInlineEditor(fixture, el);
    fat.value = '';
    fat.dispatchEvent(new Event('input'));
    await submit();
    expect(api.putWeight).toHaveBeenCalledWith(date, { weightKg: 80.2, bodyFatPct: null });
  });

  it('shows every weigh-in in the range on request so older ones can be fixed or deleted', async () => {
    const many = Array.from({ length: 20 }, (_, index) => log(index + 1, 80 + index / 10));
    api.weights.mockImplementation(async (from, to) => makeWeightSummary(from, to, many));
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    const { fixture, el } = await render();
    const list = el.querySelector('app-weigh-in-list')!;
    const rows = () => Array.from(list.querySelectorAll<HTMLButtonElement>('li > button'));
    expect(rows()).toHaveLength(14);
    expect(text(list)).toContain('Latest 14 of 20 in this range');

    const toggle = buttonWithText(list, 'Show all 20');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await settle(fixture);
    expect(rows()).toHaveLength(20);
    expect(text(list)).toContain('20 in this range');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    rows().at(-1)!.click();
    await settle(fixture);
    buttonWithText(list, 'Delete').click();
    await settle(fixture);
    expect(confirm).toHaveBeenCalled();
    expect(api.deleteWeight).toHaveBeenCalledWith(addDays(today, -20));
    expect(rows()).toHaveLength(19);

    buttonWithText(list, 'Show fewer').click();
    await settle(fixture);
    expect(rows()).toHaveLength(14);
    expect(text(list)).toContain('Latest 14 of 19 in this range');
  });

  it('closes an editor that a collapse would hide', async () => {
    const many = Array.from({ length: 16 }, (_, index) => log(index + 1, 80 + index / 10));
    api.weights.mockImplementation(async (from, to) => makeWeightSummary(from, to, many));
    const { fixture, el } = await render();
    const list = el.querySelector('app-weigh-in-list')!;
    buttonWithText(list, 'Show all 16').click();
    await settle(fixture);
    Array.from(list.querySelectorAll<HTMLButtonElement>('li > button')).at(-1)!.click();
    await settle(fixture);
    expect(list.querySelector('form')).not.toBeNull();

    buttonWithText(list, 'Show fewer').click();
    await settle(fixture);
    expect(list.querySelector('form')).toBeNull();
  });

  it('deletes a weigh-in after confirmation', async () => {
    const { fixture, el } = await render();
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    const list = el.querySelector('app-weigh-in-list')!;
    expect(text(list)).not.toContain('Show all');
    list.querySelector<HTMLButtonElement>('li > button')!.click();
    await settle(fixture);
    buttonWithText(list, 'Delete').click();
    await settle(fixture);

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
    expect(api.deleteWeight).toHaveBeenCalledWith(addDays(today, -1));
    expect(list.querySelectorAll('li')).toHaveLength(3);
    expect(TestBed.inject(DataEventsService).weights()).toBe(1);
  });

  it('adds a weigh-in for another day from the sheet', async () => {
    const { fixture, el } = await render();
    buttonWithText(el.querySelector('app-weigh-in-list')!, 'Add').click();
    await settle(fixture);
    const sheet = el.querySelector('app-weigh-in-sheet')!;
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    const date = sheet.querySelector<HTMLInputElement>('#weigh-in-sheet-date')!;
    const weight = sheet.querySelector<HTMLInputElement>('#weigh-in-sheet-weight')!;
    const fat = sheet.querySelector<HTMLInputElement>('#weigh-in-sheet-fat')!;
    expect(date.value).toBe(today);
    expect(weight.value).toBe('80.2');
    expect(text(sheet)).not.toContain('Replaces');

    date.value = addDays(today, -6);
    date.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(text(sheet)).toContain('Replaces the 80.8 kg weigh-in');
    expect(weight.value).toBe('80.8');
    expect(fat.value).toBe('');
    weight.value = '80,6';
    weight.dispatchEvent(new Event('input'));
    fat.value = '90';
    fat.dispatchEvent(new Event('input'));
    sheet.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(api.putWeight).not.toHaveBeenCalled();
    expect(sheet.querySelector('[role="alert"]')?.textContent).toContain(
      'Body fat must be between',
    );

    fat.value = '19';
    fat.dispatchEvent(new Event('input'));
    sheet.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(api.putWeight).toHaveBeenCalledWith(addDays(today, -6), {
      weightKg: 80.6,
      bodyFatPct: 19,
    });
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('asks before discarding a typed weigh-in but closes an untouched sheet', async () => {
    const { fixture, el } = await render();
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);
    const sheet = el.querySelector('app-weigh-in-sheet')!;
    const dialog = () => sheet.querySelector('dialog')!;
    const openSheet = async () => {
      buttonWithText(el.querySelector('app-weigh-in-list')!, 'Add').click();
      await settle(fixture);
    };
    const close = async () => {
      sheet.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(fixture);
    };

    await openSheet();
    await close();
    expect(confirm).not.toHaveBeenCalled();
    expect(dialog().hasAttribute('open')).toBe(false);

    await openSheet();
    const fat = sheet.querySelector<HTMLInputElement>('#weigh-in-sheet-fat')!;
    fat.value = '18';
    fat.dispatchEvent(new Event('input'));
    await close();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Discard changes?', tone: 'danger' }),
    );
    expect(dialog().hasAttribute('open')).toBe(true);

    fat.value = '';
    fat.dispatchEvent(new Event('input'));
    await close();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute('open')).toBe(false);

    await openSheet();
    sheet.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(api.putWeight).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  async function openAddSheet(fixture: ComponentFixture<StatsWeight>, el: HTMLElement) {
    buttonWithText(el.querySelector('app-weigh-in-list')!, 'Add').click();
    await settle(fixture);
    const sheet = el.querySelector('app-weigh-in-sheet')!;
    const date = sheet.querySelector<HTMLInputElement>('#weigh-in-sheet-date')!;
    const weight = sheet.querySelector<HTMLInputElement>('#weigh-in-sheet-weight')!;
    const fat = sheet.querySelector<HTMLInputElement>('#weigh-in-sheet-fat')!;
    const pick = async (value: string) => {
      date.value = value;
      date.dispatchEvent(new Event('input'));
      await settle(fixture);
    };
    const type = async (field: HTMLInputElement, value: string) => {
      field.value = value;
      field.dispatchEvent(new Event('input'));
      await settle(fixture);
    };
    const submit = async () => {
      sheet.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(fixture);
    };
    return { sheet, weight, fat, pick, type, submit };
  }

  it('prefills an existing day and keeps its body fat out of the request when untouched', async () => {
    const { fixture, el } = await render();
    const { weight, fat, pick, submit } = await openAddSheet(fixture, el);
    await pick(addDays(today, -1));
    expect(weight.value).toBe('80.2');
    expect(fat.value).toBe('18.5');
    await submit();

    const [day, body] = api.putWeight.mock.calls[0]!;
    expect(day).toBe(addDays(today, -1));
    expect(body).toEqual({ weightKg: 80.2 });
    expect('bodyFatPct' in body).toBe(false);
  });

  it('follows the picked date until the user types, then keeps the typed values', async () => {
    const { fixture, el } = await render();
    const { weight, fat, pick, type, submit } = await openAddSheet(fixture, el);
    expect(weight.value).toBe('80.2');

    await pick(addDays(today, -6));
    expect(weight.value).toBe('80.8');
    await pick(addDays(today, -2));
    expect(weight.value).toBe('80.2');
    expect(fat.value).toBe('');

    await type(weight, '79.9');
    await pick(addDays(today, -13));
    expect(weight.value).toBe('79.9');
    await submit();
    expect(api.putWeight).toHaveBeenCalledWith(addDays(today, -13), { weightKg: 79.9 });
  });

  it('clears a stored body fat reading when the sheet empties it', async () => {
    const { fixture, el } = await render();
    const { fat, pick, type, submit } = await openAddSheet(fixture, el);
    await pick(addDays(today, -1));
    await type(fat, '');
    await submit();
    expect(api.putWeight).toHaveBeenCalledWith(addDays(today, -1), {
      weightKg: 80.2,
      bodyFatPct: null,
    });
  });

  it('invites the first weigh-in when there are none', async () => {
    api.weights.mockImplementation(async (from, to) => makeWeightSummary(from, to, []));
    api.getProfile.mockRejectedValue(new Error('offline'));
    const { fixture, el } = await render();
    expect(text(el)).toContain('No weigh-ins yet');
    buttonWithText(el, 'Log your weight').click();
    await settle(fixture);
    const weight = el.querySelector<HTMLInputElement>('#weigh-in-sheet-weight')!;
    expect(weight.value).toBe('');
  });

  it('reloads when weigh-ins change elsewhere without dimming or refetching the profile', async () => {
    const { fixture, el } = await render();
    const calls = api.weights.mock.calls.length;
    let release!: () => void;
    api.weights.mockImplementationOnce(
      (from, to) =>
        new Promise((resolve) => {
          release = () =>
            resolve(makeWeightSummary(from, to, standardLogs, { weeklyChangeKg: -0.42 }));
        }),
    );
    TestBed.inject(DataEventsService).notify('weights');
    fixture.detectChanges();
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    fixture.detectChanges();
    expect(api.weights.mock.calls.length).toBe(calls + 1);
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
    release();
    await settle(fixture);
    expect(api.getProfile).toHaveBeenCalledTimes(1);
  });

  it('marks the content busy while a new range loads', async () => {
    const { fixture, el } = await render();
    let release!: () => void;
    api.weights.mockImplementationOnce(
      (from, to) =>
        new Promise((resolve) => {
          release = () => resolve(makeWeightSummary(from, to, standardLogs));
        }),
    );
    buttonWithText(el, '90 days').click();
    fixture.detectChanges();
    await sleep(0);
    fixture.detectChanges();
    expect(el.querySelector('[aria-busy="true"]')).not.toBeNull();
    release();
    await settle(fixture);
    expect(el.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('shows a retryable error', async () => {
    api.weights.mockRejectedValueOnce(new Error('Weights are down'));
    const { fixture, el } = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Weights are down');
    buttonWithText(el, 'Try again').click();
    await settle(fixture);
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(text(el)).toContain('Trend weight');
  });
});
