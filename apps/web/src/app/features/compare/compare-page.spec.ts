import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type AnalyzeRequestFields,
  type AnalyzeResponse,
  type BarcodeLookupResponse,
  type CreateEntryRequest,
  type DayDashboardResponse,
  type EntryDto,
  type FoodSearchQuery,
  type FoodSearchResponse,
  type FoodSearchResult,
  type LogProductRequest,
  type MenuDish,
  type MenuScanFields,
  type MenuScanResponse,
  type Nutrients,
  type QuickLogRequest,
  type TargetValues,
  type UserDto,
} from '@food/shared';
import { ApiService, type AnalyzeImage } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DataEventsService } from '../../core/data-events.service';
import { KeyboardService } from '../../core/keyboard.service';
import { NetworkService } from '../../core/network.service';
import { SessionScope } from '../../core/session-scope';
import { ToastService } from '../../core/toast.service';
import { installDialogShim } from '../../shared/testing/dialog-shim';
import { BROWSE_LIMIT } from '../log/food-search.store';
import { ComparePage } from './compare-page';
import {
  COMPARE_STORAGE_KEY,
  optionFromDish,
  optionFromLibrary,
  type CompareOption,
  type PersistedCompare,
} from './compare-model';
import { COMPARE_CLOCK, COMPARE_COMPRESSOR, CompareStore } from './compare.store';
import { COMPARE_MAX_AGE_MS } from './compare-model';

@Component({ template: '' })
class Blank {}

const USER: UserDto = { id: 'user-1', email: 'owner@example.com', name: 'Owner', role: 'member' };
const NOW = new Date(2026, 8, 30, 13, 0, 0);
const TODAY = '2026-09-30';

const TARGETS: TargetValues = {
  calories: 2500,
  protein: 150,
  carbs: 280,
  fat: 80,
  satFatMax: 25,
  fiberMin: 35,
  sugarMax: 60,
  sodiumMax: 2300,
};

function n(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

const EATEN = n({ calories: 1500, protein: 90, fiber: 15, satFat: 12, sodium: 1500, sugar: 30 });

const YOGURT: FoodSearchResult = {
  portion: null,
  key: 'meal:entry-1',
  kind: 'meal',
  name: 'Greek yogurt',
  detail: null,
  items: [
    {
      name: 'Greek yogurt',
      grams: 170,
      nutrients: n({ calories: 150, protein: 17, carbs: 6, fat: 4 }),
      confidence: 'high',
    },
  ],
  totals: n({ calories: 150, protein: 17, carbs: 6, fat: 4 }),
  grams: 170,
  mealType: 'snack',
  photo: null,
  favoriteId: null,
  entryId: 'entry-1',
  productId: null,
  useCount: 3,
  lastUsedAt: null,
  starred: false,
};

const BOWL_DISH: MenuDish = {
  portion: null,
  name: 'Chicken rice bowl',
  description: 'Grilled chicken, rice, greens',
  grams: 450,
  nutrients: n({
    calories: 650,
    protein: 42,
    carbs: 70,
    fat: 18,
    fiber: 6,
    satFat: 3,
    sodium: 700,
    sugar: 5,
  }),
  confidence: 'medium',
  notes: null,
};

const BURGER_DISH: MenuDish = {
  portion: null,
  name: 'Double cheeseburger',
  description: 'Two patties, cheese, fries',
  grams: 520,
  nutrients: n({
    calories: 1100,
    protein: 45,
    carbs: 90,
    fat: 60,
    fiber: 3,
    satFat: 18,
    sodium: 1600,
    sugar: 12,
  }),
  confidence: 'medium',
  notes: null,
};

const SALAD_DISH: MenuDish = {
  portion: null,
  name: 'Fattoush',
  description: null,
  grams: 250,
  nutrients: n({ calories: 280, protein: 5, carbs: 30, fat: 16, fiber: 7, sodium: 600, sugar: 8 }),
  confidence: 'high',
  notes: null,
};

function dashboard(date: string, entryCount = 3): DayDashboardResponse {
  return {
    day: {
      date,
      trainingDay: false,
      targets: TARGETS,
      totals: EATEN,
      entryCount,
      micros: {},
      microsCoverage: { items: 0, withMicros: 0 },
      fluidsMl: 0,
      fluidTargetMl: 2500,
    },
    entries: [],
  };
}

function entry(id: string, name: string, calories: number): EntryDto {
  return {
    portion: null,
    id,
    name,
    description: null,
    mealType: 'lunch',
    source: 'text',
    timestamp: NOW.toISOString(),
    localDate: TODAY,
    items: [],
    totals: n({ calories }),
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
}

function analysis(name: string, calories: number, protein: number): AnalyzeResponse {
  return {
    analysisId: 'an-1',
    mode: 'text',
    description: 'chicken shawarma wrap',
    result: {
      inputType: 'text',
      mealName: name,
      portion: null,
      scaleCues: '',
      items: [
        {
          count: null,
          unit: null,
          unitPlural: null,
          name,
          grams: 300,
          nutrients: n({ calories, protein }),
          per100g: n({ calories: calories / 3, protein: protein / 3 }),
          micros: null,
          microsPer100g: null,
          fluidMl: null,
          confidence: 'medium',
          amountSource: 'user_stated',
          state: 'as_served',
          portionBasis: '',
          flags: [],
          savedFood: null,
          suggestedFood: null,
        },
      ],
      label: null,
      totals: n({ calories, protein }),
      assumptions: [],
      followUpQuestion: null,
      followUpOptions: [],
      warnings: [],
    },
    photo: null,
    photos: [],
    usage: {
      model: 'mock',
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      costUsd: 0,
      durationMs: 0,
      attempts: 1,
    },
    precise: false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeApi {
  readonly dayDashboard = vi.fn(async (date: string) => dashboard(date));
  readonly searchFoods = vi.fn(async (_query?: FoodSearchQuery): Promise<FoodSearchResponse> => ({
    query: '',
    results: [YOGURT],
  }));
  readonly analyze =
    vi.fn<
      (fields: AnalyzeRequestFields, images?: readonly AnalyzeImage[]) => Promise<AnalyzeResponse>
    >();
  readonly scanMenu =
    vi.fn<(fields: MenuScanFields, images: readonly AnalyzeImage[]) => Promise<MenuScanResponse>>();
  readonly lookupBarcode = vi.fn<(code: string) => Promise<BarcodeLookupResponse>>();
  readonly createEntry = vi.fn(async (body: CreateEntryRequest) =>
    entry(
      'entry-new',
      body.name,
      body.items.reduce((sum, item) => sum + item.nutrients.calories, 0),
    ),
  );
  readonly quickLog = vi.fn(async (_body: QuickLogRequest) =>
    entry('entry-quick', 'Greek yogurt', 159),
  );
  readonly logProduct = vi.fn(async (_id: string, _body: LogProductRequest) =>
    entry('entry-product', 'Protein bar', 200),
  );
  readonly deleteEntry = vi.fn(async (_id: string) => undefined);
}

function persist(options: CompareOption[]): void {
  const payload: PersistedCompare = {
    v: 1,
    userId: USER.id,
    savedAt: NOW.getTime(),
    options,
    menu: null,
  };
  sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(payload));
}

function text(el: ParentNode): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function buttonByText(root: ParentNode, label: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    text(button).includes(label),
  );
  if (!match) {
    throw new Error(`No button "${label}"`);
  }
  return match;
}

function byLabel(root: ParentNode, label: string): HTMLButtonElement {
  const match = root.querySelector<HTMLButtonElement>(`button[aria-label^="${label}"]`);
  if (!match) {
    throw new Error(`No button labelled "${label}"`);
  }
  return match;
}

function cards(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>('app-compare-option'));
}

function cardTitled(el: HTMLElement, title: string): HTMLElement {
  const card = cards(el).find((candidate) =>
    candidate.querySelector('h3')?.textContent?.includes(title),
  );
  if (!card) {
    throw new Error(`No card "${title}"`);
  }
  return card;
}

function fileList(files: File[]): FileList {
  const list = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  };
  return Object.assign(list, files) as unknown as FileList;
}

function chooseFiles(input: HTMLInputElement, files: File[]): void {
  Object.defineProperty(input, 'files', { configurable: true, value: fileList(files) });
  input.dispatchEvent(new Event('change'));
}

describe('ComparePage', () => {
  let api: FakeApi;
  let online: ReturnType<typeof signal<boolean>>;
  let restoreDialog: () => void;
  let clock: number;

  beforeEach(() => {
    sessionStorage.clear();
    clock = NOW.getTime();
    restoreDialog = installDialogShim();
    api = new FakeApi();
    online = signal(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'today', component: Blank },
          { path: 'compare', component: Blank },
        ]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: signal(USER), isAdmin: signal(false) } },
        { provide: COMPARE_CLOCK, useValue: () => new Date(clock) },
        { provide: COMPARE_COMPRESSOR, useValue: async (blob: Blob) => ({ blob }) },
        { provide: KeyboardService, useValue: { open: signal(false) } },
        { provide: NetworkService, useValue: { online } },
      ],
    });
  });

  afterEach(() => {
    restoreDialog();
    sessionStorage.clear();
  });

  async function settle(fixture: ComponentFixture<ComparePage>): Promise<void> {
    for (let round = 0; round < 4; round++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
    }
  }

  async function render(): Promise<{ fixture: ComponentFixture<ComparePage>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(ComparePage);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function sheet(el: HTMLElement): HTMLDialogElement {
    const dialog = el.querySelector<HTMLDialogElement>('app-add-option-sheet dialog');
    if (!dialog) {
      throw new Error('No sheet');
    }
    return dialog;
  }

  it("shows what's left of today and every way to add an option", async () => {
    const { el } = await render();
    expect(api.dayDashboard).toHaveBeenCalledWith(TODAY);
    const budget = text(el.querySelector('app-compare-budget')!);
    expect(budget).toContain('Left for today');
    expect(budget).toContain('1,000');
    expect(budget).toContain('60 g');
    expect(text(el)).toContain("Can't decide what to eat?");
    const tiles = Array.from(el.querySelectorAll('section button[aria-label]')).map((button) =>
      button.getAttribute('aria-label'),
    );
    expect(tiles).toEqual([
      'My foods, instant',
      'Barcode, instant',
      'Describe, AI estimate',
      'Photo, AI estimate',
      'Label, AI estimate',
      'Menu, AI estimate',
    ]);
  });

  it('says so when nothing is logged yet today', async () => {
    api.dayDashboard.mockImplementation(async (date: string) => dashboard(date, 0));
    const { el } = await render();
    expect(text(el)).toContain('Nothing logged yet today');
  });

  it('adds a food from search as an option', async () => {
    const { fixture, el } = await render();
    byLabel(el, 'My foods').click();
    await settle(fixture);
    expect(sheet(el).open).toBe(true);
    expect(api.searchFoods).toHaveBeenCalledWith({ limit: BROWSE_LIMIT, scope: 'standalone' });

    byLabel(el, 'Compare Greek yogurt').click();
    await settle(fixture);

    expect(sheet(el).open).toBe(false);
    const card = cardTitled(el, 'Greek yogurt');
    expect(text(card.querySelector('[data-testid="option-kcal"]')!)).toMatch(/^150\s?kcal$/);
    expect(text(card)).toContain('My foods');
    expect(el.querySelector('[data-testid="winner-badge"]')).toBeNull();
    expect(text(el)).toContain('Add something to compare it with');
  });

  it('estimates a described option with AI and shows progress until it is ready', async () => {
    const pending = deferred<AnalyzeResponse>();
    api.analyze.mockReturnValue(pending.promise);
    const { fixture, el } = await render();

    byLabel(el, 'Describe').click();
    await settle(fixture);
    const field = sheet(el).querySelector<HTMLTextAreaElement>('textarea')!;
    field.value = 'chicken shawarma wrap';
    field.dispatchEvent(new Event('input'));
    await settle(fixture);
    buttonByText(sheet(el), 'Estimate with AI').click();
    await settle(fixture);

    expect(api.analyze).toHaveBeenCalledWith(
      {
        mode: 'text',
        description: 'chicken shawarma wrap',
        localTime: '2026-09-30T13:00',
        mealType: 'lunch',
      },
      [],
    );
    expect(sheet(el).open).toBe(false);
    const loading = cards(el)[0];
    expect(loading.querySelector('article')?.getAttribute('aria-busy')).toBe('true');
    expect(text(loading)).toContain('Reading your description');

    pending.resolve(analysis('Chicken shawarma wrap', 620, 38));
    await settle(fixture);

    const card = cardTitled(el, 'Chicken shawarma wrap');
    expect(text(card.querySelector('[data-testid="option-kcal"]')!)).toMatch(/^620\s?kcal$/);
    expect(text(card)).toContain('Described');
    expect(JSON.parse(sessionStorage.getItem(COMPARE_STORAGE_KEY)!).options).toHaveLength(1);
  });

  it('shows an AI failure on the option and retries it', async () => {
    api.analyze
      .mockRejectedValueOnce(new HttpErrorResponse({ status: 504, statusText: 'Gateway Timeout' }))
      .mockResolvedValueOnce(analysis('Lentil soup', 320, 18));
    const { fixture, el } = await render();
    TestBed.inject(CompareStore).describe('lentil soup');
    await settle(fixture);

    const failed = cards(el)[0];
    expect(failed.querySelector('[role="alert"]')).not.toBeNull();
    expect(text(failed)).toContain('The AI took too long');

    buttonByText(failed, 'Try again').click();
    await settle(fixture);

    expect(api.analyze).toHaveBeenCalledTimes(2);
    expect(cardTitled(el, 'Lentil soup')).toBeTruthy();
  });

  it('fails straight away while offline', async () => {
    online.set(false);
    const { fixture, el } = await render();
    TestBed.inject(CompareStore).describe('lentil soup');
    await settle(fixture);
    expect(api.analyze).not.toHaveBeenCalled();
    expect(text(cards(el)[0])).toContain("You're offline");
  });

  it('scans a menu and compares the dishes you pick', async () => {
    api.scanMenu.mockResolvedValue({
      restaurant: 'Café Nour',
      dishes: [BOWL_DISH, BURGER_DISH, SALAD_DISH],
      warnings: [],
      usage: analysis('x', 0, 0).usage,
    });
    const { fixture, el } = await render();

    byLabel(el, 'Menu').click();
    await settle(fixture);
    const photo = new File(['menu'], 'menu.jpg', { type: 'image/jpeg' });
    chooseFiles(sheet(el).querySelector<HTMLInputElement>('input[type="file"][multiple]')!, [
      photo,
    ]);
    await settle(fixture);
    expect(sheet(el).querySelectorAll('ul[aria-label="Menu photos"] app-blob-image')).toHaveLength(
      1,
    );

    buttonByText(sheet(el), 'Find dishes').click();
    await settle(fixture);

    expect(api.scanMenu).toHaveBeenCalledWith({}, [{ blob: photo, role: 'label' }]);
    const dishes = Array.from(
      sheet(el).querySelectorAll<HTMLButtonElement>('ul[aria-label="Dishes"] button'),
    );
    expect(dishes.map((button) => text(button.querySelector('.line-clamp-2')!))).toEqual([
      'Chicken rice bowl',
      'Double cheeseburger',
      'Fattoush',
    ]);
    expect(text(dishes[0])).toContain('Best fit for today');

    dishes[0].click();
    dishes[1].click();
    await settle(fixture);
    expect(dishes[0].getAttribute('aria-pressed')).toBe('true');
    buttonByText(sheet(el), 'Compare 2 dishes').click();
    await settle(fixture);

    expect(sheet(el).open).toBe(false);
    expect(cards(el)).toHaveLength(2);
    expect(text(cardTitled(el, 'Chicken rice bowl'))).toContain('Café Nour');
    const badge = cardTitled(el, 'Chicken rice bowl').querySelector('[data-testid="winner-badge"]');
    expect(text(badge!)).toBe('Best fit for today');
    expect(
      cardTitled(el, 'Double cheeseburger').querySelector('[data-testid="winner-badge"]'),
    ).toBeNull();
    expect(text(cardTitled(el, 'Chicken rice bowl'))).toContain('Leaves 350 kcal for dinner');
    expect(text(cardTitled(el, 'Double cheeseburger'))).toContain(
      'Over your sodium limit by 800 mg',
    );
    expect(el.querySelector('app-compare-table')).not.toBeNull();
    expect(text(el.querySelector('[data-testid="verdict"]')!)).toContain('Chicken rice bowl');
  });

  it('keeps menu dishes to the free slots', async () => {
    persist([
      optionFromLibrary(YOGURT, 'o1'),
      optionFromDish(SALAD_DISH, null, 'o2'),
      optionFromDish(BURGER_DISH, null, 'o3'),
    ]);
    const { fixture } = await render();
    const store = TestBed.inject(CompareStore);
    expect(store.addDishes([BOWL_DISH, SALAD_DISH])).toBe(1);
    await settle(fixture);
    expect(store.slots()).toHaveLength(4);
    expect(store.freeSlots()).toBe(0);
  });

  it('logs a menu dish as a single-item entry and goes to Today', async () => {
    persist([
      optionFromDish(BOWL_DISH, 'Café Nour', 'o1'),
      optionFromDish(BURGER_DISH, 'Café Nour', 'o2'),
    ]);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    const events = TestBed.inject(DataEventsService);
    const before = events.entries();
    const { fixture, el } = await render();

    byLabel(cardTitled(el, 'Chicken rice bowl'), 'Log Chicken rice bowl').click();
    await settle(fixture);

    expect(api.createEntry).toHaveBeenCalledWith({
      name: 'Chicken rice bowl',
      description: 'Grilled chicken, rice, greens',
      mealType: 'lunch',
      source: 'text',
      timestamp: NOW.toISOString(),
      localDate: TODAY,
      items: [
        {
          name: 'Chicken rice bowl',
          grams: 450,
          nutrients: BOWL_DISH.nutrients,
          confidence: 'medium',
          count: null,
          unit: null,
          unitPlural: null,
        },
      ],
    });
    expect(events.entries()).toBe(before + 1);
    expect(navigate).toHaveBeenCalledWith('/today');
    const toast = TestBed.inject(ToastService).toasts()[0];
    expect(toast.message).toBe('Logged Chicken rice bowl · 650 kcal');
    expect(TestBed.inject(CompareStore).options()[0].loggedEntryId).toBe('entry-new');
  });

  it('compares a counted dish by how many and logs that portion', async () => {
    const burgers = { count: 2, unit: 'burger', unitPlural: 'burgers' };
    persist([
      optionFromDish({ ...BURGER_DISH, portion: burgers }, 'Café Nour', 'o1'),
      optionFromDish(BOWL_DISH, 'Café Nour', 'o2'),
    ]);
    const { fixture, el } = await render();
    const card = cardTitled(el, 'Double cheeseburger');
    expect(text(card)).toContain('2 burgers');
    expect(text(card)).toContain('≈ 520 g');

    byLabel(card, 'Less Double cheeseburger').click();
    await settle(fixture);
    expect(text(card)).toContain('1½ burgers');
    expect(text(card.querySelector('[data-testid="option-kcal"]')!)).toContain('825');

    byLabel(card, 'Log Double cheeseburger').click();
    await settle(fixture);
    const body = api.createEntry.mock.calls[0]![0];
    expect(body.portion).toEqual({ ...burgers, count: 1.5 });
    expect(body.items[0]).toMatchObject({ grams: 390, count: 1.5, unit: 'burger' });
  });

  it('logs the best fit from the sticky button and can undo it', async () => {
    persist([optionFromDish(BURGER_DISH, null, 'o1'), optionFromDish(BOWL_DISH, null, 'o2')]);
    const { fixture, el } = await render();

    const log = byLabel(el.querySelector('app-sticky-actions')!, 'Log Chicken rice bowl');
    expect(text(log)).toContain('Log best fit · 650 kcal');
    log.click();
    await settle(fixture);
    expect(api.createEntry).toHaveBeenCalledTimes(1);
    expect(api.createEntry.mock.calls[0][0].name).toBe('Chicken rice bowl');
    expect(text(cardTitled(el, 'Chicken rice bowl'))).toContain('Logged');

    TestBed.inject(ToastService).toasts()[0].action!.run();
    await settle(fixture);
    expect(api.deleteEntry).toHaveBeenCalledWith('entry-new');
    expect(TestBed.inject(CompareStore).options()[1].loggedEntryId).toBeNull();
  });

  it('logs a library option with quick log at the chosen weight', async () => {
    persist([optionFromLibrary(YOGURT, 'o1'), optionFromDish(SALAD_DISH, null, 'o2')]);
    const { fixture, el } = await render();
    const card = cardTitled(el, 'Greek yogurt');

    byLabel(card, 'More Greek yogurt').click();
    await settle(fixture);
    expect(text(card.querySelector('[data-testid="option-kcal"]')!)).toMatch(/^159\s?kcal$/);

    byLabel(card, 'Log Greek yogurt').click();
    await settle(fixture);
    expect(api.quickLog).toHaveBeenCalledWith({
      key: 'meal:entry-1',
      grams: 180,
      timestamp: NOW.toISOString(),
      localDate: TODAY,
      mealType: 'lunch',
    });
  });

  it('rescales an option when the portion changes', async () => {
    persist([optionFromDish(BOWL_DISH, null, 'o1')]);
    const { fixture, el } = await render();
    const card = cardTitled(el, 'Chicken rice bowl');
    const grams = card.querySelector<HTMLInputElement>(
      'input[aria-label="Grams of Chicken rice bowl"]',
    )!;
    grams.dispatchEvent(new Event('focus'));
    grams.value = '225';
    grams.dispatchEvent(new Event('input'));
    grams.dispatchEvent(new Event('blur'));
    await settle(fixture);
    expect(text(card.querySelector('[data-testid="option-kcal"]')!)).toMatch(/^325\s?kcal$/);
    const stored = JSON.parse(sessionStorage.getItem(COMPARE_STORAGE_KEY)!) as PersistedCompare;
    expect(stored.options[0].portion).toEqual({ mode: 'grams', grams: 225 });
  });

  it('offers a label scan when a barcode is unknown', async () => {
    api.lookupBarcode.mockResolvedValue({ barcode: '5281234567890', source: null, product: null });
    const { fixture, el } = await render();
    TestBed.inject(CompareStore).lookupBarcode('5281234567890');
    await settle(fixture);
    const card = cards(el)[0];
    expect(text(card)).toContain('Product not found');
    expect(buttonByText(card, 'Snap the label')).toBeTruthy();
    expect(() => buttonByText(card, 'Try again')).toThrow();
  });

  it('restores the comparison from this session', async () => {
    persist([optionFromDish(BOWL_DISH, null, 'o1'), optionFromDish(BURGER_DISH, null, 'o2')]);
    const { el } = await render();
    expect(cards(el)).toHaveLength(2);
    expect(el.querySelector('app-compare-table')).not.toBeNull();
  });

  it("ignores another person's saved comparison", async () => {
    sessionStorage.setItem(
      COMPARE_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        userId: 'someone-else',
        savedAt: NOW.getTime(),
        options: [optionFromDish(BOWL_DISH, null, 'o1')],
        menu: null,
      }),
    );
    const { el } = await render();
    expect(cards(el)).toHaveLength(0);
    expect(sessionStorage.getItem(COMPARE_STORAGE_KEY)).toBeNull();
  });

  it('clears the comparison and can bring it back', async () => {
    persist([optionFromDish(BOWL_DISH, null, 'o1'), optionFromDish(BURGER_DISH, null, 'o2')]);
    const { fixture, el } = await render();

    buttonByText(el.querySelector('app-page-header')!, 'Clear').click();
    await settle(fixture);
    expect(cards(el)).toHaveLength(0);
    expect(sessionStorage.getItem(COMPARE_STORAGE_KEY)).toBeNull();

    const toast = TestBed.inject(ToastService).toasts()[0];
    expect(toast.message).toBe('Comparison cleared');
    toast.action!.run();
    await settle(fixture);
    expect(cards(el)).toHaveLength(2);
  });

  it('removes an option with undo', async () => {
    persist([optionFromDish(BOWL_DISH, null, 'o1'), optionFromDish(BURGER_DISH, null, 'o2')]);
    const { fixture, el } = await render();
    byLabel(cardTitled(el, 'Double cheeseburger'), 'Remove Double cheeseburger').click();
    await settle(fixture);
    expect(cards(el)).toHaveLength(1);
    TestBed.inject(ToastService).toasts()[0].action!.run();
    await settle(fixture);
    expect(cards(el).map((card) => text(card.querySelector('h3')!))).toEqual([
      'Chicken rice bowl',
      'Double cheeseburger',
    ]);
  });

  it('forgets everything when the session resets', async () => {
    persist([optionFromDish(BOWL_DISH, null, 'o1')]);
    const { fixture, el } = await render();
    TestBed.inject(SessionScope).reset();
    await settle(fixture);
    expect(cards(el)).toHaveLength(0);
    expect(sessionStorage.getItem(COMPARE_STORAGE_KEY)).toBeNull();
  });

  it('reloads the budget after something is logged elsewhere', async () => {
    const { fixture } = await render();
    expect(api.dayDashboard).toHaveBeenCalledTimes(1);
    TestBed.inject(DataEventsService).notify('entries');
    await settle(fixture);
    expect(api.dayDashboard).toHaveBeenCalledTimes(2);
  });

  it('reloads the budget when the day changes while the page is open', async () => {
    const { fixture } = await render();
    expect(api.dayDashboard).toHaveBeenLastCalledWith(TODAY);
    const now = (fixture.componentInstance as unknown as { now: WritableSignal<number> }).now;
    clock = new Date(2026, 9, 1, 0, 1, 0).getTime();
    now.set(clock);
    await settle(fixture);
    expect(api.dayDashboard).toHaveBeenCalledTimes(1);

    clock = new Date(2026, 9, 1, 3, 1, 0).getTime();
    now.set(clock);
    await settle(fixture);
    expect(api.dayDashboard).toHaveBeenLastCalledWith('2026-10-01');
    expect(api.dayDashboard).toHaveBeenCalledTimes(2);
  });

  it('starts fresh when the comparison was left untouched for half a day', async () => {
    persist([optionFromDish(BOWL_DISH, null, 'o1'), optionFromDish(BURGER_DISH, null, 'o2')]);
    const first = await render();
    expect(cards(first.el)).toHaveLength(2);
    first.fixture.destroy();

    clock += COMPARE_MAX_AGE_MS + 60_000;
    const { el } = await render();
    expect(cards(el)).toHaveLength(0);
    expect(text(el)).toContain("Can't decide what to eat?");
    expect(sessionStorage.getItem(COMPARE_STORAGE_KEY)).toBeNull();
  });

  it('says "top pick" instead of "best fit" when every option goes over', async () => {
    api.dayDashboard.mockImplementation(async (date: string) => ({
      ...dashboard(date),
      day: { ...dashboard(date).day, totals: n({ ...EATEN, calories: 2400 }) },
    }));
    persist([optionFromDish(BURGER_DISH, null, 'o1'), optionFromDish(BOWL_DISH, null, 'o2')]);
    const { el } = await render();
    const sticky = el.querySelector('app-sticky-actions')!;
    expect(text(sticky)).toContain('Log top pick · 650 kcal');
    expect(text(el.querySelector('[data-testid="verdict"]')!)).toContain('Best of these');
  });

  it('marks menu dishes that are already being compared', async () => {
    api.scanMenu.mockResolvedValue({
      restaurant: 'Café Nour',
      dishes: [BOWL_DISH, BURGER_DISH, SALAD_DISH],
      warnings: [],
      usage: analysis('x', 0, 0).usage,
    });
    const { fixture, el } = await render();
    const store = TestBed.inject(CompareStore);
    store.addMenuPhotos([new File(['menu'], 'menu.jpg', { type: 'image/jpeg' })]);
    await store.scanMenu();
    store.addDishes([BOWL_DISH]);
    await settle(fixture);

    byLabel(el, 'Menu').click();
    await settle(fixture);
    buttonByText(sheet(el), 'Pick from your last menu').click();
    await settle(fixture);
    const dishes = Array.from(
      sheet(el).querySelectorAll<HTMLButtonElement>('ul[aria-label="Dishes"] button'),
    );
    expect(text(dishes[0])).toContain('Added');
    expect(text(dishes[1])).not.toContain('Added');
    expect(text(dishes[2])).not.toContain('Added');
  });
});
