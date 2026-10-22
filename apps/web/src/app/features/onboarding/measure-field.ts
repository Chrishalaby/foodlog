import { Component, ElementRef, computed, input, model, output, viewChild } from '@angular/core';
import { type FormValueControl, transformedValue } from '@angular/forms/signals';
import { roundTo } from '@food/shared';
import { Icon } from '../../shared/ui/icon';
import { formatOptionalNumber, parseOptionalNumber } from '../settings/controls/decimal-field';

export function steppedValue(
  current: number | null,
  delta: number,
  start: number,
  lower: number,
  upper: number,
  decimals: number,
): number {
  const next = current === null ? start : current + delta;
  return roundTo(Math.min(upper, Math.max(lower, next)), decimals);
}

@Component({
  selector: 'app-measure-field',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div class="flex items-center gap-2">
      @if (step(); as delta) {
        <button
          type="button"
          class="btn btn-secondary size-14 shrink-0 rounded-2xl p-0"
          tabindex="-1"
          [attr.aria-label]="'Decrease ' + label()"
          [disabled]="disabled() || atLower()"
          (click)="stepBy(-delta)"
        >
          <app-icon name="minus" [size]="20" />
        </button>
      }
      <div class="relative min-w-0 flex-1">
        <input
          #input
          type="text"
          autocomplete="off"
          class="input h-14 rounded-2xl px-11 text-center text-2xl font-bold tabular-nums placeholder:font-medium placeholder:text-muted/30"
          [attr.inputmode]="decimals() > 0 ? 'decimal' : 'numeric'"
          [attr.enterkeyhint]="enterKeyHint()"
          [attr.id]="inputId()"
          [attr.placeholder]="placeholder()"
          [attr.aria-describedby]="describedBy()"
          [attr.aria-invalid]="invalid() && touched() ? 'true' : null"
          [attr.aria-required]="required() ? 'true' : null"
          [disabled]="disabled()"
          [value]="raw()"
          (input)="onInput($event)"
          (blur)="onBlur()"
          (keydown.enter)="onEnter($event)"
        />
        @if (unit()) {
          <span
            class="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-muted"
            aria-hidden="true"
          >
            {{ unit() }}
          </span>
        }
      </div>
      @if (step(); as delta) {
        <button
          type="button"
          class="btn btn-secondary size-14 shrink-0 rounded-2xl p-0"
          tabindex="-1"
          [attr.aria-label]="'Increase ' + label()"
          [disabled]="disabled() || atUpper()"
          (click)="stepBy(delta)"
        >
          <app-icon name="plus" [size]="20" />
        </button>
      }
    </div>
  `,
})
export class MeasureField implements FormValueControl<number | null> {
  readonly value = model.required<number | null>();
  readonly invalid = input(false);
  readonly touched = input(false);
  readonly disabled = input(false);
  readonly required = input(false);
  readonly touch = output<void>();
  readonly enter = output<void>();

  readonly inputId = input<string | null>(null);
  readonly label = input('value');
  readonly unit = input('');
  readonly placeholder = input('');
  readonly describedBy = input<string | null>(null);
  readonly decimals = input(1);
  readonly step = input<number | null>(null);
  readonly stepStart = input(0);
  readonly stepMin = input(Number.MIN_SAFE_INTEGER);
  readonly stepMax = input(Number.MAX_SAFE_INTEGER);
  readonly enterKeyHint = input<'next' | 'done'>('next');

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('input');

  protected readonly raw = transformedValue(this.value, {
    parse: (text: string) => parseOptionalNumber(text, this.decimals()),
    format: formatOptionalNumber,
  });
  protected readonly atLower = computed(() => {
    const value = this.value();
    return value !== null && value <= this.stepMin();
  });
  protected readonly atUpper = computed(() => {
    const value = this.value();
    return value !== null && value >= this.stepMax();
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

  protected onEnter(event: Event): void {
    event.preventDefault();
    this.onBlur();
    this.enter.emit();
  }

  protected stepBy(delta: number): void {
    this.value.set(
      steppedValue(
        this.value(),
        delta,
        this.stepStart(),
        this.stepMin(),
        this.stepMax(),
        this.decimals(),
      ),
    );
    this.touch.emit();
  }
}
