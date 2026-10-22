import { Component, computed, input, output } from '@angular/core';
import { MEAL_TYPE_LABELS, type EntryDto } from '@food/shared';
import { EntryCard } from '../../shared/ui/entry-card';
import { MealTypeBadge } from '../../shared/ui/meal-type-badge';
import { formatNumber } from '../../shared/utils/format';
import { groupEntriesByMeal } from './today-view';

@Component({
  selector: 'app-meal-timeline',
  imports: [EntryCard, MealTypeBadge],
  host: { class: 'block' },
  template: `
    <section aria-labelledby="meal-timeline-title">
      <div class="flex items-baseline justify-between">
        <h2 id="meal-timeline-title" class="section-title">Meals</h2>
        <span class="text-xs font-medium text-muted tabular-nums">{{ countLabel() }}</span>
      </div>
      <ol class="mt-2.5 space-y-5">
        @for (group of groups(); track group.id) {
          <li [attr.aria-label]="group.ariaLabel">
            <div class="mb-2 flex items-center justify-between gap-3 pl-0.5">
              <app-meal-type-badge [mealType]="group.mealType" />
              <span class="text-xs font-semibold text-muted tabular-nums">
                {{ group.calories }} kcal
              </span>
            </div>
            <ul class="space-y-2">
              @for (entry of group.entries; track entry.id) {
                <li class="animate-fade-in">
                  <app-entry-card
                    [entry]="entry"
                    [showMealType]="false"
                    (opened)="open.emit($event)"
                    (edit)="open.emit($event)"
                    (logAgain)="logAgain.emit($event)"
                    (favorite)="favorite.emit($event)"
                    (delete)="remove.emit($event)"
                  />
                </li>
              }
            </ul>
          </li>
        }
      </ol>
    </section>
  `,
})
export class MealTimeline {
  readonly entries = input.required<readonly EntryDto[]>();

  readonly open = output<EntryDto>();
  readonly logAgain = output<EntryDto>();
  readonly favorite = output<EntryDto>();
  readonly remove = output<EntryDto>();

  protected readonly groups = computed(() =>
    groupEntriesByMeal(this.entries()).map((group) => {
      const calories = formatNumber(group.calories);
      const label = MEAL_TYPE_LABELS[group.mealType];
      return {
        ...group,
        calories,
        ariaLabel: `${label}, ${calories} kcal`,
      };
    }),
  );

  protected readonly countLabel = computed(() => {
    const count = this.entries().length;
    return count === 1 ? '1 entry' : `${count} entries`;
  });
}
