import { Component, ElementRef, computed, input, model, output, viewChild } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { Icon } from '../../../shared/ui/icon';

export function clampStep(value: number, lower: number, upper: number): number {
  return Math.min(upper, Math.max(lower, Math.round(value)));
}

@Component({
  selector: 'app-stepper-field',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div class="flex items-center gap-2">
      <button
        type="button"
        class="btn btn-secondary btn-icon"
        tabindex="-1"
        [attr.aria-label]="decreaseLabel()"
        [disabled]="value() <= lower()"
        (click)="stepBy(-1)"
      >
        <app-icon name="minus" [size]="18" />
      </button>
      <div
        #spin
        role="spinbutton"
        tabindex="0"
        class="flex min-h-11 min-w-16 flex-1 items-center justify-center rounded-xl border border-line bg-surface-2 px-3 text-lg font-bold text-fg tabular-nums outline-none focus-visible:border-brand focus-visible:ring-4 focus-visible:ring-brand/20"
        [attr.aria-labelledby]="labelledBy()"
        [attr.aria-describedby]="describedBy()"
        [attr.aria-valuenow]="value()"
        [attr.aria-valuemin]="lower()"
        [attr.aria-valuemax]="upper()"
        [attr.aria-valuetext]="valueText()"
        (keydown)="onKeydown($event)"
        (blur)="touch.emit()"
      >
        {{ value() }}
      </div>
      <button
        type="button"
        class="btn btn-secondary btn-icon"
        tabindex="-1"
        [attr.aria-label]="increaseLabel()"
        [disabled]="value() >= upper()"
        (click)="stepBy(1)"
      >
        <app-icon name="plus" [size]="18" />
      </button>
    </div>
  `,
})
export class StepperField implements FormValueControl<number> {
  readonly value = model.required<number>();
  readonly min = input<number | undefined>(undefined);
  readonly max = input<number | undefined>(undefined);
  readonly touch = output<void>();

  readonly labelledBy = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly unitLabel = input('');
  readonly decreaseLabel = input('Decrease');
  readonly increaseLabel = input('Increase');

  private readonly spin = viewChild.required<ElementRef<HTMLElement>>('spin');

  protected readonly lower = computed(() => this.min() ?? 0);
  protected readonly upper = computed(() => this.max() ?? Number.MAX_SAFE_INTEGER);
  protected readonly valueText = computed(() =>
    this.unitLabel() ? `${this.value()} ${this.unitLabel()}` : String(this.value()),
  );

  focus(options?: FocusOptions): void {
    this.spin().nativeElement.focus(options);
  }

  protected stepBy(delta: number): void {
    this.setValue(this.value() + delta);
    this.touch.emit();
  }

  protected onKeydown(event: KeyboardEvent): void {
    const next = this.keyTarget(event.key);
    if (next === null) {
      return;
    }
    event.preventDefault();
    this.setValue(next);
  }

  private keyTarget(key: string): number | null {
    switch (key) {
      case 'ArrowUp':
      case 'ArrowRight':
        return this.value() + 1;
      case 'ArrowDown':
      case 'ArrowLeft':
        return this.value() - 1;
      case 'Home':
        return this.lower();
      case 'End':
        return this.upper();
      default:
        return null;
    }
  }

  private setValue(next: number): void {
    const clamped = clampStep(next, this.lower(), this.upper());
    if (clamped !== this.value()) {
      this.value.set(clamped);
    }
  }
}
