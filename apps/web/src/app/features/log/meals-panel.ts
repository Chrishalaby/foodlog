import { Component, computed, inject, output } from '@angular/core';
import { Icon } from '../../shared/ui/icon';
import { MealTypeBadge } from '../../shared/ui/meal-type-badge';
import { Spinner } from '../../shared/ui/spinner';
import { itemsTotals } from '../../shared/ui/items-editor/items-math';
import { formatNumber, formatNutrientValue } from '../../shared/utils/format';
import { relativeDayLabel, todayLocalDate } from '../../core/time';
import { LogStore } from './log.store';
import {
  mealClock,
  mealDayLabel,
  mealItemsLine,
  mealProblem,
  mealTitle,
  mealsCalories,
  sharedMealDay,
  type PendingMeal,
} from './meal-batch';
import { StickyActions } from './sticky-actions';

interface MealRow {
  readonly meal: PendingMeal;
  readonly title: string;
  readonly time: string;
  readonly day: string | null;
  readonly kcal: string;
  readonly protein: string;
  readonly items: string;
  readonly problem: string | null;
  readonly question: boolean;
  readonly warnings: number;
}

export function mealsTitle(count: number): string {
  return count === 1 ? '1 meal left' : `${count} meals found`;
}

export function mealsDayText(day: string | null, today: string): string {
  if (day === null) {
    return 'Eaten on different days';
  }
  const label = relativeDayLabel(day, today);
  return label === 'Today' || label === 'Yesterday'
    ? `Eaten ${label.toLowerCase()}`
    : `Eaten on ${label}`;
}

export function saveMealsLabel(count: number): string {
  return count === 1 ? 'Save meal' : `Save ${count} meals`;
}

@Component({
  selector: 'app-meals-panel',
  imports: [Icon, MealTypeBadge, Spinner, StickyActions],
  host: { class: 'block animate-fade-in' },
  templateUrl: './meals-panel.html',
})
export class MealsPanel {
  protected readonly store = inject(LogStore);

  readonly discard = output<void>();
  readonly save = output<void>();

  protected readonly today = todayLocalDate();
  protected readonly busy = computed(
    () => this.store.mealsSaving() || this.store.phase() === 'saved',
  );
  private readonly sharedDay = computed(() => sharedMealDay(this.store.meals()));
  protected readonly rows = computed<MealRow[]>(() => {
    const mixedDays = this.sharedDay() === null;
    return this.store.meals().map((meal) => {
      const totals = itemsTotals(meal.items);
      const result = meal.analysis.result;
      return {
        meal,
        title: mealTitle(meal),
        time: mealClock(meal),
        day: mixedDays ? (mealDayLabel(meal, this.today) ?? 'Today') : null,
        kcal: formatNutrientValue('calories', totals.calories),
        protein: formatNumber(totals.protein),
        items: mealItemsLine(meal),
        problem: mealProblem(meal),
        question: result.followUpQuestion !== null,
        warnings: result.warnings.length,
      };
    });
  });
  protected readonly title = computed(() => mealsTitle(this.rows().length));
  protected readonly saveLabel = computed(() => saveMealsLabel(this.rows().length));
  protected readonly day = computed(() => this.sharedDay() ?? '');
  protected readonly dayText = computed(() => mealsDayText(this.sharedDay(), this.today));
  protected readonly kcal = computed(() =>
    formatNutrientValue('calories', mealsCalories(this.store.meals())),
  );

  protected onDay(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value && value !== this.day()) {
      this.store.setMealsDay(value);
    }
  }

  protected onTime(row: MealRow, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (value && value !== row.time) {
      this.store.setMealTime(row.meal.id, value);
    }
  }
}
