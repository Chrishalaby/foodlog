import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { MealType } from '@food/shared';
import { MealTypePicker } from './meal-type-picker';

@Component({
  imports: [MealTypePicker],
  template: `<span id="meal-label">Meal</span>
    <app-meal-type-picker labelledBy="meal-label" [(value)]="value" />`,
})
class Host {
  readonly value = signal<MealType>('lunch');
}

describe('MealTypePicker', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const radios = () => Array.from(el.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
    return { fixture, host: fixture.componentInstance, el, radios };
  }

  it('shows every meal type in full as a labelled radio group', async () => {
    const { el, radios } = await render();
    const group = el.querySelector('[role="radiogroup"]')!;
    expect(group.getAttribute('aria-labelledby')).toBe('meal-label');
    expect(radios().map((radio) => radio.textContent?.trim())).toEqual([
      'Breakfast',
      'Lunch',
      'Dinner',
      'Snack',
    ]);
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    for (const radio of radios()) {
      expect(radio.className).toContain('min-h-11');
    }
  });

  it('stacks into two columns on narrow screens so no label is cut off', async () => {
    const { el } = await render();
    const host = el.querySelector('app-meal-type-picker')!;
    const group = el.querySelector('[role="radiogroup"]')!;
    expect(host.classList.contains('@container')).toBe(true);
    expect(group.classList.contains('grid-cols-2')).toBe(true);
    expect(group.classList.contains('@min-[19.5rem]:grid-cols-4')).toBe(true);
    expect(group.classList.contains('grid-cols-4')).toBe(false);
  });

  it('selects by tap and moves with the arrow keys', async () => {
    const { fixture, host, radios } = await render();
    radios()[0].click();
    await fixture.whenStable();
    expect(host.value()).toBe('breakfast');

    radios()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await fixture.whenStable();
    expect(host.value()).toBe('snack');

    radios()[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await fixture.whenStable();
    expect(host.value()).toBe('breakfast');
    expect(radios()[0].getAttribute('tabindex')).toBe('0');
    expect(radios()[3].getAttribute('tabindex')).toBe('-1');
  });
});
