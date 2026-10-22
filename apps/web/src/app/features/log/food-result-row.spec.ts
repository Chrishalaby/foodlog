import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients, type FoodSearchResult } from '@food/shared';
import { FoodResultRow } from './food-result-row';

const NOW = new Date(2026, 8, 28, 15, 0);

function result(overrides: Partial<FoodSearchResult> = {}): FoodSearchResult {
  return {
    portion: null,
    key: 'favorite:fav-1',
    kind: 'favorite',
    name: 'Strawberry Yogurt',
    detail: null,
    items: [{ name: 'Strawberry Yogurt', grams: 150, nutrients: zeroNutrients() }],
    totals: { ...zeroNutrients(), calories: 144 },
    grams: 150,
    mealType: 'breakfast',
    photo: null,
    favoriteId: 'fav-1',
    entryId: null,
    productId: null,
    useCount: 0,
    lastUsedAt: null,
    starred: true,
    ...overrides,
  };
}

@Component({
  imports: [FoodResultRow],
  template: `
    <app-food-result-row
      [result]="result()"
      [query]="query()"
      [now]="now"
      [menu]="menu()"
      (quickLog)="logged.update((count) => count + 1)"
      (menuRequested)="menus.update((count) => count + 1)"
    />
  `,
})
class Host {
  readonly result = signal(result());
  readonly query = signal('');
  readonly menu = signal(false);
  readonly now = NOW;
  readonly logged = signal(0);
  readonly menus = signal(0);
}

describe('FoodResultRow', () => {
  async function setup(row: FoodSearchResult, menu = false, query = '') {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result.set(row);
    fixture.componentInstance.menu.set(menu);
    fixture.componentInstance.query.set(query);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const label = (): string =>
      el.querySelector('button[data-result-key]')!.getAttribute('aria-label')!;
    return { fixture, host: fixture.componentInstance, el, label };
  }

  it('says a favorite that was never logged from its star is starred only once', async () => {
    const { label } = await setup(result());
    expect(label()).toBe('Strawberry Yogurt, 144 kcal, 150 g. Starred');
    expect(label().match(/Starred/g)).toHaveLength(1);
  });

  it('reads out how often a starred food was logged', async () => {
    const { label } = await setup(
      result({ useCount: 3, lastUsedAt: new Date(2026, 8, 26, 12, 0).toISOString() }),
    );
    expect(label()).toBe('Strawberry Yogurt, 144 kcal, 150 g. Starred. Logged 3× · 2 days ago');
  });

  it('leaves the star and the weight out when they do not apply', async () => {
    const { label } = await setup(
      result({ key: 'meal:entry-1', kind: 'meal', starred: false, favoriteId: null }),
    );
    expect(label()).toMatch(/\. Meal$/);
    expect(label()).not.toContain('Starred');
    const { label: weightless } = await setup(result({ grams: 0 }));
    expect(weightless()).toBe('Strawberry Yogurt, 144 kcal. Starred');
  });

  it('shows how many were eaten last time', async () => {
    const { el, label } = await setup(
      result({
        key: 'meal:entry-5',
        kind: 'meal',
        name: 'Black Angus burgers',
        starred: false,
        favoriteId: null,
        grams: 780,
        totals: { ...zeroNutrients(), calories: 1450 },
        portion: { count: 2, unit: 'burger', unitPlural: 'burgers' },
      }),
    );
    expect(el.querySelector('[data-result-portion]')?.textContent?.trim()).toBe('2 burgers');
    expect(label()).toBe('Black Angus burgers, 2 burgers, 1,450 kcal, 780 g. Meal');
    expect(
      el.querySelector('button[aria-label="Log Black Angus burgers now, 2 burgers, 1,450 kcal"]'),
    ).not.toBeNull();
  });

  it('highlights the query in the food a meal was logged as', async () => {
    const { el } = await setup(
      result({
        key: 'meal:entry-1',
        kind: 'meal',
        name: 'Strawberry Yogurt',
        detail: 'Khoury strawberry yogurt',
        starred: false,
        useCount: 1,
        lastUsedAt: new Date(2026, 8, 28, 14, 54).toISOString(),
      }),
      false,
      'kho',
    );
    const marks = Array.from(el.querySelectorAll('mark')).map((mark) => mark.textContent);
    expect(marks).toEqual(['Kho']);
    expect(el.textContent).toContain('Khoury strawberry yogurt · Logged once · 6 min ago');
  });

  it('gives the more button a full touch target apart from the log button', async () => {
    const { fixture, host, el } = await setup(
      result({ key: 'meal:entry-1', kind: 'meal', starred: false }),
      true,
    );
    const more = el.querySelector<HTMLButtonElement>(
      'button[aria-label="More actions for Strawberry Yogurt"]',
    )!;
    const log = el.querySelector<HTMLButtonElement>('button[aria-label^="Log "]')!;
    expect(more.classList).toContain('size-11');
    expect(more.classList).not.toContain('w-9');
    expect(more.classList).toContain('mr-1');
    expect(more.nextElementSibling).toBe(log);

    more.click();
    await fixture.whenStable();
    expect(host.menus()).toBe(1);
    expect(host.logged()).toBe(0);

    log.click();
    await fixture.whenStable();
    expect(host.logged()).toBe(1);
    expect(host.menus()).toBe(1);
  });

  it('has no more button without a menu', async () => {
    const { el } = await setup(result(), false);
    expect(el.querySelector('button[aria-label^="More actions"]')).toBeNull();
  });
});
