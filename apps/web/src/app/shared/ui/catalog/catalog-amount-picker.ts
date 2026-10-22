import { Component, computed, input, model } from '@angular/core';
import { MAX_ITEM_GRAMS, formatCount, type CatalogFoodDto, type CatalogPortion } from '@food/shared';
import {
  CATALOG_QUANTITY_MAX,
  CATALOG_QUANTITY_MIN,
  CATALOG_QUANTITY_STEPS,
  amountLabel,
  clampQuantity,
  gramsAmount,
  portionAmount,
  type CatalogAmount,
} from '../../utils/catalog';
import { formatNutrientValue } from '../../utils/format';
import { Icon } from '../icon';
import { stepGrams } from '../items-editor/items-math';
import { NumberInput } from '../number-input';

const GRAMS_OPTION = 'grams';

let nextPickerId = 0;

@Component({
  selector: 'app-catalog-amount-picker',
  imports: [Icon, NumberInput],
  host: { class: 'block' },
  template: `
    <p class="label" [id]="ids.amount">How much?</p>
    <div
      class="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]"
      role="group"
      [attr.aria-labelledby]="ids.amount"
    >
      @for (portion of food().portions; track portion.label) {
        <button
          type="button"
          class="flex min-h-12 shrink-0 flex-col items-start justify-center rounded-xl border px-3 py-1 text-left text-sm leading-4 font-semibold transition active:scale-95"
          [class]="
            selected() === portion.label
              ? 'border-brand bg-brand/15 text-brand'
              : 'border-line/70 bg-surface text-fg hover:bg-surface-2'
          "
          [attr.aria-pressed]="selected() === portion.label"
          (click)="pickPortion(portion)"
        >
          <span class="max-w-48 truncate">{{ portion.label }}</span>
          <span class="mt-0.5 text-[11px] font-medium tabular-nums opacity-70">{{
            gramsText(portion.grams)
          }}</span>
        </button>
      }
      <button
        type="button"
        class="flex min-h-12 shrink-0 flex-col items-start justify-center rounded-xl border px-3 py-1 text-left text-sm leading-4 font-semibold transition active:scale-95"
        [class]="
          selected() === gramsOption
            ? 'border-brand bg-brand/15 text-brand'
            : 'border-line/70 bg-surface text-fg hover:bg-surface-2'
        "
        [attr.aria-pressed]="selected() === gramsOption"
        (click)="pickGrams()"
      >
        Grams
        <span class="mt-0.5 text-[11px] font-medium opacity-70">Weigh it</span>
      </button>
    </div>

    <div class="mt-2 flex items-center gap-2">
      @if (amount().portion) {
        <button
          type="button"
          class="btn btn-secondary btn-icon size-12"
          aria-label="Less"
          [disabled]="amount().quantity <= quantityMin"
          (click)="stepQuantity(-1)"
        >
          <app-icon name="minus" />
        </button>
        <output
          class="flex h-12 min-w-0 flex-1 items-center justify-center rounded-xl border border-line bg-surface-2 px-2 text-center tabular-nums"
          aria-live="polite"
        >
          <span class="truncate text-base leading-6 font-bold text-fg">{{ label() }}</span>
        </output>
        <button
          type="button"
          class="btn btn-secondary btn-icon size-12"
          aria-label="More"
          [disabled]="amount().quantity >= quantityMax"
          (click)="stepQuantity(1)"
        >
          <app-icon name="plus" />
        </button>
      } @else {
        <button
          type="button"
          class="btn btn-secondary btn-icon size-12"
          aria-label="Fewer grams"
          [disabled]="amount().grams <= 1"
          (click)="stepGrams(-1)"
        >
          <app-icon name="minus" />
        </button>
        <div class="relative min-w-0 flex-1">
          <app-number-input
            inputClass="input h-12 pr-10 text-center text-xl font-bold tabular-nums"
            ariaLabel="Grams"
            [inputId]="ids.grams"
            [value]="amount().grams"
            [decimals]="1"
            [max]="maxGrams"
            (valueChange)="setGrams($event)"
          />
          <span
            class="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-medium text-muted"
            >g</span
          >
        </div>
        <button
          type="button"
          class="btn btn-secondary btn-icon size-12"
          aria-label="More grams"
          [disabled]="amount().grams >= maxGrams"
          (click)="stepGrams(1)"
        >
          <app-icon name="plus" />
        </button>
      }
    </div>

    @if (amount().portion) {
      <div class="mt-2 grid grid-cols-5 gap-1.5" role="group" aria-label="How many">
        @for (step of quantitySteps; track step) {
          <button
            type="button"
            class="min-h-11 rounded-xl border text-sm font-bold tabular-nums transition active:scale-95"
            [class]="
              isQuantity(step)
                ? 'border-brand bg-brand/15 text-brand'
                : 'border-line/70 bg-surface text-fg hover:bg-surface-2'
            "
            [attr.aria-pressed]="isQuantity(step)"
            (click)="pickQuantity(step)"
          >
            {{ quantityLabel(step) }}
          </button>
        }
      </div>
    }
    @if (amount().grams <= 0) {
      <p class="mt-1.5 text-center text-xs text-danger" role="alert">Enter at least 1 g.</p>
    }
  `,
})
export class CatalogAmountPicker {
  readonly food = input.required<CatalogFoodDto>();
  readonly amount = model.required<CatalogAmount>();

  private readonly pickerId = nextPickerId++;
  protected readonly ids = {
    amount: `catalog-amount-${this.pickerId}`,
    grams: `catalog-amount-${this.pickerId}-grams`,
  };
  protected readonly gramsOption = GRAMS_OPTION;
  protected readonly maxGrams = MAX_ITEM_GRAMS;
  protected readonly quantitySteps = CATALOG_QUANTITY_STEPS;
  protected readonly quantityMin = CATALOG_QUANTITY_MIN;
  protected readonly quantityMax = CATALOG_QUANTITY_MAX;
  protected readonly selected = computed(() => this.amount().portion?.label ?? GRAMS_OPTION);
  protected readonly label = computed(() => amountLabel(this.amount()));

  protected gramsText(grams: number): string {
    return `${formatNutrientValue('protein', grams)} g`;
  }

  protected quantityLabel(quantity: number): string {
    return `${formatCount(quantity)}×`;
  }

  protected pickPortion(portion: CatalogPortion): void {
    const current = this.amount();
    this.amount.set(portionAmount(portion, current.portion ? current.quantity : 1));
  }

  protected pickGrams(): void {
    this.amount.set(gramsAmount(this.amount().grams || 100));
  }

  protected pickQuantity(quantity: number): void {
    const portion = this.amount().portion;
    if (portion) {
      this.amount.set(portionAmount(portion, quantity));
    }
  }

  protected isQuantity(quantity: number): boolean {
    return Math.abs(this.amount().quantity - quantity) < 1e-6;
  }

  protected stepQuantity(direction: 1 | -1): void {
    const amount = this.amount();
    if (!amount.portion) {
      return;
    }
    const step = amount.quantity < 1 || (amount.quantity === 1 && direction < 0) ? 0.25 : 0.5;
    this.amount.set(portionAmount(amount.portion, clampQuantity(amount.quantity + direction * step)));
  }

  protected stepGrams(direction: 1 | -1): void {
    const amount = this.amount();
    if (!amount.portion) {
      this.amount.set(gramsAmount(stepGrams(amount.grams, direction)));
    }
  }

  protected setGrams(grams: number): void {
    this.amount.set({ portion: null, quantity: 1, grams });
  }
}
