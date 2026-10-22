import { Component, input, model } from '@angular/core';
import { MEAL_TYPES, MEAL_TYPE_LABELS, type MealType } from '@food/shared';

@Component({
  selector: 'app-meal-type-picker',
  host: { class: 'block @container' },
  template: `
    <div
      class="grid grid-cols-2 gap-1 rounded-2xl border border-line/70 bg-surface-2 p-1 @min-[19.5rem]:grid-cols-4"
      role="radiogroup"
      [attr.aria-labelledby]="labelledBy()"
      [attr.aria-label]="labelledBy() ? null : 'Meal type'"
    >
      @for (type of types; track type; let i = $index) {
        <button
          type="button"
          role="radio"
          class="flex min-h-11 min-w-0 items-center justify-center rounded-xl px-1 text-[13px] font-semibold transition duration-150"
          [class.bg-elevated]="type === value()"
          [class.text-fg]="type === value()"
          [class.shadow-soft]="type === value()"
          [class.text-muted]="type !== value()"
          [attr.aria-checked]="type === value()"
          [attr.tabindex]="type === value() ? 0 : -1"
          (click)="value.set(type)"
          (keydown)="onKeydown($event, i)"
        >
          <span class="truncate">{{ labels[type] }}</span>
        </button>
      }
    </div>
  `,
})
export class MealTypePicker {
  readonly value = model.required<MealType>();
  readonly labelledBy = input<string | null>(null);

  protected readonly types = MEAL_TYPES;
  protected readonly labels = MEAL_TYPE_LABELS;

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const nextIndex = (index + step + this.types.length) % this.types.length;
    this.value.set(this.types[nextIndex]);
    const group = (event.currentTarget as HTMLElement).parentElement;
    group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]').item(nextIndex)?.focus();
  }
}
