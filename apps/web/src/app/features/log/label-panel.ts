import { Component, computed, input, output } from '@angular/core';
import { MAX_ITEM_GRAMS, type LabelInfo } from '@food/shared';
import { Icon } from '../../shared/ui/icon';
import { NumberInput } from '../../shared/ui/number-input';
import { formatNumber } from '../../shared/utils/format';
import {
  MIN_SERVINGS,
  amountForServings,
  labelMicroRows,
  labelRows,
  packSizeOf,
  servingSizeOf,
  servingsForAmount,
  stepServings,
} from './label-portion';

let nextPanelId = 0;

@Component({
  selector: 'app-label-panel',
  imports: [Icon, NumberInput],
  host: { class: 'block' },
  templateUrl: './label-panel.html',
})
export class LabelPanel {
  readonly label = input.required<LabelInfo>();
  readonly amount = input<number | null>(null);
  readonly saveable = input(false);
  readonly savedName = input<string | null>(null);
  readonly amountChange = output<number>();
  readonly saveFood = output<void>();

  protected readonly ids = {
    title: `label-panel-${nextPanelId}-title`,
    amount: `label-panel-${nextPanelId}-amount`,
    servings: `label-panel-${nextPanelId++}-servings`,
  };
  protected readonly maxAmount = MAX_ITEM_GRAMS;
  protected readonly unit = computed(() => this.label().basisUnit);
  protected readonly rows = computed(() => labelRows(this.label()));
  protected readonly microRows = computed(() => labelMicroRows(this.label()));
  protected readonly servingSize = computed(() => servingSizeOf(this.label()));
  protected readonly packSize = computed(() => packSizeOf(this.label()));
  protected readonly amountValue = computed(() => this.amount() ?? 0);
  protected readonly servings = computed(() =>
    servingsForAmount(this.amountValue(), this.servingSize()),
  );
  protected readonly servingsText = computed(() => formatNumber(this.servings() ?? 0, 2));
  protected readonly canDecrease = computed(() => (this.servings() ?? 0) > MIN_SERVINGS);
  protected readonly isWholePack = computed(() => {
    const pack = this.packSize();
    return pack !== null && Math.abs(this.amountValue() - pack) < 0.05;
  });

  protected format(value: number, decimals: number): string {
    return formatNumber(value, decimals);
  }

  protected setAmount(value: number): void {
    this.amountChange.emit(value);
  }

  protected step(direction: 1 | -1): void {
    const size = this.servingSize();
    if (size === null) {
      return;
    }
    this.amountChange.emit(amountForServings(stepServings(this.servings() ?? 0, direction), size));
  }

  protected useWholePack(): void {
    const pack = this.packSize();
    if (pack !== null) {
      this.amountChange.emit(pack);
    }
  }
}
