import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { EntryDto, LogProductRequest, ProductDto, UpsertProductRequest } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { OFFLINE_MESSAGE, errorMessage, httpStatus } from '../../../core/errors';
import { NetworkService } from '../../../core/network.service';
import { onSessionReset } from '../../../core/session-scope';
import { ToastService } from '../../../core/toast.service';
import { formatNutrientValue } from '../../../shared/utils/format';
import { TODAY_PATH } from '../log-helpers';
import { BarcodeImageReader, IMAGE_SCAN_MESSAGES } from './barcode-image';
import { ProductLibrary } from './product-library';
import { productDisplayName } from './product-portion';

export type FlowStep =
  | { readonly kind: 'idle' }
  | { readonly kind: 'scanning' }
  | { readonly kind: 'lookup'; readonly barcode: string }
  | { readonly kind: 'found'; readonly barcode: string; readonly product: ProductDto }
  | { readonly kind: 'missing'; readonly barcode: string }
  | {
      readonly kind: 'failed';
      readonly barcode: string;
      readonly message: string;
      readonly offline: boolean;
    }
  | { readonly kind: 'edit'; readonly barcode: string; readonly product: ProductDto | null };

export type FlowBusy = 'log' | 'save' | null;

export const LOOKUP_ERROR = "Couldn't look up this barcode. Please try again.";
export const INVALID_BARCODE = "That barcode isn't valid. Scan it again or type the number.";
export const SAVE_PRODUCT_ERROR = "Couldn't save this product. Please try again.";
export const PRODUCT_SAVED = 'Saved — next time just scan the barcode';
export const SAME_BARCODE_IN_IMAGE =
  "That's the same barcode, and we still don't know it. Scan its nutrition label instead.";
export const PRODUCT_SKIPPED =
  "The meal was saved, but the barcode wasn't remembered because its per-100 values look off. Scan it again to add the product.";

const IDLE: FlowStep = { kind: 'idle' };

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function lookupFailure(err: unknown): { message: string; offline: boolean } {
  const status = httpStatus(err);
  if (status === 0) {
    return { message: OFFLINE_MESSAGE, offline: true };
  }
  if (status === 400) {
    return { message: INVALID_BARCODE, offline: false };
  }
  if (status !== null && status >= 500) {
    return { message: LOOKUP_ERROR, offline: false };
  }
  return { message: errorMessage(err, LOOKUP_ERROR), offline: false };
}

@Injectable()
export class BarcodeFlowStore {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly network = inject(NetworkService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly images = inject(BarcodeImageReader);
  private readonly products = inject(ProductLibrary);
  private readonly stepState = signal<FlowStep>(IDLE);
  private readonly busyState = signal<FlowBusy>(null);
  private readonly saveErrorState = signal<string | null>(null);
  private readonly imageBusyState = signal(false);
  private readonly imageMessageState = signal<string | null>(null);
  private controller: AbortController | null = null;
  private seq = 0;

  readonly step = this.stepState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly saveError = this.saveErrorState.asReadonly();
  readonly imageBusy = this.imageBusyState.asReadonly();
  readonly imageMessage = this.imageMessageState.asReadonly();
  readonly scanning = computed(() => this.stepState().kind === 'scanning');
  readonly sheetOpen = computed(() => {
    const kind = this.stepState().kind;
    return kind !== 'idle' && kind !== 'scanning';
  });
  readonly barcode = computed(() => {
    const step = this.stepState();
    return 'barcode' in step ? step.barcode : null;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelLookup());
    onSessionReset(() => this.reset(IDLE));
  }

  openScanner(): void {
    if (this.scanning()) {
      return;
    }
    this.reset({ kind: 'scanning' });
  }

  closeScanner(): void {
    if (this.scanning()) {
      this.reset(IDLE);
    }
  }

  close(): void {
    if (this.stepState().kind !== 'idle') {
      this.reset(IDLE);
    }
  }

  async lookup(barcode: string): Promise<void> {
    this.reset({ kind: 'lookup', barcode });
    if (!this.network.online()) {
      this.stepState.set({ kind: 'failed', barcode, message: OFFLINE_MESSAGE, offline: true });
      return;
    }
    const id = this.seq;
    const controller = new AbortController();
    this.controller = controller;
    try {
      const response = await this.api.lookupBarcode(barcode, controller.signal);
      if (response.source === 'openfoodfacts') {
        this.events.notify('products');
      }
      if (id !== this.seq) {
        return;
      }
      this.stepState.set(
        response.product
          ? { kind: 'found', barcode: response.barcode || barcode, product: response.product }
          : { kind: 'missing', barcode },
      );
    } catch (err) {
      if (id !== this.seq || isAbort(err)) {
        return;
      }
      if (httpStatus(err) === 404) {
        this.stepState.set({ kind: 'missing', barcode });
        return;
      }
      this.stepState.set({ kind: 'failed', barcode, ...lookupFailure(err) });
    } finally {
      if (this.controller === controller) {
        this.controller = null;
      }
    }
  }

  async lookupImage(file: Blob): Promise<void> {
    const kind = this.stepState().kind;
    if ((kind !== 'missing' && kind !== 'failed') || this.imageBusyState()) {
      return;
    }
    const id = this.seq;
    this.imageBusyState.set(true);
    this.imageMessageState.set(null);
    const result = await this.images.read(file);
    if (id !== this.seq) {
      return;
    }
    this.imageBusyState.set(false);
    if (result.kind !== 'code') {
      this.imageMessageState.set(IMAGE_SCAN_MESSAGES[result.kind]);
      return;
    }
    const step = this.stepState();
    if (step.kind === 'missing' && step.barcode === result.code) {
      this.imageMessageState.set(SAME_BARCODE_IN_IMAGE);
      return;
    }
    await this.lookup(result.code);
  }

  retry(): void {
    const step = this.stepState();
    if (step.kind === 'failed') {
      void this.lookup(step.barcode);
    }
  }

  editValues(): void {
    const step = this.stepState();
    if (step.kind === 'found') {
      this.saveErrorState.set(null);
      this.stepState.set({ kind: 'edit', barcode: step.barcode, product: step.product });
    }
  }

  enterManually(): void {
    const step = this.stepState();
    if (step.kind === 'missing' || step.kind === 'failed') {
      this.saveErrorState.set(null);
      this.stepState.set({ kind: 'edit', barcode: step.barcode, product: null });
    }
  }

  cancelEdit(): void {
    const step = this.stepState();
    if (step.kind !== 'edit' || this.busyState() !== null) {
      return;
    }
    this.saveErrorState.set(null);
    this.stepState.set(
      step.product
        ? { kind: 'found', barcode: step.barcode, product: step.product }
        : { kind: 'missing', barcode: step.barcode },
    );
  }

  async saveProduct(body: UpsertProductRequest): Promise<ProductDto | null> {
    const step = this.stepState();
    if (step.kind !== 'edit' || this.busyState() !== null) {
      return null;
    }
    const id = this.seq;
    this.busyState.set('save');
    this.saveErrorState.set(null);
    try {
      const product = step.product
        ? await this.products.save(step.product, body)
        : await this.createProduct(step.barcode, body);
      if (id === this.seq) {
        this.stepState.set({ kind: 'found', barcode: step.barcode, product });
      }
      return product;
    } catch (err) {
      if (id === this.seq) {
        this.saveErrorState.set(errorMessage(err, SAVE_PRODUCT_ERROR));
      }
      return null;
    } finally {
      this.busyState.set(null);
    }
  }

  private async createProduct(barcode: string, body: UpsertProductRequest): Promise<ProductDto> {
    const product = await this.api.upsertProduct(barcode, body);
    this.events.notify('products');
    this.toast.success(PRODUCT_SAVED);
    return product;
  }

  async log(product: ProductDto, body: LogProductRequest): Promise<EntryDto | null> {
    if (this.busyState() !== null) {
      return null;
    }
    const id = this.seq;
    this.busyState.set('log');
    try {
      const entry = await this.api.logProduct(product.id, body);
      this.events.notify('entries', 'products');
      this.toast.success(
        `Logged ${entry.name} · ${formatNutrientValue('calories', entry.totals.calories)} kcal`,
        {
          actions: [
            { label: 'Undo', run: () => void this.undo(entry) },
            { label: 'View', run: () => void this.router.navigate(['/entries', entry.id]) },
          ],
        },
      );
      if (id === this.seq) {
        this.reset(IDLE);
        void this.router.navigateByUrl(TODAY_PATH).catch(() => false);
      }
      return entry;
    } catch (err) {
      const name = productDisplayName(product);
      this.toast.error(
        httpStatus(err) === 404
          ? `${name} is no longer in your products. Scan it again.`
          : errorMessage(err, `Couldn't log ${name}. Please try again.`),
      );
      return null;
    } finally {
      this.busyState.set(null);
    }
  }

  async undo(entry: EntryDto): Promise<void> {
    try {
      await this.api.deleteEntry(entry.id);
      this.events.notify('entries');
      this.toast.info(`Removed ${entry.name} from your log`);
    } catch (err) {
      this.toast.error(errorMessage(err, "Couldn't undo. Delete the entry from your log instead."));
    }
  }

  private reset(step: FlowStep): void {
    this.seq += 1;
    this.cancelLookup();
    this.saveErrorState.set(null);
    this.imageBusyState.set(false);
    this.imageMessageState.set(null);
    this.stepState.set(step);
  }

  private cancelLookup(): void {
    this.controller?.abort();
    this.controller = null;
  }
}
