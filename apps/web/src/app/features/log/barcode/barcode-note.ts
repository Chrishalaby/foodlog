import { Component, computed, input, output } from '@angular/core';
import { Icon } from '../../../shared/ui/icon';
import { formatBarcode } from './gs1';

@Component({
  selector: 'app-barcode-note',
  imports: [Icon],
  host: { class: 'block animate-fade-in' },
  template: `
    <div
      class="flex items-center gap-3 rounded-card border border-accent/30 bg-accent/10 py-2 pr-1 pl-3.5"
      role="note"
    >
      <app-icon class="text-accent" name="barcode" />
      <p class="min-w-0 flex-1 text-sm leading-snug">
        <span class="block font-semibold text-fg tabular-nums">Barcode {{ code() }}</span>
        <span class="block text-xs text-muted">{{ detail() }}</span>
      </p>
      <button
        type="button"
        class="btn btn-ghost btn-icon text-muted"
        aria-label="Don't remember this barcode"
        [disabled]="disabled()"
        (click)="removed.emit()"
      >
        <app-icon name="close" [size]="18" />
      </button>
    </div>
  `,
})
export class BarcodeNote {
  readonly barcode = input.required<string>();
  readonly detail = input('Saved with this food, so the next scan is instant.');
  readonly disabled = input(false);
  readonly removed = output<void>();

  protected readonly code = computed(() => formatBarcode(this.barcode()));
}
