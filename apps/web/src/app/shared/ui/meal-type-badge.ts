import { Component, computed, input } from '@angular/core';
import { MEAL_TYPE_LABELS, type MealType } from '@food/shared';

export const MEAL_TYPE_TOKENS = {
  breakfast: 'carbs',
  lunch: 'brand',
  dinner: 'accent',
  snack: 'protein',
} as const satisfies Record<MealType, string>;

export const MEAL_BADGE_TINT_PERCENT = 14;
export const MEAL_BADGE_TEXT_PERCENT = 85;

@Component({
  selector: 'app-meal-type-badge',
  host: { class: 'inline-flex' },
  template: `
    <span
      class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4 font-semibold tracking-wide"
      [style.color]="color()"
      [style.background-color]="background()"
    >
      <span class="size-1.5 rounded-full bg-current"></span>
      {{ label() }}
    </span>
  `,
})
export class MealTypeBadge {
  readonly mealType = input.required<MealType>();

  protected readonly label = computed(() => MEAL_TYPE_LABELS[this.mealType()]);
  private readonly token = computed(() => `var(--color-${MEAL_TYPE_TOKENS[this.mealType()]})`);
  protected readonly color = computed(
    () => `color-mix(in srgb, ${this.token()} ${MEAL_BADGE_TEXT_PERCENT}%, var(--color-fg))`,
  );
  protected readonly background = computed(
    () => `color-mix(in srgb, ${this.token()} ${MEAL_BADGE_TINT_PERCENT}%, transparent)`,
  );
}
