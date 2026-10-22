import { Component, computed, effect, inject, untracked, viewChild } from '@angular/core';
import type { LogProductRequest, ProductDto, UpsertProductRequest } from '@food/shared';
import { CaptureService } from '../../../core/capture.service';
import { BottomSheet } from '../../../shared/ui/bottom-sheet';
import { Skeleton } from '../../../shared/ui/skeleton';
import { Spinner } from '../../../shared/ui/spinner';
import { LogStore } from '../log.store';
import { BarcodeFlowStore } from './barcode-flow.store';
import { BarcodeScanner } from './barcode-scanner';
import { formatBarcode } from './gs1';
import { ProductDetails } from './product-details';
import { ProductEditor } from './product-editor';
import { ProductMissing, type LookupProblem } from './product-missing';
import { productDisplayName } from './product-portion';

@Component({
  selector: 'app-barcode-flow',
  imports: [
    BarcodeScanner,
    BottomSheet,
    ProductDetails,
    ProductEditor,
    ProductMissing,
    Skeleton,
    Spinner,
  ],
  templateUrl: './barcode-flow.html',
})
export class BarcodeFlow {
  protected readonly flow = inject(BarcodeFlowStore);
  private readonly log = inject(LogStore);
  private readonly capture = inject(CaptureService);
  private readonly sheet = viewChild(BottomSheet);

  protected readonly step = this.flow.step;
  protected readonly code = computed(() => {
    const barcode = this.flow.barcode();
    return barcode ? formatBarcode(barcode) : '';
  });
  protected readonly found = computed(() => {
    const step = this.step();
    return step.kind === 'found' ? step : null;
  });
  protected readonly editing = computed(() => {
    const step = this.step();
    return step.kind === 'edit' ? step : null;
  });
  protected readonly problem = computed<LookupProblem | null>(() => {
    const step = this.step();
    return step.kind === 'failed' ? { message: step.message, offline: step.offline } : null;
  });
  protected readonly sheetLabel = computed(() => {
    const step = this.step();
    switch (step.kind) {
      case 'found':
        return `Log ${productDisplayName(step.product)}`;
      case 'edit':
        return step.product ? 'Edit product values' : 'Add product';
      case 'missing':
        return 'Unknown product';
      case 'failed':
        return 'Barcode lookup failed';
      default:
        return 'Looking up barcode';
    }
  });

  constructor() {
    effect(() => {
      if (this.log.phase() !== 'idle') {
        untracked(() => this.flow.close());
      }
    });
  }

  protected onDetected(code: string): void {
    void this.flow.lookup(code);
  }

  protected lookupImage(file: File): void {
    void this.flow.lookupImage(file);
  }

  protected onSheetOpenChange(open: boolean): void {
    if (!open && this.flow.sheetOpen()) {
      this.flow.close();
    }
  }

  protected closeSheet(): void {
    this.flow.close();
  }

  protected logProduct(product: ProductDto, body: LogProductRequest): void {
    void this.flow.log(product, body);
  }

  protected saveProduct(body: UpsertProductRequest): void {
    void this.flow.saveProduct(body);
  }

  protected scanLabel(): void {
    const barcode = this.flow.barcode();
    if (!barcode) {
      return;
    }
    this.sheet()?.close();
    this.flow.close();
    this.capture.requestLabelScan(barcode);
  }

  protected describe(): void {
    const barcode = this.flow.barcode();
    if (!barcode) {
      return;
    }
    this.flow.close();
    this.log.start({ file: null, mode: 'text', source: 'text', barcode });
  }
}
