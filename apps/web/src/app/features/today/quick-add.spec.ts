import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { FoodSearchResult } from '@food/shared';
import { KEYBOARD_PRIMER_ATTRIBUTE } from '../../core/keyboard-primer';
import { ICONS } from '../../shared/ui/icon';
import { QUICK_ADD_LONG_PRESS_MS, QuickAdd } from './quick-add';
import { makeFood } from './today-fixtures';

@Component({
  imports: [QuickAdd],
  template: `
    <app-quick-add
      [foods]="foods()"
      (log)="logged.set([...logged(), $event.key])"
      (adjust)="adjusted.set([...adjusted(), $event.key])"
      (options)="opened.set([...opened(), $event.key])"
      (scanBarcode)="scanBarcode.set(scanBarcode() + 1)"
      (scanLabel)="scanLabel.set(scanLabel() + 1)"
      (describe)="describe.set(describe() + 1)"
    />
  `,
})
class Host {
  readonly foods = signal<readonly FoodSearchResult[]>([]);
  readonly scanBarcode = signal(0);
  readonly scanLabel = signal(0);
  readonly describe = signal(0);
  readonly logged = signal<string[]>([]);
  readonly adjusted = signal<string[]>([]);
  readonly opened = signal<string[]>([]);
}

describe('QuickAdd', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
  });

  async function render(foods: readonly FoodSearchResult[] = []) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.foods.set(foods);
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  function actions(el: HTMLElement): HTMLElement[] {
    const group = el.querySelector('[role="group"][aria-label="More ways to log"]');
    return Array.from(group?.querySelectorAll<HTMLElement>('a, button') ?? []);
  }

  function iconPaths(root: Element | null): string[] {
    const icon = root?.querySelector('app-icon');
    return Array.from(icon?.querySelectorAll('path') ?? []).map((path) => path.getAttribute('d')!);
  }

  function chipIconSlot(el: HTMLElement, name: string): HTMLElement | null {
    const chip = el.querySelector<HTMLButtonElement>(`button[aria-label^="Log ${name}"]`);
    return chip?.querySelector<HTMLElement>('span.rounded-full') ?? null;
  }

  it('shows how many were eaten on a chip when the food was counted', async () => {
    const { el } = await render([
      makeFood({
        key: 'meal:burgers',
        name: 'Black Angus burgers',
        totals: { ...makeFood({ key: 'x' }).totals, calories: 1450 },
        portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
      }),
      makeFood({ key: 'meal:soup', name: 'Lentil soup' }),
    ]);
    const burgers = el.querySelector<HTMLButtonElement>('button[aria-label^="Log Black Angus"]')!;
    expect(burgers.textContent?.replace(/\s+/g, ' ')).toContain('2 burgers · 1,450 kcal');
    expect(burgers.getAttribute('aria-label')).toBe(
      'Log Black Angus burgers, 2 burgers, 1,450 kcal',
    );
    const soup = el.querySelector<HTMLButtonElement>('button[aria-label^="Log Lentil soup"]')!;
    expect(soup.getAttribute('aria-label')).toBe('Log Lentil soup, 120 kcal');
  });

  it('offers barcode scanning next to label scanning and describing', async () => {
    const { fixture, host, el } = await render();
    const [barcode, label, describe] = actions(el);
    expect(actions(el).map((action) => action.textContent?.trim())).toEqual([
      'Scan barcode',
      'Scan label',
      'Describe',
    ]);
    expect(barcode.tagName).toBe('BUTTON');
    expect(iconPaths(barcode)).toEqual(ICONS.barcode.paths);
    expect(iconPaths(label)).toEqual(ICONS.label.paths);

    barcode.click();
    label.click();
    describe.click();
    await fixture.whenStable();
    expect(host.scanBarcode()).toBe(1);
    expect(host.scanLabel()).toBe(1);
    expect(host.describe()).toBe(1);
  });

  it('opens the keyboard from the Search tap so the search field can take focus', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const { el } = await render();
    const search = el.querySelector<HTMLAnchorElement>(
      'a[aria-label="Search everything you have logged"]',
    )!;

    search.click();

    expect(document.activeElement?.hasAttribute(KEYBOARD_PRIMER_ATTRIBUTE)).toBe(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]?.[0])).toBe('/log?search=1');
  });

  it('keeps every action at least 44 px tall and lets long labels wrap', async () => {
    const { el } = await render();
    for (const action of actions(el)) {
      expect(action.className).toContain('min-h-[4.5rem]');
      expect(action.className).toContain('whitespace-normal');
    }
  });

  it('marks each kind with the same icon and tone as the food search', async () => {
    const { el } = await render([
      makeFood({ key: 'product:1', kind: 'product', name: 'Labneh', productId: '1' }),
      makeFood({ key: 'food:1', kind: 'food', name: 'Banana' }),
      makeFood({ key: 'meal:1', kind: 'meal', name: 'Porridge' }),
      makeFood({ key: 'favorite:1', kind: 'favorite', name: 'Shake', starred: true }),
    ]);
    const product = chipIconSlot(el, 'Labneh');
    expect(product?.className).toContain('text-fat');
    expect(product?.className).toContain('size-8');
    expect(iconPaths(product)).toEqual(ICONS.barcode.paths);
    const food = chipIconSlot(el, 'Banana');
    expect(food?.className).toContain('text-accent');
    expect(food?.textContent?.trim()).toBe('B');
    expect(iconPaths(chipIconSlot(el, 'Porridge'))).toEqual(ICONS.utensils.paths);
    expect(chipIconSlot(el, 'Porridge')?.className).toContain('text-brand');
    expect(iconPaths(chipIconSlot(el, 'Shake'))).toEqual(ICONS['star-filled'].paths);
    expect(chipIconSlot(el, 'Shake')?.className).toContain('text-warn');
  });

  it('links to Favorites and tells screen readers what a long press offers', async () => {
    const { el } = await render([
      makeFood({ key: 'meal:1', kind: 'meal', name: 'Porridge' }),
      makeFood({ key: 'product:1', kind: 'product', name: 'Labneh', productId: '1' }),
      makeFood({ key: 'favorite:1', kind: 'favorite', name: 'Shake', starred: true }),
    ]);
    const link = el.querySelector<HTMLAnchorElement>('a[href="/favorites"]');
    expect(link?.textContent?.trim()).toBe('Favorites');
    const hint = (name: string) => {
      const chip = el.querySelector(`button[aria-label^="Log ${name}"]`);
      const id = chip?.getAttribute('aria-describedby') ?? '';
      return el.querySelector(`[id="${id}"]`)?.textContent?.trim();
    };
    expect(hint('Porridge')).toContain('rename, or remove from suggestions');
    expect(hint('Labneh')).toContain('edit or delete the product');
    expect(hint('Shake')).toBe('Long-press to adjust the amount before logging.');
  });

  describe('more options', () => {
    const library = [
      makeFood({ key: 'meal:1', kind: 'meal', name: 'Porridge' }),
      makeFood({ key: 'food:1', kind: 'food', name: 'Banana' }),
      makeFood({ key: 'favorite:1', kind: 'favorite', name: 'Shake', starred: true }),
      makeFood({ key: 'product:1', kind: 'product', name: 'Labneh', productId: '1' }),
    ];

    function moreButton(el: HTMLElement, label: string): HTMLButtonElement {
      const button = el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
      if (!button) {
        throw new Error(`No button labelled "${label}"`);
      }
      return button;
    }

    it('opens the action sheet for meals, foods and products but adjusts starred items', async () => {
      const { fixture, host, el } = await render(library);
      const porridge = moreButton(el, 'More options for Porridge');
      expect(porridge.getAttribute('aria-haspopup')).toBe('dialog');
      porridge.click();
      moreButton(el, 'More options for Banana').click();
      const shake = moreButton(el, 'Adjust Shake before logging');
      expect(shake.hasAttribute('aria-haspopup')).toBe(false);
      shake.click();
      moreButton(el, 'More options for Labneh').click();
      await fixture.whenStable();

      expect(host.opened()).toEqual(['meal:1', 'food:1', 'product:1']);
      expect(host.adjusted()).toEqual(['favorite:1']);
      expect(host.logged()).toEqual([]);
    });

    it('opens the same options on a long press without logging, then logs on the next tap', async () => {
      const { fixture, host, el } = await render(library);
      const chip = el.querySelector<HTMLButtonElement>('button[aria-label^="Log Porridge"]')!;
      const favorite = el.querySelector<HTMLButtonElement>('button[aria-label^="Log Shake"]')!;
      vi.useFakeTimers();
      try {
        chip.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
        vi.advanceTimersByTime(QUICK_ADD_LONG_PRESS_MS - 50);
        expect(host.opened()).toEqual([]);
        vi.advanceTimersByTime(60);
        chip.dispatchEvent(new PointerEvent('pointerup'));
        chip.click();

        favorite.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
        vi.advanceTimersByTime(QUICK_ADD_LONG_PRESS_MS + 10);
        favorite.dispatchEvent(new PointerEvent('pointerup'));
        favorite.click();

        chip.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
        chip.dispatchEvent(new PointerEvent('pointerup'));
        chip.click();
      } finally {
        vi.useRealTimers();
      }
      await fixture.whenStable();

      expect(host.opened()).toEqual(['meal:1']);
      expect(host.adjusted()).toEqual(['favorite:1']);
      expect(host.logged()).toEqual(['meal:1']);
    });

    it('cancels a long press when the finger scrolls the row away', async () => {
      const { fixture, host, el } = await render(library);
      const chip = el.querySelector<HTMLButtonElement>('button[aria-label^="Log Banana"]')!;
      vi.useFakeTimers();
      try {
        chip.dispatchEvent(new PointerEvent('pointerdown', { button: 0 }));
        vi.advanceTimersByTime(100);
        chip.dispatchEvent(new PointerEvent('pointercancel'));
        vi.advanceTimersByTime(QUICK_ADD_LONG_PRESS_MS);
      } finally {
        vi.useRealTimers();
      }
      await fixture.whenStable();
      expect(host.opened()).toEqual([]);
    });
  });
});
