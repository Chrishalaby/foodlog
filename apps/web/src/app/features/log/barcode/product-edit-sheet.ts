import { Component, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import type { FoodSearchResult, ProductDto, UpsertProductRequest } from '@food/shared';
import { errorMessage } from '../../../core/errors';
import { BottomSheet } from '../../../shared/ui/bottom-sheet';
import { Icon } from '../../../shared/ui/icon';
import { Spinner } from '../../../shared/ui/spinner';
import { ProductEditor } from './product-editor';
import { PRODUCT_SAVE_FAILED, ProductLibrary } from './product-library';

export const PRODUCT_LOAD_FAILED = 'Could not load this product.';

@Component({
  selector: 'app-product-edit-sheet',
  imports: [BottomSheet, Icon, ProductEditor, Spinner],
  template: `
    <app-bottom-sheet [(open)]="open" [ariaLabel]="'Edit ' + (food()?.name ?? 'product')">
      @if (product(); as current) {
        <app-product-editor
          [product]="current"
          [barcode]="current.barcode"
          [busy]="saving()"
          [error]="saveError()"
          (saved)="save(current, $event)"
          (cancelled)="open.set(false)"
        />
      } @else if (loadError(); as message) {
        <div class="flex flex-col items-center gap-3 py-8 text-center" role="alert">
          <p class="text-sm text-muted">{{ message }}</p>
          <button type="button" class="btn btn-secondary" (click)="retry()">
            <app-icon name="refresh" [size]="18" />
            Try again
          </button>
        </div>
      } @else {
        <div class="flex justify-center py-10" role="status">
          <app-spinner [size]="24" label="Loading product" />
        </div>
      }
    </app-bottom-sheet>
  `,
})
export class ProductEditSheet {
  private readonly library = inject(ProductLibrary);
  private loadSeq = 0;

  readonly food = input<FoodSearchResult | null>(null);
  readonly open = model(false);
  readonly missing = output<FoodSearchResult>();

  protected readonly product = signal<ProductDto | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saving = signal(false);

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => void this.load());
      }
    });
  }

  protected retry(): void {
    void this.load();
  }

  protected async save(product: ProductDto, body: UpsertProductRequest): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.library.save(product, body, this.food()?.name);
      this.open.set(false);
    } catch (err) {
      this.saveError.set(errorMessage(err, PRODUCT_SAVE_FAILED));
    } finally {
      this.saving.set(false);
    }
  }

  private async load(): Promise<void> {
    const food = this.food();
    const token = ++this.loadSeq;
    this.product.set(null);
    this.loadError.set(null);
    this.saveError.set(null);
    if (!food?.productId) {
      return;
    }
    try {
      const product = await this.library.find(food.productId);
      if (token !== this.loadSeq) {
        return;
      }
      if (product) {
        this.product.set(product);
      } else {
        this.open.set(false);
        this.missing.emit(food);
      }
    } catch (err) {
      if (token === this.loadSeq) {
        this.loadError.set(errorMessage(err, PRODUCT_LOAD_FAILED));
      }
    }
  }
}
