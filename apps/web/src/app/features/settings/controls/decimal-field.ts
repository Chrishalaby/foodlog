import { Component, ElementRef, input, model, output, viewChild } from '@angular/core';
import { type FormValueControl, type ParseResult, transformedValue } from '@angular/forms/signals';
import { roundTo } from '@food/shared';
import { parseDecimal } from '../../../shared/utils/format';

export const NUMBER_PARSE_MESSAGE = 'Enter a number.';

export function parseOptionalNumber(text: string, decimals: number): ParseResult<number | null> {
  if (text.trim() === '') {
    return { value: null };
  }
  const parsed = parseDecimal(text);
  if (parsed === null) {
    return { error: { kind: 'parse', message: NUMBER_PARSE_MESSAGE } };
  }
  return { value: roundTo(parsed, decimals) };
}

export function formatOptionalNumber(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : String(value);
}

@Component({
  selector: 'app-decimal-field',
  host: { class: 'relative block' },
  template: `
    <input
      #input
      type="text"
      autocomplete="off"
      enterkeyhint="done"
      class="input text-right tabular-nums"
      [class.pr-12]="unit() !== ''"
      [attr.inputmode]="decimals() > 0 ? 'decimal' : 'numeric'"
      [attr.id]="inputId()"
      [attr.placeholder]="placeholder()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="invalid() && touched() ? 'true' : null"
      [disabled]="disabled()"
      [value]="raw()"
      (input)="onInput($event)"
      (blur)="onBlur()"
      (keydown.enter)="input.blur()"
    />
    @if (unit()) {
      <span
        class="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted"
        aria-hidden="true"
      >
        {{ unit() }}
      </span>
    }
  `,
})
export class DecimalField implements FormValueControl<number | null> {
  readonly value = model.required<number | null>();
  readonly invalid = input(false);
  readonly touched = input(false);
  readonly disabled = input(false);
  readonly touch = output<void>();

  readonly decimals = input(1);
  readonly unit = input('');
  readonly inputId = input<string | null>(null);
  readonly placeholder = input('');
  readonly ariaLabel = input<string | null>(null);
  readonly describedBy = input<string | null>(null);

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly raw = transformedValue(this.value, {
    parse: (text: string) => parseOptionalNumber(text, this.decimals()),
    format: formatOptionalNumber,
  });

  focus(options?: FocusOptions): void {
    this.inputRef().nativeElement.focus(options);
  }

  protected onInput(event: Event): void {
    this.raw.set((event.target as HTMLInputElement).value);
  }

  protected onBlur(): void {
    if (this.raw.parseErrors().length === 0) {
      this.raw.set(formatOptionalNumber(this.value()));
    }
    this.touch.emit();
  }
}
