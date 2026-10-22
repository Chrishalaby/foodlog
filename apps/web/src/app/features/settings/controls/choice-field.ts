import { Component, ElementRef, computed, inject, input, model, output } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { Icon, type IconName } from '../../../shared/ui/icon';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
  icon?: IconName;
}

export type ChoiceSize = 'md' | 'lg';

const SIZE_CLASSES: Record<ChoiceSize, string> = {
  md: 'min-h-11 text-sm has-checked:bg-elevated',
  lg: 'min-h-14 text-base has-checked:bg-brand/15 has-checked:ring-1 has-checked:ring-brand/60',
};

let nextChoiceId = 0;

@Component({
  selector: 'app-choice-field',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div
      role="radiogroup"
      class="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl border bg-surface-2 p-1"
      [class]="invalid() && touched() ? 'border-danger' : 'border-line/70'"
      [attr.aria-labelledby]="labelledBy()"
      [attr.aria-label]="labelledBy() ? null : ariaLabel()"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="invalid() && touched() ? 'true' : null"
    >
      @for (option of options(); track option.value) {
        <label
          class="relative flex cursor-pointer flex-col items-center justify-center rounded-xl px-2 py-1.5 text-center leading-tight font-semibold text-muted transition duration-150 select-none has-checked:text-fg has-checked:shadow-soft has-focus-visible:ring-2 has-focus-visible:ring-brand"
          [class]="sizeClass()"
        >
          <input
            type="radio"
            class="sr-only"
            [name]="groupName"
            [value]="option.value"
            [checked]="option.value === value()"
            (change)="select(option.value)"
            (blur)="touch.emit()"
          />
          <span class="flex items-center gap-1.5">
            @if (option.icon) {
              <app-icon [name]="option.icon" [size]="16" />
            }
            {{ option.label }}
          </span>
          @if (option.hint) {
            <span class="mt-0.5 text-[11px] font-medium text-muted">{{ option.hint }}</span>
          }
        </label>
      }
    </div>
  `,
})
export class ChoiceField<T extends string> implements FormValueControl<T> {
  readonly value = model.required<T>();
  readonly touch = output<void>();
  readonly options = input.required<readonly ChoiceOption<T>[]>();
  readonly labelledBy = input<string | null>(null);
  readonly ariaLabel = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly invalid = input(false);
  readonly touched = input(false);
  readonly size = input<ChoiceSize>('md');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly sizeClass = computed(() => SIZE_CLASSES[this.size()]);

  protected readonly groupName = `app-choice-${nextChoiceId++}`;

  focus(options?: FocusOptions): void {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLInputElement>('input:checked') ?? root.querySelector('input');
    target?.focus(options);
  }

  protected select(value: T): void {
    this.value.set(value);
  }
}
