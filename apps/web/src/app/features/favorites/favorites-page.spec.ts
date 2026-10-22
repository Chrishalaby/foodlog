import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  guessMealType,
  zeroNutrients,
  type CreateFavoriteRequest,
  type EntryDto,
  type FavoriteDto,
  type FoodRenameRequest,
  type FoodRenameResponse,
  type LogFavoriteRequest,
  type UpdateFavoriteRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { DATA_REFRESH_DEBOUNCE_MS } from '../today/data-watch';
import { FavoritesPage } from './favorites-page';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function favorite(overrides: Partial<FavoriteDto> & Pick<FavoriteDto, 'id' | 'name'>): FavoriteDto {
  return {
    portion: null,
    mealType: null,
    items: [
      {
        name: 'Oats',
        grams: 80,
        nutrients: { ...zeroNutrients(), calories: 303, protein: 10.5, carbs: 54, fat: 5.5 },
      },
      {
        name: 'Milk',
        grams: 200,
        nutrients: { ...zeroNutrients(), calories: 128, protein: 6.8, carbs: 9.6, fat: 7 },
      },
    ],
    totals: { ...zeroNutrients(), calories: 431, protein: 17.3, carbs: 63.6, fat: 12.5 },
    photo: null,
    useCount: 3,
    lastUsedAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function loggedEntry(id: string, request: LogFavoriteRequest, name: string): EntryDto {
  return {
    portion: null,
    id,
    name,
    description: null,
    mealType: request.mealType,
    source: 'favorite',
    timestamp: request.timestamp,
    localDate: request.localDate,
    items: [],
    totals: zeroNutrients(),
    photo: null,
    photos: [],
    analysisId: null,
    favoriteId: 'f1',
    productId: null,
    createdAt: request.timestamp,
    updatedAt: request.timestamp,
  };
}

class FakeApi {
  readonly listFavorites = vi.fn<() => Promise<FavoriteDto[]>>();
  readonly logFavorite = vi.fn<(id: string, body: LogFavoriteRequest) => Promise<EntryDto>>(
    async (id, body) => loggedEntry(`entry-${id}`, body, 'Logged'),
  );
  readonly deleteEntry = vi.fn<(id: string) => Promise<void>>(async () => undefined);
  readonly createFavorite = vi.fn<(body: CreateFavoriteRequest) => Promise<FavoriteDto>>();
  readonly updateFavorite =
    vi.fn<(id: string, body: UpdateFavoriteRequest) => Promise<FavoriteDto>>();
  readonly deleteFavorite = vi.fn<(id: string) => Promise<void>>(async () => undefined);
  readonly renameFood = vi.fn<(body: FoodRenameRequest) => Promise<FoodRenameResponse>>(
    async () => ({ matchedEntries: 0, renamedEntries: 0, renamedItems: 0 }),
  );
}

function installDialogShim(): () => void {
  const proto = HTMLDialogElement.prototype;
  const keys = ['open', 'showModal', 'close'] as const;
  const originals = keys.map((key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const);
  Object.defineProperty(proto, 'open', {
    configurable: true,
    get(this: HTMLDialogElement) {
      return this.hasAttribute('open');
    },
  });
  Object.defineProperty(proto, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(proto, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (this.hasAttribute('open')) {
        this.removeAttribute('open');
        this.dispatchEvent(new Event('close'));
      }
    },
  });
  return () => {
    for (const [key, descriptor] of originals) {
      if (descriptor) {
        Object.defineProperty(proto, key, descriptor);
      } else {
        Reflect.deleteProperty(proto, key);
      }
    }
  };
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find(
    (button) => button.textContent?.replace(/\s+/g, ' ').trim() === text,
  );
  if (!match) {
    throw new Error(`No button "${text}"`);
  }
  return match;
}

describe('FavoritesPage', () => {
  const oats = favorite({ id: 'f1', name: 'Overnight oats', mealType: 'breakfast', useCount: 3 });
  const shake = favorite({ id: 'f2', name: 'Protein shake', useCount: 1 });
  const apple = favorite({ id: 'f3', name: 'Apple', useCount: 0 });
  let api: FakeApi;
  let restoreDialog: () => void;

  beforeAll(() => {
    restoreDialog = installDialogShim();
  });

  afterAll(() => restoreDialog());

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: ApiService, useValue: api }],
    });
  });

  async function settle(fixture: ComponentFixture<FavoritesPage>): Promise<void> {
    await sleep(0);
    await fixture.whenStable();
  }

  async function render(
    list: FavoriteDto[],
  ): Promise<{ fixture: ComponentFixture<FavoritesPage>; el: HTMLElement }> {
    api.listFavorites.mockResolvedValueOnce(list);
    const fixture = TestBed.createComponent(FavoritesPage);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function cardNames(el: HTMLElement): string[] {
    return Array.from(el.querySelectorAll('app-favorite-card p.truncate')).map(
      (node) => node.textContent?.trim() ?? '',
    );
  }

  function toasts() {
    return TestBed.inject(ToastService).toasts();
  }

  it('renders a card per favorite with totals, use count and meal type', async () => {
    const { el } = await render([oats, shake]);
    expect(el.querySelector('app-page-header')?.textContent).toContain('2 starred meals');
    expect(cardNames(el)).toEqual(['Overnight oats', 'Protein shake']);
    const first = el.querySelector('app-favorite-card')!;
    expect(first.textContent).toContain('431');
    expect(first.textContent).toContain('17.3');
    expect(first.textContent).toContain('Logged 3 times');
    expect(first.textContent).toContain('Breakfast');
  });

  it('logs one serving in one tap, then offers Undo and a link to the entry', async () => {
    const { fixture, el } = await render([oats, shake]);
    el.querySelector<HTMLButtonElement>('button[aria-label="Log Protein shake now"]')!.click();
    await settle(fixture);

    expect(api.logFavorite).toHaveBeenCalledTimes(1);
    const [id, body] = api.logFavorite.mock.calls[0];
    expect(id).toBe('f2');
    expect(body.servings).toBe(1);
    expect(body.localDate).toBe(todayLocalDate());
    expect(body.mealType).toBe(guessMealType(new Date(body.timestamp)));

    const toast = toasts().at(-1)!;
    expect(toast.message).toBe('Logged “Protein shake”');
    expect(toast.action?.label).toBe('Undo');
    const card = el.querySelectorAll('app-favorite-card')[1];
    expect(card.textContent).toContain('Logged to Today');
    expect(card.textContent).toContain('Logged 2 times');
    expect(card.querySelector('a')?.getAttribute('href')).toBe('/entries/entry-f2');

    TestBed.inject(ToastService).runAction(toast.id);
    await settle(fixture);
    expect(api.deleteEntry).toHaveBeenCalledWith('entry-f2');
    expect(card.textContent).not.toContain('Logged to Today');
    expect(toasts().at(-1)?.message).toBe('Removed “Protein shake” from your log');
  });

  it('uses the favorite meal type for one-tap logging when it has one', async () => {
    const { fixture, el } = await render([oats]);
    el.querySelector<HTMLButtonElement>('button[aria-label="Log Overnight oats now"]')!.click();
    await settle(fixture);
    expect(api.logFavorite.mock.calls[0][1].mealType).toBe('breakfast');
  });

  it('logs with custom servings, meal type and time from the Log… sheet', async () => {
    const { fixture, el } = await render([oats]);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Log Overnight oats with options"]',
    )!.click();
    await settle(fixture);

    const sheet = el.querySelector('app-log-favorite-sheet')!;
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(true);
    expect(buttonByText(sheet, 'Breakfast').getAttribute('aria-checked')).toBe('true');

    sheet.querySelector<HTMLButtonElement>('button[aria-label="1½ servings"]')!.click();
    buttonByText(sheet, 'Dinner').click();
    const when = sheet.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    when.value = '2026-09-27T19:30';
    when.dispatchEvent(new Event('input'));
    await settle(fixture);

    const submit = buttonByText(sheet, 'Log 1½ servings · 647 kcal');
    submit.click();
    await settle(fixture);

    expect(api.logFavorite).toHaveBeenCalledWith('f1', {
      timestamp: new Date(2026, 8, 27, 19, 30).toISOString(),
      localDate: '2026-09-27',
      mealType: 'dinner',
      servings: 1.5,
    });
    expect(sheet.querySelector('dialog')?.hasAttribute('open')).toBe(false);
    expect(toasts().at(-1)?.message).toContain('Logged “Overnight oats” ×1½');
  });

  it('steps servings within bounds', async () => {
    const { fixture, el } = await render([oats]);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Log Overnight oats with options"]',
    )!.click();
    await settle(fixture);
    const sheet = el.querySelector('app-log-favorite-sheet')!;
    const fewer = sheet.querySelector<HTMLButtonElement>('button[aria-label="Fewer servings"]')!;
    for (let i = 0; i < 5; i++) {
      fewer.click();
    }
    await settle(fixture);
    expect(fewer.disabled).toBe(true);
    expect(sheet.querySelector<HTMLInputElement>('input[aria-label="Servings"]')?.value).toBe(
      '0.25',
    );
  });

  it('caps servings in the Log… sheet when a bigger portion would exceed the item limits', async () => {
    const pot = favorite({
      id: 'f4',
      name: 'Soup pot',
      items: [{ name: 'Soup', grams: 2600, nutrients: { ...zeroNutrients(), calories: 1800 } }],
    });
    const { fixture, el } = await render([pot]);
    el.querySelector<HTMLButtonElement>('button[aria-label="Log Soup pot with options"]')!.click();
    await settle(fixture);

    const sheet = el.querySelector('app-log-favorite-sheet')!;
    const more = sheet.querySelector<HTMLButtonElement>('button[aria-label="More servings"]')!;
    for (let i = 0; i < 20; i++) {
      more.click();
    }
    await settle(fixture);

    expect(more.disabled).toBe(true);
    expect(sheet.querySelector<HTMLInputElement>('input[aria-label="Servings"]')?.value).toBe(
      '3.75',
    );
    expect(sheet.textContent).toContain('Up to 3¾ servings');
    buttonByText(sheet, 'Log 3¾ servings · 6,750 kcal').click();
    await settle(fixture);
    expect(api.logFavorite.mock.calls[0][1].servings).toBe(3.75);
  });

  describe('counted favorites', () => {
    const burgers = favorite({
      id: 'f5',
      name: 'Black Angus burgers',
      mealType: 'dinner',
      items: [
        {
          name: 'Black Angus burger',
          grams: 780,
          nutrients: { ...zeroNutrients(), calories: 1450, protein: 80 },
          count: 2,
          unit: 'burger',
          unitPlural: 'burgers',
        },
      ],
      totals: { ...zeroNutrients(), calories: 1450, protein: 80 },
      portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
    });

    it('shows the count on the card', async () => {
      const { el } = await render([burgers]);
      const card = el.querySelector('app-favorite-card')!;
      expect(card.querySelector('[data-favorite-amount]')?.textContent?.trim()).toBe(
        '2 burgers · 780 g',
      );
      expect(card.textContent).toContain('Logged 3 times');
    });

    it('picks how many units to log instead of servings', async () => {
      const { fixture, el } = await render([burgers]);
      el.querySelector<HTMLButtonElement>(
        'button[aria-label="Log Black Angus burgers with options"]',
      )!.click();
      await settle(fixture);
      const sheet = el.querySelector('app-log-favorite-sheet')!;
      expect(sheet.querySelector('legend')?.textContent).toContain('How many burgers?');
      const units = sheet.querySelector<HTMLInputElement>('input[aria-label="How many burgers"]')!;
      expect(units.value).toBe('2');
      expect(sheet.querySelector('input[aria-label="Servings"]')).toBeNull();

      sheet.querySelector<HTMLButtonElement>('button[aria-label="1½ burgers"]')!.click();
      await settle(fixture);
      expect(units.value).toBe('1.5');
      expect(sheet.querySelector('ul[aria-label="Items"]')?.textContent).toContain(
        '1½ burgers · 585 g',
      );
      sheet.querySelector<HTMLButtonElement>('button[aria-label="Fewer burgers"]')!.click();
      await settle(fixture);
      sheet.querySelector<HTMLButtonElement>('button[aria-label="More burgers"]')!.click();
      await settle(fixture);
      api.logFavorite.mockImplementationOnce(async (id, body) => ({
        ...loggedEntry(`entry-${id}`, body, 'Black Angus burgers'),
        portion: { count: 1.5, unit: 'burger', unitPlural: 'burgers' },
      }));
      buttonByText(sheet, 'Log 1½ burgers · 1,088 kcal').click();
      await settle(fixture);
      expect(api.logFavorite.mock.calls[0][1].servings).toBe(0.75);
      expect(toasts().at(-1)?.message).toContain('Logged “Black Angus burgers” · 1½ burgers');
      expect(toasts().at(-1)?.message).not.toContain('×');
    });

    it('edits the count of a favorite and rescales its items', async () => {
      const { fixture, el } = await render([burgers]);
      api.updateFavorite.mockImplementation(async (id, body) => ({ ...burgers, id, ...body }));
      el.querySelector<HTMLButtonElement>(
        'button[aria-label="More actions for Black Angus burgers"]',
      )!.click();
      await settle(fixture);
      buttonByText(el, 'Edit favorite').click();
      await settle(fixture);
      const editor = el.querySelector('app-favorite-editor-sheet')!;
      expect(editor.textContent).toContain('Portion');
      editor.querySelector<HTMLButtonElement>('button[aria-label="1 burger"]')!.click();
      await settle(fixture);
      buttonByText(editor, 'Save changes').click();
      await settle(fixture);
      const body = api.updateFavorite.mock.calls[0][1];
      expect(body.portion).toEqual({ count: 1, unit: 'burger', unitPlural: 'burgers' });
      expect(body.items[0]).toMatchObject({ grams: 390, count: 1 });
    });
  });

  it('sorts A–Z and filters by search text', async () => {
    const { fixture, el } = await render([oats, shake, apple]);
    expect(cardNames(el)).toEqual(['Overnight oats', 'Protein shake', 'Apple']);

    buttonByText(el, 'A–Z').click();
    await settle(fixture);
    expect(cardNames(el)).toEqual(['Apple', 'Overnight oats', 'Protein shake']);

    const search = el.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'milk shake';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(cardNames(el)).toEqual(['Protein shake']);

    search.value = 'pizza';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(el.textContent).toContain('No starred meals match “pizza”.');
    const searchAll = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Search all foods'),
    );
    expect(searchAll?.getAttribute('href')).toBe('/log?q=pizza');
    buttonByText(el, 'Clear search').click();
    await settle(fixture);
    expect(cardNames(el)).toHaveLength(3);
  });

  it('explains starring and points to the searchable food library when there are none', async () => {
    const { el } = await render([]);
    expect(el.textContent).toContain('No starred meals yet');
    expect(el.textContent).toContain('searchable from the Log screen');
    expect(el.textContent).toContain('no AI cost');
    const search = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Search your foods'),
    );
    expect(search?.getAttribute('href')).toBe('/log?search=1');
  });

  it('mentions the food library under the list', async () => {
    const { el } = await render([oats]);
    expect(el.textContent).toContain('Everything you have ever logged is searchable');
    const link = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Search your food library'),
    );
    expect(link?.getAttribute('href')).toBe('/log?search=1');
  });

  it('announces its own changes without reloading itself', async () => {
    const { fixture, el } = await render([oats, shake]);
    const events = TestBed.inject(DataEventsService);
    el.querySelector<HTMLButtonElement>('button[aria-label="Log Protein shake now"]')!.click();
    await settle(fixture);
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    expect(events.entries()).toBe(1);
    expect(events.favorites()).toBe(1);
    expect(api.listFavorites).toHaveBeenCalledTimes(1);

    TestBed.inject(ToastService).runAction(toasts().at(-1)!.id);
    await settle(fixture);
    expect(events.entries()).toBe(2);
  });

  it('quietly reloads when favorites change elsewhere', async () => {
    const { fixture, el } = await render([oats]);
    api.listFavorites.mockResolvedValueOnce([oats, shake]);
    TestBed.inject(DataEventsService).notify('favorites');
    await fixture.whenStable();
    expect(el.querySelector('[aria-label="Loading favorites"]')).toBeNull();
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    await settle(fixture);
    expect(api.listFavorites).toHaveBeenCalledTimes(2);
    expect(cardNames(el)).toEqual(['Overnight oats', 'Protein shake']);

    api.listFavorites.mockRejectedValueOnce(new Error('offline'));
    TestBed.inject(DataEventsService).notify('favorites');
    await fixture.whenStable();
    await sleep(DATA_REFRESH_DEBOUNCE_MS + 20);
    await settle(fixture);
    expect(cardNames(el)).toHaveLength(2);
    expect(el.textContent).not.toContain("Favorites didn't load");
  });

  it('edits a favorite from the actions menu', async () => {
    const { fixture, el } = await render([oats, shake]);
    api.updateFavorite.mockImplementation(async (id, body) => ({
      ...oats,
      id,
      name: body.name,
      mealType: body.mealType,
    }));
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Overnight oats"]',
    )!.click();
    await settle(fixture);
    buttonByText(el, 'Edit favorite').click();
    await settle(fixture);

    const editor = el.querySelector('app-favorite-editor-sheet')!;
    const name = editor.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Overnight oats"]',
    )!;
    expect(name.value).toBe('Overnight oats');
    expect(editor.querySelectorAll('input[data-item-name]')).toHaveLength(0);
    const rows = Array.from(editor.querySelectorAll('button[data-item-row]'));
    expect(rows.map((row) => row.textContent?.replace(/\s+/g, ' '))).toEqual([
      expect.stringContaining('Oats'),
      expect.stringContaining('Milk'),
    ]);

    name.value = 'Oats with milk';
    name.dispatchEvent(new Event('input'));
    const select = editor.querySelector<HTMLSelectElement>('select')!;
    select.value = '';
    select.dispatchEvent(new Event('change'));
    buttonByText(editor, 'Save changes').click();
    await settle(fixture);

    expect(api.updateFavorite).toHaveBeenCalledWith('f1', {
      name: 'Oats with milk',
      mealType: null,
      items: [
        expect.objectContaining({ name: 'Oats', grams: 80 }),
        expect.objectContaining({ name: 'Milk', grams: 200 }),
      ],
      portion: null,
    });
    expect(cardNames(el)).toEqual(['Oats with milk', 'Protein shake']);
    expect(editor.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('offers to rename past entries still named like the favorite before its rename', async () => {
    const { fixture, el } = await render([oats, shake]);
    api.updateFavorite.mockImplementation(async (id, body) => ({ ...oats, id, name: body.name }));
    api.renameFood.mockImplementation(async (body) => ({
      matchedEntries: 4,
      renamedEntries: body.dryRun ? 0 : 4,
      renamedItems: 0,
    }));
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Overnight oats"]',
    )!.click();
    await settle(fixture);
    buttonByText(el, 'Edit favorite').click();
    await settle(fixture);
    const editor = el.querySelector('app-favorite-editor-sheet')!;
    const name = editor.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Overnight oats"]',
    )!;
    name.value = 'Khoury overnight oats';
    name.dispatchEvent(new Event('input'));
    buttonByText(editor, 'Save changes').click();
    await settle(fixture);
    await settle(fixture);

    expect(api.renameFood).toHaveBeenNthCalledWith(1, {
      from: 'Overnight oats',
      to: 'Khoury overnight oats',
      dryRun: true,
    });
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Also rename past entries?' }),
    );
    expect(api.renameFood).toHaveBeenNthCalledWith(2, {
      from: 'Overnight oats',
      to: 'Khoury overnight oats',
    });
    expect(TestBed.inject(DataEventsService).entries()).toBe(1);
    expect(toasts().at(-1)?.message).toBe('Renamed 4 entries to “Khoury overnight oats”');
  });

  it('does not offer a rename when a favorite keeps its name or is new', async () => {
    const { fixture, el } = await render([oats]);
    api.updateFavorite.mockImplementation(async (id, body) => ({ ...oats, id, ...body }));
    api.createFavorite.mockImplementation(async (body) =>
      favorite({ id: 'f9', name: body.name, useCount: 0 }),
    );
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Overnight oats"]',
    )!.click();
    await settle(fixture);
    buttonByText(el, 'Edit favorite').click();
    await settle(fixture);
    const editor = el.querySelector('app-favorite-editor-sheet')!;
    const select = editor.querySelector<HTMLSelectElement>('select')!;
    select.value = 'lunch';
    select.dispatchEvent(new Event('change'));
    buttonByText(editor, 'Save changes').click();
    await settle(fixture);

    el.querySelector<HTMLButtonElement>('button[aria-label="New favorite"]')!.click();
    await settle(fixture);
    const name = editor.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Overnight oats"]',
    )!;
    name.value = 'Banana';
    name.dispatchEvent(new Event('input'));
    const itemName = editor.querySelector<HTMLInputElement>('input[data-item-name]')!;
    itemName.value = 'Banana';
    itemName.dispatchEvent(new Event('input'));
    await settle(fixture);
    buttonByText(editor, 'Create favorite').click();
    await settle(fixture);

    expect(api.updateFavorite).toHaveBeenCalledTimes(1);
    expect(api.createFavorite).toHaveBeenCalledTimes(1);
    expect(api.renameFood).not.toHaveBeenCalled();
  });

  it('saves large nutrient values typed into an expanded item of the editor', async () => {
    const { fixture, el } = await render([oats]);
    api.updateFavorite.mockImplementation(async (id, body) => ({ ...oats, id, ...body }));
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Overnight oats"]',
    )!.click();
    await settle(fixture);
    buttonByText(el, 'Edit favorite').click();
    await settle(fixture);
    const editor = el.querySelector('app-favorite-editor-sheet')!;
    editor.querySelector<HTMLButtonElement>('button[data-item-row]')!.click();
    await settle(fixture);
    const type = (label: string, value: string) => {
      const input = editor.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
      input.dispatchEvent(new FocusEvent('focus'));
      input.value = value;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new FocusEvent('blur'));
    };
    type('Calories (kcal) of Oats', '12345');
    type('Protein (g) of Oats', '1234.5');
    type('Carbs (g) of Oats', '1999.9');
    await settle(fixture);
    expect(
      editor.querySelector<HTMLInputElement>('input[aria-label="Protein (g) of Oats"]')?.value,
    ).toBe('1234.5');
    buttonByText(editor, 'Save changes').click();
    await settle(fixture);
    expect(api.updateFavorite).toHaveBeenCalledWith('f1', {
      name: 'Overnight oats',
      mealType: 'breakfast',
      items: [
        expect.objectContaining({
          name: 'Oats',
          nutrients: expect.objectContaining({ calories: 12345, protein: 1234.5, carbs: 1999.9 }),
        }),
        expect.objectContaining({ name: 'Milk' }),
      ],
      portion: null,
    });
    expect(editor.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  });

  it('creates a favorite manually and validates the draft first', async () => {
    const { fixture, el } = await render([oats]);
    api.createFavorite.mockImplementation(async (body) =>
      favorite({ id: 'f9', name: body.name, useCount: 0 }),
    );
    el.querySelector<HTMLButtonElement>('button[aria-label="New favorite"]')!.click();
    await settle(fixture);

    const editor = el.querySelector('app-favorite-editor-sheet')!;
    expect(editor.querySelectorAll('input[data-item-name]')).toHaveLength(1);
    buttonByText(editor, 'Create favorite').click();
    await settle(fixture);
    expect(editor.querySelector('[role="alert"]')?.textContent).toContain(
      'Give this favorite a name.',
    );
    expect(api.createFavorite).not.toHaveBeenCalled();

    const name = editor.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Overnight oats"]',
    )!;
    name.value = 'Banana';
    name.dispatchEvent(new Event('input'));
    const itemName = editor.querySelector<HTMLInputElement>('input[data-item-name]')!;
    itemName.value = 'Banana';
    itemName.dispatchEvent(new Event('input'));
    await settle(fixture);
    buttonByText(editor, 'Create favorite').click();
    await settle(fixture);

    expect(api.createFavorite).toHaveBeenCalledWith({
      name: 'Banana',
      mealType: null,
      items: [expect.objectContaining({ name: 'Banana', grams: 0 })],
      portion: null,
    });
    expect(cardNames(el)).toEqual(['Banana', 'Overnight oats']);
    expect(toasts().at(-1)?.message).toBe('Created “Banana”');
  });

  it('marks an unnamed item only after a save attempt fails', async () => {
    const { fixture, el } = await render([oats]);
    el.querySelector<HTMLButtonElement>('button[aria-label="New favorite"]')!.click();
    await settle(fixture);
    const editor = el.querySelector('app-favorite-editor-sheet')!;
    const itemName = (): HTMLInputElement =>
      editor.querySelector<HTMLInputElement>('input[data-item-name]')!;
    expect(itemName().getAttribute('aria-invalid')).toBeNull();

    const name = editor.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Overnight oats"]',
    )!;
    name.value = 'Banana';
    name.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(itemName().getAttribute('aria-invalid')).toBeNull();

    buttonByText(editor, 'Create favorite').click();
    await settle(fixture);

    expect(editor.querySelector('[role="alert"]')).not.toBeNull();
    expect(itemName().getAttribute('aria-invalid')).toBe('true');
    expect(api.createFavorite).not.toHaveBeenCalled();
  });

  it('deletes a favorite after confirmation', async () => {
    const { fixture, el } = await render([oats, shake]);
    vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(true);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Protein shake"]',
    )!.click();
    await settle(fixture);
    buttonByText(el, 'Delete favorite').click();
    await settle(fixture);

    expect(api.deleteFavorite).toHaveBeenCalledWith('f2');
    expect(cardNames(el)).toEqual(['Overnight oats']);
    expect(toasts().at(-1)?.message).toBe('Favorite deleted');
    expect(TestBed.inject(DataEventsService).favorites()).toBe(1);
  });

  it('closes a clean editor straight away but asks before discarding edits', async () => {
    const { fixture, el } = await render([oats]);
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm');
    const editor = el.querySelector('app-favorite-editor-sheet')!;
    const dialog = () => editor.querySelector('dialog')!;
    const openEditor = async () => {
      el.querySelector<HTMLButtonElement>(
        'button[aria-label="More actions for Overnight oats"]',
      )!.click();
      await settle(fixture);
      buttonByText(el, 'Edit favorite').click();
      await settle(fixture);
    };
    const close = async () => {
      editor.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(fixture);
    };

    await openEditor();
    await close();
    expect(confirm).not.toHaveBeenCalled();
    expect(dialog().hasAttribute('open')).toBe(false);

    await openEditor();
    const name = editor.querySelector<HTMLInputElement>(
      'input[placeholder="e.g. Overnight oats"]',
    )!;
    name.value = 'Oats v2';
    name.dispatchEvent(new Event('input'));
    await settle(fixture);
    confirm.mockResolvedValueOnce(false);
    await close();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Discard changes?', confirmLabel: 'Discard' }),
    );
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(name.value).toBe('Oats v2');

    name.value = 'Overnight oats ';
    name.dispatchEvent(new Event('input'));
    await settle(fixture);
    await close();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute('open')).toBe(false);

    await openEditor();
    editor.querySelector<HTMLButtonElement>('button[data-item-row]')!.click();
    await settle(fixture);
    editor.querySelector<HTMLButtonElement>('button[aria-label="Increase grams of Oats"]')!.click();
    await settle(fixture);
    confirm.mockResolvedValueOnce(true);
    await close();
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(api.updateFavorite).not.toHaveBeenCalled();
  });

  it('asks before discarding the servings, meal or time picked in the Log… sheet', async () => {
    const { fixture, el } = await render([oats]);
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);
    const sheet = el.querySelector('app-log-favorite-sheet')!;
    const dialog = () => sheet.querySelector('dialog')!;
    const openSheet = async () => {
      el.querySelector<HTMLButtonElement>(
        'button[aria-label="Log Overnight oats with options"]',
      )!.click();
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
    sheet.querySelector<HTMLButtonElement>('button[aria-label="2 servings"]')!.click();
    await settle(fixture);
    await close();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute('open')).toBe(true);

    confirm.mockResolvedValueOnce(true);
    await close();
    expect(dialog().hasAttribute('open')).toBe(false);

    await openSheet();
    expect(sheet.querySelector<HTMLInputElement>('input[aria-label="Servings"]')?.value).toBe('1');
    buttonByText(sheet, 'Snack').click();
    await settle(fixture);
    await close();
    expect(confirm).toHaveBeenCalledTimes(3);
    buttonByText(sheet, 'Log 1 serving · 431 kcal').click();
    await settle(fixture);
    expect(api.logFavorite.mock.calls.at(-1)?.[1].mealType).toBe('snack');
    expect(dialog().hasAttribute('open')).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(3);
  });
});
