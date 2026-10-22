import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients } from '@food/shared';
import { ItemsEditor, UNDO_REMOVE_MS } from './items-editor';
import { createDraftItem, type DraftItem } from './items-math';

@Component({
  imports: [ItemsEditor],
  template: `<app-items-editor [(items)]="items" />`,
})
class Host {
  readonly items = signal<DraftItem[]>([
    createDraftItem({
      name: 'Rice',
      grams: 150,
      nutrients: { ...zeroNutrients(), calories: 195, protein: 4, carbs: 42, fat: 0.4 },
      confidence: 'low',
      hints: {
        amountSource: 'visual_estimate',
        portionBasis: 'About one cup',
        flags: ['hidden_oil'],
      },
    }),
  ]);
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.dispatchEvent(new Event('focus'));
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
});

describe('ItemsEditor', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('renders an editable card per item with hints and totals', async () => {
    const { el } = await setup();
    expect(el.querySelectorAll('section').length).toBe(1);
    const name = el.querySelector<HTMLInputElement>('input[data-item-name]');
    expect(name?.value).toBe('Rice');
    expect(el.textContent).toContain('Low confidence');
    expect(el.textContent).toContain('Visual estimate');
    expect(el.textContent).toContain('About one cup');
    expect(el.textContent).toContain('Hidden oil');
    expect(el.textContent).toContain('Total');
  });

  it('rescales all nutrients when grams change', async () => {
    const { fixture, host, el } = await setup();
    const grams = el.querySelector<HTMLInputElement>('input[aria-label="Grams of Rice"]');
    expect(grams).not.toBeNull();
    typeInto(grams!, '300');
    await fixture.whenStable();
    expect(host.items()[0].grams).toBe(300);
    expect(host.items()[0].nutrients.calories).toBe(390);
    expect(host.items()[0].nutrients.carbs).toBe(84);
  });

  it('updates a nutrient and uses it for later rescales', async () => {
    const { fixture, host, el } = await setup();
    const protein = el.querySelector<HTMLInputElement>('input[aria-label="Protein (g) of Rice"]');
    typeInto(protein!, '6');
    await fixture.whenStable();
    expect(host.items()[0].nutrients.protein).toBe(6);
    const plus = el.querySelector<HTMLButtonElement>('button[aria-label="Increase grams of Rice"]');
    plus!.click();
    await fixture.whenStable();
    expect(host.items()[0].grams).toBe(160);
    expect(host.items()[0].nutrients.protein).toBe(6.4);
  });

  it('keeps long nutrient values readable on narrow phones', async () => {
    const { fixture, host, el } = await setup();
    host.items.set([
      createDraftItem({
        name: 'Tahini',
        grams: 1234.5,
        nutrients: { ...zeroNutrients(), calories: 12345, protein: 1234.5, sodium: 200000 },
      }),
    ]);
    await fixture.whenStable();
    const section = el.querySelector('section')!;
    expect(section.classList.contains('@container')).toBe(true);

    const [macros] = Array.from(el.querySelectorAll<HTMLElement>('[data-nutrient-grid]'));
    expect(macros.classList.contains('grid-cols-2')).toBe(true);
    expect(macros.classList.contains('@min-[18rem]:grid-cols-4')).toBe(true);
    const protein = el.querySelector<HTMLInputElement>(
      'input[aria-label="Protein (g) of Tahini"]',
    )!;
    expect(protein.value).toBe('1234.5');
    expect(protein.className).toContain('px-1');
    expect(protein.className).toContain('tracking-tight');
    expect(protein.className).not.toMatch(/text-(xs|sm|\[)/);

    const amount = Array.from(section.querySelectorAll('span')).find(
      (span) => span.textContent?.trim() === 'Amount',
    )!;
    expect(amount.className).toContain('hidden');
    expect(amount.className).toContain('@min-[18rem]:inline');

    Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('More nutrients'))!
      .click();
    await fixture.whenStable();
    const extras = el.querySelectorAll<HTMLElement>('[data-nutrient-grid]')[1];
    expect(extras.classList.contains('grid-cols-1')).toBe(true);
    expect(extras.classList.contains('@min-[28rem]:grid-cols-2')).toBe(true);
    const sodium = el.querySelector<HTMLInputElement>('input[aria-label="Sodium (mg) of Tahini"]')!;
    expect(sodium.value).toBe('200000');
    expect(sodium.closest('span.w-28')).not.toBeNull();
  });

  it('adds, renames and removes items', async () => {
    const { fixture, host, el } = await setup();
    const add = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Add item'),
    );
    add!.click();
    await fixture.whenStable();
    expect(host.items().length).toBe(2);

    const names = el.querySelectorAll<HTMLInputElement>('input[data-item-name]');
    names[1].value = 'Salad';
    names[1].dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(host.items()[1].name).toBe('Salad');

    el.querySelector<HTMLButtonElement>('button[aria-label="Remove Rice"]')!.click();
    await fixture.whenStable();
    expect(host.items().map((item) => item.name)).toEqual(['Salad']);
  });

  it('only flags an empty new item once the user leaves its name', async () => {
    const { fixture, el } = await setup();
    Array.from(el.querySelectorAll('button'))
      .find((b) => b.textContent?.includes('Add item'))!
      .click();
    await fixture.whenStable();
    const added = el.querySelectorAll<HTMLInputElement>('input[data-item-name]')[1]!;
    expect(added.value).toBe('');
    expect(added.hasAttribute('aria-invalid')).toBe(false);

    added.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(added.getAttribute('aria-invalid')).toBe('true');

    typeInto(added, 'Banana');
    await fixture.whenStable();
    expect(added.hasAttribute('aria-invalid')).toBe(false);
  });
});

@Component({
  imports: [ItemsEditor],
  template: `<app-items-editor [(items)]="items" [showErrors]="showErrors()" />`,
})
class ErrorsHost {
  readonly showErrors = signal(false);
  readonly items = signal<DraftItem[]>([createDraftItem()]);
}

describe('ItemsEditor (counts)', () => {
  function patties(): DraftItem {
    return createDraftItem({
      name: 'Beef patty',
      grams: 300,
      nutrients: { ...zeroNutrients(), calories: 750, protein: 60 },
      count: 2,
      unit: 'patty',
      unitPlural: 'patties',
    });
  }

  async function setup(items: DraftItem[], compact = false) {
    const fixture = TestBed.createComponent(compact ? CompactHost : Host);
    fixture.componentInstance.items.set(items);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const commit = (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('change'));
  };

  it('rescales grams from the per-unit weight when the count changes', async () => {
    const { fixture, host, el } = await setup([patties()]);
    const count = el.querySelector<HTMLInputElement>('input[aria-label="How many of Beef patty"]')!;
    const unit = el.querySelector<HTMLInputElement>('input[aria-label="Unit of Beef patty"]')!;
    expect(count.value).toBe('2');
    expect(unit.value).toBe('patties');

    commit(count, '3');
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ count: 3, grams: 450 });
    expect(host.items()[0].nutrients.calories).toBe(1125);

    el.querySelector<HTMLButtonElement>('button[aria-label="Fewer of Beef patty"]')!.click();
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ count: 2.5, grams: 375 });

    const grams = el.querySelector<HTMLInputElement>('input[aria-label="Grams of Beef patty"]')!;
    typeInto(grams, '400');
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ count: 2.5, grams: 400 });

    commit(count, 'many');
    await fixture.whenStable();
    expect(count.value).toBe('2.5');
    expect(host.items()[0].count).toBe(2.5);
  });

  it('lets a count be added to an item that had none without changing its grams', async () => {
    const { fixture, host, el } = await setup([
      createDraftItem({
        name: 'Falafel',
        grams: 120,
        nutrients: { ...zeroNutrients(), calories: 400 },
      }),
    ]);
    expect(el.querySelector('input[aria-label="How many of Falafel"]')).toBeNull();
    Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Add a count'))!
      .click();
    await fixture.whenStable();
    const count = el.querySelector<HTMLInputElement>('input[aria-label="How many of Falafel"]')!;
    expect(document.activeElement).toBe(count);
    commit(count, '6');
    await fixture.whenStable();
    const unit = el.querySelector<HTMLInputElement>('input[aria-label="Unit of Falafel"]')!;
    commit(unit, 'pieces');
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({
      grams: 120,
      count: 6,
      unit: 'piece',
      unitPlural: 'pieces',
    });

    commit(count, '3');
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ grams: 60, count: 3 });
  });

  it('shows the count next to the grams in compact rows', async () => {
    const { el } = await setup([patties()], true);
    const text = el.querySelector('button[data-item-row]')!.textContent!.replace(/\s+/g, ' ');
    expect(text).toContain('2 patties · 300 g');
  });
});

describe('ItemsEditor (after a save attempt)', () => {
  it('flags every empty name once errors are shown', async () => {
    const fixture = TestBed.createComponent(ErrorsHost);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const name = el.querySelector<HTMLInputElement>('input[data-item-name]')!;
    expect(name.hasAttribute('aria-invalid')).toBe(false);

    fixture.componentInstance.showErrors.set(true);
    await fixture.whenStable();
    expect(name.getAttribute('aria-invalid')).toBe('true');

    typeInto(name, 'Banana');
    await fixture.whenStable();
    expect(name.hasAttribute('aria-invalid')).toBe(false);
  });
});

@Component({
  imports: [ItemsEditor],
  template: `<app-items-editor [(items)]="items" [compact]="true" />`,
})
class CompactHost {
  readonly items = signal<DraftItem[]>([
    createDraftItem({
      name: 'Grilled chicken',
      grams: 150,
      nutrients: { ...zeroNutrients(), calories: 248, protein: 46.5, fat: 5.4 },
      confidence: 'high',
      hints: { amountSource: 'user_stated' },
    }),
    createDraftItem({
      name: 'Olive oil',
      grams: 10,
      nutrients: { ...zeroNutrients(), calories: 88, fat: 10 },
      confidence: 'low',
      hints: { amountSource: 'assumed_hidden' },
    }),
  ]);
}

describe('ItemsEditor (compact)', () => {
  afterEach(() => vi.useRealTimers());

  async function setup() {
    const fixture = TestBed.createComponent(CompactHost);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const row = (el: HTMLElement, name: string): HTMLButtonElement =>
    Array.from(el.querySelectorAll<HTMLButtonElement>('button[data-item-row]')).find((button) =>
      button.textContent?.includes(name),
    )!;

  it('shows one compact row per item with grams, kcal, macros and hints', async () => {
    const { el } = await setup();
    expect(el.querySelectorAll('input[data-item-name]')).toHaveLength(0);
    const chicken = row(el, 'Grilled chicken').textContent!.replace(/\s+/g, ' ');
    expect(chicken).toContain('248');
    expect(chicken).toContain('150 g');
    expect(chicken).toContain('from your description');
    expect(chicken).toContain('46.5');
    expect(chicken).toContain('High confidence');
    const oil = row(el, 'Olive oil');
    expect(oil.textContent).toContain('Added by AI');
    expect(oil.parentElement?.className).toContain('border-warn/40');
  });

  it('expands a row for full editing and collapses it again', async () => {
    const { fixture, host, el } = await setup();
    row(el, 'Grilled chicken').click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLInputElement>('input[data-item-name]')?.value).toBe(
      'Grilled chicken',
    );
    const half = el.querySelector<HTMLButtonElement>('button[aria-label="½×, 75 g"]')!;
    half.click();
    await fixture.whenStable();
    expect(host.items()[0].grams).toBe(75);
    expect(half.getAttribute('aria-pressed')).toBe('true');
    el.querySelector<HTMLButtonElement>('button[aria-label="Collapse Grilled chicken"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('input[data-item-name]')).toBeNull();
    expect(row(el, 'Grilled chicken').textContent).toContain('75 g');
  });

  it('removes an AI-added item in one tap and can undo it', async () => {
    const { fixture, host, el } = await setup();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Olive oil (added by AI)"]',
    )!.click();
    await fixture.whenStable();
    expect(host.items().map((item) => item.name)).toEqual(['Grilled chicken']);
    expect(el.textContent).toContain('Removed Olive oil');
    Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Undo')!
      .click();
    await fixture.whenStable();
    expect(host.items().map((item) => item.name)).toEqual(['Grilled chicken', 'Olive oil']);
    expect(el.textContent).not.toContain('Removed Olive oil');
  });

  it('drops the undo after a few seconds', async () => {
    const { fixture, el } = await setup();
    vi.useFakeTimers();
    el.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Olive oil (added by AI)"]',
    )!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('Removed Olive oil');
    vi.advanceTimersByTime(UNDO_REMOVE_MS);
    fixture.detectChanges();
    expect(el.textContent).not.toContain('Removed Olive oil');
  });

  it('drops the undo when the list is replaced', async () => {
    const { fixture, host, el } = await setup();
    el.querySelector<HTMLButtonElement>('button[data-item-row]')!.click();
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[aria-label="Remove Grilled chicken"]')!.click();
    await fixture.whenStable();
    expect(el.textContent).toContain('Removed Grilled chicken');
    host.items.set([createDraftItem({ name: 'Soup', grams: 300 })]);
    await fixture.whenStable();
    expect(el.textContent).not.toContain('Removed Grilled chicken');
  });

  it('keeps new and unnamed items open for editing', async () => {
    const { fixture, el } = await setup();
    Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Add item'))!
      .click();
    await fixture.whenStable();
    const inputs = el.querySelectorAll<HTMLInputElement>('input[data-item-name]');
    expect(inputs).toHaveLength(1);
    expect(inputs[0].value).toBe('');
    expect(el.querySelector('button[aria-label^="Collapse"]')).toBeNull();
  });

  it('keeps a new item open while its name is typed until the user collapses it', async () => {
    const { fixture, host, el } = await setup();
    Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Add item'))!
      .click();
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('input[data-item-name]')!;
    typeInto(input, 'B');
    await fixture.whenStable();
    typeInto(input, 'Banana');
    await fixture.whenStable();
    expect(el.querySelector('input[data-item-name]')).toBe(input);
    expect(host.items().at(-1)?.name).toBe('Banana');

    el.querySelector<HTMLButtonElement>('button[aria-label="Collapse Banana"]')!.click();
    await fixture.whenStable();
    expect(el.querySelector('input[data-item-name]')).toBeNull();
    expect(row(el, 'Banana')).toBeDefined();
  });

  it('keeps an unnamed seeded item open once the user starts naming it', async () => {
    const { fixture, host, el } = await setup();
    host.items.set([createDraftItem()]);
    await fixture.whenStable();
    const input = el.querySelector<HTMLInputElement>('input[data-item-name]')!;
    typeInto(input, 'Apple');
    await fixture.whenStable();
    expect(el.querySelector('input[data-item-name]')).toBe(input);
  });
});

describe('ItemsEditor (drinks and vitamins)', () => {
  function dietPepsi(): DraftItem {
    return createDraftItem({
      name: 'Diet Pepsi',
      grams: 330,
      nutrients: { ...zeroNutrients(), sodium: 40 },
      micros: { caffeine: 36 },
      fluidMl: 330,
    });
  }

  function soyMilk(): DraftItem {
    return createDraftItem({
      name: 'Soy milk',
      grams: 250,
      nutrients: { ...zeroNutrients(), calories: 100, protein: 8 },
      micros: { calcium: 300 },
    });
  }

  async function setup(items: DraftItem[]) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.items.set(items);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const drinkRow = (el: HTMLElement): HTMLElement | null =>
    el.querySelector<HTMLElement>('[data-item-drink]');
  const drinkSwitch = (el: HTMLElement): HTMLButtonElement | null =>
    el.querySelector<HTMLButtonElement>('[data-item-drink] button[role="switch"]');
  const drinkMl = (el: HTMLElement): HTMLInputElement | null =>
    el.querySelector<HTMLInputElement>(
      'input[aria-label="Millilitres of Diet Pepsi to count as a drink"]',
    );

  it('shows “Counts as a drink: 330 ml” on a drink without opening More nutrients', async () => {
    const { el } = await setup([dietPepsi()]);
    expect(el.querySelector('input[aria-label="Sodium (mg) of Diet Pepsi"]')).toBeNull();
    expect(drinkRow(el)?.textContent?.replace(/\s+/g, ' ')).toContain('Counts as a drink:');
    expect(drinkSwitch(el)?.getAttribute('aria-checked')).toBe('true');
    expect(drinkSwitch(el)?.getAttribute('aria-label')).toBe('Diet Pepsi counts as a drink');
    expect(drinkMl(el)?.value).toBe('330');
    expect(drinkRow(el)?.textContent).toContain('ml');
  });

  it('rescales the drink ml and vitamins when the grams change', async () => {
    const { fixture, host, el } = await setup([dietPepsi()]);
    typeInto(el.querySelector<HTMLInputElement>('input[aria-label="Grams of Diet Pepsi"]')!, '500');
    await fixture.whenStable();
    expect(host.items()[0]).toMatchObject({ grams: 500, fluidMl: 500, micros: { caffeine: 55 } });
    expect(drinkMl(el)?.value).toBe('500');
  });

  it('changes the drink amount by hand and keeps the saved and shown amount in step', async () => {
    const { fixture, host, el } = await setup([dietPepsi()]);
    const ml = drinkMl(el)!;
    typeInto(ml, '250');
    await fixture.whenStable();
    expect(host.items()[0].fluidMl).toBe(250);
    expect(host.items()[0].grams).toBe(330);
    typeInto(ml, '');
    await fixture.whenStable();
    ml.dispatchEvent(new Event('blur'));
    await fixture.whenStable();
    expect(host.items()[0].fluidMl).toBe(1);
    expect(drinkMl(el)?.value).toBe('1');
  });

  it('turns a drink off and back on from the switch', async () => {
    const { fixture, host, el } = await setup([dietPepsi()]);
    drinkSwitch(el)!.click();
    await fixture.whenStable();
    expect(host.items()[0].fluidMl).toBeNull();
    expect(drinkRow(el)).toBeNull();
    Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('More nutrients'))!
      .click();
    await fixture.whenStable();
    expect(drinkSwitch(el)?.getAttribute('aria-checked')).toBe('false');
    expect(drinkMl(el)).toBeNull();
    drinkSwitch(el)!.click();
    await fixture.whenStable();
    expect(host.items()[0].fluidMl).toBe(330);
    expect(drinkMl(el)?.value).toBe('330');
  });

  it('offers the switch for any food under More nutrients and defaults to its grams', async () => {
    const { fixture, host, el } = await setup([soyMilk()]);
    expect(drinkRow(el)).toBeNull();
    Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('More nutrients'))!
      .click();
    await fixture.whenStable();
    const toggle = el.querySelector<HTMLButtonElement>(
      'button[aria-label="Soy milk counts as a drink"]',
    )!;
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    toggle.click();
    await fixture.whenStable();
    expect(host.items()[0].fluidMl).toBe(250);
    Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.includes('Hide details'))!
      .click();
    await fixture.whenStable();
    expect(drinkRow(el)).not.toBeNull();
  });

  it('keeps vitamins when nutrients are edited by hand', async () => {
    const { fixture, host, el } = await setup([soyMilk()]);
    typeInto(
      el.querySelector<HTMLInputElement>('input[aria-label="Protein (g) of Soy milk"]')!,
      '9',
    );
    await fixture.whenStable();
    expect(host.items()[0].nutrients.protein).toBe(9);
    expect(host.items()[0].micros).toEqual({ calcium: 300 });
  });
});
