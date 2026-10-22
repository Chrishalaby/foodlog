import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import {
  addDays,
  type CreateFluidLogRequest,
  type DraftDto,
  type FluidDayResponse,
  type FluidLogDto,
  type DayDashboardResponse,
  type FoodRenameResponse,
  type FoodSearchResponse,
  type FoodSearchResult,
  type HiddenFoodsResponse,
  type MealIdeasResponse,
  type ProductDto,
  type ProfileResponse,
  type UpsertProductRequest,
  type WeightSummaryResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { KEYBOARD_PRIMER_ATTRIBUTE } from '../../core/keyboard-primer';
import { CaptureService } from '../../core/capture.service';
import { DataEventsService } from '../../core/data-events.service';
import { localDateOf, todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { ketchupSuggestion } from '../../shared/testing/my-foods-fixtures';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { QuickLogSheet } from '../log/quick-log-sheet';
import { DATA_REFRESH_DEBOUNCE_MS } from './data-watch';
import { LibraryDraftHandoff } from '../log/library-draft-handoff';
import { MealTimeline } from './meal-timeline';
import { QUICK_ADD_LONG_PRESS_MS } from './quick-add';
import {
  TEST_TARGETS,
  installDialogShim,
  makeDashboard,
  makeEntry,
  makeFluidDay,
  makeFood,
  makeProduct,
  makeWeightSummary,
  nutrients,
} from './today-fixtures';
import { TodayPage, type TodayQuickLogSelection } from './today-page';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function createApi() {
  return {
    dayDashboard: vi.fn<(date: string) => Promise<DayDashboardResponse>>(),
    searchFoods: vi
      .fn<() => Promise<FoodSearchResponse>>()
      .mockResolvedValue({ query: '', results: [] }),
    getProfile: vi.fn().mockResolvedValue({
      profile: { goal: 'maintain', weightKg: 80 },
      targets: { ...TEST_TARGETS, complete: false },
    } as unknown as ProfileResponse),
    weights: vi
      .fn<(from: string, to: string) => Promise<WeightSummaryResponse>>()
      .mockImplementation(async (from, to) => makeWeightSummary(from, to)),
    putWeight: vi.fn(),
    putDay: vi.fn(),
    deleteEntry: vi.fn(),
    duplicateEntry: vi.fn(),
    quickLog: vi.fn(),
    mealIdeas: vi.fn<() => Promise<MealIdeasResponse>>().mockResolvedValue({
      summary: 'Protein is the gap to close.',
      ideas: [
        {
          title: 'Your usual wrap',
          mealType: 'dinner',
          reason: 'Close to your usual dinner',
          parts: [
            {
              name: 'Chicken wrap',
              foodKey: 'meal:1',
              servings: 1,
              grams: 320,
              portion: null,
              nutrients: nutrients({ calories: 640, protein: 40 }),
              items: [
                { name: 'Chicken wrap', grams: 320, nutrients: nutrients({ calories: 640 }) },
              ],
            },
          ],
          totals: nutrients({ calories: 640, protein: 40 }),
          grams: 320,
        },
      ],
      usage: {
        model: 'mock',
        inputTokens: 1,
        cachedInputTokens: 0,
        outputTokens: 1,
        reasoningTokens: 0,
        costUsd: 0,
        durationMs: 1,
        attempts: 1,
      },
    }),
    createFavoriteFromEntry: vi.fn(),
    renameFood: vi.fn<(body: { from: string; to: string }) => Promise<FoodRenameResponse>>(),
    hideFood: vi.fn<(body: { name: string }) => Promise<HiddenFoodsResponse>>(),
    unhideFood: vi.fn<(name: string) => Promise<HiddenFoodsResponse>>(),
    listProducts: vi.fn<() => Promise<ProductDto[]>>(),
    upsertProduct: vi.fn<(code: string, body: UpsertProductRequest) => Promise<ProductDto>>(),
    deleteProduct: vi.fn<(id: string) => Promise<void>>(),
    listDrafts: vi.fn<() => Promise<DraftDto[]>>().mockResolvedValue([]),
    fluidDay: vi
      .fn<(date: string) => Promise<FluidDayResponse>>()
      .mockImplementation(async (date) => makeFluidDay(date)),
    createFluid: vi.fn<(body: CreateFluidLogRequest) => Promise<FluidLogDto>>(),
    deleteFluid: vi.fn<(id: string) => Promise<void>>(),
  };
}

function makeDraft(id: string, overrides: Partial<DraftDto> = {}): DraftDto {
  return {
    portion: null,
    id,
    mode: 'food_photo',
    name: null,
    description: `Draft ${id}`,
    mealType: 'lunch',
    timestamp: new Date().toISOString(),
    localDate: todayLocalDate(),
    items: null,
    analysisId: null,
    photos: [],
    createdAt: `2026-09-30T08:0${id.length}:00.000Z`,
    updatedAt: `2026-09-30T08:0${id.length}:00.000Z`,
    ...overrides,
  };
}

describe('TodayPage', () => {
  let api: ReturnType<typeof createApi>;
  const today = todayLocalDate();

  beforeEach(() => {
    api = createApi();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  async function render(date?: string) {
    const fixture = TestBed.createComponent(TodayPage);
    if (date) {
      fixture.componentRef.setInput('date', date);
    }
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function buttonWithText(el: HTMLElement, text: string): HTMLButtonElement {
    const button = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(text),
    );
    if (!button) {
      throw new Error(`No button containing "${text}"`);
    }
    return button as HTMLButtonElement;
  }

  it('shows progress, grouped meals and the quick-add library for today', async () => {
    api.dayDashboard.mockResolvedValue(
      makeDashboard(today, [
        makeEntry({
          id: 'a',
          name: 'Porridge',
          localDate: today,
          totals: nutrients({ calories: 420, protein: 18, carbs: 60, fat: 10, sodium: 2600 }),
        }),
        makeEntry({ id: 'b', name: 'Coffee', localDate: today, mealType: 'breakfast' }),
      ]),
    );
    api.searchFoods.mockResolvedValue({
      query: '',
      results: [
        makeFood({ key: 'meal:1', name: 'Porridge' }),
        makeFood({ key: 'favorite:1', kind: 'favorite', name: 'Greek yogurt', starred: true }),
      ],
    });
    const { el } = await render();

    expect(api.dayDashboard).toHaveBeenCalledWith(today);
    expect(api.searchFoods).toHaveBeenCalledWith({ limit: 10 });
    const chips = Array.from(
      el.querySelectorAll<HTMLButtonElement>('app-quick-add button[aria-label^="Log "]'),
    ).map((b) => b.getAttribute('aria-label'));
    expect(chips).toEqual(['Log Greek yogurt, 120 kcal, starred', 'Log Porridge, 120 kcal']);
    const search = el.querySelector<HTMLAnchorElement>('app-quick-add a[href^="/log"]');
    expect(search?.getAttribute('href')).toBe('/log?search=1');
    expect(el.querySelector('h1')?.textContent).toContain('Today');
    expect(el.querySelector('app-day-hero')?.textContent).toContain('820');
    expect(el.textContent).toContain('Sodium');
    expect(el.textContent).toContain('over limit');
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(2);
    expect(el.querySelector('app-meal-timeline')?.textContent).toContain('2 entries');
    expect(el.textContent).toContain('Greek yogurt');
    expect(el.textContent).toContain('Complete your profile');
    expect(el.querySelector('button[aria-label="Next day"]')?.hasAttribute('disabled')).toBe(true);
  });

  it('asks once today whether foods logged several ways should become one food', async () => {
    localStorage.clear();
    api.dayDashboard.mockResolvedValue(
      makeDashboard(today, [makeEntry({ id: 'a', localDate: today })]),
    );
    Object.assign(api, {
      foodMergeSuggestions: vi.fn().mockResolvedValue({ suggestions: [ketchupSuggestion()] }),
    });
    const { el } = await render();
    const card = el.querySelector('section[aria-labelledby="food-merge-card-title"]');
    expect(card?.textContent).toContain('Tomato ketchup was logged 3 ways');
    localStorage.clear();
  });

  it('does not ask about merging foods on other days', async () => {
    localStorage.clear();
    const yesterday = addDays(today, -1);
    api.dayDashboard.mockResolvedValue(makeDashboard(yesterday, []));
    Object.assign(api, {
      foodMergeSuggestions: vi.fn().mockResolvedValue({ suggestions: [ketchupSuggestion()] }),
    });
    const { el } = await render(yesterday);
    expect(el.querySelector('app-food-merge-card')).toBeNull();
  });

  it('shows protein above target as a success rather than a warning', async () => {
    api.dayDashboard.mockResolvedValue(
      makeDashboard(today, [
        makeEntry({
          id: 'a',
          localDate: today,
          totals: nutrients({ calories: 900, protein: 150, carbs: 20, fat: 10 }),
        }),
      ]),
    );
    const { el } = await render();
    const rings = Array.from(el.querySelectorAll<HTMLElement>('app-day-hero app-progress-ring'));
    const protein = rings.find((ring) => ring.getAttribute('aria-label')?.startsWith('Protein'));
    const carbs = rings.find((ring) => ring.getAttribute('aria-label')?.startsWith('Carbs'));
    expect(protein?.getAttribute('aria-label')).toContain('over');
    const overflow = (ring: HTMLElement | undefined) =>
      Array.from(ring?.querySelectorAll('circle') ?? [])
        .at(2)
        ?.getAttribute('stroke');
    expect(overflow(protein)).toBe('var(--color-ok)');
    const okText = Array.from(protein?.querySelectorAll('.text-ok') ?? []).map(
      (n) => n.textContent,
    );
    expect(okText.join(' ')).toMatch(/30\s.*g over/s);
    expect(protein?.querySelector('.text-danger')).toBeNull();
    expect(protein?.getAttribute('style') ?? '').not.toContain('--color-danger');
    expect(protein?.getAttribute('style') ?? '').not.toContain('--app-danger');
    expect(carbs?.getAttribute('aria-label')).toContain('left');
  });

  it('keeps carbs and fat above target in the danger tone', async () => {
    api.dayDashboard.mockResolvedValue(
      makeDashboard(today, [
        makeEntry({
          id: 'a',
          localDate: today,
          totals: nutrients({ calories: 3000, protein: 20, carbs: 500, fat: 150 }),
        }),
      ]),
    );
    const { el } = await render();
    const rings = Array.from(el.querySelectorAll<HTMLElement>('app-day-hero app-progress-ring'));
    for (const name of ['Carbs', 'Fat']) {
      const ring = rings.find((item) => item.getAttribute('aria-label')?.startsWith(name));
      const circles = Array.from(ring?.querySelectorAll('circle') ?? []);
      expect(circles.at(2)?.getAttribute('stroke'), name).toBe('var(--color-danger)');
    }
  });

  it('shows a camera call to action on an empty day', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard(today));
    const capture = TestBed.inject(CaptureService);
    const camera = vi.spyOn(capture, 'requestCamera').mockImplementation(() => undefined);
    const text = vi.spyOn(capture, 'startText').mockImplementation(() => undefined);
    const { el } = await render();

    expect(el.textContent).toContain('Nothing logged yet today');
    const quickAdd = el.querySelector('app-quick-add')!;
    const empty = el.querySelector('#today-empty-title')!;
    expect(quickAdd.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    buttonWithText(el, 'Take a photo').click();
    expect(camera).toHaveBeenCalledWith('food_photo');
    buttonWithText(el, 'Scan label').click();
    expect(camera).toHaveBeenCalledWith('nutrition_label');
    const barcode = vi.spyOn(capture, 'requestBarcode').mockImplementation(() => undefined);
    buttonWithText(el, 'Scan barcode').click();
    expect(barcode).toHaveBeenCalledTimes(1);
    buttonWithText(el, 'Describe').click();
    expect(text).toHaveBeenCalled();
    expect(document.activeElement?.hasAttribute(KEYBOARD_PRIMER_ATTRIBUTE)).toBe(true);
  });

  it('shows an error with a working retry', async () => {
    api.dayDashboard.mockRejectedValueOnce(new Error('Database unavailable'));
    const { fixture, el } = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('Database unavailable');

    api.dayDashboard.mockResolvedValueOnce(makeDashboard(today));
    buttonWithText(el, 'Try again').click();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('[role="alert"]')).toBeNull();
    expect(el.textContent).toContain('Nothing logged yet today');
  });

  it('views a past day from the query string and navigates between days', async () => {
    const past = addDays(today, -3);
    api.dayDashboard.mockResolvedValue(makeDashboard(past));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const { el } = await render(past);

    expect(api.dayDashboard).toHaveBeenCalledWith(past);
    expect(el.textContent).toContain('3 days ago');
    (el.querySelector('button[aria-label="Next day"]') as HTMLButtonElement).click();
    expect(navigate.mock.calls[0][1]?.queryParams).toEqual({ date: addDays(past, 1) });
    (el.querySelector('h1 button') as HTMLButtonElement).click();
    expect(navigate.mock.calls[1][1]?.queryParams).toEqual({ date: null });
  });

  it('logs a library item in one tap, names the day and offers undo', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard(today));
    api.searchFoods.mockResolvedValue({
      query: '',
      results: [makeFood({ key: 'meal:y', name: 'Khoury strawberry yogurt' })],
    });
    const created = makeEntry({ id: 'new', name: 'Khoury strawberry yogurt', localDate: today });
    api.quickLog.mockResolvedValueOnce(created);
    api.deleteEntry.mockResolvedValueOnce(undefined);
    const toasts = TestBed.inject(ToastService);
    const events = TestBed.inject(DataEventsService);
    const { fixture, el } = await render();

    (el.querySelector('button[aria-label^="Log Khoury"]') as HTMLButtonElement).click();
    await flush();
    await fixture.whenStable();
    expect(api.quickLog).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'meal:y', servings: 1, localDate: today }),
    );
    expect(el.querySelectorAll('app-entry-card')).toHaveLength(1);
    expect(events.entries()).toBe(1);
    expect(events.favorites()).toBe(1);
    const toast = toasts.toasts().at(-1);
    expect(toast?.message).toBe('Logged “Khoury strawberry yogurt” for today');
    expect(toast?.action?.label).toBe('Undo');

    toasts.runAction(toast!.id);
    await flush();
    expect(api.deleteEntry).toHaveBeenCalledWith('new');
    expect(events.entries()).toBe(2);
  });

  it('logs a library item to the past day being viewed', async () => {
    const past = addDays(today, -3);
    api.dayDashboard.mockResolvedValue(makeDashboard(past));
    api.searchFoods.mockResolvedValue({
      query: '',
      results: [makeFood({ key: 'meal:b', name: 'Banana' })],
    });
    api.quickLog.mockResolvedValueOnce(makeEntry({ id: 'new', name: 'Banana', localDate: past }));
    const { fixture, el } = await render(past);

    (el.querySelector('button[aria-label^="Log Banana"]') as HTMLButtonElement).click();
    await flush();
    await fixture.whenStable();
    const body = api.quickLog.mock.calls[0][0] as { localDate: string; timestamp: string };
    expect(body.localDate).toBe(past);
    expect(localDateOf(new Date(body.timestamp))).toBe(past);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toMatch(/^Logged “Banana” for /);
  });

  it('offers a retry when the food library cannot be loaded', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard(today));
    api.searchFoods.mockRejectedValueOnce(new Error('offline'));
    const { fixture, el } = await render();
    expect(el.querySelector('app-quick-add')?.textContent).toContain('Couldn’t load your foods');

    api.searchFoods.mockResolvedValueOnce({
      query: '',
      results: [makeFood({ key: 'meal:y', name: 'Yogurt' })],
    });
    buttonWithText(el.querySelector('app-quick-add') as HTMLElement, 'Retry').click();
    await flush();
    await fixture.whenStable();
    expect(el.querySelector('app-quick-add')?.textContent).not.toContain('Couldn’t load');
    expect(el.querySelector('button[aria-label^="Log Yogurt"]')).not.toBeNull();
  });

  it('puts quick add right under the calorie and macro rings, before weight and limits', async () => {
    api.dayDashboard.mockResolvedValue(
      makeDashboard(today, [
        makeEntry({
          id: 'a',
          localDate: today,
          totals: nutrients({ calories: 420, sodium: 2600 }),
        }),
      ]),
    );
    api.searchFoods.mockResolvedValue({
      query: '',
      results: [makeFood({ key: 'meal:1', name: 'Porridge' })],
    });
    const { el } = await render();
    const order = [
      'app-day-hero',
      'app-quick-add',
      'app-weight-card',
      'app-day-limits',
      'app-meal-timeline',
    ].map((selector) => el.querySelector(selector));
    expect(order.every((node) => node !== null)).toBe(true);
    for (let i = 1; i < order.length; i++) {
      const follows = order[i - 1]!.compareDocumentPosition(order[i]!);
      expect(follows & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(el.querySelectorAll('app-day-hero [role="progressbar"]')).toHaveLength(0);
    expect(el.querySelectorAll('app-day-limits [role="progressbar"]')).toHaveLength(4);
    expect(el.querySelector('app-day-limits')?.textContent).toContain('over limit');
  });

  it('puts a collapsed “Vitamins & minerals” row right under the limits card', async () => {
    localStorage.clear();
    const dashboard = makeDashboard(today, [makeEntry({ id: 'a', localDate: today })]);
    dashboard.day.micros = { vitaminD: 125, potassium: 1200 };
    dashboard.day.microsCoverage = { items: 9, withMicros: 7 };
    api.dayDashboard.mockResolvedValue(dashboard);
    const { fixture, el } = await render();
    const limits = el.querySelector('app-day-limits')!;
    const micros = el.querySelector('app-day-micros')!;
    expect(limits.nextElementSibling).toBe(micros);
    const toggle = micros.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
    expect(toggle.textContent).toContain('Vitamins & minerals');
    expect(toggle.textContent).toContain('Vitamin D above the usual limit');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(micros.querySelector('[data-micro="potassium"]')?.textContent).toContain('1,200 mg');
    expect(micros.querySelector('[data-micros-coverage]')?.textContent).toBe(
      'Estimated for 7 of 9 foods; older logs have no vitamin data',
    );
    localStorage.clear();
  });

  it('shows a compact drafts card near the top only when drafts exist', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard(today, []));
    api.listDrafts.mockResolvedValue([
      makeDraft('a'),
      makeDraft('bb', { name: 'Poke bowl' }),
      makeDraft('ccc'),
    ]);
    const { el } = await render();

    const card = el.querySelector('app-drafts-list section');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain('Drafts');
    expect(card?.querySelectorAll('button[aria-label^="Open draft"]')).toHaveLength(2);
    expect(card?.querySelector('a')?.getAttribute('href')).toBe('/log?drafts=1');
    const hero = el.querySelector('app-day-hero')!;
    const quickAdd = el.querySelector('app-quick-add')!;
    const drafts = el.querySelector('app-drafts-list')!;
    expect(hero.compareDocumentPosition(drafts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      drafts.compareDocumentPosition(quickAdd) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('hides the drafts card when there are none', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard(today, []));
    const { el } = await render();
    expect(api.listDrafts).toHaveBeenCalled();
    expect(el.querySelector('app-drafts-list section')).toBeNull();
  });

  describe('AI meal ideas', () => {
    let restoreDialog: () => void;

    beforeEach(() => {
      restoreDialog = installDialogShim();
    });

    afterEach(() => {
      restoreDialog();
    });

    function ideasDialog(el: HTMLElement): HTMLDialogElement {
      return el.querySelector<HTMLDialogElement>('app-meal-ideas-sheet dialog')!;
    }

    it('sits right under quick add on today and asks the AI only when tapped', async () => {
      api.dayDashboard.mockResolvedValue(
        makeDashboard(today, [makeEntry({ id: 'a', localDate: today })]),
      );
      const { fixture, el } = await render();
      const card = el.querySelector('app-meal-ideas-card')!;
      const follows = el.querySelector('app-quick-add')!.compareDocumentPosition(card);
      expect(follows & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(card.previousElementSibling?.tagName).toBe('APP-QUICK-ADD');
      expect(api.mealIdeas).not.toHaveBeenCalled();

      buttonWithText(el, 'AI meal ideas').click();
      await fixture.whenStable();

      expect(ideasDialog(el).hasAttribute('open')).toBe(true);
      expect(api.mealIdeas).toHaveBeenCalledTimes(1);
      expect(api.mealIdeas).toHaveBeenCalledWith(expect.objectContaining({ localDate: today }));
      expect(ideasDialog(el).textContent).toContain('Your usual wrap');
    });

    it('is not offered on other days', async () => {
      const yesterday = addDays(today, -1);
      api.dayDashboard.mockResolvedValue(makeDashboard(yesterday, []));
      const { el } = await render(yesterday);
      expect(el.querySelector('app-meal-ideas-card')).toBeNull();
    });

    it('adds a logged idea to the day and offers undo', async () => {
      api.dayDashboard.mockResolvedValue(makeDashboard(today, []));
      const created = makeEntry({ id: 'idea', name: 'Chicken wrap', localDate: today });
      api.quickLog.mockResolvedValue(created);
      const success = vi.spyOn(TestBed.inject(ToastService), 'success');
      const { fixture, el } = await render();
      buttonWithText(el, 'AI meal ideas').click();
      await fixture.whenStable();

      buttonWithText(ideasDialog(el), 'Log this').click();
      await fixture.whenStable();
      await flush();
      await fixture.whenStable();

      expect(api.quickLog).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'meal:1', servings: 1, localDate: today }),
      );
      expect(ideasDialog(el).hasAttribute('open')).toBe(false);
      expect(success).toHaveBeenCalledWith(
        'Logged “Chicken wrap” for today',
        expect.objectContaining({ action: expect.objectContaining({ label: 'Undo' }) }),
      );
      expect(el.querySelector('app-meal-timeline')?.textContent).toContain('Chicken wrap');
    });

    it('opens straight away with ?ideas=1 and clears the parameter', async () => {
      api.dayDashboard.mockResolvedValue(makeDashboard(today, []));
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const fixture = TestBed.createComponent(TodayPage);
      fixture.componentRef.setInput('ideas', '1');
      await fixture.whenStable();
      await flush();
      await fixture.whenStable();

      expect(ideasDialog(fixture.nativeElement as HTMLElement).hasAttribute('open')).toBe(true);
      expect(api.mealIdeas).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(
        [],
        expect.objectContaining({ queryParams: { ideas: null }, replaceUrl: true }),
      );
    });
  });

  it('links to the compare screen to decide what to eat', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard(today, []));
    const { el } = await render();
    const link = Array.from(el.querySelectorAll<HTMLAnchorElement>('app-quick-add a')).find((a) =>
      a.textContent?.includes('What should I eat?'),
    );
    expect(link?.getAttribute('href')).toBe('/compare');
  });

  describe('adjusting a library item in place', () => {
    let restoreDialog: () => void;

    beforeEach(() => {
      restoreDialog = installDialogShim();
    });

    afterEach(() => restoreDialog());

    function quickLogSheet(el: HTMLElement): HTMLElement {
      return el.querySelector<HTMLElement>('app-quick-log-sheet')!;
    }

    function quickLogOpen(el: HTMLElement): boolean {
      return quickLogSheet(el).querySelector('dialog')?.hasAttribute('open') === true;
    }

    it('opens the portion sheet on Today for a starred item from the more button or a long press', async () => {
      api.dayDashboard.mockResolvedValue(makeDashboard(today));
      api.searchFoods.mockResolvedValue({
        query: '',
        results: [
          makeFood({
            key: 'favorite:b',
            kind: 'favorite',
            name: 'Banana bread',
            starred: true,
            favoriteId: 'b',
          }),
        ],
      });
      api.quickLog.mockResolvedValueOnce(
        makeEntry({ id: 'new', name: 'Banana bread ×1.25', localDate: today }),
      );
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate');
      const navigateByUrl = vi.spyOn(router, 'navigateByUrl');
      const { fixture, el } = await render();

      el.querySelector<HTMLButtonElement>(
        'button[aria-label="Adjust Banana bread before logging"]',
      )!.click();
      await fixture.whenStable();
      expect(quickLogOpen(el)).toBe(true);
      expect(quickLogSheet(el).querySelector('h2')?.textContent).toContain('Banana bread');
      expect(quickLogSheet(el).querySelector('button[aria-pressed="true"]')).not.toBeNull();
      quickLogSheet(el).querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await fixture.whenStable();
      expect(quickLogOpen(el)).toBe(false);

      vi.useFakeTimers();
      try {
        const chip = el.querySelector('button[aria-label^="Log Banana"]') as HTMLButtonElement;
        chip.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
        vi.advanceTimersByTime(QUICK_ADD_LONG_PRESS_MS + 10);
        chip.dispatchEvent(new PointerEvent('pointerup'));
        chip.click();
      } finally {
        vi.useRealTimers();
      }
      await fixture.whenStable();
      expect(quickLogOpen(el)).toBe(true);
      expect(api.quickLog).not.toHaveBeenCalled();

      quickLogSheet(el)
        .querySelector<HTMLButtonElement>('button[aria-label="More servings"]')!
        .click();
      await fixture.whenStable();
      buttonWithText(quickLogSheet(el), 'Log ·').click();
      await flush();
      await fixture.whenStable();

      expect(api.quickLog).toHaveBeenCalledTimes(1);
      expect(api.quickLog).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'favorite:b', servings: 1.25, localDate: today }),
      );
      expect(quickLogOpen(el)).toBe(false);
      expect(el.querySelectorAll('app-entry-card')).toHaveLength(1);
      expect(navigate).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
    });

    it('starts the portion sheet on the day being viewed', async () => {
      const past = addDays(today, -3);
      api.dayDashboard.mockResolvedValue(makeDashboard(past));
      api.searchFoods.mockResolvedValue({
        query: '',
        results: [makeFood({ key: 'meal:b', name: 'Banana' })],
      });
      const { fixture, el } = await render(past);
      el.querySelector<HTMLButtonElement>('button[aria-label="More options for Banana"]')!.click();
      await fixture.whenStable();
      buttonWithText(el.querySelector('app-food-actions-sheet')!, 'Adjust amount & log').click();
      await fixture.whenStable();

      const sheet = fixture.debugElement.query(By.directive(QuickLogSheet))
        .componentInstance as QuickLogSheet;
      const chosen = sheet.selection() as TodayQuickLogSelection;
      expect(chosen.result.key).toBe('meal:b');
      expect(chosen.dateTime.slice(0, 10)).toBe(past);
      expect(quickLogOpen(el)).toBe(true);
    });

    it('hands an edited portion to the log screen and falls back to searching for it there', async () => {
      api.dayDashboard.mockResolvedValue(makeDashboard(today));
      api.searchFoods.mockResolvedValue({
        query: '',
        results: [
          makeFood({
            key: 'favorite:b',
            kind: 'favorite',
            name: 'Banana bread',
            starred: true,
            favoriteId: 'b',
          }),
        ],
      });
      const router = TestBed.inject(Router);
      const handoff = TestBed.inject(LibraryDraftHandoff);
      const openSearch = vi
        .spyOn(TestBed.inject(CaptureService), 'openSearch')
        .mockImplementation(() => undefined);
      const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const { fixture, el } = await render();
      const editFirst = async () => {
        el.querySelector<HTMLButtonElement>(
          'button[aria-label="Adjust Banana bread before logging"]',
        )!.click();
        await fixture.whenStable();
        buttonWithText(quickLogSheet(el), 'Edit before saving').click();
        await flush();
        await fixture.whenStable();
      };

      await editFirst();
      expect(navigateByUrl).toHaveBeenLastCalledWith('/log');
      expect(openSearch).toHaveBeenCalledWith('Banana bread');
      expect(handoff.take()).toBeNull();

      let claimed: ReturnType<LibraryDraftHandoff['take']> = null;
      navigateByUrl.mockImplementationOnce(async () => {
        claimed = handoff.take();
        return true;
      });
      await editFirst();
      expect(claimed).toEqual(
        expect.objectContaining({ name: 'Banana bread', mealTypeAuto: true }),
      );
      expect(openSearch).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes once, after a short pause, when data changes elsewhere', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard(today));
    const { fixture } = await render();
    const events = TestBed.inject(DataEventsService);
    const counts = () => [
      api.dayDashboard.mock.calls.length,
      api.searchFoods.mock.calls.length,
      api.weights.mock.calls.length,
      api.getProfile.mock.calls.length,
    ];
    const before = counts();

    events.notify('entries');
    events.notify('entries', 'favorites');
    await fixture.whenStable();
    expect(counts()).toEqual(before);
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    expect(counts()).toEqual([before[0] + 1, before[1] + 1, before[2], before[3]]);

    events.notify('weights', 'profile');
    await fixture.whenStable();
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    expect(counts()).toEqual([before[0] + 2, before[1] + 1, before[2] + 1, before[3] + 1]);

    events.notify('products');
    await fixture.whenStable();
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    expect(counts()).toEqual([before[0] + 2, before[1] + 2, before[2] + 1, before[3] + 1]);
  });

  it('focuses the weight entry when opened with ?weight=1 and clears the parameter', async () => {
    api.dayDashboard.mockResolvedValue(makeDashboard(today));
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const fixture = TestBed.createComponent(TodayPage);
    fixture.componentRef.setInput('weight', '1');
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    await sleep(50);
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('#today-weight-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('80.0');
    expect(document.activeElement).toBe(input);
    expect(navigate).toHaveBeenCalledWith(
      [],
      expect.objectContaining({
        queryParams: { weight: null },
        replaceUrl: true,
        scroll: 'manual',
      }),
    );
  });

  it('asks for confirmation before deleting an entry', async () => {
    const entry = makeEntry({ id: 'a', name: 'Toast', localDate: today });
    api.dayDashboard.mockResolvedValue(makeDashboard(today, [entry]));
    api.deleteEntry.mockResolvedValue(undefined);
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm');
    const { fixture } = await render();
    const timeline = fixture.debugElement.query(By.directive(MealTimeline))
      .componentInstance as MealTimeline;

    confirm.mockResolvedValueOnce(false);
    timeline.remove.emit(entry);
    await flush();
    expect(api.deleteEntry).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    timeline.remove.emit(entry);
    await flush();
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ tone: 'danger' }));
    expect(api.deleteEntry).toHaveBeenCalledWith('a');
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe('Entry deleted');
  });

  it('toggles the training day and refreshes when the page becomes visible', async () => {
    let serverTraining = false;
    api.dayDashboard.mockImplementation(async () => makeDashboard(today, [], serverTraining));
    api.putDay.mockImplementation(async (_date: string, body: { trainingDay: boolean }) => {
      serverTraining = body.trainingDay;
      return { date: today, trainingDay: body.trainingDay };
    });
    const { fixture, el } = await render();
    const chip = el.querySelector('button[aria-pressed]') as HTMLButtonElement;
    expect(chip.getAttribute('aria-pressed')).toBe('false');

    chip.click();
    await fixture.whenStable();
    expect(api.putDay).toHaveBeenCalledWith(today, { trainingDay: true });
    expect(chip.getAttribute('aria-pressed')).toBe('true');

    const calls = api.dayDashboard.mock.calls.length;
    const weightCalls = api.weights.mock.calls.length;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(api.dayDashboard.mock.calls.length).toBe(calls + 1);
    expect(api.weights.mock.calls.length).toBe(weightCalls + 1);
  });

  it('refreshes a past day on return even after midnight passed in the background', async () => {
    const past = addDays(today, -3);
    api.dayDashboard.mockResolvedValue(makeDashboard(past));
    const { fixture } = await render(past);
    const calls = api.dayDashboard.mock.calls.length;
    const now = new Date();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 8));
      document.dispatchEvent(new Event('visibilitychange'));
    } finally {
      vi.useRealTimers();
    }
    await fixture.whenStable();
    expect(api.dayDashboard.mock.calls.length).toBe(calls + 1);
    expect(api.dayDashboard).toHaveBeenLastCalledWith(past);
  });

  describe('food actions', () => {
    let restoreDialog: () => void;
    let library: FoodSearchResult[];
    let hidden: Set<string>;

    beforeEach(() => {
      restoreDialog = installDialogShim();
      hidden = new Set();
      library = [
        makeFood({ key: 'meal:p', name: 'Porridge', useCount: 3 }),
        makeFood({ key: 'meal:b', name: 'Banana bread' }),
        makeFood({ key: 'food:y', kind: 'food', name: 'Yogurt', detail: 'Breakfast plate' }),
      ];
      api.dayDashboard.mockResolvedValue(makeDashboard(today));
      api.searchFoods.mockImplementation(async () => ({
        query: '',
        results: library.filter((food) => !hidden.has(food.name)),
      }));
      api.hideFood.mockImplementation(async ({ name }) => {
        hidden.add(name);
        return { names: [...hidden] };
      });
      api.unhideFood.mockImplementation(async (name) => {
        hidden.delete(name);
        return { names: [...hidden] };
      });
    });

    afterEach(() => restoreDialog());

    function chipNames(el: HTMLElement): string[] {
      return Array.from(
        el.querySelectorAll<HTMLButtonElement>('app-quick-add button[aria-label^="Log "]'),
      ).map((chip) => chip.getAttribute('aria-label')!.split(',')[0].slice(4));
    }

    function sheet(el: HTMLElement, selector: string): HTMLElement {
      return el.querySelector<HTMLElement>(selector)!;
    }

    function isOpen(el: HTMLElement, selector: string): boolean {
      return sheet(el, selector).querySelector('dialog')?.hasAttribute('open') === true;
    }

    async function openActions(
      fixture: { whenStable: () => Promise<void> },
      el: HTMLElement,
      name: string,
    ): Promise<HTMLElement> {
      el.querySelector<HTMLButtonElement>(`button[aria-label="More options for ${name}"]`)!.click();
      await fixture.whenStable();
      return sheet(el, 'app-food-actions-sheet');
    }

    it('opens the actions for a logged meal and adjusts the amount on Today from there', async () => {
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate');
      const navigateByUrl = vi.spyOn(router, 'navigateByUrl');
      const { fixture, el } = await render();

      const actions = await openActions(fixture, el, 'Porridge');
      expect(isOpen(el, 'app-food-actions-sheet')).toBe(true);
      expect(actions.querySelector('h2')?.textContent).toContain('Porridge');
      expect(actions.textContent).toContain('120 kcal · logged 3 times');
      buttonWithText(actions, 'Adjust amount & log').click();
      await fixture.whenStable();

      expect(isOpen(el, 'app-food-actions-sheet')).toBe(false);
      expect(isOpen(el, 'app-quick-log-sheet')).toBe(true);
      expect(sheet(el, 'app-quick-log-sheet').querySelector('h2')?.textContent).toContain(
        'Porridge',
      );
      expect(navigate).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(api.quickLog).not.toHaveBeenCalled();
    });

    it('offers a long press on a meal chip the same actions', async () => {
      const { fixture, el } = await render();
      const chip = el.querySelector<HTMLButtonElement>('button[aria-label^="Log Banana bread"]')!;
      vi.useFakeTimers();
      try {
        chip.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
        vi.advanceTimersByTime(QUICK_ADD_LONG_PRESS_MS + 10);
        chip.dispatchEvent(new PointerEvent('pointerup'));
        chip.click();
      } finally {
        vi.useRealTimers();
      }
      await fixture.whenStable();

      expect(isOpen(el, 'app-food-actions-sheet')).toBe(true);
      expect(sheet(el, 'app-food-actions-sheet').querySelector('h2')?.textContent).toContain(
        'Banana bread',
      );
      expect(api.quickLog).not.toHaveBeenCalled();
    });

    it('does not offer a rename for a food that only exists inside bigger meals', async () => {
      const { fixture, el } = await render();
      const actions = await openActions(fixture, el, 'Yogurt');
      expect(actions.textContent).toContain('Remove from suggestions');
      expect(actions.textContent).not.toContain('Rename');

      const meal = await openActions(fixture, el, 'Porridge');
      expect(meal.textContent).toContain('Rename…');
    });

    it('removes a meal from suggestions at once and puts it back in place on undo', async () => {
      const toasts = TestBed.inject(ToastService);
      const events = TestBed.inject(DataEventsService);
      const { fixture, el } = await render();
      expect(chipNames(el)).toEqual(['Porridge', 'Banana bread', 'Yogurt']);

      const actions = await openActions(fixture, el, 'Porridge');
      buttonWithText(actions, 'Remove from suggestions').click();
      await fixture.whenStable();
      expect(chipNames(el)).toEqual(['Banana bread', 'Yogurt']);
      expect(isOpen(el, 'app-food-actions-sheet')).toBe(false);
      await flush();
      expect(api.hideFood).toHaveBeenCalledWith({ name: 'Porridge' });
      expect(events.entries()).toBe(1);
      const toast = toasts.toasts().at(-1)!;
      expect(toast.kind).toBe('info');
      expect(toast.message).toBe('Removed “Porridge” from suggestions. Your logs are kept.');
      expect(toast.action?.label).toBe('Undo');

      await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
      await fixture.whenStable();
      expect(chipNames(el)).toEqual(['Banana bread', 'Yogurt']);

      toasts.runAction(toast.id);
      await fixture.whenStable();
      expect(chipNames(el)).toEqual(['Porridge', 'Banana bread', 'Yogurt']);
      await flush();
      expect(api.unhideFood).toHaveBeenCalledWith('Porridge');
      await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
      await fixture.whenStable();
      expect(chipNames(el)).toEqual(['Porridge', 'Banana bread', 'Yogurt']);
      expect(events.entries()).toBe(2);
    });

    it('keeps the chip and explains when removing it fails', async () => {
      api.hideFood.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      const { fixture, el } = await render();
      const actions = await openActions(fixture, el, 'Banana bread');
      buttonWithText(actions, 'Remove from suggestions').click();
      await flush();
      await fixture.whenStable();

      expect(chipNames(el)).toEqual(['Porridge', 'Banana bread', 'Yogurt']);
      const toast = TestBed.inject(ToastService).toasts().at(-1);
      expect(toast?.kind).toBe('error');
      expect(toast?.message).toBe('Could not remove “Banana bread” from suggestions.');
    });

    it('renames a meal everywhere from the same sheet and refreshes the day', async () => {
      api.renameFood.mockImplementation(async ({ from, to }) => {
        library = library.map((food) => (food.name === from ? { ...food, name: to } : food));
        return { matchedEntries: 3, renamedEntries: 3, renamedItems: 3 };
      });
      const { fixture, el } = await render();
      const dashboards = api.dayDashboard.mock.calls.length;

      const actions = await openActions(fixture, el, 'Porridge');
      buttonWithText(actions, 'Rename…').click();
      await fixture.whenStable();
      expect(isOpen(el, 'app-food-actions-sheet')).toBe(true);

      const input = actions.querySelector<HTMLInputElement>('input[type="text"]')!;
      expect(input.value).toBe('Porridge');
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('Porridge'.length);
      input.value = '  Oat   porridge ';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      actions.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await flush();
      await fixture.whenStable();

      expect(api.renameFood).toHaveBeenCalledWith({ from: 'Porridge', to: 'Oat porridge' });
      expect(isOpen(el, 'app-food-actions-sheet')).toBe(false);
      expect(chipNames(el)).toEqual(['Oat porridge', 'Banana bread', 'Yogurt']);
      expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
        'Renamed 3 entries to “Oat porridge”',
      );

      await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
      await fixture.whenStable();
      expect(api.dayDashboard.mock.calls.length).toBe(dashboards + 1);
      expect(chipNames(el)).toEqual(['Oat porridge', 'Banana bread', 'Yogurt']);
    });

    it('keeps the rename open with the typed name when renaming fails', async () => {
      api.renameFood.mockRejectedValueOnce(
        new HttpErrorResponse({
          status: 400,
          error: { statusCode: 400, message: 'to must be shorter than or equal to 120 characters' },
        }),
      );
      const { fixture, el } = await render();
      const actions = await openActions(fixture, el, 'Porridge');
      buttonWithText(actions, 'Rename…').click();
      await fixture.whenStable();
      const input = actions.querySelector<HTMLInputElement>('input[type="text"]')!;
      input.value = 'Oat porridge';
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      actions.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
      await flush();
      await fixture.whenStable();

      expect(isOpen(el, 'app-food-actions-sheet')).toBe(true);
      expect(input.value).toBe('Oat porridge');
      expect(chipNames(el)).toEqual(['Porridge', 'Banana bread', 'Yogurt']);
      const toast = TestBed.inject(ToastService).toasts().at(-1);
      expect(toast?.kind).toBe('error');
      expect(toast?.message).toContain('120 characters');
    });

    describe('saved products', () => {
      const product = makeProduct({ id: 'k', name: 'Yaourt fraise', brand: 'Khoury' });

      beforeEach(() => {
        library = [
          makeFood({
            key: 'product:k',
            kind: 'product',
            name: 'Khoury Yaourt fraise',
            detail: 'Khoury',
            productId: 'k',
          }),
          ...library,
        ];
        api.listProducts.mockResolvedValue([product]);
        api.upsertProduct.mockImplementation(async (_code, body) => ({
          ...product,
          name: body.name,
          brand: body.brand ?? null,
        }));
        api.renameFood.mockResolvedValue({ matchedEntries: 2, renamedEntries: 2, renamedItems: 2 });
        api.deleteProduct.mockResolvedValue(undefined);
      });

      it('edits a product from its chip and renames its earlier logs to match', async () => {
        const { fixture, el } = await render();
        const actions = await openActions(fixture, el, 'Khoury Yaourt fraise');
        expect(actions.textContent).not.toContain('Rename…');
        buttonWithText(actions, 'Edit product…').click();
        await flush();
        await fixture.whenStable();

        expect(isOpen(el, 'app-food-actions-sheet')).toBe(false);
        expect(isOpen(el, 'app-product-edit-sheet')).toBe(true);
        const editor = sheet(el, 'app-product-edit-sheet');
        const name = editor.querySelector<HTMLInputElement>(
          'input[placeholder^="e.g. Strawberry"]',
        )!;
        expect(name.value).toBe('Yaourt fraise');
        name.value = 'Strawberry yogurt';
        name.dispatchEvent(new Event('input'));
        await fixture.whenStable();
        editor.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
        await flush();
        await fixture.whenStable();

        expect(api.upsertProduct).toHaveBeenCalledWith(
          product.barcode,
          expect.objectContaining({ name: 'Strawberry yogurt', brand: 'Khoury' }),
        );
        expect(api.renameFood).toHaveBeenCalledWith({
          from: 'Khoury Yaourt fraise',
          to: 'Khoury Strawberry yogurt',
        });
        expect(isOpen(el, 'app-product-edit-sheet')).toBe(false);
        expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
          'Updated Khoury Strawberry yogurt',
        );
      });

      it('drops the chip when the product is no longer saved', async () => {
        api.listProducts.mockResolvedValue([]);
        const { fixture, el } = await render();
        library = library.filter((food) => food.kind !== 'product');
        const actions = await openActions(fixture, el, 'Khoury Yaourt fraise');
        buttonWithText(actions, 'Edit product…').click();
        await flush();
        await fixture.whenStable();

        expect(isOpen(el, 'app-product-edit-sheet')).toBe(false);
        expect(chipNames(el)).not.toContain('Khoury Yaourt fraise');
        await flush();
        await fixture.whenStable();
        expect(chipNames(el)).toEqual(['Porridge', 'Banana bread', 'Yogurt']);
        expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
          '“Khoury Yaourt fraise” is no longer in your library.',
        );
      });

      it('deletes a product after confirming and drops its chip', async () => {
        const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
        const { fixture, el } = await render();
        const actions = await openActions(fixture, el, 'Khoury Yaourt fraise');
        buttonWithText(actions, 'Delete product').click();
        await flush();
        await fixture.whenStable();

        expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger' }));
        expect(api.deleteProduct).toHaveBeenCalledWith('k');
        expect(api.hideFood).toHaveBeenCalledWith({ name: 'Khoury Yaourt fraise' });
        expect(chipNames(el)).toEqual(['Porridge', 'Banana bread', 'Yogurt']);
      });
    });
  });
});
