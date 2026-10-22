import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { CatalogSearchQuery, CatalogSearchResponse } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { HUMMUS_FOOD, OLIVE_OIL_FOOD } from '../../testing/catalog-fixtures';
import { installDialogShim } from '../../testing/dialog-shim';
import {
  CATALOG_PICKER_DEBOUNCE_MS,
  CatalogPickerSheet,
  type CatalogPick,
} from './catalog-picker-sheet';

@Component({
  imports: [CatalogPickerSheet],
  template: `<app-catalog-picker-sheet [(open)]="open" (picked)="picked.set($event)" />`,
})
class Host {
  readonly open = signal(false);
  readonly picked = signal<CatalogPick | null>(null);
}

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  )!;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('CatalogPickerSheet', () => {
  const searchCatalog = vi.fn<(query: CatalogSearchQuery) => Promise<CatalogSearchResponse>>();
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    searchCatalog.mockReset();
    searchCatalog.mockImplementation(async (query) => ({
      query: query.q ?? '',
      group: null,
      total: 2,
      results: [OLIVE_OIL_FOOD, HUMMUS_FOOD],
    }));
    TestBed.configureTestingModule({
      providers: [{ provide: ApiService, useValue: { searchCatalog } }],
    });
  });

  afterEach(() => restoreDialog());

  async function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  async function search(fixture: { whenStable(): Promise<unknown> }, el: HTMLElement, text: string) {
    const input = el.querySelector<HTMLInputElement>('#catalog-picker-search')!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    await wait(CATALOG_PICKER_DEBOUNCE_MS + 20);
    await fixture.whenStable();
  }

  it('explains itself before the first search', async () => {
    const { el } = await render();
    expect(el.textContent).toContain('Search thousands of ingredients and dishes');
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  it('searches, picks an amount and adds the item with its source food', async () => {
    const { fixture, host, el } = await render();
    await search(fixture, el, 'olive oil');
    expect(searchCatalog).toHaveBeenCalledWith({ q: 'olive oil', limit: 20 });

    el.querySelector<HTMLButtonElement>(`button[data-catalog-id="${OLIVE_OIL_FOOD.id}"]`)!.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('100 g');
    const grams = el.querySelector<HTMLInputElement>('input[aria-label="Grams"]')!;
    grams.value = '14';
    grams.dispatchEvent(new Event('input'));
    grams.dispatchEvent(new Event('blur'));
    await fixture.whenStable();

    buttonWith(el, 'Add to meal').click();
    await fixture.whenStable();
    expect(host.picked()?.food.id).toBe(OLIVE_OIL_FOOD.id);
    expect(host.picked()?.item).toMatchObject({ name: 'Olive oil', grams: 14 });
    expect(host.picked()?.item.nutrients.calories).toBe(126);
    expect(host.open()).toBe(false);
  });

  it('goes back to the results and starts fresh when opened again', async () => {
    const { fixture, host, el } = await render();
    await search(fixture, el, 'hummus');
    el.querySelector<HTMLButtonElement>(`button[data-catalog-id="${HUMMUS_FOOD.id}"]`)!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="Back to results"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('#catalog-picker-search')).not.toBeNull();

    host.open.set(false);
    await fixture.whenStable();
    host.open.set(true);
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('#catalog-picker-search')!.value).toBe('');
    expect(el.textContent).toContain('Search thousands of ingredients and dishes');
  });

  it('says when nothing matches and when the search fails', async () => {
    const { fixture, el } = await render();
    searchCatalog.mockResolvedValueOnce({ query: 'zzz', group: null, total: 0, results: [] });
    await search(fixture, el, 'zzz');
    expect(el.textContent).toContain('No foods match “zzz”.');

    searchCatalog.mockRejectedValueOnce(new Error('offline'));
    await search(fixture, el, 'egg');
    expect(el.textContent).toContain("Couldn't search the food database.");
  });
});
