import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients, type MealType, type Portion } from '@food/shared';
import { todayLocalDate } from '../../core/time';
import { createDraftItem, type DraftItem } from '../../shared/ui/items-editor/items-math';
import { EntryForm } from './entry-form';

@Component({
  imports: [EntryForm],
  template: `
    <app-entry-form
      [(name)]="name"
      [(mealType)]="mealType"
      [(dateTime)]="dateTime"
      [(items)]="items"
      [(portion)]="portion"
      [thumbUrl]="thumb()"
      [autoMealType]="auto()"
      [portionBaseline]="baseline()"
      [photoTime]="photoTime()"
      [showErrors]="showErrors()"
      (mealTypePicked)="picked.set($event)"
      (photoOpen)="photoOpened.set(true)"
    >
      <p entryFormBeforeItems id="before">Before items</p>
      <p id="after">After items</p>
    </app-entry-form>
  `,
})
class Host {
  readonly name = signal('Oats');
  readonly mealType = signal<MealType>('breakfast');
  readonly dateTime = signal('2026-09-28T08:00');
  readonly items = signal<DraftItem[]>([
    createDraftItem({
      name: 'Oats',
      grams: 60,
      nutrients: { ...zeroNutrients(), calories: 228, protein: 8 },
    }),
  ]);
  readonly portion = signal<Portion | null>(null);
  readonly thumb = signal<string | null>('/api/photos/p/thumb');
  readonly auto = signal(true);
  readonly baseline = signal(0);
  readonly photoTime = signal<string | null>(null);
  readonly showErrors = signal(false);
  readonly picked = signal<MealType | null>(null);
  readonly photoOpened = signal(false);
}

function setInput(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function namedItem(name: string, calories = 100): DraftItem {
  return createDraftItem({ name, grams: 100, nutrients: { ...zeroNutrients(), calories } });
}

describe('EntryForm', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  async function setup(configure?: (host: Host) => void) {
    const fixture = TestBed.createComponent(Host);
    configure?.(fixture.componentInstance);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  const mealNameInput = (el: HTMLElement): HTMLInputElement =>
    el.querySelector<HTMLInputElement>('input[type="text"]')!;

  async function typeMealName(
    fixture: { whenStable(): Promise<unknown> },
    el: HTMLElement,
    value: string,
  ) {
    setInput(mealNameInput(el), value);
    await fixture.whenStable();
  }

  async function renameItemInEditor(
    fixture: { whenStable(): Promise<unknown> },
    el: HTMLElement,
    value: string,
  ): Promise<void> {
    el.querySelector<HTMLButtonElement>('button[data-item-row]')?.click();
    await fixture.whenStable();
    setInput(el.querySelector<HTMLInputElement>('input[data-item-name]')!, value);
    await fixture.whenStable();
  }

  it('passes the save attempt on to the item names', async () => {
    const { fixture, host, el } = await setup((h) => {
      h.items.set([namedItem('Oats'), createDraftItem()]);
    });
    const empty = (): HTMLInputElement =>
      Array.from(el.querySelectorAll<HTMLInputElement>('input[data-item-name]')).find(
        (input) => input.value === '',
      )!;
    expect(empty().hasAttribute('aria-invalid')).toBe(false);
    host.showErrors.set(true);
    await fixture.whenStable();
    expect(empty().getAttribute('aria-invalid')).toBe('true');
  });

  describe('single-item name sync', () => {
    it('renames the only item along with the meal, even when it started with its own name', async () => {
      const { fixture, host, el } = await setup((h) => {
        h.name.set('Salmon plate');
        h.items.set([namedItem('Salmon', 290)]);
      });
      await typeMealName(fixture, el, 'Salmon & greens');
      expect(host.name()).toBe('Salmon & greens');
      expect(host.items()[0]?.name).toBe('Salmon & greens');
      expect(host.items()[0]?.nutrients.calories).toBe(290);

      await typeMealName(fixture, el, '  Salmon bowl  ');
      expect(host.items()[0]?.name).toBe('Salmon bowl');
    });

    it('keeps the last name on the item while the meal name is cleared and retyped', async () => {
      const { fixture, host, el } = await setup();
      await typeMealName(fixture, el, '');
      expect(host.items()[0]?.name).toBe('Oats');
      await typeMealName(fixture, el, 'Porridge');
      expect(host.items()[0]?.name).toBe('Porridge');
    });

    it('stops following once the user renamed the item to something else', async () => {
      const { fixture, host, el } = await setup();
      await renameItemInEditor(fixture, el, 'Rolled oats');
      await typeMealName(fixture, el, 'Breakfast bowl');
      expect(host.items()[0]?.name).toBe('Rolled oats');

      await renameItemInEditor(fixture, el, 'Breakfast bowl');
      await typeMealName(fixture, el, 'Breakfast bowl XL');
      expect(host.items()[0]?.name).toBe('Breakfast bowl');
    });

    it('keeps following when the user edited the item to match the meal name', async () => {
      const { fixture, host, el } = await setup((h) => {
        h.name.set('Latte');
        h.items.set([namedItem('Coffee')]);
      });
      await renameItemInEditor(fixture, el, 'latte');
      await typeMealName(fixture, el, 'Oat latte');
      expect(host.items()[0]?.name).toBe('Oat latte');
    });

    it('leaves meals with several items alone', async () => {
      const { fixture, host, el } = await setup((h) => {
        h.name.set('Rice & chicken');
        h.items.set([namedItem('Rice'), namedItem('Chicken')]);
      });
      await typeMealName(fixture, el, 'Chicken rice bowl');
      expect(host.items().map((item) => item.name)).toEqual(['Rice', 'Chicken']);
    });

    it('fills a blank item from the meal name and keeps its editor open', async () => {
      const { fixture, host, el } = await setup((h) => {
        h.name.set('');
        h.items.set([createDraftItem()]);
      });
      expect(el.querySelector('input[data-item-name]')).not.toBeNull();
      await typeMealName(fixture, el, 'Toast');
      expect(host.items()[0]?.name).toBe('Toast');
      expect(el.querySelector<HTMLInputElement>('input[data-item-name]')?.value).toBe('Toast');
      expect(el.querySelector('button[data-item-row]')).toBeNull();
    });

    it('starts following again for a new baseline', async () => {
      const { fixture, host, el } = await setup();
      await renameItemInEditor(fixture, el, 'Rolled oats');
      await typeMealName(fixture, el, 'Oats again');
      expect(host.items()[0]?.name).toBe('Rolled oats');

      host.baseline.set(1);
      await fixture.whenStable();
      await typeMealName(fixture, el, 'Muesli');
      expect(host.items()[0]?.name).toBe('Muesli');
    });

    it('follows a single item that is left after removing the others', async () => {
      const { fixture, host, el } = await setup((h) => {
        h.name.set('Yogurt & granola');
        h.items.set([namedItem('Yogurt'), namedItem('Granola')]);
      });
      host.items.update((items) => items.slice(0, 1));
      await fixture.whenStable();
      await typeMealName(fixture, el, 'Greek yogurt');
      expect(host.items()[0]?.name).toBe('Greek yogurt');
    });
  });

  describe('photo time', () => {
    const photoTime = (): string => `${todayLocalDate()}T08:05`;

    it('explains that the time came from the photo and focuses the time field on Change', async () => {
      const { fixture, el } = await setup((h) => {
        h.dateTime.set(photoTime());
        h.photoTime.set(photoTime());
      });
      const note = el.querySelector('app-photo-time-note')!;
      expect(note.textContent?.replace(/\s+/g, ' ')).toContain('Time from photo · 08:05');
      note.querySelector<HTMLButtonElement>('button')!.click();
      await fixture.whenStable();
      expect(document.activeElement).toBe(el.querySelector('input[type="datetime-local"]'));
    });

    it('offers to go back to the photo time after the time was changed', async () => {
      const { fixture, host, el } = await setup((h) => {
        h.dateTime.set(photoTime());
        h.photoTime.set(photoTime());
      });
      Array.from(el.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.trim() === 'Now')!
        .click();
      await fixture.whenStable();
      expect(host.dateTime()).not.toBe(photoTime());
      const restore = el.querySelector<HTMLButtonElement>('app-photo-time-note button')!;
      expect(restore.textContent?.replace(/\s+/g, ' ')).toContain('Use photo time · 08:05');
      restore.click();
      await fixture.whenStable();
      expect(host.dateTime()).toBe(photoTime());
      expect(host.mealType()).toBe('breakfast');
    });

    it('shows nothing without a photo time', async () => {
      const { el } = await setup();
      expect(el.querySelector('app-photo-time-note')).toBeNull();
    });
  });

  it('binds the name, time and items and projects content around the items', async () => {
    const { fixture, host, el } = await setup();
    const name = el.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(name.value).toBe('Oats');
    setInput(name, 'Overnight oats');
    await fixture.whenStable();
    expect(host.name()).toBe('Overnight oats');

    const text = el.textContent ?? '';
    expect(text.indexOf('Before items')).toBeLessThan(text.indexOf('Items'));
    expect(text.indexOf('After items')).toBeGreaterThan(text.indexOf('Total'));
    expect(el.querySelector('button[data-item-row]')?.textContent).toContain('Overnight oats');
    expect(el.querySelector('input[data-item-name]')).toBeNull();
  });

  it('rescales the whole meal from the portion chips and resets them on a new baseline', async () => {
    const { fixture, host, el } = await setup();
    host.items.update((items) => [
      ...items,
      createDraftItem({
        name: 'Milk',
        grams: 200,
        nutrients: { ...zeroNutrients(), calories: 100 },
      }),
    ]);
    await fixture.whenStable();
    const chip = (label: string) =>
      el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    expect(el.textContent).toContain('How much did you eat?');
    expect(chip('All of it').getAttribute('aria-pressed')).toBe('true');

    chip('½ of the estimate').click();
    await fixture.whenStable();
    expect(host.items().map((item) => item.grams)).toEqual([30, 100]);
    expect(host.items()[0].nutrients.calories).toBe(114);
    expect(chip('½ of the estimate').getAttribute('aria-pressed')).toBe('true');
    expect(el.textContent).toContain('½ of the estimate');

    chip('¼ of the estimate').click();
    await fixture.whenStable();
    expect(host.items().map((item) => item.grams)).toEqual([15, 50]);

    chip('2 times the estimate').click();
    await fixture.whenStable();
    expect(host.items().map((item) => item.grams)).toEqual([120, 400]);

    host.baseline.set(1);
    await fixture.whenStable();
    expect(chip('All of it').getAttribute('aria-pressed')).toBe('true');
  });

  describe('counted portions', () => {
    const BURGERS: Portion = { count: 2, unit: 'burger', unitPlural: 'burgers' };

    function burgerItems(): DraftItem[] {
      return [
        createDraftItem({
          name: 'Black Angus patty',
          grams: 400,
          nutrients: { ...zeroNutrients(), calories: 1000 },
          count: 2,
          unit: 'patty',
          unitPlural: 'patties',
        }),
        createDraftItem({
          name: 'Brioche bun',
          grams: 380,
          nutrients: { ...zeroNutrients(), calories: 450 },
        }),
      ];
    }

    async function setupBurgers(portion: Portion | null = BURGERS) {
      const setup_ = await setup((host) => {
        host.items.set(burgerItems());
        host.portion.set(portion);
        host.baseline.set(1);
      });
      const button = (label: string) =>
        setup_.el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      return { ...setup_, button };
    }

    it('rescales every item and its count from count chips instead of multipliers', async () => {
      const { fixture, host, el, button } = await setupBurgers();
      expect(el.textContent).toContain('How much did you eat?');
      expect(el.textContent).toContain('Burgers');
      expect(button('All of it')).toBeNull();
      const chips = Array.from(el.querySelectorAll('app-meal-portion [aria-pressed]')).map((chip) =>
        chip.getAttribute('aria-label'),
      );
      expect(chips).toEqual(['½ burger', '1 burger', '1½ burgers', '2 burgers', '3 burgers']);
      expect(button('2 burgers')?.getAttribute('aria-pressed')).toBe('true');

      button('1½ burgers')!.click();
      await fixture.whenStable();
      expect(host.portion()).toEqual({ ...BURGERS, count: 1.5 });
      expect(host.items().map((item) => item.grams)).toEqual([300, 285]);
      expect(host.items().map((item) => item.count)).toEqual([1.5, null]);
      expect(host.items()[1].nutrients.calories).toBe(338);
      expect(el.textContent).toContain('Was 2 burgers');

      button('½ burger')!.click();
      await fixture.whenStable();
      button('2 burgers')!.click();
      await fixture.whenStable();
      expect(host.items().map((item) => item.grams)).toEqual([400, 380]);
      expect(host.items()[0].count).toBe(2);
      expect(el.textContent).not.toContain('Was 2 burgers');
    });

    it('steps the count by halves and accepts a typed count', async () => {
      const { fixture, host, el, button } = await setupBurgers();
      button('Fewer burgers')!.click();
      await fixture.whenStable();
      expect(host.portion()?.count).toBe(1.5);
      button('More burgers')!.click();
      await fixture.whenStable();
      button('More burgers')!.click();
      await fixture.whenStable();
      expect(host.portion()?.count).toBe(2.5);

      const input = el.querySelector<HTMLInputElement>('input[aria-label="How many burgers"]')!;
      input.value = '3';
      input.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(host.portion()?.count).toBe(3);
      expect(host.items().map((item) => item.grams)).toEqual([600, 570]);

      input.value = 'lots';
      input.dispatchEvent(new Event('change'));
      await fixture.whenStable();
      expect(host.portion()?.count).toBe(3);
      expect(input.value).toBe('3');
    });

    it('includes the counted amount among the chips', async () => {
      const { el } = await setupBurgers({ ...BURGERS, count: 4 });
      const chips = Array.from(el.querySelectorAll('app-meal-portion [aria-pressed]')).map((chip) =>
        chip.textContent?.trim(),
      );
      expect(chips).toEqual(['½', '1', '1½', '2', '3', '4']);
    });

    it('renames the unit inline without touching the amounts', async () => {
      const { fixture, host, el, button } = await setupBurgers();
      button('Change unit, burgers')!.click();
      await fixture.whenStable();
      const unit = el.querySelector<HTMLInputElement>('app-meal-portion input[aria-label="Unit"]')!;
      unit.value = 'sliders';
      Array.from(el.querySelectorAll<HTMLButtonElement>('app-meal-portion button'))
        .find((b) => b.textContent?.trim() === 'Done')!
        .click();
      await fixture.whenStable();
      expect(host.portion()).toEqual({ count: 2, unit: 'slider', unitPlural: 'sliders' });
      expect(host.items().map((item) => item.grams)).toEqual([400, 380]);
      expect(button('1 slider')).not.toBeNull();
    });

    it('removes the portion and falls back to multipliers', async () => {
      const { fixture, host, button } = await setupBurgers();
      button('Change unit, burgers')!.click();
      await fixture.whenStable();
      button('Remove the portion')!.click();
      await fixture.whenStable();
      expect(host.portion()).toBeNull();
      expect(button('All of it')?.getAttribute('aria-pressed')).toBe('true');
    });

    it('adds a portion to a meal that has none, then counts from it', async () => {
      const { fixture, host, el, button } = await setupBurgers(null);
      button('½ of the estimate')!.click();
      await fixture.whenStable();
      expect(host.items().map((item) => item.grams)).toEqual([200, 190]);

      Array.from(el.querySelectorAll<HTMLButtonElement>('app-meal-portion button'))
        .find((b) => b.textContent?.includes('Add portion'))!
        .click();
      await fixture.whenStable();
      const form = el.querySelector<HTMLFormElement>('form[aria-label="Add a portion"]')!;
      expect(form.textContent).toContain('This meal is');
      const [count, unit] = Array.from(form.querySelectorAll<HTMLInputElement>('input'));
      setInput(count!, '1');
      setInput(unit!, 'burger');
      await fixture.whenStable();
      form.dispatchEvent(new Event('submit'));
      await fixture.whenStable();
      expect(host.portion()).toEqual({ count: 1, unit: 'burger', unitPlural: 'burgers' });

      button('2 burgers')!.click();
      await fixture.whenStable();
      expect(host.items().map((item) => item.grams)).toEqual([400, 380]);
      expect(host.items()[0].count).toBe(2);
    });
  });

  it('hides the portion chips while there is nothing to scale', async () => {
    const { fixture, host, el } = await setup();
    host.items.set([createDraftItem()]);
    await fixture.whenStable();
    expect(el.textContent).not.toContain('How much did you eat?');
  });

  it('re-guesses the meal type from a new time until the user picks one', async () => {
    const { fixture, host, el } = await setup();
    const time = el.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    setInput(time, '2026-09-28T19:30');
    await fixture.whenStable();
    expect(host.dateTime()).toBe('2026-09-28T19:30');
    expect(host.mealType()).toBe('dinner');

    const snack = Array.from(el.querySelectorAll<HTMLButtonElement>('button[role="radio"]')).find(
      (button) => button.textContent?.includes('Snack'),
    )!;
    snack.click();
    await fixture.whenStable();
    expect(host.mealType()).toBe('snack');
    expect(host.picked()).toBe('snack');
    expect(snack.getAttribute('aria-checked')).toBe('true');

    host.auto.set(false);
    await fixture.whenStable();
    setInput(time, '2026-09-28T12:00');
    await fixture.whenStable();
    expect(host.mealType()).toBe('snack');
  });

  it('flags an invalid time and opens the photo from the thumbnail', async () => {
    const { fixture, host, el } = await setup();
    const time = el.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    setInput(time, '');
    await fixture.whenStable();
    expect(time.getAttribute('aria-invalid')).toBe('true');
    expect(el.textContent).toContain('Choose a valid date and time.');

    el.querySelector<HTMLButtonElement>('button[aria-label="View photo"]')!.click();
    expect(host.photoOpened()).toBe(true);

    host.thumb.set(null);
    await fixture.whenStable();
    expect(el.querySelector('button[aria-label="View photo"]')).toBeNull();
  });
});
