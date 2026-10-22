import { Component, computed, inject, input, linkedSignal, model, output } from '@angular/core';
import {
  CATALOG_SOURCE_LABELS,
  NUTRIENT_KEYS,
  NUTRIENT_META,
  catalogMissingLabel,
  guessMealType,
  microTargets,
  type CatalogFoodDto,
  type EntryDto,
  type EntryItemInput,
  type MealType,
} from '@food/shared';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { Icon } from '../../shared/ui/icon';
import { MicrosPanel } from '../../shared/ui/micros/micros-panel';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';
import { Spinner } from '../../shared/ui/spinner';
import { CatalogAmountPicker } from '../../shared/ui/catalog/catalog-amount-picker';
import {
  amountLabel,
  catalogAmountNutrients,
  catalogEntryItem,
  catalogFoodUrl,
  catalogSubtitle,
  defaultCatalogAmount,
  type CatalogAmount,
} from '../../shared/utils/catalog';
import { formatNutrientValue } from '../../shared/utils/format';
import { AfterMidnightNote } from './after-midnight-note';
import { currentDateTimeInput, mealTypeAt, timingFromInput } from './entry-timing';
import { LibraryActions } from './library-actions';
import type { LibraryDraft } from './log.store';
import { MealTypePicker } from './meal-type-picker';

export type CatalogSheetMode = 'log' | 'pick';

export interface CatalogSelection {
  id: number;
  food: CatalogFoodDto;
}

const MACROS = [
  { key: 'protein', short: 'P', label: 'Protein' },
  { key: 'carbs', short: 'C', label: 'Carbs' },
  { key: 'fat', short: 'F', label: 'Fat' },
] as const;

let nextSheetId = 0;

export function catalogIdentity(food: Pick<CatalogFoodDto, 'id'>): string {
  return `catalog:${food.id}`;
}

@Component({
  selector: 'app-catalog-food-sheet',
  imports: [
    AfterMidnightNote,
    BottomSheet,
    CatalogAmountPicker,
    Icon,
    MealTypePicker,
    MicrosPanel,
    Spinner,
  ],
  templateUrl: './catalog-food-sheet.html',
})
export class CatalogFoodSheet {
  private readonly actions = inject(LibraryActions, { optional: true });

  readonly selection = input<CatalogSelection | null>(null);
  readonly mode = input<CatalogSheetMode>('log');
  readonly open = model(false);
  readonly logged = output<EntryDto>();
  readonly picked = output<EntryItemInput>();
  readonly edit = output<LibraryDraft>();

  private readonly sheetId = nextSheetId++;
  protected readonly ids = {
    meal: `catalog-${this.sheetId}-meal`,
    time: `catalog-${this.sheetId}-time`,
    details: `catalog-${this.sheetId}-details`,
  };
  protected readonly microTargets = microTargets(null, null);
  protected readonly macros = MACROS.map((macro) => ({
    ...macro,
    color: NUTRIENT_COLORS[macro.key],
  }));

  protected readonly food = computed(() => this.selection()?.food ?? null);
  protected readonly amount = linkedSignal<CatalogAmount | null>(() => {
    const food = this.food();
    return food ? defaultCatalogAmount(food) : null;
  });
  protected readonly mealType = linkedSignal<MealType>(() => {
    this.selection();
    return guessMealType(new Date());
  });
  protected readonly mealTypeAuto = linkedSignal(() => {
    this.selection();
    return true;
  });
  protected readonly dateTime = linkedSignal(() => {
    this.selection();
    return currentDateTimeInput();
  });
  protected readonly showDetails = linkedSignal(() => {
    this.selection();
    return false;
  });
  protected readonly timing = computed(() => timingFromInput(this.dateTime()));
  protected readonly busy = computed(() => {
    const food = this.food();
    return food !== null && this.actions?.busyKey() === catalogIdentity(food);
  });
  protected readonly locked = computed(() => (this.actions?.busyKey() ?? null) !== null);
  protected readonly amountValid = computed(() => (this.amount()?.grams ?? 0) > 0);
  protected readonly canSubmit = computed(
    () =>
      this.amountValid() && !this.locked() && (this.mode() === 'pick' || this.timing() !== null),
  );
  protected readonly nutrients = computed(() => {
    const food = this.food();
    const amount = this.amount();
    return food && amount ? catalogAmountNutrients(food, amount) : null;
  });
  protected readonly item = computed(() => {
    const food = this.food();
    const amount = this.amount();
    return food && amount ? catalogEntryItem(food, amount) : null;
  });
  protected readonly subtitle = computed(() => {
    const food = this.food();
    return food ? catalogSubtitle(food) : '';
  });
  protected readonly sourceText = computed(() => {
    const food = this.food();
    return food ? `${CATALOG_SOURCE_LABELS[food.source]} · ${food.category}` : '';
  });
  protected readonly sourceUrl = computed(() => {
    const food = this.food();
    return food ? catalogFoodUrl(food) : null;
  });
  protected readonly missingText = computed(() => {
    const food = this.food();
    return food ? catalogMissingLabel(food.missing) : null;
  });
  protected readonly amountText = computed(() => {
    const amount = this.amount();
    return amount ? amountLabel(amount) : '';
  });
  protected readonly nutrientRows = computed(() => {
    const food = this.food();
    const nutrients = this.nutrients();
    if (!food || !nutrients) {
      return [];
    }
    return NUTRIENT_KEYS.filter((key) => key !== 'alcohol' || food.per100.alcohol > 0).map(
      (key) => ({
        key,
        label: NUTRIENT_META[key].label,
        amount: `${formatNutrientValue(key, nutrients[key])} ${NUTRIENT_META[key].unit}`,
        per100: `${formatNutrientValue(key, food.per100[key])} ${NUTRIENT_META[key].unit}`,
        missing: food.missing.includes(key),
      }),
    );
  });
  protected readonly submitLabel = computed(() => {
    const food = this.food();
    if (!food) {
      return '';
    }
    return this.mode() === 'pick' ? 'Add to meal' : `Log ${this.amountText()}`;
  });

  protected kcal(): string {
    return formatNutrientValue('calories', this.nutrients()?.calories ?? 0);
  }

  protected macroValue(key: 'protein' | 'carbs' | 'fat'): string {
    return `${formatNutrientValue(key, this.nutrients()?.[key] ?? 0)} g`;
  }

  protected pickMealType(mealType: MealType): void {
    this.mealType.set(mealType);
    this.mealTypeAuto.set(false);
  }

  protected onDateTime(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.dateTime.set(value);
    const guess = this.mealTypeAuto() ? mealTypeAt(value) : null;
    if (guess) {
      this.mealType.set(guess);
    }
  }

  protected toggleDetails(): void {
    this.showDetails.update((shown) => !shown);
  }

  protected async submit(): Promise<void> {
    const food = this.food();
    const item = this.item();
    if (!food || !item || !this.canSubmit()) {
      return;
    }
    if (this.mode() === 'pick') {
      this.picked.emit(item);
      this.open.set(false);
      return;
    }
    const timing = this.timing();
    if (!timing || !this.actions) {
      return;
    }
    const entry = await this.actions.logEntry(catalogIdentity(food), {
      name: item.name,
      mealType: this.mealType(),
      source: 'database',
      timestamp: timing.timestamp,
      localDate: timing.localDate,
      items: [item],
      ...(item.count && item.unit && item.unitPlural
        ? { portion: { count: item.count, unit: item.unit, unitPlural: item.unitPlural } }
        : {}),
    });
    if (entry) {
      this.open.set(false);
      this.logged.emit(entry);
    }
  }

  protected editFirst(): void {
    const item = this.item();
    if (!item || !this.amountValid()) {
      return;
    }
    this.open.set(false);
    this.edit.emit({
      name: item.name,
      items: [item],
      mealType: this.mealType(),
      mealTypeAuto: this.mealTypeAuto(),
      dateTime: this.dateTime(),
      photo: null,
      portion:
        item.count && item.unit && item.unitPlural
          ? { count: item.count, unit: item.unit, unitPlural: item.unitPlural }
          : null,
    });
  }
}
