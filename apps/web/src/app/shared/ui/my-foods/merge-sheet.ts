import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
} from '@angular/core';
import {
  API_LIMITS,
  type FoodMergeSuggestion,
  type FoodMergeVariant,
  type FoodValueSource,
  type MyFoodChangeResponse,
} from '@food/shared';
import { errorMessage } from '../../../core/errors';
import { MyFoodsStore } from '../../../core/my-foods.store';
import { ToastService } from '../../../core/toast.service';
import { formatNumber, formatNutrientValue } from '../../utils/format';
import { VALUE_SOURCE_LABELS, kcalRangeText, pastItemsText } from '../../utils/saved-foods';
import { BottomSheet } from '../bottom-sheet';
import { Icon } from '../icon';
import { Spinner } from '../spinner';
import { ToggleRow } from '../toggle-row';
import {
  includedVariants,
  initialMergeDraft,
  mergePastItems,
  mergeRequest,
  mergedMessage,
  nameIsKeptApart,
  valuesVariant,
  withVariantIncluded,
  type MergeDraft,
} from './merge-model';

export const NAME_KEPT_APART = 'That name is unticked above. Tick it or use another name.';

export const MERGE_FAILED = 'Could not merge these foods.';

const SOURCE_CLASSES: Record<FoodValueSource, string> = {
  saved: 'bg-brand/15 text-brand',
  label: 'bg-carbs/15 text-carbs',
  estimate: 'bg-surface-2 text-muted',
};

let nextMergeId = 0;

@Component({
  selector: 'app-merge-sheet',
  imports: [BottomSheet, Icon, Spinner, ToggleRow],
  templateUrl: './merge-sheet.html',
})
export class MergeSheet {
  private readonly store = inject(MyFoodsStore);
  private readonly toast = inject(ToastService);

  readonly suggestion = input<FoodMergeSuggestion | null>(null);
  readonly open = model(false);
  readonly merged = output<MyFoodChangeResponse>();

  private readonly prefix = `merge-sheet-${nextMergeId++}`;
  protected readonly ids = {
    name: `${this.prefix}-name`,
    radios: `${this.prefix}-radio`,
  };
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly draft = linkedSignal<MergeDraft | null>(() => {
    const suggestion = this.suggestion();
    return suggestion ? initialMergeDraft(suggestion) : null;
  });
  protected readonly saving = signal(false);
  protected readonly failure = linkedSignal<string | null>(() => {
    this.suggestion();
    return null;
  });
  protected readonly submitted = linkedSignal(() => {
    this.suggestion();
    return false;
  });
  protected readonly choices = computed(() => {
    const suggestion = this.suggestion();
    const draft = this.draft();
    return suggestion && draft ? includedVariants(suggestion, draft) : [];
  });
  protected readonly chosen = computed(() => {
    const suggestion = this.suggestion();
    const draft = this.draft();
    return suggestion && draft ? valuesVariant(suggestion, draft) : null;
  });
  protected readonly pastItems = computed(() => {
    const suggestion = this.suggestion();
    const draft = this.draft();
    return suggestion && draft ? mergePastItems(suggestion, draft) : 0;
  });
  protected readonly pastItemsLabel = computed(() => pastItemsText(this.pastItems()));
  protected readonly nameKeptApart = computed(() => {
    const suggestion = this.suggestion();
    const draft = this.draft();
    return suggestion && draft ? nameIsKeptApart(suggestion, draft) : false;
  });
  protected readonly message = computed(() => {
    const failure = this.failure();
    if (failure) {
      return failure;
    }
    if (!this.submitted()) {
      return null;
    }
    if (this.choices().length === 0) {
      return 'Keep at least one name.';
    }
    if (!this.draft()?.name.trim()) {
      return 'Give the food a name.';
    }
    return this.nameKeptApart() ? NAME_KEPT_APART : null;
  });

  protected included(index: number): boolean {
    return this.draft()?.included.has(index) ?? false;
  }

  protected sourceLabel(variant: FoodMergeVariant): string {
    return VALUE_SOURCE_LABELS[variant.valueSource];
  }

  protected sourceClass(variant: FoodMergeVariant): string {
    return SOURCE_CLASSES[variant.valueSource];
  }

  protected range(variant: FoodMergeVariant): string {
    return kcalRangeText(variant.kcalPer100Min, variant.kcalPer100Max, variant.basisUnit);
  }

  protected timesText(variant: FoodMergeVariant): string {
    const count = variant.timesLogged;
    if (count <= 0) {
      return 'not logged yet';
    }
    return count === 1 ? 'logged once' : `logged ${formatNumber(count)} times`;
  }

  protected valuesText(variant: FoodMergeVariant): string {
    const per100 = variant.per100;
    return [
      `${formatNutrientValue('calories', per100.calories)} kcal`,
      `P ${formatNutrientValue('protein', per100.protein)}`,
      `C ${formatNutrientValue('carbs', per100.carbs)}`,
      `F ${formatNutrientValue('fat', per100.fat)}`,
    ].join(' · ');
  }

  protected toggle(index: number, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const suggestion = this.suggestion();
    this.draft.update((draft) =>
      draft && suggestion ? withVariantIncluded(suggestion, draft, index, checked) : draft,
    );
  }

  protected chooseValues(variant: FoodMergeVariant): void {
    const index = this.suggestion()?.variants.indexOf(variant) ?? -1;
    this.draft.update((draft) => (draft && index >= 0 ? { ...draft, valuesFrom: index } : draft));
  }

  protected onName(event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    this.draft.update((draft) => (draft ? { ...draft, name } : draft));
  }

  protected setApply(applyToPast: boolean): void {
    this.draft.update((draft) => (draft ? { ...draft, applyToPast } : draft));
  }

  protected async merge(event: Event): Promise<void> {
    event.preventDefault();
    const suggestion = this.suggestion();
    const draft = this.draft();
    this.submitted.set(true);
    if (!suggestion || !draft || this.saving()) {
      return;
    }
    const body = mergeRequest(suggestion, draft);
    if (!body) {
      return;
    }
    this.saving.set(true);
    this.failure.set(null);
    try {
      const response = await this.store.merge(body);
      this.toast.success(mergedMessage(response, body.applyToPast));
      this.merged.emit(response);
      this.open.set(false);
    } catch (err) {
      this.failure.set(errorMessage(err, MERGE_FAILED));
    } finally {
      this.saving.set(false);
    }
  }
}
