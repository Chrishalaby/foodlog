import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { FoodSearchResult } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { OFFLINE_MESSAGE } from '../../../core/errors';
import { ProductEditSheet } from './product-edit-sheet';
import { installDialogShim, makeFood, makeProduct } from '../../today/today-fixtures';

@Component({
  imports: [ProductEditSheet],
  template: `
    <app-product-edit-sheet
      [(open)]="open"
      [food]="food()"
      (missing)="missing.set([...missing(), $event.key])"
    />
  `,
})
class Host {
  readonly open = signal(false);
  readonly food = signal<FoodSearchResult | null>(
    makeFood({
      key: 'product:product-1',
      kind: 'product',
      name: 'Khoury Yaourt fraise',
      productId: 'product-1',
    }),
  );
  readonly missing = signal<string[]>([]);
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('ProductEditSheet', () => {
  let restoreDialog: () => void;
  let api: {
    listProducts: ReturnType<typeof vi.fn>;
    upsertProduct: ReturnType<typeof vi.fn>;
    renameFood: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    restoreDialog = installDialogShim();
    api = {
      listProducts: vi.fn().mockResolvedValue([makeProduct()]),
      upsertProduct: vi.fn(),
      renameFood: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
  });

  afterEach(() => restoreDialog());

  async function openSheet() {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.open.set(true);
    await fixture.whenStable();
    await flush();
    await fixture.whenStable();
    return { fixture, host: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  it('shows a retry when the product cannot be loaded, then the editor once it loads', async () => {
    api.listProducts.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    const { fixture, el } = await openSheet();
    expect(el.textContent).toContain(OFFLINE_MESSAGE);
    expect(el.textContent).not.toContain('Edit values');

    Array.from(el.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Try again'))!
      .click();
    await flush();
    await fixture.whenStable();
    expect(api.listProducts).toHaveBeenCalledTimes(2);
    expect(el.textContent).not.toContain(OFFLINE_MESSAGE);
    expect(el.textContent).toContain('Edit values');
  });

  it('keeps the editor open with the error when saving fails', async () => {
    api.upsertProduct.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 400, error: { message: 'name must not be empty' } }),
    );
    const { fixture, host, el } = await openSheet();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    await fixture.whenStable();

    expect(api.upsertProduct).toHaveBeenCalledWith('5281234567896', expect.any(Object));
    expect(host.open()).toBe(true);
    expect(el.textContent).toContain('Name must not be empty.');
  });

  it('closes and reports a product that is no longer saved', async () => {
    api.listProducts.mockResolvedValueOnce([]);
    const { host } = await openSheet();
    expect(host.open()).toBe(false);
    expect(host.missing()).toEqual(['product:product-1']);
  });
});
