import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type {
  FoodMergeSuggestionsResponse,
  MyFoodChangeResponse,
  MyFoodDto,
  SaveMyFoodRequest,
  UpdateMyFoodRequest,
} from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService, type ConfirmOptions } from '../../../shared/ui/confirm.service';
import { installDialogShim } from '../../../shared/testing/dialog-shim';
import {
  MAYO,
  YOGURT,
  ketchupSuggestion,
  myFood,
  per100,
} from '../../../shared/testing/my-foods-fixtures';
import { MyFoodsPage } from './my-foods-page';

const KETCHUP = myFood();
const SALT = myFood({
  id: 'food-salt',
  name: 'Table salt',
  aliases: ['Added table salt'],
  unitName: null,
  unitGrams: null,
  per100: per100({ sodium: 38758 }),
  useCount: 0,
  itemCount: 0,
});

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function buttonWith(root: ParentNode, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  );
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.dispatchEvent(new Event('focus'));
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('MyFoodsPage', () => {
  const api = {
    listMyFoods: vi.fn<() => Promise<MyFoodDto[]>>(),
    foodMergeSuggestions: vi.fn<() => Promise<FoodMergeSuggestionsResponse>>(),
    createMyFood: vi.fn<(body: SaveMyFoodRequest) => Promise<MyFoodDto>>(),
    updateMyFood: vi.fn<(id: string, body: UpdateMyFoodRequest) => Promise<MyFoodChangeResponse>>(),
    deleteMyFood: vi.fn<(id: string) => Promise<void>>(),
    dismissFoodMerge: vi.fn<(body: { key: string }) => Promise<void>>(),
  };
  const confirm = { confirm: vi.fn<(options: ConfirmOptions) => Promise<boolean>>() };
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
    Object.values(api).forEach((mock) => mock.mockReset());
    confirm.confirm.mockReset();
    confirm.confirm.mockResolvedValue(true);
    api.listMyFoods.mockResolvedValue([KETCHUP, YOGURT, MAYO, SALT]);
    api.foodMergeSuggestions.mockResolvedValue({ suggestions: [ketchupSuggestion()] });
    api.updateMyFood.mockImplementation(async (id, body) => ({
      food: { ...KETCHUP, ...body, id } as MyFoodDto,
      updatedItems: body.applyToPast ? 3 : 0,
      updatedEntries: body.applyToPast ? 2 : 0,
      updatedFavorites: 0,
    }));
    api.createMyFood.mockImplementation(async (body) =>
      myFood({ ...body, id: 'food-new', aliases: body.aliases ?? [], useCount: 0, itemCount: 0 }),
    );
    api.deleteMyFood.mockResolvedValue(undefined);
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

  async function render(): Promise<{ fixture: ComponentFixture<MyFoodsPage>; el: HTMLElement }> {
    const fixture = TestBed.createComponent(MyFoodsPage);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function rows(el: HTMLElement): string[] {
    return Array.from(el.querySelectorAll('ul[aria-label="Saved foods"] > li')).map(
      (row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
  }

  function toasts(): string[] {
    return TestBed.inject(ToastService)
      .toasts()
      .map((toast) => toast.message);
  }

  it('lists saved foods with values, badges, aliases and use', async () => {
    const { el } = await render();
    expect(el.querySelector('h1')?.textContent).toContain('My foods');
    expect(el.textContent).toContain('4 saved foods');
    const list = rows(el);
    expect(list).toHaveLength(4);
    expect(list[0]).toContain('Heinz tomato ketchup');
    expect(list[0]).toContain('110 kcal/100 g');
    expect(list[0]).toContain('Manual');
    expect(list[0]).toContain('used 3 times');
    expect(list[0]).toContain('also: Tomato ketchup');
    expect(list[1]).toContain('Khoury');
    expect(list[1]).toContain('Barcode');
    expect(list[1]).toContain('Label');
    expect(list[3]).toContain('not used yet');
  });

  it('puts pending merge suggestions at the top', async () => {
    const { fixture, el } = await render();
    const section = el.querySelector('section[aria-labelledby="my-foods-suggestions"]')!;
    expect(section.textContent).toContain(
      'Tomato ketchup was logged 3 ways (103–118 kcal/100 g). Make it one food?',
    );
    buttonWith(section, 'Review')!.click();
    await fixture.whenStable();
    expect(el.querySelector('dialog[open]')?.textContent).toContain('Make it one food');

    api.dismissFoodMerge.mockResolvedValue(undefined);
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Don’t ask about Tomato ketchup again"]',
    )!.click();
    await flush();
    await fixture.whenStable();
    expect(api.dismissFoodMerge).toHaveBeenCalledWith({ key: 'tomato ketchup' });
    expect(el.querySelector('section[aria-labelledby="my-foods-suggestions"]')).toBeNull();
  });

  it('searches names, brands and aliases', async () => {
    const { fixture, el } = await render();
    typeInto(el.querySelector<HTMLInputElement>('#my-foods-search')!, 'added salt');
    await fixture.whenStable();
    expect(rows(el)).toHaveLength(1);
    expect(rows(el)[0]).toContain('Table salt');
    typeInto(el.querySelector<HTMLInputElement>('#my-foods-search')!, 'pickles');
    await fixture.whenStable();
    expect(el.textContent).toContain('No saved food matches “pickles”.');
    el.querySelector<HTMLButtonElement>('button[aria-label="Clear search"]')!.click();
    await fixture.whenStable();
    expect(rows(el)).toHaveLength(4);
  });

  it('edits a food and updates past logs when its values change', async () => {
    const { fixture, el } = await render();
    buttonWith(el.querySelector('ul[aria-label="Saved foods"]')!, 'Heinz tomato ketchup')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Edit my food');
    expect(dialog.querySelector('[role="switch"]')).toBeNull();

    dialog.querySelector<HTMLButtonElement>('button[aria-label="Remove Tomato ketchup"]')!.click();
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="Another name for it"]')!,
      'Ketchup',
    );
    await fixture.whenStable();
    buttonWith(dialog, 'Add')!.click();
    await fixture.whenStable();
    expect(dialog.querySelector('ul')?.textContent).toContain('Ketchup');
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[aria-label="Energy per 100 g (kcal)"]')!,
      '105',
    );
    await fixture.whenStable();
    const toggle = dialog.querySelector('[role="switch"]')!;
    expect(toggle.textContent).toContain('Update past logs (3)');
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await fixture.whenStable();
    expect(api.updateMyFood).toHaveBeenCalledWith('food-ketchup', {
      name: 'Heinz tomato ketchup',
      brand: null,
      aliases: ['Ketchup'],
      basisUnit: 'g',
      per100: { ...KETCHUP.per100, calories: 105 },
      unitName: 'tbsp',
      unitGrams: 15,
      applyToPast: true,
    });
    expect(toasts()).toContain('Updated Heinz tomato ketchup · 3 past items updated');
    expect(el.querySelector('dialog[open]')).toBeNull();
  });

  it('can keep past logs as they are', async () => {
    const { fixture, el } = await render();
    buttonWith(el.querySelector('ul[aria-label="Saved foods"]')!, 'Heinz tomato ketchup')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[aria-label="Protein per 100 g (g)"]')!,
      '2',
    );
    await fixture.whenStable();
    dialog.querySelector<HTMLButtonElement>('[role="switch"]')!.click();
    await fixture.whenStable();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(api.updateMyFood.mock.calls[0]![1]).toMatchObject({ applyToPast: false });
    expect(toasts()).toContain('Updated Heinz tomato ketchup');
  });

  it('adds vitamins per 100 g under More nutrients and leaves blanks unknown', async () => {
    const { fixture, el } = await render();
    buttonWith(el.querySelector('ul[aria-label="Saved foods"]')!, 'Heinz tomato ketchup')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.querySelector('[data-micro-input]')).toBeNull();
    buttonWith(dialog, 'More nutrients')!.click();
    await fixture.whenStable();
    expect(dialog.textContent).toContain('Leave blank if you don’t know.');
    const fields = dialog.querySelectorAll<HTMLInputElement>('input[data-micro-input]');
    expect(fields).toHaveLength(15);
    expect(Array.from(fields).every((field) => field.value === '')).toBe(true);
    const potassium = dialog.querySelector<HTMLInputElement>(
      'input[data-micro-input="potassium"]',
    )!;
    expect(potassium.getAttribute('aria-label')).toBe('Potassium per 100 g (mg)');
    typeInto(potassium, '281');
    typeInto(dialog.querySelector<HTMLInputElement>('input[data-micro-input="vitaminC"]')!, '0');
    await fixture.whenStable();
    expect(dialog.querySelector('[role="switch"]')?.textContent).toContain('Update past logs (3)');
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(api.updateMyFood.mock.calls[0]![1]).toMatchObject({
      microsPer100: { vitaminC: 0, potassium: 281 },
      applyToPast: true,
    });
  });

  it('opens More nutrients and blocks saving when a vitamin is not a number', async () => {
    const softgel = myFood({
      id: 'food-d3',
      name: 'Vitamin D3 softgel',
      aliases: [],
      microsPer100: { vitaminD: 25000 },
    });
    api.listMyFoods.mockResolvedValue([softgel]);
    const { fixture, el } = await render();
    buttonWith(el.querySelector('ul[aria-label="Saved foods"]')!, 'Vitamin D3 softgel')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    buttonWith(dialog, 'More nutrients')!.click();
    await fixture.whenStable();
    const vitaminD = dialog.querySelector<HTMLInputElement>('input[data-micro-input="vitaminD"]')!;
    expect(vitaminD.value).toBe('25000');
    typeInto(vitaminD, '5000 IU');
    await fixture.whenStable();
    buttonWith(dialog, 'Fewer nutrients')!.click();
    await fixture.whenStable();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await fixture.whenStable();
    expect(api.updateMyFood).not.toHaveBeenCalled();
    expect(dialog.textContent).toContain(
      'Vitamin D per 100 g must be a number from 0 to 100,000,000 µg, or blank.',
    );
    const field = dialog.querySelector<HTMLInputElement>('input[data-micro-input="vitaminD"]');
    expect(field?.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps a typed name that was not added before saving', async () => {
    const { fixture, el } = await render();
    buttonWith(el.querySelector('ul[aria-label="Saved foods"]')!, 'Heinz tomato ketchup')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="Another name for it"]')!,
      'Red sauce',
    );
    await fixture.whenStable();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(api.updateMyFood.mock.calls[0]![1]).toMatchObject({
      aliases: ['Tomato ketchup', 'Red sauce'],
    });
    expect(api.updateMyFood.mock.calls[0]![1]).not.toHaveProperty('applyToPast');
  });

  it('deletes a food after confirming that past logs keep their values', async () => {
    const { fixture, el } = await render();
    buttonWith(el.querySelector('ul[aria-label="Saved foods"]')!, 'Table salt')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>(
      'dialog[open] button[aria-label="Delete Table salt"]',
    )!.click();
    await flush();
    await fixture.whenStable();
    expect(confirm.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Delete “Table salt” from My foods?',
        message: 'Past logs keep their values.',
        tone: 'danger',
      }),
    );
    expect(api.deleteMyFood).toHaveBeenCalledWith('food-salt');
    expect(rows(el).some((row) => row.includes('Table salt'))).toBe(false);
    expect(toasts()).toContain('Deleted “Table salt”. Past logs keep their values.');
  });

  it('keeps the food when deleting is cancelled', async () => {
    confirm.confirm.mockResolvedValue(false);
    const { fixture, el } = await render();
    buttonWith(el.querySelector('ul[aria-label="Saved foods"]')!, 'Table salt')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>(
      'dialog[open] button[aria-label="Delete Table salt"]',
    )!.click();
    await flush();
    expect(api.deleteMyFood).not.toHaveBeenCalled();
  });

  it('adds a manual food', async () => {
    const { fixture, el } = await render();
    buttonWith(el.querySelector('header')!, 'Add food')!.click();
    await fixture.whenStable();
    const dialog = el.querySelector('dialog[open]')!;
    expect(dialog.textContent).toContain('Add a food');
    const form = dialog.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Give this food a name.');
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[placeholder="e.g. Tomato ketchup"]')!,
      'Labneh',
    );
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[aria-label="Energy per 100 g (kcal)"]')!,
      '160',
    );
    typeInto(dialog.querySelector<HTMLInputElement>('input[aria-label="Unit name"]')!, 'tbsp');
    typeInto(
      dialog.querySelector<HTMLInputElement>('input[aria-label="Grams in one unit"]')!,
      '20',
    );
    await fixture.whenStable();
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await fixture.whenStable();
    expect(api.createMyFood).toHaveBeenCalledWith({
      name: 'Labneh',
      brand: null,
      aliases: [],
      basisUnit: 'g',
      per100: per100({ calories: 160 }),
      unitName: 'tbsp',
      unitGrams: 20,
      source: 'manual',
    });
    expect(toasts()).toContain('Added “Labneh” to My foods');
    expect(rows(el).some((row) => row.includes('Labneh'))).toBe(true);
  });

  it('explains how foods get saved when there are none', async () => {
    api.listMyFoods.mockResolvedValue([]);
    api.foodMergeSuggestions.mockResolvedValue({ suggestions: [] });
    const { el } = await render();
    expect(el.textContent).toContain('No saved foods yet');
    expect(el.querySelector('#my-foods-search')).toBeNull();
  });

  it('offers a retry when the list fails to load', async () => {
    api.listMyFoods.mockRejectedValueOnce(new Error('offline'));
    const { fixture, el } = await render();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not load your saved foods.',
    );
    buttonWith(el, 'Try again')!.click();
    await flush();
    await fixture.whenStable();
    expect(rows(el)).toHaveLength(4);
  });
});
