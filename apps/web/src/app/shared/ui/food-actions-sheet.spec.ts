import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients, type FoodSearchResult } from '@food/shared';
import { installDialogShim } from '../testing/dialog-shim';
import { ConfirmService } from './confirm.service';
import { DISCARD_CHANGES_TITLE } from './discard-guard';
import { FoodActionsSheet, type FoodActionsSelection } from './food-actions-sheet';

function food(overrides: Partial<FoodSearchResult> & { key: string }): FoodSearchResult {
  return {
    portion: null,
    kind: 'meal',
    name: 'Lentil soup',
    detail: null,
    items: [],
    totals: { ...zeroNutrients(), calories: 320 },
    grams: 350,
    mealType: 'dinner',
    photo: null,
    favoriteId: null,
    entryId: 'entry-1',
    productId: null,
    useCount: 4,
    lastUsedAt: null,
    starred: false,
    ...overrides,
  };
}

const MEAL = food({ key: 'meal:entry-1' });
const FOOD = food({ key: 'food:item-9', kind: 'food', name: 'Yogurt', detail: 'Breakfast plate' });
const PRODUCT = food({
  key: 'product:p1',
  kind: 'product',
  name: 'Khoury Yaourt fraise',
  detail: 'Khoury',
  productId: 'p1',
});

@Component({
  imports: [FoodActionsSheet],
  template: `
    <button type="button" id="opener">Opener</button>
    <app-food-actions-sheet
      [selection]="selection()"
      [(open)]="open"
      [busy]="busy()"
      [rename]="rename"
      (adjust)="events.set([...events(), 'adjust:' + $event.key])"
      (hide)="events.set([...events(), 'hide:' + $event.key])"
      (editProduct)="events.set([...events(), 'edit:' + $event.key])"
      (deleteProduct)="events.set([...events(), 'delete:' + $event.key])"
    />
  `,
})
class Host {
  readonly selection = signal<FoodActionsSelection | null>({ id: 1, result: MEAL });
  readonly open = signal(true);
  readonly busy = signal(false);
  readonly events = signal<string[]>([]);
  readonly renames: [string, string][] = [];
  renameResult = Promise.resolve(true);
  readonly rename = (result: FoodSearchResult, to: string): Promise<boolean> => {
    this.renames.push([result.name, to]);
    return this.renameResult;
  };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function buttonWith(el: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
    button.textContent?.replace(/\s+/g, ' ').includes(text),
  );
}

function actionLabels(el: HTMLElement): string[] {
  const group = el.querySelector('[role="group"]');
  return Array.from(group?.querySelectorAll('button') ?? []).map(
    (button) => button.querySelector('span.font-semibold')?.textContent?.trim() ?? '',
  );
}

describe('FoodActionsSheet', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    restoreDialog = installDialogShim();
  });

  afterEach(() => restoreDialog());

  async function setup(selection: FoodActionsSelection = { id: 1, result: MEAL }) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.selection.set(selection);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const type = async (value: string) => {
      const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
      input.value = value;
      input.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };
    return { fixture, host: fixture.componentInstance, el, type };
  }

  it('lists adjusting first and removal last, with a summary of the food', async () => {
    const { el } = await setup();
    expect(el.querySelector('h2')?.textContent).toContain('Lentil soup');
    expect(el.textContent).toContain('320 kcal · logged 4 times');
    expect(actionLabels(el)).toEqual(['Adjust amount & log', 'Rename…', 'Remove from suggestions']);
    expect(el.textContent).toContain('Bring it back from Settings');
  });

  it('offers no rename for a food that only exists inside bigger meals', async () => {
    const { el } = await setup({ id: 2, result: FOOD });
    expect(actionLabels(el)).toEqual(['Adjust amount & log', 'Remove from suggestions']);
    expect(el.textContent).toContain('from Breakfast plate');
  });

  it('offers editing and deleting a saved product instead of rename and hide', async () => {
    const { fixture, host, el } = await setup({ id: 3, result: PRODUCT });
    expect(actionLabels(el)).toEqual(['Adjust amount & log', 'Edit product…', 'Delete product']);
    expect(el.textContent).toContain('Khoury · 350 g · 320 kcal');

    buttonWith(el, 'Edit product…')!.click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);

    host.open.set(true);
    await fixture.whenStable();
    buttonWith(el, 'Delete product')!.click();
    await fixture.whenStable();
    expect(host.events()).toEqual(['edit:product:p1', 'delete:product:p1']);
  });

  it('closes and hands the chosen food to adjust or hide', async () => {
    const { fixture, host, el } = await setup();
    buttonWith(el, 'Adjust amount & log')!.click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);

    host.open.set(true);
    await fixture.whenStable();
    buttonWith(el, 'Remove from suggestions')!.click();
    await fixture.whenStable();
    expect(host.open()).toBe(false);
    expect(host.events()).toEqual(['adjust:meal:entry-1', 'hide:meal:entry-1']);
  });

  it('ignores the click that ends the long press which opened it', async () => {
    const { fixture, host, el } = await setup();
    const adjust = buttonWith(el, 'Adjust amount & log')!;
    adjust.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await fixture.whenStable();
    expect(host.events()).toEqual([]);
    expect(host.open()).toBe(true);

    adjust.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    adjust.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await fixture.whenStable();
    expect(host.events()).toEqual(['adjust:meal:entry-1']);
  });

  it('disables the actions while another library action is running', async () => {
    const { fixture, host, el } = await setup();
    host.busy.set(true);
    await fixture.whenStable();
    expect(buttonWith(el, 'Adjust amount & log')!.disabled).toBe(true);
    expect(buttonWith(el, 'Remove from suggestions')!.disabled).toBe(true);
  });

  it('focuses the name and selects all of it when rename opens, even after the dialog focused Close', async () => {
    const proto = HTMLDialogElement.prototype;
    const shimmed = Object.getOwnPropertyDescriptor(proto, 'showModal')!;
    Object.defineProperty(proto, 'showModal', {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '');
        this.querySelector<HTMLButtonElement>('button')?.focus();
      },
    });
    try {
      const { fixture, el } = await setup();
      expect(document.activeElement?.getAttribute('aria-label')).toBe('Close');

      buttonWith(el, 'Rename…')!.click();
      await fixture.whenStable();
      const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
      expect(input.value).toBe('Lentil soup');
      expect(document.activeElement).toBe(input);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe('Lentil soup'.length);
      expect(el.textContent).toContain('Changes the name of all 4 entries called “Lentil soup”.');
    } finally {
      Object.defineProperty(proto, 'showModal', shimmed);
    }
  });

  it('starts over on the action list and reselects the new name for every new selection', async () => {
    const { fixture, host, el } = await setup();
    buttonWith(el, 'Rename…')!.click();
    await fixture.whenStable();
    expect(buttonWith(el, 'Save name')).toBeDefined();

    host.open.set(false);
    host.selection.set({ id: 2, result: food({ key: 'meal:entry-2', name: 'Oat milk' }) });
    host.open.set(true);
    await fixture.whenStable();
    expect(buttonWith(el, 'Save name')).toBeUndefined();

    buttonWith(el, 'Rename…')!.click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('Oat milk');
    expect(input.selectionEnd).toBe('Oat milk'.length);
  });

  it('only saves a changed, non-empty name, cleaned up, and closes once it is renamed', async () => {
    const { fixture, host, el, type } = await setup();
    buttonWith(el, 'Rename…')!.click();
    await fixture.whenStable();
    const save = buttonWith(el, 'Save name')!;
    expect(save.disabled).toBe(true);

    await type('   ');
    expect(save.disabled).toBe(true);
    await type('  Red   lentil soup ');
    expect(save.disabled).toBe(false);
    save.click();
    await flush();
    await fixture.whenStable();

    expect(host.renames).toEqual([['Lentil soup', 'Red lentil soup']]);
    expect(host.open()).toBe(false);
  });

  it('stays open on the typed name, without reselecting it, when renaming fails', async () => {
    const { fixture, host, el, type } = await setup();
    host.renameResult = Promise.resolve(false);
    buttonWith(el, 'Rename…')!.click();
    await fixture.whenStable();
    await type('Red lentil soup');
    const input = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    input.setSelectionRange(3, 3);
    buttonWith(el, 'Save name')!.click();
    await flush();
    await fixture.whenStable();

    expect(host.open()).toBe(true);
    expect(input.value).toBe('Red lentil soup');
    expect(input.selectionStart).toBe(3);
    expect(input.selectionEnd).toBe(3);
    expect(buttonWith(el, 'Save name')!.disabled).toBe(false);
  });

  it('asks before throwing away a typed name', async () => {
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'confirm').mockResolvedValue(false);
    const { fixture, host, el, type } = await setup();
    buttonWith(el, 'Rename…')!.click();
    await fixture.whenStable();
    await type('Red lentil soup');
    el.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    await flush();
    await fixture.whenStable();

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: DISCARD_CHANGES_TITLE }));
    expect(host.open()).toBe(true);
  });

  it('goes back to the actions from the rename view', async () => {
    const { fixture, el } = await setup();
    buttonWith(el, 'Rename…')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="Back to actions"]')!.click();
    await fixture.whenStable();
    expect(actionLabels(el)).toEqual(['Adjust amount & log', 'Rename…', 'Remove from suggestions']);
  });
});
