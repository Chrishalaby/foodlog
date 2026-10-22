import { Component, input, output } from '@angular/core';
import { MEAL_TYPES, MEAL_TYPE_LABELS, type MealType } from '@food/shared';

const STEP_KEYS: Readonly<Record<string, 1 | -1>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

@Component({
  selector: 'app-meal-type-picker',
  host: { class: 'block' },
  template: `
    <div
      class="grid grid-cols-4 gap-1 rounded-2xl border border-line/70 bg-surface-2 p-1"
      role="radiogroup"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-labelledby]="labelledBy()"
    >
      @for (option of options; track option.value; let i = $index) {
        <button
          type="button"
          role="radio"
          class="flex min-h-11 min-w-0 items-center justify-center rounded-xl px-1 text-[13px] font-semibold transition duration-150"
          [class.bg-elevated]="option.value === value()"
          [class.text-fg]="option.value === value()"
          [class.shadow-soft]="option.value === value()"
          [class.text-muted]="option.value !== value()"
          [attr.aria-checked]="option.value === value()"
          [attr.tabindex]="option.value === value() ? 0 : -1"
          (click)="pick(option.value)"
          (keydown)="onKeydown($event, i)"
        >
          <span class="truncate">{{ option.label }}</span>
        </button>
      }
    </div>
  `,
})
export class MealTypePicker {
  readonly value = input.required<MealType>();
  readonly ariaLabel = input<string | null>('Meal type');
  readonly labelledBy = input<string | null>(null);
  readonly picked = output<MealType>();

  protected readonly options = MEAL_TYPES.map((value) => ({
    value,
    label: MEAL_TYPE_LABELS[value],
  }));

  protected pick(value: MealType): void {
    if (value !== this.value()) {
      this.picked.emit(value);
    }
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const step = STEP_KEYS[event.key];
    if (!step) {
      return;
    }
    event.preventDefault();
    const nextIndex = (index + step + this.options.length) % this.options.length;
    const next = this.options[nextIndex];
    if (!next) {
      return;
    }
    this.pick(next.value);
    const group = (event.currentTarget as HTMLElement).parentElement;
    group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]').item(nextIndex)?.focus();
  }
}
