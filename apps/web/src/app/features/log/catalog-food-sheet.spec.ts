import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  zeroNutrients,
  type CreateEntryRequest,
  type EntryDto,
  type EntryItemInput,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { FALAFEL_FOOD, HUMMUS_FOOD } from '../../shared/testing/catalog-fixtures';
import {
  CatalogFoodSheet,
  catalogIdentity,
  type CatalogSelection,
  type CatalogSheetMode,
} from './catalog-food-sheet';
import { LibraryActions } from './library-actions';
import type { LibraryDraft } from './log.store';
import { installDialogShim } from './testing/dialog-shim';

@Component({
  imports: [CatalogFoodSheet],
  providers: [LibraryActions],
  template: `
    <app-catalog-food-sheet
      [selection]="selection()"
      [mode]="mode()"
      [(open)]="open"
      (logged)="logged.set($event)"
      (picked)="picked.set($event)"
      (edit)="draft.set($event)"
    />
  `,
})
class Host {
  readonly selection = signal<CatalogSelection | null>(null);
  readonly mode = signal<CatalogSheetMode>('log');
  readonly open = signal(false);
  readonly logged = signal<EntryDto | null>(null);
  readonly picked = signal<EntryItemInput | null>(null);
  readonly draft = signal<LibraryDraft | null>(null);
}

const buttonWith = (el: HTMLElement, text: string): HTMLButtonElement =>
  Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  )!;

function entryFor(body: CreateEntryRequest): EntryDto {
  return {
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
  };
}

describe('CatalogFoodSheet', () => {
  const api = {
    createEntry: vi.fn<(body: CreateEntryRequest) => Promise<EntryDto>>(),
    deleteEntry: vi.fn(),
  };
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    api.createEntry.mockReset();
    api.createEntry.mockImplementation(async (body) => entryFor(body));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: ConfirmService, useValue: { confirm: vi.fn() } },
      ],
    });
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function render(mode: CatalogSheetMode, food = HUMMUS_FOOD) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.mode.set(mode);
    fixture.componentInstance.selection.set({ id: 1, food });
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the food with its first portion and live values', async () => {
    const { el } = await render('log');
    expect(el.querySelector('h2')?.textContent).toContain('Hummus, plain');
    expect(el.textContent).toContain('Soups & sauces · 243 kcal per 100 g');
    expect(el.textContent).toContain('146');
    expect(buttonWith(el, 'Log 1 serving (60 g)')).toBeDefined();
  });

  it('recalculates when the amount changes', async () => {
    const { fixture, el } = await render('log');
    buttonWith(el, '1 tablespoon').click();
    await fixture.whenStable();
    buttonWith(el, '2×').click();
    await fixture.whenStable();
    expect(buttonWith(el, 'Log 2 × 1 tablespoon (30 g)')).toBeDefined();
    expect(el.textContent).toContain('73');

    buttonWith(el, 'Grams').click();
    await fixture.whenStable();
    const grams = el.querySelector<HTMLInputElement>('input[aria-label="Grams"]')!;
    expect(grams.value).toBe('30');
  });

  it('logs a database entry and closes', async () => {
    const { fixture, host, el } = await render('log');
    buttonWith(el, 'Log 1 serving (60 g)').click();
    await fixture.whenStable();

    expect(api.createEntry).toHaveBeenCalledTimes(1);
    const body = api.createEntry.mock.calls[0]![0];
    expect(body).toMatchObject({ name: 'Hummus, plain', source: 'database' });
    expect(body.portion).toBeUndefined();
    expect(body.items[0]).toMatchObject({ grams: 60, confidence: 'high' });
    expect(host.logged()?.id).toBe('entry-db');
    expect(host.open()).toBe(false);
    expect(TestBed.inject(LibraryActions, null)).toBeNull();
    expect(fixture.debugElement.injector.get(LibraryActions).isIdentityLogged(catalogIdentity(HUMMUS_FOOD))).toBe(true);
  });

  it('notifies other screens after logging', async () => {
    const events = TestBed.inject(DataEventsService);
    const before = events.entries();
    const { fixture, el } = await render('log');
    buttonWith(el, 'Log 1 serving (60 g)').click();
    await fixture.whenStable();
    expect(events.entries()).toBeGreaterThan(before);
  });

  it('hands the item to the editor instead when asked to edit first', async () => {
    const { fixture, host, el } = await render('log');
    buttonWith(el, 'Edit before saving').click();
    await fixture.whenStable();
    expect(api.createEntry).not.toHaveBeenCalled();
    expect(host.draft()).toMatchObject({
      name: 'Hummus, plain',
      photo: null,
      portion: null,
      items: [{ name: 'Hummus, plain', grams: 60 }],
    });
  });

  it('adds the item to a meal in pick mode without logging', async () => {
    const { fixture, host, el } = await render('pick');
    expect(el.textContent).not.toContain('When');
    buttonWith(el, 'Add to meal').click();
    await fixture.whenStable();
    expect(api.createEntry).not.toHaveBeenCalled();
    expect(host.picked()).toMatchObject({ name: 'Hummus, plain', grams: 60 });
    expect(host.open()).toBe(false);
  });

  it('says which nutrients the source does not report', async () => {
    const { fixture, el } = await render('log', FALAFEL_FOOD);
    expect(el.textContent).toContain('No fiber, sugar data in the source');
    buttonWith(el, 'Nutrition details').click();
    await fixture.whenStable();
    expect(el.textContent).toContain('(not reported)');
    const link = el.querySelector<HTMLAnchorElement>('a[href*="fdc.nal.usda.gov"]');
    expect(link?.href).toBe('https://fdc.nal.usda.gov/food-details/172447/nutrients');
  });
});
