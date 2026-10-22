import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { zeroNutrients, type SaveMyFoodRequest } from '@food/shared';
import { MyFoodsStore } from '../../../core/my-foods.store';
import { ToastService } from '../../../core/toast.service';
import { installDialogShim } from '../../testing/dialog-shim';
import { MAYO, myFood } from '../../testing/my-foods-fixtures';
import { savedFoodRef } from '../../utils/saved-foods';
import { ItemsEditor } from './items-editor';
import { createDraftItem, type DraftItem } from './items-math';

const KETCHUP = myFood({ aliases: [] });

@Component({
  imports: [ItemsEditor],
  template: `<app-items-editor [(items)]="items" [compact]="compact()" />`,
})
class Host {
  readonly compact = signal(false);
  readonly items = signal<DraftItem[]>([]);
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.dispatchEvent(new Event('focus'));
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function buttonWith(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  );
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function aiKetchup(): DraftItem {
  return createDraftItem({
    name: 'Tomato ketchup',
    grams: 30,
    nutrients: { ...zeroNutrients(), calories: 33, carbs: 7.5 },
    aiName: 'Tomato ketchup',
    suggestedFood: savedFoodRef(KETCHUP),
    hints: { amountSource: 'visual_estimate' },
  });
}

function linkedKetchup(): DraftItem {
  return createDraftItem({
    name: 'Heinz tomato ketchup',
    grams: 26,
    nutrients: { ...zeroNutrients(), calories: 29, carbs: 6.7 },
    productId: KETCHUP.id,
  });
}

describe('ItemsEditor (my foods)', () => {
  let http: HttpTestingController;
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(ToastService).clear();
    restoreDialog();
  });

  async function setup(
    items: DraftItem[],
    compact = false,
  ): Promise<{ fixture: ComponentFixture<Host>; host: Host; el: HTMLElement }> {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.compact.set(compact);
    fixture.componentInstance.items.set(items);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  async function answerList(fixture: ComponentFixture<Host>): Promise<void> {
    http
      .expectOne((req) => req.url === '/api/my-foods' && req.method === 'GET')
      .flush([KETCHUP, MAYO]);
    await flush();
    await fixture.whenStable();
  }

  it('offers the server’s suggestion in one line and applies it with “Use it”', async () => {
    const { fixture, host, el } = await setup([aiKetchup()], true);
    http.expectNone('/api/my-foods');
    const line = el.querySelector('[aria-label="Saved food suggestion for Tomato ketchup"]');
    expect(line?.textContent?.replace(/\s+/g, ' ')).toContain(
      'Same as your Heinz tomato ketchup? Use it',
    );
    buttonWith(line!, 'Use it')!.click();
    await fixture.whenStable();
    const [item] = host.items();
    expect(item).toMatchObject({ name: 'Heinz tomato ketchup', grams: 30, productId: KETCHUP.id });
    expect(item.nutrients.calories).toBe(33);
    expect(item.nutrients.carbs).toBe(7.7);
    expect(item.nutrients.sodium).toBe(270);
    expect(el.querySelector('[aria-label^="Saved food suggestion"]')).toBeNull();
    expect(el.querySelector('button[data-item-row]')?.textContent).toContain('My food');
  });

  it('hides a suggestion for that item only', async () => {
    const other = { ...aiKetchup(), key: 'item-other' };
    const { fixture, host, el } = await setup([aiKetchup(), other], true);
    const hide = el.querySelectorAll<HTMLButtonElement>(
      'button[aria-label="Hide suggestion for Tomato ketchup"]',
    );
    expect(hide).toHaveLength(2);
    hide[0].click();
    await fixture.whenStable();
    expect(el.querySelectorAll('[aria-label^="Saved food suggestion"]')).toHaveLength(1);
    expect(host.items().every((item) => item.productId === null)).toBe(true);
  });

  it('suggests a saved food for a typed name from the cached list', async () => {
    const { fixture, host, el } = await setup([createDraftItem()]);
    http.expectNone('/api/my-foods');
    typeInto(el.querySelector<HTMLInputElement>('input[data-item-name]')!, 'Mayonnaise, regular');
    await fixture.whenStable();
    await answerList(fixture);
    const line = el.querySelector('[aria-label="Saved food suggestion for Mayonnaise, regular"]');
    expect(line?.textContent).toContain('Heinz mayonnaise, regular');
    typeInto(el.querySelector<HTMLInputElement>('input[aria-label^="Grams of"]')!, '20');
    await fixture.whenStable();
    const refreshed = el.querySelector(
      '[aria-label="Saved food suggestion for Mayonnaise, regular"]',
    );
    buttonWith(refreshed!, 'Use it')!.click();
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({
      name: 'Heinz mayonnaise, regular',
      productId: MAYO.id,
      grams: 20,
    });
    expect(host.items()[0].nutrients.calories).toBe(136);
    expect(host.items()[0].nutrients.fat).toBe(15);
  });

  it('shows the My food chip, keeps the link on grams edits and unlinks on nutrient edits', async () => {
    const { fixture, host, el } = await setup([linkedKetchup()]);
    await answerList(fixture);
    const chip = el.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
    expect(chip?.getAttribute('aria-label')).toBe('My food, Heinz tomato ketchup. Options');
    expect(chip?.textContent?.trim()).toBe('My food');

    typeInto(
      el.querySelector<HTMLInputElement>('input[aria-label="Grams of Heinz tomato ketchup"]')!,
      '100',
    );
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ grams: 100, productId: KETCHUP.id });
    expect(host.items()[0].nutrients.calories).toBe(110);
    expect(host.items()[0].nutrients.sodium).toBe(900);

    typeInto(
      el.querySelector<HTMLInputElement>(
        'input[aria-label="Calories (kcal) of Heinz tomato ketchup"]',
      )!,
      '120',
    );
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ productId: null, savedFood: null });
    expect(host.items()[0].nutrients.calories).toBe(120);
    expect(el.querySelector('button[aria-label^="My food"]')).toBeNull();
    expect(el.querySelector('[aria-label^="Saved food suggestion"]')).toBeNull();
    expect(buttonWith(el, 'Save as my food')).toBeDefined();
  });

  it('names the saved food on the chip when the item is called something else', async () => {
    const { fixture, el } = await setup([{ ...linkedKetchup(), name: 'Ketchup' }]);
    await answerList(fixture);
    const chip = el.querySelector<HTMLButtonElement>('button[aria-label^="My food"]');
    expect(chip?.textContent?.replace(/\s+/g, ' ')).toContain('· Heinz tomato ketchup');
  });

  it('does not repeat a branded saved food on the chip when the item carries its full name', async () => {
    const labneh = myFood({ id: 'food-labneh', name: 'Labneh', brand: 'Khoury', aliases: [] });
    const linked = createDraftItem({
      name: 'Khoury Labneh',
      grams: 30,
      nutrients: { ...zeroNutrients(), calories: 50 },
      productId: labneh.id,
      savedFood: savedFoodRef(labneh),
    });
    const { el } = await setup([linked]);
    const chip = el.querySelector<HTMLButtonElement>('button[aria-label^="My food"]');
    expect(chip?.getAttribute('aria-label')).toBe('My food, Khoury Labneh. Options');
    expect(chip?.textContent?.trim()).toBe('My food');
  });

  it('unlinks from the chip menu and keeps the values', async () => {
    const { fixture, host, el } = await setup([linkedKetchup()]);
    await answerList(fixture);
    el.querySelector<HTMLButtonElement>('button[aria-label^="My food"]')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Use another saved food…');
    buttonWith(dialog, 'Unlink')!.click();
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ productId: null, name: 'Heinz tomato ketchup' });
    expect(host.items()[0].nutrients.calories).toBe(29);
  });

  it('switches to another saved food from the picker', async () => {
    const { fixture, host, el } = await setup([linkedKetchup()]);
    await answerList(fixture);
    el.querySelector<HTMLButtonElement>('button[aria-label^="My food"]')!.click();
    await fixture.whenStable();
    buttonWith(el.querySelector('dialog[open]')!, 'Use another saved food')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    const search = dialog.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(dialog.querySelectorAll('ul[aria-label="Saved foods"] button')).toHaveLength(1);
    typeInto(search, 'zzz');
    await fixture.whenStable();
    expect(dialog.textContent).toContain('No saved food matches that.');
    typeInto(search, 'mayo');
    await fixture.whenStable();
    buttonWith(dialog, 'Heinz mayonnaise, regular')!.click();
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({
      name: 'Heinz mayonnaise, regular',
      productId: MAYO.id,
      grams: 26,
    });
    expect(host.items()[0].nutrients.calories).toBe(177);
  });

  it('saves an item as my food and links it', async () => {
    const item = createDraftItem({
      name: 'Sofisoft potato bun',
      grams: 60,
      nutrients: { ...zeroNutrients(), calories: 163, carbs: 30, protein: 5.4, fat: 2.4 },
      count: 1,
      unit: 'bun',
      unitPlural: 'buns',
    });
    const { fixture, host, el } = await setup([item]);
    await answerList(fixture);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Save Sofisoft potato bun as my food"]',
    )!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.querySelector<HTMLInputElement>('input.font-semibold')?.value).toBe(
      'Sofisoft potato bun',
    );
    expect(dialog.textContent?.replace(/\s+/g, ' ')).toContain('Per 100 g');
    expect(dialog.textContent).toContain('272');
    expect(dialog.querySelector<HTMLInputElement>('input[aria-label="Unit name"]')?.value).toBe(
      'bun',
    );
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. Heinz"]')!,
      'Sofisoft',
    );
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    const post = http.expectOne((req) => req.url === '/api/my-foods' && req.method === 'POST');
    const body = post.request.body as SaveMyFoodRequest;
    expect(body).toMatchObject({
      name: 'Sofisoft potato bun',
      brand: 'Sofisoft',
      basisUnit: 'g',
      unitName: 'bun',
      unitGrams: 60,
      source: 'manual',
    });
    expect(body.per100).toMatchObject({ calories: 272, carbs: 50, protein: 9, fat: 4 });
    post.flush(myFood({ id: 'food-bun', name: 'Sofisoft potato bun', per100: body.per100 }));
    await flush();
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ productId: 'food-bun', grams: 60 });
    expect(host.items()[0].nutrients.calories).toBe(163);
    expect(TestBed.inject(MyFoodsStore).find('food-bun')).not.toBeNull();
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.message),
    ).toContain('Saved “Sofisoft potato bun” to My foods');
  });

  it('applies the saved food’s vitamins per 100 g with “Use it”', async () => {
    const withMicros = myFood({ aliases: [], microsPer100: { potassium: 281, vitaminC: 15 } });
    const item = createDraftItem({
      name: 'Tomato ketchup',
      grams: 30,
      nutrients: { ...zeroNutrients(), calories: 33, carbs: 7.5 },
      micros: { potassium: 50 },
      aiName: 'Tomato ketchup',
      suggestedFood: savedFoodRef(withMicros),
      hints: { amountSource: 'visual_estimate' },
    });
    const { fixture, host, el } = await setup([item], true);
    buttonWith(el.querySelector('[aria-label^="Saved food suggestion"]')!, 'Use it')!.click();
    await fixture.whenStable();
    expect(host.items()[0].micros).toEqual({ vitaminC: 5, potassium: 84 });
  });

  it('keeps the item’s own vitamins when the picked saved food has none', async () => {
    const item = { ...linkedKetchup(), micros: { potassium: 70 }, microsBasis: null };
    const { fixture, host, el } = await setup([item]);
    await answerList(fixture);
    el.querySelector<HTMLButtonElement>('button[aria-label^="My food"]')!.click();
    await fixture.whenStable();
    buttonWith(el.querySelector('dialog[open]')!, 'Use another saved food')!.click();
    await fixture.whenStable();
    buttonWith(el.querySelector('dialog[open]')!, 'Heinz mayonnaise, regular')!.click();
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ productId: MAYO.id, micros: { potassium: 70 } });
  });

  it('saves the item’s vitamins per 100 g with “Save as my food”', async () => {
    const item = createDraftItem({
      name: 'Doctor’s Best Vitamin D3',
      grams: 0.5,
      nutrients: { ...zeroNutrients(), calories: 4.5, fat: 0.5 },
      micros: { vitaminD: 125 },
      count: 1,
      unit: 'softgel',
      unitPlural: 'softgels',
    });
    const { fixture, el } = await setup([item]);
    await answerList(fixture);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Save Doctor’s Best Vitamin D3 as my food"]',
    )!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    const post = http.expectOne((req) => req.url === '/api/my-foods' && req.method === 'POST');
    expect((post.request.body as SaveMyFoodRequest).microsPer100).toEqual({ vitaminD: 25000 });
    post.flush(myFood({ id: 'food-d3', name: 'Doctor’s Best Vitamin D3' }));
    await flush();
  });

  it('asks for both parts of a handy unit before saving', async () => {
    const item = createDraftItem({
      name: 'Garlic sauce',
      grams: 20,
      nutrients: { ...zeroNutrients(), calories: 120 },
    });
    const { fixture, el } = await setup([item]);
    await answerList(fixture);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Save Garlic sauce as my food"]',
    )!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    typeInto(dialog.querySelector<HTMLInputElement>('input[aria-label="Unit name"]')!, 'tbsp');
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain(
      'Give the unit a name and its weight',
    );
    http.expectNone((req) => req.method === 'POST');
  });
});
