import { Component, computed, input, model, signal } from '@angular/core';
import { roundTo } from '@food/shared';
import { formatNumber, parseDecimal } from '../utils/format';

@Component({
  selector: 'app-number-input',
  host: { class: 'block' },
  template: `
    <input
      type="text"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="done"
      [attr.inputmode]="inputMode()"
      [class]="inputClass()"
      [attr.id]="inputId()"
      [attr.aria-label]="ariaLabel()"
      [attr.placeholder]="placeholder()"
      [disabled]="disabled()"
      [value]="text()"
      (focus)="onFocus($event)"
      (input)="onInput($event)"
      (blur)="onBlur()"
      (keydown.enter)="blurTarget($event)"
    />
  `,
})
export class NumberInput {
  readonly value = model.required<number>();
  readonly decimals = input(1);
  readonly min = input(0);
  readonly max = input(Number.MAX_SAFE_INTEGER);
  readonly inputId = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly placeholder = input('0');
  readonly disabled = input(false);
  readonly inputClass = input('input text-right tabular-nums');

  protected readonly inputMode = computed(() => {
    if (this.min() < 0) {
      return 'text';
    }
    return this.decimals() > 0 ? 'decimal' : 'numeric';
  });

  private readonly focused = signal(false);
  private readonly draft = signal('');

  protected readonly text = computed(() =>
    this.focused() ? this.draft() : formatNumber(this.value(), this.decimals()).replace(/,/g, ''),
  );

  protected onFocus(event: FocusEvent): void {
    this.draft.set(formatNumber(this.value(), this.decimals()).replace(/,/g, ''));
    this.focused.set(true);
    const target = event.target as HTMLInputElement;
    queueMicrotask(() => target.select());
  }

  protected onInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    this.draft.set(raw);
    const parsed = raw.trim() === '' ? 0 : parseDecimal(raw);
    if (parsed !== null) {
      this.value.set(this.clamp(parsed));
    }
  }

  protected onBlur(): void {
    this.focused.set(false);
  }

  protected blurTarget(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  private clamp(value: number): number {
    return roundTo(Math.min(this.max(), Math.max(this.min(), value)), this.decimals());
  }
}
