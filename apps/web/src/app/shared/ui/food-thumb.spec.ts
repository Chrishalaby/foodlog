import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { zeroNutrients, type FoodResultKind, type FoodSearchResult } from '@food/shared';
import { FoodThumb } from './food-thumb';
import { ICONS } from './icon';

function result(kind: FoodResultKind, overrides: Partial<FoodSearchResult> = {}): FoodSearchResult {
  return {
    portion: null,
    key: `${kind}:1`,
    kind,
    name: 'banana bread',
    detail: null,
    items: [],
    totals: zeroNutrients(),
    grams: 100,
    mealType: null,
    photo: null,
    favoriteId: null,
    entryId: null,
    productId: null,
    useCount: 1,
    lastUsedAt: null,
    starred: kind === 'favorite',
    ...overrides,
  };
}

@Component({
  imports: [FoodThumb],
  template: `<app-food-thumb [result]="result()" [size]="size()" />`,
})
class Host {
  readonly result = signal(result('meal'));
  readonly size = signal(44);
}

describe('FoodThumb', () => {
  async function render(value: FoodSearchResult, size = 44) {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.result.set(value);
    fixture.componentInstance.size.set(size);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('app-food-thumb') as HTMLElement;
  }

  function iconPaths(root: Element): string[] {
    return Array.from(root.querySelectorAll('app-icon path')).map((path) =>
      path.getAttribute('d')!,
    );
  }

  it('gives every kind one icon and tone', async () => {
    const favorite = await render(result('favorite'));
    expect(favorite.querySelector('span')?.className).toContain('text-warn');
    expect(iconPaths(favorite)).toEqual(ICONS['star-filled'].paths);

    const meal = await render(result('meal'));
    expect(meal.querySelector('span')?.className).toContain('text-brand');
    expect(iconPaths(meal)).toEqual(ICONS.utensils.paths);

    const product = await render(result('product'));
    expect(product.querySelector('span')?.className).toContain('text-fat');
    expect(iconPaths(product)).toEqual(ICONS.barcode.paths);

    const food = await render(result('food'));
    expect(food.querySelector('span')?.className).toContain('text-accent');
    expect(food.textContent?.trim()).toBe('B');
  });

  it('marks a saved food without a barcode with the link icon', async () => {
    const saved = await render(result('product', { barcode: null }));
    expect(saved.querySelector('span')?.className).toContain('text-fat');
    expect(iconPaths(saved)).toEqual(ICONS.link.paths);

    const scanned = await render(result('product', { barcode: '5280001234566' }));
    expect(iconPaths(scanned)).toEqual(ICONS.barcode.paths);
  });

  it('sizes a chip thumbnail as a small circle and larger ones as rounded squares', async () => {
    const shape = async (size: number) => {
      const classes = (await render(result('meal'), size)).querySelector('span')!.classList;
      return ['size-8', 'size-11', 'size-14', 'rounded-full', 'rounded-xl', 'rounded-2xl'].filter(
        (name) => classes.contains(name),
      );
    };
    expect(await shape(32)).toEqual(['size-8', 'rounded-full']);
    expect(await shape(44)).toEqual(['size-11', 'rounded-xl']);
    expect(await shape(56)).toEqual(['size-14', 'rounded-2xl']);
  });

  it('shows the photo when there is one', async () => {
    const thumb = await render(
      result('meal', {
        photo: {
          id: 'p1',
          url: '/api/photos/p1',
          thumbUrl: '/api/photos/p1/thumb',
          width: 640,
          height: 480,
        },
      }),
      32,
    );
    const img = thumb.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('/api/photos/p1/thumb');
    expect(img.className).toContain('rounded-full');
    expect(thumb.getAttribute('aria-hidden')).toBe('true');
  });
});
