import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients, type LabelInfo } from '@food/shared';
import { LabelPanel } from './label-panel';

@Component({
  imports: [LabelPanel],
  template: `<app-label-panel
    [label]="label()"
    [amount]="amount()"
    [saveable]="saveable()"
    [savedName]="savedName()"
    (amountChange)="amount.set($event)"
    (saveFood)="saves.set(saves() + 1)"
  />`,
})
class Host {
  readonly saveable = signal(false);
  readonly savedName = signal<string | null>(null);
  readonly saves = signal(0);
  readonly label = signal<LabelInfo>({
    productName: 'Crispbread',
    basisUnit: 'g',
    per100: { ...zeroNutrients(), calories: 350, protein: 10, carbs: 62, fiber: 16 },
    microsPer100: null,
    servingSize: 20,
    servingText: '2 slices',
    packSize: 250,
  });
  readonly amount = signal<number | null>(20);
}

describe('LabelPanel', () => {
  async function setup() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const button = (label: string): HTMLButtonElement =>
      Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find(
        (candidate) =>
          candidate.getAttribute('aria-label') === label || candidate.textContent?.includes(label),
      )!;
    return { fixture, host: fixture.componentInstance, el, button };
  }

  it('shows the per-100 g and per-serving table with serving and pack info', async () => {
    const { el } = await setup();
    expect(el.textContent).toContain('Crispbread');
    expect(el.textContent).toContain('Per 100 g');
    expect(el.textContent).toContain('Serving (20 g)');
    const calories = Array.from(el.querySelectorAll('tbody tr')).find((row) =>
      row.textContent?.includes('Calories'),
    )!;
    expect(calories.textContent).toContain('350 kcal');
    expect(calories.textContent).toContain('70 kcal');
    expect(el.textContent).toContain('Serving: 2 slices');
    expect(el.textContent).toContain('Pack: 250 g');
  });

  it('adds printed vitamins and minerals under the nutrition table when the label has them', async () => {
    const { fixture, host, el } = await setup();
    expect(el.querySelector('[data-micro-rows]')).toBeNull();
    host.label.update((value) => ({ ...value, microsPer100: { iron: 3.6, vitaminD: 2 } }));
    await fixture.whenStable();
    const section = el.querySelector('[data-micro-rows]')!;
    expect(section.querySelector('th[scope="colgroup"]')?.textContent?.trim()).toBe(
      'Vitamins & minerals',
    );
    expect(section.querySelector('th[scope="colgroup"]')?.getAttribute('colspan')).toBe('3');
    const iron = Array.from(section.querySelectorAll('tr')).find((row) =>
      row.textContent?.includes('Iron'),
    )!;
    expect(iron.textContent).toContain('3.6 mg');
    expect(iron.textContent).toContain('0.7 mg');
  });

  it('steps servings by halves and sets the whole pack', async () => {
    const { fixture, host, el, button } = await setup();
    expect(el.querySelector('output')?.textContent?.trim()).toBe('1');

    button('Half a serving more').click();
    await fixture.whenStable();
    expect(host.amount()).toBe(30);
    expect(el.querySelector('output')?.textContent?.trim()).toBe('1.5');

    button('Half a serving less').click();
    await fixture.whenStable();
    button('Half a serving less').click();
    await fixture.whenStable();
    expect(host.amount()).toBe(10);
    expect(button('Half a serving less').disabled).toBe(true);

    button('Whole pack').click();
    await fixture.whenStable();
    expect(host.amount()).toBe(250);
    expect(button('Whole pack').getAttribute('aria-pressed')).toBe('true');
  });

  it('accepts a typed amount', async () => {
    const { fixture, host, el } = await setup();
    const input = el.querySelector<HTMLInputElement>('app-number-input input')!;
    input.dispatchEvent(new Event('focus'));
    input.value = '55';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(host.amount()).toBe(55);
  });

  it('explains when the label item has been removed', async () => {
    const { fixture, host, el } = await setup();
    host.amount.set(null);
    await fixture.whenStable();
    expect(el.textContent).toContain('The label item was removed');
    expect(el.querySelector('output')).toBeNull();
  });

  it('offers to save a label without a barcode to My foods, then confirms it', async () => {
    const { fixture, host, el, button } = await setup();
    expect(el.textContent).not.toContain('Save to My foods');
    host.saveable.set(true);
    await fixture.whenStable();
    button('Save to My foods').click();
    expect(host.saves()).toBe(1);
    host.savedName.set('Crispbread');
    await fixture.whenStable();
    expect(el.textContent).not.toContain('Save to My foods');
    expect(el.textContent?.replace(/\s+/g, ' ')).toContain('In My foods as Crispbread');
  });
});
