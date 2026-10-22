import {
  Component,
  ElementRef,
  afterNextRender,
  computed,
  input,
  linkedSignal,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  type NutrientKey,
  type ProductDto,
  type UpsertProductRequest,
} from '@food/shared';
import { Icon } from '../../../shared/ui/icon';
import { NumberInput } from '../../../shared/ui/number-input';
import { SegmentedControl, type SegmentOption } from '../../../shared/ui/segmented-control';
import { Spinner } from '../../../shared/ui/spinner';
import { formatBarcode } from './gs1';
import {
  draftFromProduct,
  emptyProductDraft,
  per100Fields,
  productDraftError,
  productRequestFromDraft,
  type BasisUnit,
  type ProductDraft,
} from './product-form';

let nextEditorId = 0;

@Component({
  selector: 'app-product-editor',
  imports: [Icon, NumberInput, SegmentedControl, Spinner],
  host: { class: 'block' },
  templateUrl: './product-editor.html',
})
export class ProductEditor {
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly product = input<ProductDto | null>(null);
  readonly barcode = input.required<string | null>();
  readonly busy = input(false);
  readonly error = input<string | null>(null);
  readonly saved = output<UpsertProductRequest>();
  readonly cancelled = output<void>();

  protected readonly idPrefix = `product-editor-${nextEditorId++}`;
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly sizeMax = MAX_ITEM_GRAMS;
  protected readonly sizeFields = [
    { key: 'servingSizeG', label: 'Serving size' },
    { key: 'packSizeG', label: 'Pack size' },
  ] as const;
  protected readonly unitOptions: readonly SegmentOption<BasisUnit>[] = [
    { value: 'g', label: 'Per 100 g' },
    { value: 'ml', label: 'Per 100 ml' },
  ];

  protected readonly draft = linkedSignal<ProductDraft>(() => {
    const product = this.product();
    return product ? draftFromProduct(product) : emptyProductDraft();
  });
  protected readonly submitted = signal(false);
  protected readonly editing = computed(() => this.product() !== null);
  protected readonly title = computed(() => (this.editing() ? 'Edit values' : 'Add this product'));
  protected readonly code = computed(() => {
    const barcode = this.barcode();
    return barcode ? formatBarcode(barcode) : null;
  });
  protected readonly fields = computed(() => per100Fields(this.draft().basisUnit));
  protected readonly problem = computed(() => productDraftError(this.draft()));
  protected readonly message = computed(
    () => this.error() ?? (this.submitted() ? this.problem() : null),
  );

  constructor() {
    afterNextRender(() => {
      if (!this.product()) {
        this.nameInput()?.nativeElement.focus({ preventScroll: true });
      }
    });
  }

  protected fieldId(key: string): string {
    return `${this.idPrefix}-${key}`;
  }

  protected onText(field: 'name' | 'brand', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected setUnit(basisUnit: BasisUnit): void {
    this.draft.update((draft) => ({ ...draft, basisUnit }));
  }

  protected setNutrient(key: NutrientKey, value: number): void {
    this.draft.update((draft) => ({ ...draft, per100: { ...draft.per100, [key]: value } }));
  }

  protected setSize(field: 'servingSizeG' | 'packSizeG', value: number): void {
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected submit(event: Event): void {
    event.preventDefault();
    this.submitted.set(true);
    if (this.busy() || this.problem() !== null) {
      return;
    }
    this.saved.emit(productRequestFromDraft(this.draft(), 'manual'));
  }
}
