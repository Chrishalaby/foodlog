import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients, type CatalogSearchResponse } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { OLIVE_OIL_FOOD } from '../../testing/catalog-fixtures';
import { installDialogShim } from '../../testing/dialog-shim';
import { CATALOG_PICKER_DEBOUNCE_MS } from '../catalog/catalog-picker-sheet';
import { ItemsEditor } from './items-editor';
import {
  createDraftItem,
  draftFromCatalogItem,
  isBlankDraftItem,
  rescaleItem,
  type DraftItem,
} from './items-math';

@Component({
  imports: [ItemsEditor],
  template: `<app-items-editor [(items)]="items" />`,
})
class Host {
  readonly items = signal<DraftItem[]>([createDraftItem()]);
}

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  )!;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('ItemsEditor (food database)', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    const response: CatalogSearchResponse = {
      query: 'olive oil',
      group: null,
      total: 1,
      results: [OLIVE_OIL_FOOD],
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ApiService, useValue: { searchCatalog: vi.fn().mockResolvedValue(response) } },
      ],
    });
  });

  afterEach(() => restoreDialog());

  it('replaces the blank starter item with a food picked from the database', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;

    buttonWith(el, 'From database').click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('#catalog-picker-search')!;
    input.value = 'olive oil';
    input.dispatchEvent(new Event('input'));
    await wait(CATALOG_PICKER_DEBOUNCE_MS + 20);
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>(`button[data-catalog-id="${OLIVE_OIL_FOOD.id}"]`)!.click();
    await fixture.whenStable();
    buttonWith(el, 'Add to meal').click();
    await fixture.whenStable();

    const items = fixture.componentInstance.items();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Olive oil', grams: 100, confidence: 'high' });
    expect(items[0]?.nutrients.calories).toBe(900);
  });
});

describe('database items', () => {
  it('keep the exact per-100 g values when the grams change', () => {
    const item = draftFromCatalogItem(
      {
        name: 'Olive oil',
        grams: 14,
        nutrients: { ...zeroNutrients(), calories: 126, fat: 14, satFat: 1.9, sodium: 0 },
        confidence: 'high',
        micros: { vitaminE: 2, vitaminK: 8 },
      },
      OLIVE_OIL_FOOD.per100,
      OLIVE_OIL_FOOD.microsPer100,
    );
    const rescaled = rescaleItem(item, 27);
    expect(rescaled.nutrients.calories).toBe(243);
    expect(rescaled.nutrients.satFat).toBe(3.7);
    expect(rescaled.micros).toEqual({ vitaminE: 3.9, vitaminK: 16 });
  });

  it('only treat untouched rows as blank', () => {
    expect(isBlankDraftItem(createDraftItem())).toBe(true);
    expect(isBlankDraftItem(createDraftItem({ name: 'Rice' }))).toBe(false);
    expect(isBlankDraftItem(createDraftItem({ grams: 50 }))).toBe(false);
    expect(
      isBlankDraftItem(createDraftItem({ nutrients: { ...zeroNutrients(), calories: 10 } })),
    ).toBe(false);
  });
});
