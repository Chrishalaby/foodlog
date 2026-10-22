import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type EntryDto,
  type FavoriteDto,
  type FoodSearchResult,
  type Portion,
  type QuickLogRequest,
  type UpdateEntryRequest,
  type UpdateFavoriteRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { LibraryActions } from './library-actions';
import { installDialogShim } from './testing/dialog-shim';
import type { LibraryDraft } from './log.store';
import { QuickLogSheet, type QuickLogSelection } from './quick-log-sheet';

const YOGURT: FoodSearchResult = {
  portion: null,
  key: 'food:item-1',
  kind: 'food',
  name: 'Khoury strawberry yogurt',
  detail: 'Breakfast bowl',
  items: [
    {
      name: 'Khoury strawberry yogurt',
      grams: 170,
      nutrients: { ...zeroNutrients(), calories: 150, protein: 6, carbs: 22, fat: 4.2 },
      confidence: 'high',
    },
  ],
  totals: { ...zeroNutrients(), calories: 150, protein: 6, carbs: 22, fat: 4.2 },
  grams: 170,
  mealType: 'breakfast',
  photo: {
    id: 'photo-9',
    url: '/api/photos/photo-9',
    thumbUrl: '/api/photos/photo-9/thumb',
    width: 1,
    height: 1,
  },
  favoriteId: null,
  entryId: 'entry-1',
  useCount: 4,
  lastUsedAt: null,
  productId: null,
  starred: false,
};

const PLATE: FoodSearchResult = {
  ...YOGURT,
  key: 'meal:entry-2',
  kind: 'meal',
  name: 'Chicken plate',
  detail: null,
  items: [
    { name: 'Chicken', grams: 180, nutrients: { ...zeroNutrients(), calories: 390, protein: 45 } },
    { name: 'Fries', grams: 120, nutrients: { ...zeroNutrients(), calories: 370, fat: 18 } },
  ],
  totals: { ...zeroNutrients(), calories: 760, protein: 45, fat: 18 },
  grams: 300,
  entryId: 'entry-2',
};

const OATS: FoodSearchResult = {
  ...PLATE,
  key: 'favorite:fav-1',
  kind: 'favorite',
  name: 'Overnight oats',
  mealType: 'breakfast',
  favoriteId: 'fav-1',
  entryId: null,
  productId: null,
  starred: true,
};

const SINGLE_MEAL: FoodSearchResult = {
  ...YOGURT,
  key: 'meal:entry-3',
  kind: 'meal',
  detail: null,
  entryId: 'entry-3',
};

const SINGLE_FAVORITE: FoodSearchResult = {
  ...YOGURT,
  key: 'favorite:fav-2',
  kind: 'favorite',
  detail: null,
  favoriteId: 'fav-2',
  entryId: null,
  starred: true,
};

function favoriteOf(result: FoodSearchResult, id: string): FavoriteDto {
  return {
    portion: null,
    id,
    name: result.name,
    mealType: result.kind === 'food' ? null : result.mealType,
    items: result.items,
    totals: result.totals,
    photo: null,
    useCount: 0,
    lastUsedAt: null,
    createdAt: '2026-09-28T07:00:00.000Z',
    updatedAt: '2026-09-28T07:00:00.000Z',
  };
}

function entry(body: QuickLogRequest, calories: number): EntryDto {
  return {
    portion: null,
    id: 'entry-new',
    name: 'Khoury strawberry yogurt',
    description: null,
    mealType: body.mealType,
    source: 'copy',
    timestamp: body.timestamp,
    localDate: body.localDate,
    items: [],
    totals: { ...zeroNutrients(), calories },
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: body.timestamp,
    updatedAt: body.timestamp,
  };
}

@Component({
  imports: [QuickLogSheet],
  providers: [LibraryActions],
  template: `
    <app-quick-log-sheet
      [selection]="selection()"
      [(open)]="open"
      (logged)="logged.set($event)"
      (edit)="draft.set($event)"
    />
  `,
})
class Host {
  readonly selection = signal<QuickLogSelection | null>(null);
  readonly open = signal(false);
  readonly logged = signal<EntryDto | null>(null);
  readonly draft = signal<LibraryDraft | null>(null);
}

const BURGERS: Portion = { count: 2, unit: 'burger', unitPlural: 'burgers' };

const BURGER_MEAL: FoodSearchResult = {
  ...PLATE,
  key: 'meal:entry-5',
  name: 'Black Angus beef burgers',
  items: [
    {
      name: 'Black Angus patty',
      grams: 400,
      nutrients: { ...zeroNutrients(), calories: 1000, protein: 80 },
      count: 2,
      unit: 'patty',
      unitPlural: 'patties',
    },
    { name: 'Brioche bun', grams: 380, nutrients: { ...zeroNutrients(), calories: 450 } },
  ],
  totals: { ...zeroNutrients(), calories: 1450, protein: 80 },
  grams: 780,
  portion: BURGERS,
  entryId: 'entry-5',
};

function savedEntry(id: string, body: UpdateEntryRequest): EntryDto {
  return {
    id,
    name: body.name,
    description: body.description ?? null,
    mealType: body.mealType,
    source: 'food_photo',
    timestamp: body.timestamp,
    localDate: body.localDate,
    items: body.items.map((item, position) => ({
      id: `${id}-new-item-${position}`,
      position,
      name: item.name,
      grams: item.grams,
      nutrients: item.nutrients,
      confidence: item.confidence ?? null,
      count: item.count ?? null,
      unit: item.unit ?? null,
      unitPlural: item.unitPlural ?? null,
      productId: item.productId ?? null,
      micros: item.micros ?? null,
      fluidMl: item.fluidMl ?? null,
    })),
    totals: zeroNutrients(),
    portion: body.portion ?? null,
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: null,
    productId: null,
    createdAt: body.timestamp,
    updatedAt: body.timestamp,
  };
}

function sourceEntry(result: FoodSearchResult, itemId: string): EntryDto {
  return {
    ...savedEntry(result.entryId!, {
      name: result.name,
      description: 'from the grill',
      mealType: 'dinner',
      timestamp: '2026-09-29T19:00:00.000Z',
      localDate: '2026-09-29',
      items: result.items,
    }),
    items: result.items.map((item, position) => ({
      id: position === 0 ? itemId : `other-${position}`,
      position,
      name: item.name,
      grams: item.grams,
      nutrients: item.nutrients,
      confidence: item.confidence ?? null,
      count: item.count ?? null,
      unit: item.unit ?? null,
      unitPlural: item.unitPlural ?? null,
      productId: item.productId ?? null,
      micros: item.micros ?? null,
      fluidMl: item.fluidMl ?? null,
    })),
  };
}

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  )!;

describe('QuickLogSheet', () => {
  const api = {
    quickLog: vi.fn<(body: QuickLogRequest) => Promise<EntryDto>>(),
    deleteEntry: vi.fn(),
    createFavorite: vi.fn(),
    createFavoriteFromEntry: vi.fn(),
    deleteFavorite: vi.fn(),
    getEntry: vi.fn<(id: string) => Promise<EntryDto>>(),
    updateEntry: vi.fn<(id: string, body: UpdateEntryRequest) => Promise<EntryDto>>(),
    listFavorites: vi.fn<() => Promise<FavoriteDto[]>>(),
    updateFavorite: vi.fn<(id: string, body: UpdateFavoriteRequest) => Promise<FavoriteDto>>(),
  };
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    Object.values(api).forEach((mock) => mock.mockReset());
    confirm.confirm.mockReset();
    api.quickLog.mockImplementation(async (body) => entry(body, body.grams ? 225 : 380));
    api.deleteEntry.mockResolvedValue(undefined);
    api.deleteFavorite.mockResolvedValue(undefined);
    api.createFavorite.mockResolvedValue(favoriteOf(YOGURT, 'fav-9'));
    api.createFavoriteFromEntry.mockResolvedValue(favoriteOf(PLATE, 'fav-8'));
    api.updateEntry.mockImplementation(async (id, body) => savedEntry(id, body));
    api.updateFavorite.mockImplementation(async (id, body) => ({
      ...favoriteOf(OATS, id),
      name: body.name,
      items: body.items,
      portion: body.portion ?? null,
    }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function show(result: FoodSearchResult) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.selection.set({ id: 1, result });
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    return { fixture, host: fixture.componentInstance, el };
  }

  it('logs a single food by grams with live totals, then offers undo', async () => {
    const { fixture, host, el } = await show(YOGURT);
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(el.querySelector('dialog')?.getAttribute('aria-label')).toBe(
      'Log Khoury strawberry yogurt',
    );
    const grams = el.querySelector<HTMLInputElement>('input[aria-label="Grams"]')!;
    expect(el.textContent).toContain('Khoury strawberry yogurt');
    expect(el.textContent).toContain('from Breakfast bowl');
    expect(grams.value).toBe('170');
    expect(buttonWith(el, 'Log ·').textContent).toContain('150 kcal');

    buttonWith(el, '1½×').click();
    await fixture.whenStable();
    expect(grams.value).toBe('255');
    expect(buttonWith(el, 'Log ·').textContent).toContain('225 kcal');
    expect(buttonWith(el, '1½×').getAttribute('aria-pressed')).toBe('true');

    el.querySelector<HTMLButtonElement>('button[aria-label="More, more grams"]')!.click();
    await fixture.whenStable();
    expect(grams.value).toBe('260');
    el.querySelector<HTMLButtonElement>('button[aria-label="Less, fewer grams"]')!.click();
    await fixture.whenStable();
    expect(grams.value).toBe('250');
    buttonWith(el, '1½×').click();
    await fixture.whenStable();

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    const body = api.quickLog.mock.calls[0]![0];
    expect(body).toMatchObject({
      key: 'food:item-1',
      grams: 255,
      localDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(body.servings).toBeUndefined();
    expect(host.open()).toBe(false);
    expect(el.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(host.logged()?.id).toBe('entry-new');

    const events = TestBed.inject(DataEventsService);
    expect(events.entries()).toBe(1);
    expect(events.favorites()).toBe(1);
    const toasts = TestBed.inject(ToastService);
    const toast = toasts.toasts().at(-1)!;
    expect(toast.message).toBe('Logged Khoury strawberry yogurt · 225 kcal');
    expect(toast.actions.map((action) => action.label)).toEqual(['Undo', 'View']);
    toasts.runAction(toast.id);
    await fixture.whenStable();
    expect(api.deleteEntry).toHaveBeenCalledWith('entry-new');
    expect(events.entries()).toBe(2);
  });

  const SINGLE_CHIPS: [FoodSearchResult, string[]][] = [
    [SINGLE_MEAL, ['½ of last time', 'Same as last time', '1½× last time', '2× last time']],
    [SINGLE_FAVORITE, ['½ serving', '1 serving', '1½ servings', '2 servings']],
  ];

  for (const [single, labels] of SINGLE_CHIPS) {
    it(`logs a food logged on its own by grams (${single.kind})`, async () => {
      const { fixture, el } = await show(single);
      const grams = el.querySelector<HTMLInputElement>('input[aria-label="Grams"]');
      expect(grams?.value).toBe('170');
      expect(el.querySelector('output')).toBeNull();
      expect(el.textContent).not.toMatch(/About \d+ g/);
      const chips = labels.map((label) =>
        el.querySelector<HTMLButtonElement>(`button[aria-label^="${label},"]`),
      );
      expect(chips.map((chip) => chip?.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
        `${labels[0]} 85 g`,
        `${labels[1]} 170 g`,
        `${labels[2]} 255 g`,
        `${labels[3]} 340 g`,
      ]);

      chips[2]!.click();
      await fixture.whenStable();
      expect(grams?.value).toBe('255');
      expect(buttonWith(el, 'Log ·').textContent).toContain('225 kcal');

      buttonWith(el, 'Log ·').click();
      await fixture.whenStable();
      const body = api.quickLog.mock.calls[0]![0];
      expect(body).toMatchObject({ key: single.key, grams: 255 });
      expect(body.servings).toBeUndefined();
    });
  }

  it('logs meals relative to last time in quarter steps, never as a bare multiplier', async () => {
    const { fixture, el } = await show(PLATE);
    const output = () => el.querySelector('output')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(el.querySelector('[data-quick-lead]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Last time: 300 g · 760 kcal',
    );
    expect(output()).toBe('Same as last time');
    expect(el.textContent).toContain('How much this time?');
    expect(
      el.querySelector('[role="group"][aria-labelledby]')?.querySelectorAll('button').length,
    ).toBe(4);
    expect(el.textContent).toContain('About 300 g');
    expect(el.textContent).not.toMatch(/×\s*1\.5|\b1½×(?! last time)/);
    el.querySelector<HTMLButtonElement>('button[aria-label="More than last time"]')!.click();
    await fixture.whenStable();
    expect(output()).toBe('1¼× last time');
    el.querySelector<HTMLButtonElement>('button[aria-label="More than last time"]')!.click();
    el.querySelector<HTMLButtonElement>('button[aria-label="More than last time"]')!.click();
    await fixture.whenStable();
    expect(output()).toBe('1¾× last time');
    el.querySelector<HTMLButtonElement>('button[aria-label="Less than last time"]')!.click();
    el.querySelector<HTMLButtonElement>('button[aria-label="Less than last time"]')!.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('About 375 g');
    el.querySelector<HTMLButtonElement>('button[aria-label="½ of last time, 150 g"]')!.click();
    await fixture.whenStable();
    expect(output()).toBe('½ of last time');
    expect(buttonWith(el, 'Log ·').textContent).toContain('380 kcal');

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    expect(api.quickLog.mock.calls[0]![0]).toMatchObject({ key: 'meal:entry-2', servings: 0.5 });
  });

  it("uses a favorite's meal type and lets the user pick another one", async () => {
    const { fixture, el } = await show(OATS);
    const radio = (label: string) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button[role="radio"]')).find((b) =>
        b.textContent?.includes(label),
      )!;
    expect(radio('Breakfast').getAttribute('aria-checked')).toBe('true');
    radio('Snack').click();
    await fixture.whenStable();
    const time = el.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    time.value = '2026-09-28T19:30';
    time.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(radio('Snack').getAttribute('aria-checked')).toBe('true');

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    expect(api.quickLog.mock.calls[0]![0]).toMatchObject({
      key: 'favorite:fav-1',
      mealType: 'snack',
      servings: 1,
      timestamp: new Date(2026, 8, 28, 19, 30).toISOString(),
      localDate: '2026-09-28',
    });
  });

  it('re-guesses the meal type from the time until the user picks one', async () => {
    const { fixture, el } = await show(PLATE);
    const time = el.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    time.value = '2026-09-28T08:00';
    time.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const checked = el.querySelector('button[role="radio"][aria-checked="true"]');
    expect(checked?.textContent).toContain('Breakfast');

    time.value = '';
    time.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(el.textContent).toContain('Choose a valid date and time.');
    expect(buttonWith(el, 'Log ·').disabled).toBe(true);
  });

  it('logs at the time the selection brings, such as a past day being viewed', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.selection.set({
      id: 1,
      result: PLATE,
      dateTime: '2026-09-25T13:15',
    });
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const time = el.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(time.value).toBe('2026-09-25T13:15');

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();

    expect(api.quickLog).toHaveBeenCalledWith(
      expect.objectContaining({
        timestamp: new Date(2026, 8, 25, 13, 15).toISOString(),
        localDate: '2026-09-25',
      }),
    );
  });

  it('hands the selected time to the full editor', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.selection.set({
      id: 1,
      result: PLATE,
      dateTime: '2026-09-25T13:15',
    });
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    buttonWith(el, 'Edit before saving').click();
    await fixture.whenStable();

    expect(fixture.componentInstance.draft()?.dateTime).toBe('2026-09-25T13:15');
  });

  it('hands scaled items to the full editor before saving', async () => {
    const { fixture, host, el } = await show(PLATE);
    buttonWith(el, '2').click();
    await fixture.whenStable();
    buttonWith(el, 'Edit before saving').click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);
    const draft = host.draft()!;
    expect(draft.name).toBe('Chicken plate');
    expect(draft.items.map((item) => item.grams)).toEqual([360, 240]);
    expect(draft.items[0].nutrients.calories).toBe(780);
    expect(draft.photo?.id).toBe('photo-9');
    expect(draft.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(api.quickLog).not.toHaveBeenCalled();
  });

  it('does not carry the photo of the source meal into a single food', async () => {
    const { fixture, host, el } = await show(YOGURT);
    buttonWith(el, 'Edit before saving').click();
    await fixture.whenStable();
    expect(host.draft()?.photo).toBeNull();
    expect(host.draft()?.items[0].grams).toBe(170);
  });

  it('stars a food and a meal', async () => {
    const { fixture, el } = await show(YOGURT);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Star Khoury strawberry yogurt"]',
    )!.click();
    await fixture.whenStable();
    expect(api.createFavorite).toHaveBeenCalledWith({
      name: 'Khoury strawberry yogurt',
      mealType: null,
      items: YOGURT.items,
      photoId: null,
    });
    const star = el.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
    expect(star?.getAttribute('aria-label')).toContain('Remove from favorites');
    expect(TestBed.inject(DataEventsService).favorites()).toBe(1);

    fixture.componentInstance.selection.set({ id: 2, result: PLATE });
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="Star Chicken plate"]')!.click();
    await fixture.whenStable();
    expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('entry-2');
  });

  it('logs a meal starred in the sheet as the new favorite', async () => {
    const { fixture, el } = await show(PLATE);
    buttonWith(el, '½').click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="Star Chicken plate"]')!.click();
    await fixture.whenStable();
    expect(api.createFavoriteFromEntry).toHaveBeenCalledWith('entry-2');
    expect(el.querySelector('output')!.textContent).toContain('½');

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    const body = api.quickLog.mock.calls[0]![0];
    expect(body).toMatchObject({ key: 'favorite:fav-8', servings: 0.5 });
    expect(body.grams).toBeUndefined();
  });

  it('logs a food starred in the sheet as the new favorite, still by grams', async () => {
    const { fixture, el } = await show(YOGURT);
    buttonWith(el, '1½×').click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Star Khoury strawberry yogurt"]',
    )!.click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('input[aria-label="Grams"]')?.value).toBe('255');

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    const body = api.quickLog.mock.calls[0]![0];
    expect(body).toMatchObject({ key: 'favorite:fav-9', grams: 255 });
    expect(body.servings).toBeUndefined();
  });

  it('goes back to the meal when a star added in the sheet is removed', async () => {
    const { fixture, host, el } = await show(PLATE);
    el.querySelector<HTMLButtonElement>('button[aria-label="Star Chicken plate"]')!.click();
    await fixture.whenStable();
    confirm.confirm.mockResolvedValueOnce(true);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Starred. Remove from favorites"]',
    )!.click();
    await fixture.whenStable();
    expect(api.deleteFavorite).toHaveBeenCalledWith('fav-8');
    expect(host.open()).toBe(true);
    expect(el.querySelector('button[aria-label="Star Chicken plate"]')).not.toBeNull();

    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    expect(api.quickLog.mock.calls[0]![0]).toMatchObject({ key: 'meal:entry-2', servings: 1 });
  });

  it('unstars a favorite after confirming and closes the sheet', async () => {
    const { fixture, host, el } = await show(OATS);
    const star = () =>
      el.querySelector<HTMLButtonElement>('button[aria-label="Starred. Remove from favorites"]')!;
    confirm.confirm.mockResolvedValueOnce(false);
    star().click();
    await fixture.whenStable();
    expect(api.deleteFavorite).not.toHaveBeenCalled();
    expect(host.open()).toBe(true);

    confirm.confirm.mockResolvedValueOnce(true);
    star().click();
    await fixture.whenStable();
    expect(api.deleteFavorite).toHaveBeenCalledWith('fav-1');
    expect(host.open()).toBe(false);
  });

  it('keeps the sheet open and explains a failed log', async () => {
    api.quickLog.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const { fixture, host, el } = await show(PLATE);
    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    expect(host.open()).toBe(true);
    expect(TestBed.inject(ToastService).toasts().at(-1)?.kind).toBe('error');
    expect(buttonWith(el, 'Log ·').disabled).toBe(false);
  });

  it('says so when the food is no longer in the library', async () => {
    api.quickLog.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    const { fixture, el } = await show(PLATE);
    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
      'Chicken plate is no longer in your library.',
    );
  });

  it('opens today from the toast after logging', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const { fixture, el } = await show(PLATE);
    buttonWith(el, 'Log ·').click();
    await fixture.whenStable();
    const toasts = TestBed.inject(ToastService);
    toasts.runAction(toasts.toasts().at(-1)!.id, 1);
    expect(navigate).toHaveBeenCalledWith('/today');
    expect(api.deleteEntry).not.toHaveBeenCalled();
  });
  describe('counting portions', () => {
    const output = (el: HTMLElement) =>
      el.querySelector('output')!.textContent!.replace(/\s+/g, ' ').trim();
    const lead = (el: HTMLElement) =>
      el.querySelector('[data-quick-lead]')?.textContent?.replace(/\s+/g, ' ').trim();
    const logButton = (el: HTMLElement) =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
        /^Log\b.*kcal$/.test(button.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
      )!;

    it('re-logs 1½ of the 2 burgers eaten last time instead of 1½× the meal', async () => {
      const { fixture, el } = await show(BURGER_MEAL);
      expect(lead(el)).toBe('Last time: 2 burgers · 780 g · 1,450 kcal');
      expect(el.textContent).toContain('How many burgers?');
      expect(output(el)).toBe('2 burgers');
      const chips = Array.from(
        el.querySelectorAll<HTMLButtonElement>('[role="group"][aria-labelledby] button'),
      ).map((chip) => chip.getAttribute('aria-label'));
      expect(chips).toEqual([
        '½ burger, 195 g',
        '1 burger, 390 g',
        '1½ burgers, 585 g',
        '2 burgers, 780 g',
        '3 burgers, 1,170 g',
      ]);
      expect(
        el.querySelector('button[aria-label^="2 burgers,"]')?.getAttribute('aria-pressed'),
      ).toBe('true');

      el.querySelector<HTMLButtonElement>('button[aria-label^="1½ burgers,"]')!.click();
      await fixture.whenStable();
      expect(output(el)).toBe('1½ burgers');
      expect(el.textContent).toContain('About 585 g');
      expect(logButton(el).textContent?.replace(/\s+/g, ' ').trim()).toBe(
        'Log 1½ burgers · 1,088 kcal',
      );

      api.quickLog.mockImplementationOnce(async (request) => ({
        ...entry(request, 1088),
        name: 'Black Angus beef burgers',
        portion: { ...BURGERS, count: 1.5 },
      }));
      logButton(el).click();
      await fixture.whenStable();
      const body = api.quickLog.mock.calls[0]![0];
      expect(body).toMatchObject({ key: 'meal:entry-5', portionCount: 1.5 });
      expect(body.servings).toBeUndefined();
      expect(body.grams).toBeUndefined();
      expect(TestBed.inject(ToastService).toasts().at(-1)?.message).toBe(
        'Logged Black Angus beef burgers · 1½ burgers · 1,088 kcal',
      );
    });

    it('steps by half a unit and hands the scaled portion to the full editor', async () => {
      const { fixture, host, el } = await show(BURGER_MEAL);
      el.querySelector<HTMLButtonElement>('button[aria-label="Fewer burgers"]')!.click();
      await fixture.whenStable();
      expect(output(el)).toBe('1½ burgers');
      el.querySelector<HTMLButtonElement>('button[aria-label="Fewer burgers"]')!.click();
      el.querySelector<HTMLButtonElement>('button[aria-label="Fewer burgers"]')!.click();
      await fixture.whenStable();
      expect(output(el)).toBe('½ burger');
      expect(
        el.querySelector<HTMLButtonElement>('button[aria-label="Fewer burgers"]')!.disabled,
      ).toBe(true);
      el.querySelector<HTMLButtonElement>('button[aria-label="More burgers"]')!.click();
      await fixture.whenStable();

      buttonWith(el, 'Edit before saving').click();
      await fixture.whenStable();
      const draft = host.draft()!;
      expect(draft.portion).toEqual({ ...BURGERS, count: 1 });
      expect(draft.items[0]).toMatchObject({ grams: 200, count: 1, unit: 'patty' });
      expect(draft.items[1]).toMatchObject({ grams: 190, count: null });
    });

    it('offers grams as the alternative and switches back to counting', async () => {
      const { fixture, el } = await show(BURGER_MEAL);
      buttonWith(el, 'Enter grams instead').click();
      await fixture.whenStable();
      const grams = el.querySelector<HTMLInputElement>('input[aria-label="Grams"]')!;
      expect(grams.value).toBe('780');
      grams.dispatchEvent(new Event('focus'));
      grams.value = '390';
      grams.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(logButton(el).textContent).toContain('725 kcal');

      buttonWith(el, 'Count burgers instead').click();
      await fixture.whenStable();
      expect(output(el)).toBe('1 burger');

      buttonWith(el, 'Enter grams instead').click();
      await fixture.whenStable();
      logButton(el).click();
      await fixture.whenStable();
      expect(api.quickLog.mock.calls[0]![0]).toMatchObject({ servings: 0.5 });
    });

    it('saves "this was 2 burgers" on last time\'s entry and switches to counting', async () => {
      api.getEntry.mockResolvedValue(sourceEntry(PLATE, 'item-a'));
      const { fixture, el } = await show(PLATE);
      expect(el.textContent).not.toContain('How many');
      buttonWith(el, 'Log by count').click();
      await fixture.whenStable();
      expect(el.querySelector('form label')?.textContent?.trim()).toBe('Last time was');
      const count = el.querySelector<HTMLInputElement>('form input[inputmode="decimal"]')!;
      const unit = el.querySelector<HTMLInputElement>('form input[aria-label^="Unit"]')!;
      expect(count.value).toBe('');
      expect(count.placeholder).toBe('');
      expect(unit.placeholder).toBe('e.g. burgers');
      expect(buttonWith(el, 'Save count').disabled).toBe(true);
      count.value = '2';
      count.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(buttonWith(el, 'Save count').disabled).toBe(true);
      unit.value = 'burger';
      unit.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      expect(buttonWith(el, 'Save count').disabled).toBe(false);
      buttonWith(el, 'Save count').click();
      await fixture.whenStable();

      expect(api.getEntry).toHaveBeenCalledWith('entry-2');
      const [id, body] = api.updateEntry.mock.calls[0]!;
      expect(id).toBe('entry-2');
      expect(body).toMatchObject({
        name: 'Chicken plate',
        description: 'from the grill',
        mealType: 'dinner',
        timestamp: '2026-09-29T19:00:00.000Z',
        localDate: '2026-09-29',
        portion: BURGERS,
      });
      expect(body.items.map((item) => item.grams)).toEqual([180, 120]);
      expect(TestBed.inject(DataEventsService).entries()).toBe(1);

      expect(lead(el)).toBe('Last time: 2 burgers · 300 g · 760 kcal');
      expect(el.textContent).toContain('How many burgers?');
      expect(el.textContent).not.toContain('Log by count');
      el.querySelector<HTMLButtonElement>('button[aria-label^="1½ burgers,"]')!.click();
      await fixture.whenStable();
      expect(logButton(el).textContent).toContain('570 kcal');
      logButton(el).click();
      await fixture.whenStable();
      expect(api.quickLog.mock.calls[0]![0]).toMatchObject({
        key: 'meal:entry-2',
        portionCount: 1.5,
      });
    });

    it('saves the count on the food item and follows its new key', async () => {
      api.getEntry.mockResolvedValue(sourceEntry(YOGURT, 'item-1'));
      const { fixture, el } = await show(YOGURT);
      buttonWith(el, 'Log by count').click();
      await fixture.whenStable();
      const count = el.querySelector<HTMLInputElement>('form input[inputmode="decimal"]')!;
      const unit = el.querySelector<HTMLInputElement>('form input[aria-label^="Unit"]')!;
      count.value = '1';
      count.dispatchEvent(new Event('input'));
      unit.value = 'cup';
      unit.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      buttonWith(el, 'Save count').click();
      await fixture.whenStable();

      const body = api.updateEntry.mock.calls[0]![1];
      expect(body.items[0]).toMatchObject({ count: 1, unit: 'cup', unitPlural: 'cups' });
      expect(body.portion).toEqual({ count: 1, unit: 'cup', unitPlural: 'cups' });
      el.querySelector<HTMLButtonElement>('button[aria-label^="2 cups,"]')!.click();
      await fixture.whenStable();
      logButton(el).click();
      await fixture.whenStable();
      expect(api.quickLog.mock.calls[0]![0]).toMatchObject({
        key: 'food:entry-1-new-item-0',
        portionCount: 2,
      });
    });

    it('saves the count on a favorite', async () => {
      api.listFavorites.mockResolvedValue([favoriteOf(OATS, 'fav-1')]);
      const { fixture, el } = await show(OATS);
      buttonWith(el, 'Log by count').click();
      await fixture.whenStable();
      expect(el.querySelector('form label')?.textContent?.trim()).toBe('This favorite is');
      const count = el.querySelector<HTMLInputElement>('form input[inputmode="decimal"]')!;
      const unit = el.querySelector<HTMLInputElement>('form input[aria-label^="Unit"]')!;
      count.value = '1';
      count.dispatchEvent(new Event('input'));
      unit.value = 'jar';
      unit.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      buttonWith(el, 'Save count').click();
      await fixture.whenStable();
      expect(api.updateFavorite).toHaveBeenCalledWith('fav-1', {
        name: 'Overnight oats',
        mealType: 'breakfast',
        items: OATS.items,
        portion: { count: 1, unit: 'jar', unitPlural: 'jars' },
      });
      expect(api.updateEntry).not.toHaveBeenCalled();
      expect(el.textContent).toContain('How many jars?');
    });

    it('keeps the sheet usable when saving the count fails', async () => {
      api.getEntry.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
      const { fixture, el } = await show(PLATE);
      buttonWith(el, 'Log by count').click();
      await fixture.whenStable();
      const count = el.querySelector<HTMLInputElement>('form input[inputmode="decimal"]')!;
      const unit = el.querySelector<HTMLInputElement>('form input[aria-label^="Unit"]')!;
      count.value = '2';
      count.dispatchEvent(new Event('input'));
      unit.value = 'plates';
      unit.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      buttonWith(el, 'Save count').click();
      await fixture.whenStable();
      expect(TestBed.inject(ToastService).toasts().at(-1)?.kind).toBe('error');
      expect(el.textContent).not.toContain('How many');
      expect(output(el)).toBe('Same as last time');
      expect(logButton(el).disabled).toBe(false);
    });

    it('does not offer counting for scanned products', async () => {
      const product = { ...YOGURT, key: 'product:p1', kind: 'product' as const, productId: 'p1' };
      const { el } = await show(product);
      expect(el.textContent).not.toContain('Log by count');
      expect(lead(el)).toBe('1 serving: 170 g · 150 kcal');
    });
  });
});
