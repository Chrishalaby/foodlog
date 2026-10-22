import { Component, ElementRef, computed, input, model, viewChild } from '@angular/core';
import { Icon } from '../../shared/ui/icon';
import { parseWeightText, stepWeight, weightText } from './weight-math';

@Component({
  selector: 'app-weight-field',
  imports: [Icon],
  host: { class: 'flex items-center gap-1.5' },
  template: `
    <button
      type="button"
      class="btn btn-secondary btn-icon rounded-xl"
      aria-label="Decrease by 0.1 kg"
      [disabled]="disabled() || !canStep()"
      (click)="step(-1)"
    >
      <app-icon name="minus" [size]="18" [strokeWidth]="2.4" />
    </button>
    <div class="relative min-w-0 flex-1">
      <input
        #field
        type="text"
        inputmode="decimal"
        autocomplete="off"
        enterkeyhint="done"
        class="input pr-10 text-center text-lg font-semibold tabular-nums"
        [attr.id]="inputId()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-invalid]="invalid() ? true : null"
        [attr.aria-describedby]="describedBy()"
        [attr.placeholder]="placeholder()"
        [disabled]="disabled()"
        [value]="text()"
        (focus)="selectAll($event)"
        (input)="onInput($event)"
      />
      <span
        class="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm font-medium text-muted"
        aria-hidden="true"
        >kg</span
      >
    </div>
    <button
      type="button"
      class="btn btn-secondary btn-icon rounded-xl"
      aria-label="Increase by 0.1 kg"
      [disabled]="disabled() || !canStep()"
      (click)="step(1)"
    >
      <app-icon name="plus" [size]="18" [strokeWidth]="2.4" />
    </button>
  `,
})
export class WeightField {
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>('field');

  readonly text = model('');
  readonly fallback = input<number | null>(null);
  readonly inputId = input<string | null>(null);
  readonly ariaLabel = input('Weight in kg');
  readonly describedBy = input<string | null>(null);
  readonly invalid = input(false);
  readonly disabled = input(false);
  readonly placeholder = input('0.0');

  protected readonly canStep = computed(
    () => parseWeightText(this.text()) !== null || this.fallback() !== null,
  );

  focus(): void {
    const element = this.field().nativeElement;
    element.focus({ preventScroll: true });
    element.select();
  }

  protected selectAll(event: FocusEvent): void {
    const element = event.target as HTMLInputElement;
    setTimeout(() => {
      if (element.ownerDocument.activeElement === element) {
        element.setSelectionRange(0, element.value.length);
      }
    });
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
  }

  protected step(direction: 1 | -1): void {
    const next = stepWeight(parseWeightText(this.text()), direction, this.fallback());
    if (next !== null) {
      this.text.set(weightText(next));
    }
  }
}
