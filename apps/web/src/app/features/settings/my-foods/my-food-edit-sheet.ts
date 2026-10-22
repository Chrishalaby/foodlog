import { Component, computed, inject, input, linkedSignal, model, signal } from '@angular/core';
import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  MICRO_KEYS,
  MICRO_META,
  type MicroKey,
  type MyFoodDto,
  type NutrientKey,
} from '@food/shared';
import { errorMessage } from '../../../core/errors';
import { MyFoodsStore } from '../../../core/my-foods.store';
import { ToastService } from '../../../core/toast.service';
import { BottomSheet } from '../../../shared/ui/bottom-sheet';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import { injectDiscardGuard } from '../../../shared/ui/discard-guard';
import { Icon } from '../../../shared/ui/icon';
import { UNIT_NAME_MAX } from '../../../shared/ui/my-foods/save-my-food-sheet';
import { NumberInput } from '../../../shared/ui/number-input';
import { Spinner } from '../../../shared/ui/spinner';
import { ToggleRow } from '../../../shared/ui/toggle-row';
import { per100Fields, type Per100Field } from '../../log/barcode/product-form';
import {
  MAIN_VALUE_KEYS,
  MORE_VALUE_KEYS,
  addAlias,
  draftFromMyFood,
  emptyMyFoodDraft,
  myFoodDraftError,
  parseMicrosText,
  removeAlias,
  sameDraft,
  saveRequestFromDraft,
  updateRequestFromDraft,
  updatedMessage,
  valuesChanged,
  type MyFoodDraft,
} from './my-food-form';

export interface MyFoodEditTarget {
  id: number;
  food: MyFoodDto | null;
}

export const MY_FOOD_SAVE_FAILED = 'Could not save this food.';
export const MY_FOOD_DELETE_FAILED = 'Could not delete this food.';

let nextEditId = 0;

function pick(fields: readonly Per100Field[], keys: readonly NutrientKey[]): Per100Field[] {
  return keys
    .map((key) => fields.find((field) => field.key === key))
    .filter((field): field is Per100Field => field !== undefined);
}

@Component({
  selector: 'app-my-food-edit-sheet',
  imports: [BottomSheet, Icon, NumberInput, Spinner, ToggleRow],
  templateUrl: './my-food-edit-sheet.html',
})
export class MyFoodEditSheet {
  private readonly store = inject(MyFoodsStore);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly target = input<MyFoodEditTarget | null>(null);
  readonly open = model(false);

  private readonly prefix = `my-food-edit-${nextEditId++}`;
  protected readonly ids = {
    name: `${this.prefix}-name`,
    brand: `${this.prefix}-brand`,
    alias: `${this.prefix}-alias`,
    aliases: `${this.prefix}-aliases`,
    values: `${this.prefix}-values`,
    unit: `${this.prefix}-unit`,
    micros: `${this.prefix}-micros`,
  };
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly unitMax = UNIT_NAME_MAX;
  protected readonly maxGrams = MAX_ITEM_GRAMS;
  protected readonly microFields = MICRO_KEYS.map((key) => ({
    key,
    label: MICRO_META[key].label,
    unit: MICRO_META[key].unit,
  }));
  protected readonly food = computed(() => this.target()?.food ?? null);
  private readonly initial = computed(() => {
    const food = this.food();
    return food ? draftFromMyFood(food) : emptyMyFoodDraft();
  });
  protected readonly draft = linkedSignal<MyFoodDraft>(() => this.initial());
  protected readonly aliasText = linkedSignal(() => {
    this.target();
    return '';
  });
  protected readonly showMore = linkedSignal(() => {
    this.target();
    return false;
  });
  protected readonly applyToPast = linkedSignal(() => {
    this.target();
    return true;
  });
  protected readonly submitted = linkedSignal(() => {
    this.target();
    return false;
  });
  protected readonly failure = linkedSignal<string | null>(() => {
    this.target();
    return null;
  });
  protected readonly busy = signal<'save' | 'delete' | null>(null);
  protected readonly title = computed(() => (this.food() ? 'Edit my food' : 'Add a food'));
  protected readonly fields = computed(() => per100Fields(this.draft().basisUnit));
  protected readonly mainFields = computed(() => pick(this.fields(), MAIN_VALUE_KEYS));
  protected readonly moreFields = computed(() => pick(this.fields(), MORE_VALUE_KEYS));
  protected readonly linkedCount = computed(() => this.food()?.itemCount ?? 0);
  protected readonly showApplyToggle = computed(
    () => valuesChanged(this.food(), this.draft()) && this.linkedCount() > 0,
  );
  protected readonly dirty = computed(
    () => !sameDraft(this.draft(), this.initial()) || this.aliasText().trim() !== '',
  );
  protected readonly problem = computed(() => myFoodDraftError(this.draft()));
  protected readonly invalidMicro = computed(
    () => parseMicrosText(this.draft().microsText).invalid,
  );
  protected readonly message = computed(
    () => this.failure() ?? (this.submitted() ? this.problem() : null),
  );
  protected readonly canClose = injectDiscardGuard(
    () => this.dirty() && this.busy() === null,
    'Your changes to this food won’t be saved.',
  );

  protected textOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected setText(field: 'name' | 'brand' | 'unitName', event: Event): void {
    const value = this.textOf(event);
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected setValue(key: NutrientKey, value: number): void {
    this.draft.update((draft) => ({ ...draft, per100: { ...draft.per100, [key]: value } }));
  }

  protected setMicro(key: MicroKey, event: Event): void {
    const value = this.textOf(event);
    this.draft.update((draft) => ({ ...draft, microsText: { ...draft.microsText, [key]: value } }));
  }

  protected setUnitGrams(value: number): void {
    this.draft.update((draft) => ({ ...draft, unitGrams: value }));
  }

  protected addAlias(event?: Event): void {
    event?.preventDefault();
    const next = addAlias(this.draft(), this.aliasText());
    this.draft.set(next);
    this.aliasText.set('');
  }

  protected removeAlias(index: number): void {
    this.draft.update((draft) => removeAlias(draft, index));
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    this.submitted.set(true);
    if (this.invalidMicro() !== null) {
      this.showMore.set(true);
    }
    if (this.busy() !== null || this.problem() !== null) {
      return;
    }
    if (this.aliasText().trim()) {
      this.addAlias();
    }
    const food = this.food();
    const draft = this.draft();
    this.busy.set('save');
    this.failure.set(null);
    try {
      if (food) {
        const response = await this.store.update(
          food.id,
          updateRequestFromDraft(food, draft, this.applyToPast()),
        );
        this.toast.success(updatedMessage(response));
      } else {
        const created = await this.store.create(saveRequestFromDraft(draft));
        this.toast.success(`Added “${created.name}” to My foods`);
      }
      this.busy.set(null);
      this.open.set(false);
    } catch (err) {
      this.failure.set(errorMessage(err, MY_FOOD_SAVE_FAILED));
    } finally {
      this.busy.set(null);
    }
  }

  protected async remove(): Promise<void> {
    const food = this.food();
    if (!food || this.busy() !== null) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: `Delete “${food.name}” from My foods?`,
      message: 'Past logs keep their values.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.busy.set('delete');
    this.failure.set(null);
    try {
      await this.store.remove(food.id);
      this.toast.info(`Deleted “${food.name}”. Past logs keep their values.`);
      this.busy.set(null);
      this.open.set(false);
    } catch (err) {
      this.failure.set(errorMessage(err, MY_FOOD_DELETE_FAILED));
    } finally {
      this.busy.set(null);
    }
  }
}
