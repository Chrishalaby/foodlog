import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { zeroNutrients } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { aiOff } from '../../core/testing/ai-off';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { installDialogShim } from '../../shared/testing/dialog-shim';
import { CaptureHome } from './capture-home';
import { CATALOG_DEBOUNCE_MS } from './catalog-suggestions.store';
import { FoodSearchStore, SEARCH_DEBOUNCE_MS } from './food-search.store';
import { LibraryActions } from './library-actions';
import type { LibraryDraft } from './log.store';

const SETTLE_MS = Math.max(SEARCH_DEBOUNCE_MS, CATALOG_DEBOUNCE_MS) + 30;

const settle = async (fixture: ComponentFixture<unknown>, ms = 0): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await fixture.whenStable();
};

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement | undefined =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  );

describe('CaptureHome without AI', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        aiOff(),
        FoodSearchStore,
        LibraryActions,
        {
          provide: ApiService,
          useValue: {
            searchFoods: vi.fn(async (query: { q?: string }) => ({
              query: query.q ?? '',
              results: [],
            })),
            searchCatalog: vi.fn(async (query: { q?: string }) => ({
              query: query.q ?? '',
              group: null,
              total: 0,
              results: [],
            })),
            listDrafts: vi.fn().mockResolvedValue([]),
            listProducts: vi.fn().mockResolvedValue([]),
          },
        },
        { provide: ConfirmService, useValue: { confirm: vi.fn() } },
      ],
    });
  });

  afterEach(() => restoreDialog());

  async function render() {
    const fixture = TestBed.createComponent(CaptureHome);
    await settle(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('leads with the food database and barcode, without AI tiles', async () => {
    const { el } = await render();
    const database = Array.from(el.querySelectorAll<HTMLAnchorElement>('a')).find((link) =>
      link.textContent?.includes('Food database'),
    );
    expect(database?.getAttribute('href')).toBe('/foods');
    expect(buttonWith(el, 'Scan barcode')).toBeDefined();
    expect(buttonWith(el, 'Manual')).toBeDefined();
    for (const label of ['Take photo', 'Scan label', 'Describe', 'Speak']) {
      expect(buttonWith(el, label)).toBeUndefined();
    }
    expect(el.querySelector('[data-ai-off-note]')?.textContent).toContain(
      'AI estimates are off on this server',
    );
  });

  it('offers to add an unknown food by hand instead of asking AI', async () => {
    const { fixture, el } = await render();
    const drafts: LibraryDraft[] = [];
    fixture.componentInstance.edit.subscribe((draft) => drafts.push(draft));
    const input = el.querySelector<HTMLInputElement>('#food-search')!;
    input.value = 'manakish zaatar';
    input.dispatchEvent(new Event('input'));
    await settle(fixture, SETTLE_MS);

    expect(buttonWith(el, 'Ask AI')).toBeUndefined();
    expect(buttonWith(el, 'Take a photo')).toBeUndefined();
    expect(buttonWith(el, 'Scan the label')).toBeUndefined();
    buttonWith(el, 'Add “manakish zaatar” manually')!.click();

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      name: 'manakish zaatar',
      items: [{ name: 'manakish zaatar', grams: 0, nutrients: zeroNutrients() }],
      photo: null,
      portion: null,
      mealTypeAuto: true,
    });
  });

  it('opens the manual form on Enter when nothing matches', async () => {
    const { fixture, el } = await render();
    const drafts: LibraryDraft[] = [];
    fixture.componentInstance.edit.subscribe((draft) => drafts.push(draft));
    const describe = vi.fn();
    fixture.componentInstance.describe.subscribe(describe);
    const input = el.querySelector<HTMLInputElement>('#food-search')!;
    input.value = 'labneh';
    input.dispatchEvent(new Event('input'));
    input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle(fixture, SETTLE_MS);
    expect(describe).not.toHaveBeenCalled();
    expect(drafts[0]?.name).toBe('labneh');
  });
});
