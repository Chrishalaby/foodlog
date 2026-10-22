import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import type { FoodMergeSuggestion, MyFoodDto } from '@food/shared';
import { DataEventsService } from '../../../core/data-events.service';
import { errorMessage } from '../../../core/errors';
import { MyFoodsStore } from '../../../core/my-foods.store';
import { ToastService } from '../../../core/toast.service';
import { Icon } from '../../../shared/ui/icon';
import { mergeCardText } from '../../../shared/ui/my-foods/merge-model';
import { MergeSheet } from '../../../shared/ui/my-foods/merge-sheet';
import { PageHeader } from '../../../shared/ui/page-header';
import { Skeleton } from '../../../shared/ui/skeleton';
import { foldFoodText, searchSavedFoods } from '../../../shared/utils/food-match';
import {
  aliasesText,
  kcalPer100Text,
  lowerFirst,
  savedFoodBadges,
  timesUsed,
  usedText,
  type SavedFoodBadge,
} from '../../../shared/utils/saved-foods';
import { MyFoodEditSheet, type MyFoodEditTarget } from './my-food-edit-sheet';

export const MY_FOODS_BACK_LINK = '/settings';

const BADGE_CLASSES: Record<SavedFoodBadge, string> = {
  Barcode: 'bg-accent/15 text-accent',
  Label: 'bg-carbs/15 text-carbs',
  Manual: 'bg-surface-2 text-muted',
};

@Component({
  selector: 'app-my-foods-page',
  imports: [Icon, MergeSheet, MyFoodEditSheet, PageHeader, Skeleton],
  templateUrl: './my-foods-page.html',
})
export class MyFoodsPage {
  private readonly events = inject(DataEventsService);
  private readonly toast = inject(ToastService);
  private editSeq = 0;

  protected readonly store = inject(MyFoodsStore);
  protected readonly backLink = MY_FOODS_BACK_LINK;
  protected readonly query = signal('');
  protected readonly results = computed(() => searchSavedFoods(this.store.foods(), this.query()));
  protected readonly editTarget = signal<MyFoodEditTarget | null>(null);
  protected readonly editOpen = signal(false);
  protected readonly mergeTarget = signal<FoodMergeSuggestion | null>(null);
  protected readonly mergeOpen = signal(false);
  protected readonly dismissing = signal<string | null>(null);
  protected readonly subtitle = computed(() => {
    const count = this.store.foods().length;
    if (this.store.status() !== 'ready' || count === 0) {
      return 'The same food, the same values';
    }
    return count === 1 ? '1 saved food' : `${count} saved foods`;
  });

  constructor() {
    effect(() => {
      this.events.entries();
      this.events.products();
      untracked(() => {
        void this.store.ensureLoaded();
        void this.store.ensureSuggestions();
      });
    });
  }

  protected retry(): void {
    void this.store.refresh();
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected clearQuery(): void {
    this.query.set('');
  }

  protected add(): void {
    this.editTarget.set({ id: ++this.editSeq, food: null });
    this.editOpen.set(true);
  }

  protected edit(food: MyFoodDto): void {
    this.editTarget.set({ id: ++this.editSeq, food });
    this.editOpen.set(true);
  }

  protected review(suggestion: FoodMergeSuggestion): void {
    this.mergeTarget.set(suggestion);
    this.mergeOpen.set(true);
  }

  protected async dismiss(suggestion: FoodMergeSuggestion): Promise<void> {
    if (this.dismissing() !== null) {
      return;
    }
    this.dismissing.set(suggestion.key);
    try {
      await this.store.dismiss(suggestion.key);
      this.toast.info(`We won’t ask about ${lowerFirst(suggestion.label)} again.`);
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not update your suggestions.'));
    } finally {
      this.dismissing.set(null);
    }
  }

  protected suggestionText(suggestion: FoodMergeSuggestion): string {
    return mergeCardText(suggestion);
  }

  protected badges(food: MyFoodDto): SavedFoodBadge[] {
    return savedFoodBadges(food);
  }

  protected badgeClass(badge: SavedFoodBadge): string {
    return BADGE_CLASSES[badge];
  }

  protected brand(food: MyFoodDto): string | null {
    const brand = food.brand?.trim() ?? '';
    return brand && !foldFoodText(food.name.trim()).startsWith(foldFoodText(brand)) ? brand : null;
  }

  protected kcal(food: MyFoodDto): string {
    return kcalPer100Text(food.per100, food.basisUnit);
  }

  protected aliases(food: MyFoodDto): string | null {
    return aliasesText(food.aliases);
  }

  protected used(food: MyFoodDto): string {
    return usedText(timesUsed(food));
  }
}
