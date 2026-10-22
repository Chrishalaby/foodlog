import { Injectable, inject } from '@angular/core';
import type { FoodSearchResult, ProductDto, UpsertProductRequest } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { errorMessage, httpStatus } from '../../../core/errors';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import { productDisplayName } from './product-portion';
import { sameFoodName } from '../food-search';

export const PRODUCT_SAVE_FAILED = 'Could not save this product.';

@Injectable({ providedIn: 'root' })
export class ProductLibrary {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  async find(productId: string): Promise<ProductDto | null> {
    const products = await this.api.listProducts();
    return products.find((product) => product.id === productId) ?? null;
  }

  async save(
    product: ProductDto,
    body: UpsertProductRequest,
    previousName: string = productDisplayName(product),
  ): Promise<ProductDto> {
    const saved = await this.persist(product, body);
    const name = productDisplayName(saved);
    const logsRenamed =
      sameFoodName(previousName, name) || (await this.renameLogs(previousName, name));
    this.events.notify('products', 'entries', 'favorites');
    if (logsRenamed) {
      this.toast.success(`Updated ${name}`);
    } else {
      this.toast.error(`Saved ${name}, but earlier logs kept the name “${previousName}”.`);
    }
    return saved;
  }

  async remove(result: FoodSearchResult): Promise<boolean> {
    const productId = result.productId;
    if (result.kind !== 'product' || !productId) {
      return false;
    }
    const confirmed = await this.confirm.confirm({
      title: `Delete “${result.name}” from your products?`,
      message:
        'Its saved values are removed and it leaves your suggestions. Your logs are kept. Scanning the barcode again looks it up afresh.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!confirmed) {
      return false;
    }
    try {
      await this.api.deleteProduct(productId);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        this.toast.error(errorMessage(err, `Could not delete “${result.name}”.`));
        return false;
      }
    }
    const hidden = await this.api.hideFood({ name: result.name }).then(
      () => true,
      () => false,
    );
    this.events.notify('products', 'entries');
    this.toast.info(
      hidden
        ? `Deleted “${result.name}”. Your logs are kept.`
        : `Deleted “${result.name}”. Its past logs may still show up in suggestions.`,
    );
    return true;
  }

  private async persist(product: ProductDto, body: UpsertProductRequest): Promise<ProductDto> {
    if (product.barcode) {
      return this.api.upsertProduct(product.barcode, body);
    }
    const { food } = await this.api.updateMyFood(product.id, {
      name: body.name,
      brand: body.brand ?? null,
      basisUnit: body.basisUnit,
      per100: body.per100,
      ...(body.microsPer100 ? { microsPer100: body.microsPer100 } : {}),
      servingSizeG: body.servingSizeG ?? null,
    });
    return food;
  }

  private renameLogs(from: string, to: string): Promise<boolean> {
    return this.api.renameFood({ from, to }).then(
      () => true,
      () => false,
    );
  }
}
