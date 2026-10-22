import {
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  formatCount,
  formatPortion,
  guessMealType,
  type FavoriteDto,
  type LogFavoriteRequest,
  type MealType,
} from '@food/shared';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { AfterMidnightNote } from '../log/after-midnight-note';
import { currentDateTimeInput } from '../log/entry-timing';
import { injectDiscardGuard } from '../../shared/ui/discard-guard';
import { Icon } from '../../shared/ui/icon';
import { MacroSummary } from '../../shared/ui/macro-summary';
import { NumberInput } from '../../shared/ui/number-input';
import { Spinner } from '../../shared/ui/spinner';
import { formatGrams, formatNutrientValue } from '../../shared/utils/format';
import {
  canStepCount,
  countChips,
  countLabel,
  itemPortion,
  sameCount,
  scaledPortion,
  stepCount,
  toPortion,
  unitLabel,
} from '../../shared/utils/portion';
import {
  SERVINGS_MAX,
  SERVINGS_MIN,
  SERVINGS_PRESETS,
  clampServings,
  formatServings,
  minUnits,
  momentFromDateTimeLocal,
  scaledItemTotals,
  servingsForUnits,
  servingsLabel,
  servingsLimit,
  stepServings,
  unitsForServings,
} from './favorites-math';
import { MealTypePicker } from './meal-type-picker';

export const LOG_SHEET_ITEM_PREVIEW = 4;

interface LogChoices {
  servings: number;
  dateTime: string;
  mealType: MealType;
}

@Component({
  selector: 'app-log-favorite-sheet',
  imports: [
    AfterMidnightNote,
    BottomSheet,
    Icon,
    MacroSummary,
    NumberInput,
    Spinner,
    MealTypePicker,
  ],
  templateUrl: './log-favorite-sheet.html',
})
export class LogFavoriteSheet {
  private static nextId = 0;

  readonly favorite = input<FavoriteDto | null>(null);
  readonly busy = input(false);
  readonly open = model(false);
  readonly submitted = output<LogFavoriteRequest>();

  protected readonly idPrefix = `log-favorite-${LogFavoriteSheet.nextId++}`;
  protected readonly min = SERVINGS_MIN;
  protected readonly presets = SERVINGS_PRESETS;
  protected readonly servings = signal(1);
  protected readonly max = computed(() => servingsLimit(this.favorite()?.items ?? []));
  protected readonly limited = computed(() => this.max() < SERVINGS_MAX);
  protected readonly unit = computed(() => toPortion(this.favorite()?.portion));
  protected readonly units = computed(() => {
    const unit = this.unit();
    return unit ? unitsForServings(this.servings(), unit) : null;
  });
  protected readonly unitWord = computed(() => {
    const unit = this.unit();
    return unit ? unitLabel(unit, this.units() ?? 0) : '';
  });
  protected readonly minUnits = computed(() => {
    const unit = this.unit();
    return unit ? minUnits(unit) : 0;
  });
  protected readonly maxUnits = computed(() => {
    const unit = this.unit();
    return unit ? unitsForServings(this.max(), unit) : 0;
  });
  protected readonly unitQuestion = computed(() => {
    const unit = this.unit();
    return unit ? `How many ${unit.unitPlural}?` : 'Servings';
  });
  protected readonly unitPresets = computed(() => {
    const unit = this.unit();
    const units = this.units();
    if (!unit || units === null) {
      return [];
    }
    return countChips(unit.count).map((count) => ({
      count,
      label: formatCount(count),
      ariaLabel: countLabel(unit, count),
      selected: sameCount(units, count),
      disabled: count > this.maxUnits() + 1e-9 || count < this.minUnits() - 1e-9,
    }));
  });
  protected readonly dateTime = signal(currentDateTimeInput());
  protected readonly mealOverride = signal<MealType | null>(null);
  private readonly initial = signal<LogChoices | null>(null);

  protected readonly moment = computed(() => momentFromDateTimeLocal(this.dateTime()));
  protected readonly mealType = computed<MealType>(() => {
    const moment = this.moment();
    return (
      this.mealOverride() ??
      this.favorite()?.mealType ??
      guessMealType(moment ? new Date(moment.timestamp) : new Date())
    );
  });
  protected readonly preview = computed(() =>
    scaledItemTotals(this.favorite()?.items ?? [], this.servings()),
  );
  protected readonly items = computed(() => {
    const servings = this.servings();
    return (this.favorite()?.items ?? []).map((item, index) => {
      const grams = formatGrams(item.grams * servings);
      const count = scaledPortion(itemPortion(item), servings);
      return {
        key: index,
        name: item.name,
        grams: count ? `${formatPortion(count)} · ${grams}` : grams,
      };
    });
  });
  protected readonly visibleItems = computed(() => this.items().slice(0, LOG_SHEET_ITEM_PREVIEW));
  protected readonly hiddenItemCount = computed(() =>
    Math.max(0, this.items().length - LOG_SHEET_ITEM_PREVIEW),
  );
  protected readonly dirty = computed(() => {
    const initial = this.initial();
    return (
      initial !== null &&
      (this.servings() !== initial.servings ||
        this.dateTime() !== initial.dateTime ||
        this.mealType() !== initial.mealType)
    );
  });
  protected readonly canClose = injectDiscardGuard(
    () => this.dirty(),
    'The servings, meal and time you picked will be lost.',
  );
  protected readonly amountLabel = computed(() => {
    const unit = this.unit();
    const units = this.units();
    return unit && units !== null ? countLabel(unit, units) : servingsLabel(this.servings());
  });
  protected readonly limitLabel = computed(() => {
    const unit = this.unit();
    return unit ? countLabel(unit, this.maxUnits()) : servingsLabel(this.max());
  });
  protected readonly submitLabel = computed(
    () =>
      `Log ${this.amountLabel()} · ${formatNutrientValue('calories', this.preview().calories)} kcal`,
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.reset());
      }
    });
  }

  protected formatServings(value: number): string {
    return formatServings(value);
  }

  protected servingsLabel(value: number): string {
    return servingsLabel(value);
  }

  protected setServings(value: number): void {
    this.servings.set(clampServings(value, this.max()));
  }

  protected step(direction: 1 | -1): void {
    const unit = this.unit();
    const units = this.units();
    if (unit && units !== null) {
      this.setUnits(stepCount(units, direction));
      return;
    }
    this.servings.update((value) => stepServings(value, direction, this.max()));
  }

  protected setUnits(value: number): void {
    const unit = this.unit();
    if (unit) {
      this.servings.set(servingsForUnits(value, unit, this.max()));
    }
  }

  protected canStep(direction: 1 | -1): boolean {
    const units = this.units();
    if (units !== null) {
      return direction > 0
        ? units < this.maxUnits() - 1e-9
        : canStepCount(units, -1) && units > this.minUnits() + 1e-9;
    }
    return direction > 0 ? this.servings() < this.max() : this.servings() > this.min;
  }

  protected onDateTimeInput(event: Event): void {
    this.dateTime.set((event.target as HTMLInputElement).value);
  }

  protected setNow(): void {
    this.dateTime.set(currentDateTimeInput());
  }

  protected submit(): void {
    const moment = this.moment();
    if (!moment || this.busy() || !this.favorite()) {
      return;
    }
    this.submitted.emit({
      timestamp: moment.timestamp,
      localDate: moment.localDate,
      mealType: this.mealType(),
      servings: this.servings(),
    });
  }

  private reset(): void {
    this.servings.set(clampServings(1, this.max()));
    this.mealOverride.set(null);
    this.setNow();
    this.initial.set({
      servings: this.servings(),
      dateTime: this.dateTime(),
      mealType: this.mealType(),
    });
  }
}
