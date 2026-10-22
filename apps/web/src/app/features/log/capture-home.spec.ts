import { HttpErrorResponse } from '@angular/common/http';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type CatalogFoodDto,
  type CatalogSearchQuery,
  type CatalogSearchResponse,
  type CreateEntryRequest,
  type EntryDto,
  type FoodSearchQuery,
  type FoodSearchResponse,
  type FoodSearchResult,
  type QuickLogRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { CaptureService } from '../../core/capture.service';
import { DataEventsService } from '../../core/data-events.service';
import { KEYBOARD_PRIMER_ATTRIBUTE } from '../../core/keyboard-primer';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { CaptureHome } from './capture-home';
import { CATALOG_DEBOUNCE_MS } from './catalog-suggestions.store';
import { FoodSearchStore, SEARCH_DEBOUNCE_MS } from './food-search.store';
import { LibraryActions } from './library-actions';
import type { LibraryDraft } from './log.store';
import { installDialogShim } from './testing/dialog-shim';

function food(overrides: Partial<FoodSearchResult>): FoodSearchResult {
  return {
    portion: null,
    key: 'meal:entry-1',
    kind: 'meal',
    name: 'Chicken shawarma plate',
    detail: null,
    items: [{ name: 'Chicken', grams: 330, nutrients: { ...zeroNutrients(), calories: 920 } }],
    totals: { ...zeroNutrients(), calories: 920, protein: 49, carbs: 53, fat: 55 },
    grams: 330,
    mealType: 'lunch',
    photo: null,
    favoriteId: null,
    entryId: 'entry-1',
    useCount: 5,
    lastUsedAt: null,
    productId: null,
    starred: false,
    ...overrides,
  };
}

const OATS = food({
  key: 'favorite:fav-1',
  kind: 'favorite',
  name: 'Overnight oats',
  favoriteId: 'fav-1',
  entryId: null,
  productId: null,
  starred: true,
  useCount: 12,
});
const PLATE = food({});
const YOGURT = food({
  key: 'food:item-1',
  kind: 'food',
  name: 'Khoury strawberry yogurt',
  detail: 'Breakfast bowl',
  items: [
    {
      name: 'Khoury strawberry yogurt',
      grams: 170,
      nutrients: { ...zeroNutrients(), calories: 150 },
    },
  ],
  totals: { ...zeroNutrients(), calories: 150 },
  grams: 170,
  entryId: 'entry-3',
});

const CHOCO = food({
  key: 'product:p1',
  kind: 'product',
  name: 'QA Choco Bar',
  detail: 'QA',
  items: [{ name: 'QA Choco Bar', grams: 45, nutrients: { ...zeroNutrients(), calories: 230 } }],
  totals: { ...zeroNutrients(), calories: 230 },
  grams: 45,
  entryId: null,
  productId: 'p1',
  useCount: 1,
});

const HUMMUS: CatalogFoodDto = {
  id: 2705367,
  name: 'Hummus, plain',
  category: 'Dips, gravies, other sauces',
  group: 'sauces_soups',
  source: 'survey',
  per100: {
    calories: 243,
    protein: 7.35,
    carbs: 14.9,
    fat: 17.1,
    satFat: 2.22,
    fiber: 5.4,
    sugar: 0.34,
    sodium: 438,
    alcohol: 0,
  },
  missing: [],
  microsPer100: { calcium: 38, iron: 2.4 },
  portions: [
    { label: '1 serving', grams: 60 },
    { label: '1 tablespoon', grams: 15 },
  ],
};

const SEARCH_SETTLE_MS = Math.max(SEARCH_DEBOUNCE_MS, CATALOG_DEBOUNCE_MS) + 30;

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  )!;

const settle = async (fixture: ComponentFixture<unknown>, ms = 0): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await fixture.whenStable();
};

describe('CaptureHome', () => {
  const searchFoods = vi.fn<(query: FoodSearchQuery) => Promise<FoodSearchResponse>>();
  const searchCatalog = vi.fn<(query: CatalogSearchQuery) => Promise<CatalogSearchResponse>>();
  const api = {
    searchFoods,
    searchCatalog,
    createEntry: vi.fn<(body: CreateEntryRequest) => Promise<EntryDto>>(),
    quickLog: vi.fn<(body: QuickLogRequest) => Promise<EntryDto>>(),
    deleteEntry: vi.fn(),
    createFavorite: vi.fn(),
    createFavoriteFromEntry: vi.fn(),
    deleteFavorite: vi.fn(),
    renameFood: vi.fn(),
    hideFood: vi.fn(),
    unhideFood: vi.fn(),
    deleteProduct: vi.fn(),
    listProducts: vi.fn(),
    listDrafts: vi.fn(),
  };
  const confirm = { confirm: vi.fn<() => Promise<boolean>>() };
  let restoreDialog: () => void;
  let navigate: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    Object.values(api).forEach((mock) => mock.mockReset());
    searchFoods.mockImplementation(async (query) => {
      if (!query.q) {
        return { query: '', results: [OATS, PLATE, YOGURT] };
      }
      const q = query.q.toLowerCase();
      return {
        query: query.q,
        results: [OATS, PLATE, YOGURT].filter((r) => r.name.toLowerCase().includes(q)),
      };
    });
    api.quickLog.mockImplementation(async (body) => ({
      portion: null,
      id: 'entry-new',
      name: 'Khoury strawberry yogurt',
      description: null,
      mealType: body.mealType,
      source: 'copy',
      timestamp: body.timestamp,
      localDate: body.localDate,
      items: [],
      totals: { ...zeroNutrients(), calories: 150 },
      photo: null,
      photos: [],
      analysisId: null,
      favoriteId: null,
      productId: null,
      createdAt: body.timestamp,
      updatedAt: body.timestamp,
    }));
    searchCatalog.mockImplementation(async (query) => ({
      query: query.q ?? '',
      group: null,
      total: 0,
      results: [],
    }));
    api.createEntry.mockImplementation(async (body) => ({
      portion: body.portion ?? null,
      id: 'entry-db',
      name: body.name,
      description: null,
      mealType: body.mealType,
      source: body.source,
      timestamp: body.timestamp,
      localDate: body.localDate,
      items: [],
      totals: { ...zeroNutrients(), calories: body.items[0]?.nutrients.calories ?? 0 },
      photo: null,
      photos: [],
      analysisId: null,
      favoriteId: null,
      productId: null,
      createdAt: body.timestamp,
      updatedAt: body.timestamp,
    }));
    api.renameFood.mockResolvedValue({ matchedEntries: 5, renamedEntries: 5, renamedItems: 3 });
    api.hideFood.mockResolvedValue({ names: [] });
    api.unhideFood.mockResolvedValue({ names: [] });
    api.deleteProduct.mockResolvedValue(undefined);
    api.listProducts.mockResolvedValue([]);
    api.listDrafts.mockResolvedValue([]);
    confirm.confirm.mockReset();
    confirm.confirm.mockResolvedValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        FoodSearchStore,
        LibraryActions,
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: confirm },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function render(): Promise<{ fixture: ComponentFixture<CaptureHome>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(CaptureHome);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function type(el: HTMLElement, text: string): HTMLInputElement {
    const input = el.querySelector<HTMLInputElement>('#food-search')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    return input;
  }

  const rowNames = (el: HTMLElement, section: string): string[] =>
    Array.from(
      el.querySelectorAll(`section[aria-labelledby="${section}"] button[data-result-key]`),
    ).map((button) => button.getAttribute('aria-label')!.split(',')[0]!);

  it('leads with search and quick capture actions, then starred and frequent foods', async () => {
    const { el } = await render();
    const input = el.querySelector<HTMLInputElement>('#food-search')!;
    expect(input.placeholder).toBe("Search foods you've eaten…");
    expect(input.type).toBe('search');
    for (const label of ['Take photo', 'Scan label', 'Describe', 'Manual']) {
      expect(buttonWith(el, label)).toBeDefined();
    }
    expect(searchFoods).toHaveBeenCalledWith({ limit: 20 });
    expect(rowNames(el, 'starred-title')).toEqual(['Overnight oats']);
    expect(rowNames(el, 'recent-title')).toEqual([
      'Chicken shawarma plate',
      'Khoury strawberry yogurt',
    ]);
    expect(el.textContent).toContain('Logged 12×');
    expect(el.textContent).toContain('from Breakfast bowl');
    expect(el.textContent).toContain('920');
  });

  it('shows a skeleton while the library loads and a retry on failure', async () => {
    searchFoods.mockRejectedValueOnce(new HttpErrorResponse({ status: 500 }));
    const fixture = TestBed.createComponent(CaptureHome);
    const el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    expect(el.querySelector('app-skeleton')).not.toBeNull();
    await settle(fixture);
    expect(el.textContent).toContain("Couldn't load your foods.");
    buttonWith(el, 'Retry').click();
    await settle(fixture);
    expect(rowNames(el, 'starred-title')).toEqual(['Overnight oats']);
  });

  it('explains the food library when nothing was logged yet', async () => {
    searchFoods.mockResolvedValueOnce({ query: '', results: [] });
    const { el } = await render();
    expect(el.textContent).toContain('Your food library builds itself');
  });

  it('searches as you type and emphasises the matching part', async () => {
    const { fixture, el } = await render();
    searchFoods.mockClear();
    type(el, 'k');
    type(el, 'kho');
    await settle(fixture, SEARCH_DEBOUNCE_MS + 30);
    expect(searchFoods).toHaveBeenCalledTimes(1);
    expect(searchFoods).toHaveBeenCalledWith({ q: 'kho' });
    const results = el.querySelectorAll('#food-results button[data-result-key]');
    expect(results).toHaveLength(1);
    expect(el.querySelector('#food-results mark')?.textContent).toBe('Kho');
    expect(el.textContent).toContain('1 food found');
    expect(buttonWith(el, 'Take photo')).toBeUndefined();
    expect(buttonWith(el, 'Ask AI about “kho”')).toBeDefined();
  });

  it('opens the first result when Enter is pressed', async () => {
    const { fixture, el } = await render();
    const input = type(el, 'yogurt');
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    const dialog = el.querySelector('app-quick-log-sheet dialog')!;
    expect(dialog.hasAttribute('open')).toBe(true);
    expect(dialog.textContent).toContain('Khoury strawberry yogurt');
  });

  it('offers AI, label scan and photo when nothing matches', async () => {
    const { fixture, el } = await render();
    const describe = vi.fn();
    fixture.componentInstance.describe.subscribe(describe);
    const camera = vi.spyOn(TestBed.inject(CaptureService), 'requestCamera');
    type(el, 'pizza margherita');
    await settle(fixture, SEARCH_SETTLE_MS);
    expect(el.textContent).toContain('No matches for “pizza margherita”');

    buttonWith(el, 'Ask AI about “pizza margherita”').click();
    expect(describe).toHaveBeenCalledWith('pizza margherita');
    buttonWith(el, 'Scan the label').click();
    expect(camera).toHaveBeenLastCalledWith('nutrition_label', 'pizza margherita');
    buttonWith(el, 'Take a photo').click();
    expect(camera).toHaveBeenLastCalledWith('food_photo', 'pizza margherita');
  });

  it('links to the food database while browsing', async () => {
    const { el } = await render();
    const link = el.querySelector<HTMLAnchorElement>('a[data-testid="food-database-link"]');
    expect(link?.getAttribute('href')).toBe('/foods');
  });

  it('lists database foods under your own and logs one with its USDA values', async () => {
    searchCatalog.mockResolvedValue({ query: 'hummus', group: null, total: 9, results: [HUMMUS] });
    const { fixture, el } = await render();
    type(el, 'hummus');
    await settle(fixture, SEARCH_SETTLE_MS);

    expect(searchCatalog).toHaveBeenCalledWith({ q: 'hummus', limit: 6 });
    expect(el.textContent).not.toContain('No matches for');
    const section = el.querySelector('section[aria-labelledby="catalog-title"]')!;
    expect(section.textContent).toContain('Food database');
    expect(section.textContent).toContain('See all 9');
    const row = section.querySelector<HTMLButtonElement>('button[data-catalog-id="2705367"]')!;
    expect(row.getAttribute('aria-label')).toBe('Hummus, plain, 146 kcal per 1 serving. Open to log');

    row.click();
    await settle(fixture);
    buttonWith(el, '1 tablespoon').click();
    await settle(fixture);
    buttonWith(el, 'Log 1 tablespoon (15 g)').click();
    await settle(fixture);

    expect(api.createEntry).toHaveBeenCalledTimes(1);
    const body = api.createEntry.mock.calls[0]![0];
    expect(body).toMatchObject({
      name: 'Hummus, plain',
      source: 'database',
      portion: { count: 1, unit: 'tablespoon', unitPlural: 'tablespoons' },
    });
    expect(body.items).toEqual([
      {
        name: 'Hummus, plain',
        grams: 15,
        nutrients: {
          calories: 36,
          protein: 1.1,
          carbs: 2.2,
          fat: 2.6,
          satFat: 0.3,
          fiber: 0.8,
          sugar: 0.1,
          sodium: 66,
          alcohol: 0,
        },
        confidence: 'high',
        count: 1,
        unit: 'tablespoon',
        unitPlural: 'tablespoons',
        productId: null,
        micros: { calcium: 6, iron: 0.4 },
        fluidMl: null,
      },
    ]);
    expect(el.textContent).toContain('Logged Hummus, plain');
  });

  it('opens the first database food on Enter when nothing of your own matches', async () => {
    searchCatalog.mockResolvedValue({ query: 'hummus', group: null, total: 1, results: [HUMMUS] });
    const { fixture, el } = await render();
    const describe = vi.fn();
    fixture.componentInstance.describe.subscribe(describe);
    const input = type(el, 'hummus');
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture, SEARCH_SETTLE_MS);
    expect(describe).not.toHaveBeenCalled();
    expect(searchCatalog).toHaveBeenCalledWith({ q: 'hummus', limit: 6 });
    expect(buttonWith(el, 'Log 1 serving (60 g)')).toBeDefined();
  });

  it('keeps the keyboard up while switching to describing a meal', async () => {
    const { fixture, el } = await render();
    const describe = vi.fn();
    fixture.componentInstance.describe.subscribe(describe);

    buttonWith(el, 'Describe').click();

    expect(describe).toHaveBeenCalledWith('');
    expect(document.activeElement?.hasAttribute(KEYBOARD_PRIMER_ATTRIBUTE)).toBe(true);
  });

  it('asks the AI when Enter is pressed without any match', async () => {
    const { fixture, el } = await render();
    const describe = vi.fn();
    fixture.componentInstance.describe.subscribe(describe);
    const input = type(el, 'pizza');
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(describe).toHaveBeenCalledWith('pizza');
  });

  it('does not send a failed search to the AI when Enter is pressed', async () => {
    const { fixture, el } = await render();
    const describe = vi.fn();
    fixture.componentInstance.describe.subscribe(describe);
    searchFoods.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    const input = type(el, 'pizza');
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture);
    expect(describe).not.toHaveBeenCalled();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('offline');
  });

  it('gives the whole result area a single id for the search field to control', async () => {
    const { el } = await render();
    expect(el.querySelectorAll('#food-results')).toHaveLength(1);
    expect(el.querySelectorAll('#food-results button[data-result-key]')).toHaveLength(3);
  });

  it('logs in one tap with sensible defaults and shows what was logged', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Log Khoury strawberry yogurt now, 150 kcal"]',
    )!.click();
    await settle(fixture);
    expect(api.quickLog).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'food:item-1',
        grams: 170,
        mealType: expect.stringMatching(/breakfast|lunch|dinner|snack/),
      }),
    );
    expect(TestBed.inject(DataEventsService).entries()).toBe(1);
    const status = el.querySelector('app-sticky-actions [role="status"]')!;
    expect(status.textContent).toContain('Logged Khoury strawberry yogurt');
    expect(status.textContent).toContain('150 kcal');
    const quick = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Log Khoury strawberry yogurt now, 150 kcal"]',
    )!;
    expect(quick.className).toContain('text-ok');

    buttonWith(el, 'View today').click();
    expect(navigate).toHaveBeenCalledWith('/today');
  });

  it('logs a meal of one food in one tap by its last weight', async () => {
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Log Chicken shawarma plate now, 920 kcal"]',
    )!.click();
    await settle(fixture);
    const body = api.quickLog.mock.calls[0]![0];
    expect(body).toMatchObject({ key: 'meal:entry-1', grams: 330 });
    expect(body.servings).toBeUndefined();
  });

  it('keeps the logged mark when the refreshed library points at the new entry', async () => {
    const { fixture, el } = await render();
    searchFoods.mockImplementation(async () => ({
      query: '',
      results: [OATS, PLATE, { ...YOGURT, key: 'food:item-99', entryId: 'entry-new' }],
    }));
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Log Khoury strawberry yogurt now, 150 kcal"]',
    )!.click();
    await settle(fixture);
    await settle(fixture);
    expect(el.querySelector('button[data-result-key="food:item-99"]')).not.toBeNull();
    const quick = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Log Khoury strawberry yogurt now, 150 kcal"]',
    )!;
    expect(quick.className).toContain('text-ok');
    const plate = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Log Chicken shawarma plate now, 920 kcal"]',
    )!;
    expect(plate.className).not.toContain('text-ok');
  });

  it('clears the search and focuses it on request', async () => {
    const { fixture, el } = await render();
    const focused = vi.fn();
    fixture.componentInstance.searchFocused.subscribe(focused);
    type(el, 'oats');
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();
    await settle(fixture);
    const input = el.querySelector<HTMLInputElement>('#food-search')!;
    expect(input.value).toBe('');
    expect(document.activeElement).toBe(input);

    input.blur();
    fixture.componentRef.setInput('focusSearch', true);
    await settle(fixture);
    expect(document.activeElement).toBe(input);
    expect(focused).toHaveBeenCalledTimes(1);
  });

  it('passes "edit before saving" drafts up to the page', async () => {
    const { fixture, el } = await render();
    const edits: LibraryDraft[] = [];
    fixture.componentInstance.edit.subscribe((draft) => edits.push(draft));
    el.querySelector<HTMLButtonElement>('button[data-result-key="meal:entry-1"]')!.click();
    await settle(fixture);
    buttonWith(el, 'Edit before saving').click();
    await settle(fixture);
    expect(edits[0]?.name).toBe('Chicken shawarma plate');
    expect(edits[0]?.items[0]?.grams).toBe(330);
  });

  describe('library actions', () => {
    const moreButton = (el: HTMLElement, name: string): HTMLButtonElement | null =>
      el.querySelector<HTMLButtonElement>(`button[aria-label="More actions for ${name}"]`);
    const actionsDialog = (el: HTMLElement): HTMLDialogElement =>
      el.querySelector<HTMLDialogElement>('app-food-actions-sheet dialog')!;
    const quickLogDialog = (el: HTMLElement): HTMLDialogElement =>
      el.querySelector<HTMLDialogElement>('app-quick-log-sheet dialog')!;

    it('offers a more button for meals and foods but not for starred foods', async () => {
      const { el } = await render();
      expect(moreButton(el, 'Chicken shawarma plate')).not.toBeNull();
      expect(moreButton(el, 'Khoury strawberry yogurt')).not.toBeNull();
      expect(moreButton(el, 'Overnight oats')).toBeNull();
      expect(el.querySelectorAll('#food-results button[data-result-key]')).toHaveLength(3);
    });

    it('offers the actions for a scanned product, with editing and deleting instead of hiding', async () => {
      searchFoods.mockImplementation(async () => ({ query: '', results: [OATS, CHOCO] }));
      const { fixture, el } = await render();
      const row = el.querySelector<HTMLButtonElement>('button[data-result-key="product:p1"]')!;
      expect(row.getAttribute('aria-describedby')).toBeTruthy();
      moreButton(el, 'QA Choco Bar')!.click();
      await settle(fixture);
      const dialog = actionsDialog(el);
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(buttonWith(dialog, 'Edit product…')).toBeDefined();
      expect(buttonWith(dialog, 'Delete product')).toBeDefined();
      expect(buttonWith(dialog, 'Adjust amount')).toBeDefined();
      expect(buttonWith(dialog, 'Remove from suggestions')).toBeUndefined();
      expect(buttonWith(dialog, 'Rename…')).toBeUndefined();
    });

    it('deletes a scanned product after confirming, keeping its logs out of suggestions', async () => {
      searchFoods.mockImplementation(async () => ({ query: '', results: [OATS, CHOCO] }));
      const { fixture, el } = await render();
      moreButton(el, 'QA Choco Bar')!.click();
      await settle(fixture);
      buttonWith(actionsDialog(el), 'Delete product').click();
      await settle(fixture);
      await settle(fixture);

      expect(confirm.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Delete “QA Choco Bar” from your products?' }),
      );
      expect(api.deleteProduct).toHaveBeenCalledWith('p1');
      expect(api.hideFood).toHaveBeenCalledWith({ name: 'QA Choco Bar' });
      expect(TestBed.inject(DataEventsService).products()).toBe(1);
      expect(actionsDialog(el).hasAttribute('open')).toBe(false);
    });

    async function editChoco(): Promise<{
      fixture: ComponentFixture<CaptureHome>;
      el: HTMLElement;
    }> {
      searchFoods.mockImplementation(async () => ({ query: '', results: [OATS, CHOCO] }));
      const rendered = await render();
      moreButton(rendered.el, 'QA Choco Bar')!.click();
      await settle(rendered.fixture);
      buttonWith(actionsDialog(rendered.el), 'Edit product…').click();
      await settle(rendered.fixture);
      await settle(rendered.fixture);
      return rendered;
    }

    const productDialog = (el: HTMLElement): HTMLDialogElement =>
      el.querySelector<HTMLDialogElement>('app-product-edit-sheet dialog')!;

    it('opens the product editor for a scanned product', async () => {
      api.listProducts.mockResolvedValue([
        {
          id: 'p1',
          barcode: '5281234567896',
          name: 'Choco Bar',
          brand: 'QA',
          basisUnit: 'g',
          per100: { ...zeroNutrients(), calories: 511 },
          servingSizeG: 45,
          packSizeG: 45,
          source: 'openfoodfacts',
          imageUrl: null,
          missingNutrients: [],
          useCount: 1,
          lastUsedAt: null,
        },
      ]);
      const { el } = await editChoco();

      expect(actionsDialog(el).hasAttribute('open')).toBe(false);
      expect(api.listProducts).toHaveBeenCalled();
      expect(productDialog(el).hasAttribute('open')).toBe(true);
      expect(productDialog(el).querySelector('app-product-editor')).not.toBeNull();
    });

    it('explains and refreshes when the product to edit is already gone', async () => {
      const { el } = await editChoco();
      expect(productDialog(el).hasAttribute('open')).toBe(false);
      expect(TestBed.inject(ToastService).toasts()[0]?.message).toBe(
        '“QA Choco Bar” is no longer in your library.',
      );
    });

    it('opens the actions from the more button, with renaming only for meals', async () => {
      const { fixture, el } = await render();
      moreButton(el, 'Chicken shawarma plate')!.click();
      await settle(fixture);
      const dialog = actionsDialog(el);
      expect(dialog.hasAttribute('open')).toBe(true);
      expect(dialog.textContent).toContain('Chicken shawarma plate');
      for (const label of ['Rename…', 'Remove from suggestions', 'Adjust amount']) {
        expect(buttonWith(dialog, label)).toBeDefined();
      }
      expect(quickLogDialog(el).hasAttribute('open')).toBe(false);

      dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
      await settle(fixture);
      moreButton(el, 'Khoury strawberry yogurt')!.click();
      await settle(fixture);
      expect(buttonWith(actionsDialog(el), 'Rename…')).toBeUndefined();
      expect(buttonWith(actionsDialog(el), 'Remove from suggestions')).toBeDefined();
    });

    it('opens the actions with a long press instead of the log sheet', async () => {
      const { fixture, el } = await render();
      const row = el.querySelector<HTMLButtonElement>('button[data-result-key="meal:entry-1"]')!;
      expect(row.getAttribute('aria-describedby')).toBeTruthy();
      row.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }),
      );
      await settle(fixture, 500);
      row.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      row.click();
      await settle(fixture);
      expect(actionsDialog(el).hasAttribute('open')).toBe(true);
      expect(quickLogDialog(el).hasAttribute('open')).toBe(false);
    });

    it('keeps the tap and long press of starred foods as they were', async () => {
      const { fixture, el } = await render();
      const row = el.querySelector<HTMLButtonElement>('button[data-result-key="favorite:fav-1"]')!;
      const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      row.dispatchEvent(menu);
      await settle(fixture);
      expect(menu.defaultPrevented).toBe(false);
      expect(actionsDialog(el).hasAttribute('open')).toBe(false);
      row.click();
      await settle(fixture);
      expect(quickLogDialog(el).hasAttribute('open')).toBe(true);
    });

    it('renames a meal everywhere and refreshes the results', async () => {
      const { fixture, el } = await render();
      moreButton(el, 'Chicken shawarma plate')!.click();
      await settle(fixture);
      buttonWith(actionsDialog(el), 'Rename…').click();
      await settle(fixture);
      const dialog = actionsDialog(el);
      const input = dialog.querySelector<HTMLInputElement>('input[type="text"]')!;
      expect(input.value).toBe('Chicken shawarma plate');
      expect(document.activeElement).toBe(input);
      expect(dialog.textContent).toContain('all 5 entries called “Chicken shawarma plate”');
      const save = buttonWith(dialog, 'Save name');
      expect(save.disabled).toBe(true);

      searchFoods.mockClear();
      input.value = 'Shawarma plate';
      input.dispatchEvent(new Event('input'));
      await settle(fixture);
      expect(save.disabled).toBe(false);
      input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
      await settle(fixture);
      await settle(fixture);

      expect(api.renameFood).toHaveBeenCalledWith({
        from: 'Chicken shawarma plate',
        to: 'Shawarma plate',
      });
      expect(TestBed.inject(DataEventsService).entries()).toBe(1);
      expect(searchFoods).toHaveBeenCalled();
      expect(actionsDialog(el).hasAttribute('open')).toBe(false);
      expect(TestBed.inject(ToastService).toasts()[0]?.message).toBe(
        'Renamed 5 entries to “Shawarma plate”',
      );
    });

    it('goes back from renaming to the actions', async () => {
      const { fixture, el } = await render();
      moreButton(el, 'Chicken shawarma plate')!.click();
      await settle(fixture);
      buttonWith(actionsDialog(el), 'Rename…').click();
      await settle(fixture);
      el.querySelector<HTMLButtonElement>('button[aria-label="Back to actions"]')!.click();
      await settle(fixture);
      expect(buttonWith(actionsDialog(el), 'Adjust amount')).toBeDefined();
    });

    it('removes a food from suggestions with an undo', async () => {
      const { fixture, el } = await render();
      searchFoods.mockImplementation(async () => ({ query: '', results: [OATS, PLATE] }));
      moreButton(el, 'Khoury strawberry yogurt')!.click();
      await settle(fixture);
      buttonWith(actionsDialog(el), 'Remove from suggestions').click();
      await settle(fixture);
      expect(el.querySelector('button[data-result-key="food:item-1"]')).toBeNull();
      expect(api.hideFood).toHaveBeenCalledWith({ name: 'Khoury strawberry yogurt' });
      await settle(fixture);
      expect(rowNames(el, 'recent-title')).toEqual(['Chicken shawarma plate']);

      const toast = TestBed.inject(ToastService);
      const shown = toast.toasts().find((item) => item.action?.label === 'Undo')!;
      expect(shown.message).toContain('Removed “Khoury strawberry yogurt” from suggestions');
      searchFoods.mockImplementation(async () => ({ query: '', results: [OATS, PLATE, YOGURT] }));
      toast.runAction(shown.id);
      await settle(fixture);
      await settle(fixture);
      expect(api.unhideFood).toHaveBeenCalledWith('Khoury strawberry yogurt');
      expect(rowNames(el, 'recent-title')).toEqual([
        'Chicken shawarma plate',
        'Khoury strawberry yogurt',
      ]);
    });

    it('adjusts the amount in the log sheet', async () => {
      const { fixture, el } = await render();
      moreButton(el, 'Khoury strawberry yogurt')!.click();
      await settle(fixture);
      buttonWith(actionsDialog(el), 'Adjust amount').click();
      await settle(fixture);
      expect(actionsDialog(el).hasAttribute('open')).toBe(false);
      const sheet = quickLogDialog(el);
      expect(sheet.hasAttribute('open')).toBe(true);
      expect(sheet.textContent).toContain('Khoury strawberry yogurt');
      expect(
        el.querySelector<HTMLInputElement>('app-quick-log-sheet input[aria-label="Grams"]')?.value,
      ).toBe('170');
    });
  });
});
