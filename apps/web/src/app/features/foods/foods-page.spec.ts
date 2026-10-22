import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import type {
  CatalogInfoResponse,
  CatalogSearchQuery,
  CatalogSearchResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { FALAFEL_FOOD, HUMMUS_FOOD, OLIVE_OIL_FOOD } from '../../shared/testing/catalog-fixtures';
import { installDialogShim } from '../../shared/testing/dialog-shim';
import { FOODS_DEBOUNCE_MS, FOODS_PAGE_SIZE, FoodsPage } from './foods-page';

const INFO: CatalogInfoResponse = {
  version: 'usda-fdc-2026-04-30.1',
  foodCount: 13331,
  loadedAt: '2026-10-22T14:43:54.000Z',
  groups: [
    { group: 'dishes', count: 1391 },
    { group: 'legumes_nuts', count: 629 },
  ],
  source: 'USDA FoodData Central',
  license: 'Public domain (CC0 1.0)',
};

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  )!;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('FoodsPage', () => {
  const searchCatalog = vi.fn<(query: CatalogSearchQuery) => Promise<CatalogSearchResponse>>();
  const catalogInfo = vi.fn<() => Promise<CatalogInfoResponse>>();
  let restoreDialog: () => void;
  let navigate: ReturnType<typeof vi.spyOn>;

  function configure(params: Record<string, string> = {}): void {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: { searchCatalog, catalogInfo, createEntry: vi.fn() } },
        { provide: ConfirmService, useValue: { confirm: vi.fn() } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(params) } },
        },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  }

  beforeEach(() => {
    restoreDialog = installDialogShim();
    searchCatalog.mockReset();
    catalogInfo.mockReset();
    catalogInfo.mockResolvedValue(INFO);
    searchCatalog.mockImplementation(async (query) => ({
      query: query.q ?? '',
      group: query.group ?? null,
      total: 3,
      results: [HUMMUS_FOOD, FALAFEL_FOOD, OLIVE_OIL_FOOD],
    }));
  });

  afterEach(() => restoreDialog());

  async function render() {
    const fixture = TestBed.createComponent(FoodsPage);
    await fixture.whenStable();
    await wait(0);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('lists the database A–Z with its size and groups', async () => {
    configure();
    const { el } = await render();
    expect(el.textContent).toContain('13,331 foods from USDA FoodData Central');
    expect(searchCatalog).toHaveBeenCalledWith({ limit: FOODS_PAGE_SIZE });
    expect(el.textContent).toContain('3 foods, A–Z');
    expect(buttonWith(el, 'Dishes & sandwiches')).toBeDefined();
    expect(buttonWith(el, 'Beans, nuts & seeds')).toBeDefined();
    expect(el.querySelectorAll('button[data-catalog-id]')).toHaveLength(3);
  });

  it('starts from the search and group in the address', async () => {
    configure({ q: 'hummus', group: 'dishes' });
    const { el } = await render();
    expect(searchCatalog).toHaveBeenCalledWith({ q: 'hummus', group: 'dishes', limit: FOODS_PAGE_SIZE });
    expect(el.querySelector<HTMLInputElement>('#catalog-search')!.value).toBe('hummus');
    expect(el.textContent).toContain('3 foods match “hummus” in Dishes & sandwiches');
  });

  it('searches as you type, filters by group and keeps both in the address', async () => {
    configure();
    const { fixture, el } = await render();
    const input = el.querySelector<HTMLInputElement>('#catalog-search')!;
    input.value = 'falafel';
    input.dispatchEvent(new Event('input'));
    await wait(FOODS_DEBOUNCE_MS + 20);
    await fixture.whenStable();
    expect(searchCatalog).toHaveBeenLastCalledWith({ q: 'falafel', limit: FOODS_PAGE_SIZE });

    buttonWith(el, 'Beans, nuts & seeds').click();
    await fixture.whenStable();
    expect(searchCatalog).toHaveBeenLastCalledWith({
      q: 'falafel',
      group: 'legumes_nuts',
      limit: FOODS_PAGE_SIZE,
    });
    expect(navigate).toHaveBeenLastCalledWith(
      [],
      expect.objectContaining({ queryParams: { q: 'falafel', group: 'legumes_nuts' }, replaceUrl: true }),
    );
  });

  it('loads more results in pages', async () => {
    configure();
    searchCatalog.mockImplementation(async (query) => ({
      query: '',
      group: null,
      total: 4,
      results: query.offset ? [OLIVE_OIL_FOOD] : [HUMMUS_FOOD, FALAFEL_FOOD, HUMMUS_FOOD].map((food, index) => ({ ...food, id: index + 1 })),
    }));
    const { fixture, el } = await render();
    buttonWith(el, 'Show more').click();
    await fixture.whenStable();
    expect(searchCatalog).toHaveBeenLastCalledWith({ limit: FOODS_PAGE_SIZE, offset: 3 });
    expect(el.querySelectorAll('button[data-catalog-id]')).toHaveLength(4);
    expect(buttonWith(el, 'Show more')).toBeUndefined();
  });

  it('explains an empty database and a failed load', async () => {
    configure();
    catalogInfo.mockResolvedValue({ ...INFO, foodCount: 0, groups: [], version: null });
    const { el } = await render();
    expect(el.textContent).toContain('The food database is not loaded yet');
    expect(buttonWith(el, 'All')).toBeUndefined();

    TestBed.resetTestingModule();
    configure();
    catalogInfo.mockResolvedValue(INFO);
    searchCatalog.mockRejectedValue(new HttpErrorResponse({ status: 500 }));
    const failed = await render();
    expect(failed.el.textContent).toContain("Couldn't load the food database.");
    expect(buttonWith(failed.el, 'Retry')).toBeDefined();
  });

  it('opens a food to log it', async () => {
    configure();
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>(`button[data-catalog-id="${HUMMUS_FOOD.id}"]`)!.click();
    await fixture.whenStable();
    expect(buttonWith(el, 'Log 1 serving (60 g)')).toBeDefined();
  });
});
