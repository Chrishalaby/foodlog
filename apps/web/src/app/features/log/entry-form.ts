import {
  Component,
  ElementRef,
  computed,
  effect,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { API_LIMITS, type MealType, type Portion } from '@food/shared';
import { ItemsEditor } from '../../shared/ui/items-editor/items-editor';
import {
  applyMealCount,
  applyMealPortion,
  initialMealScale,
  itemsMicros,
  type DraftItem,
  type MealScale,
} from '../../shared/ui/items-editor/items-math';
import { Icon } from '../../shared/ui/icon';
import { MicrosCard } from '../../shared/ui/micros/micros-card';
import { currentDateTimeInput, mealTypeAt, parseDateTimeInput } from './entry-timing';
import { sameFoodName } from './food-search';
import { AfterMidnightNote, type StoredDay } from './after-midnight-note';
import { MealPortion } from './meal-portion';
import { MealTypePicker } from './meal-type-picker';
import { PhotoTimeNote } from './photo-time-note';

let nextFormId = 0;

@Component({
  selector: 'app-entry-form',
  imports: [
    AfterMidnightNote,
    ItemsEditor,
    Icon,
    MealPortion,
    MealTypePicker,
    MicrosCard,
    PhotoTimeNote,
  ],
  host: { class: 'block' },
  templateUrl: './entry-form.html',
})
export class EntryForm {
  readonly name = model.required<string>();
  readonly mealType = model.required<MealType>();
  readonly dateTime = model.required<string>();
  readonly items = model.required<DraftItem[]>();
  readonly portion = model<Portion | null>(null);
  readonly thumbUrl = input<string | null>(null);
  readonly namePlaceholder = input('Meal name');
  readonly autoMealType = input(false);
  readonly portionBaseline = input<unknown>(null);
  readonly showPortion = input(true);
  readonly photoTime = input<string | null>(null);
  readonly showErrors = input(false);
  readonly storedDay = input<StoredDay | null>(null);
  readonly mealTypePicked = output<MealType>();
  readonly photoOpen = output<void>();
  readonly recount = output<void>();

  private readonly timeInput = viewChild<ElementRef<HTMLInputElement>>('timeInput');
  private readonly filledKeys = signal<ReadonlySet<string>>(new Set());
  private itemNameBaseline = new Map<string, string>();
  private manualItemKeys = new Set<string>();

  protected readonly ids = {
    name: `entry-form-${nextFormId}-name`,
    meal: `entry-form-${nextFormId}-meal`,
    time: `entry-form-${nextFormId}-time`,
    items: `entry-form-${nextFormId++}-items`,
  };
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly timeInvalid = computed(() => parseDateTimeInput(this.dateTime()) === null);
  protected readonly scale = linkedSignal<unknown, MealScale>({
    source: this.portionBaseline,
    computation: () => initialMealScale(untracked(this.portion)),
  });
  protected readonly portionVisible = computed(
    () =>
      this.showPortion() &&
      this.items().some((item) => item.grams > 0 || item.nutrients.calories > 0),
  );
  protected readonly mealMicros = computed(() => {
    const meal = itemsMicros(this.items());
    return meal.coverage.withMicros > 0 ? meal : null;
  });
  protected readonly microsOpen = linkedSignal<unknown, boolean>({
    source: this.portionBaseline,
    computation: () => false,
  });
  protected readonly compactItems = computed(() => {
    const items = this.items();
    const only = items.length === 1 ? items[0] : undefined;
    return !only || !this.filledKeys().has(only.key);
  });

  constructor() {
    effect(() => {
      this.portionBaseline();
      untracked(() => this.resetNameSync());
    });
  }

  protected onName(event: Event): void {
    const previous = this.name();
    const value = (event.target as HTMLInputElement).value;
    this.name.set(value);
    this.syncSingleItemName(previous, value);
  }

  protected onMealType(mealType: MealType): void {
    this.mealType.set(mealType);
    this.mealTypePicked.emit(mealType);
  }

  protected onDateTime(event: Event): void {
    this.setDateTime((event.target as HTMLInputElement).value);
  }

  protected setNow(): void {
    this.setDateTime(currentDateTimeInput());
  }

  protected usePhotoTime(value: string): void {
    this.setDateTime(value);
  }

  protected changeTime(): void {
    const input = this.timeInput()?.nativeElement;
    if (!input) {
      return;
    }
    input.focus();
    try {
      input.showPicker?.();
    } catch {
      return;
    }
  }

  protected pickPortion(factor: number): void {
    const scale = this.scale();
    const result = applyMealPortion(this.items(), scale.state, factor);
    this.scale.set({ ...scale, state: result.state });
    this.items.set(result.items);
  }

  protected pickCount(count: number): void {
    const portion = this.portion();
    const result = portion ? applyMealCount(this.items(), portion, this.scale(), count) : null;
    if (result) {
      this.scale.set(result.scale);
      this.items.set(result.items);
      this.portion.set(result.portion);
    }
  }

  protected renamePortion(portion: Portion): void {
    this.portion.set(portion);
  }

  protected addPortion(portion: Portion): void {
    this.scale.set(initialMealScale(portion));
    this.portion.set(portion);
  }

  protected removePortion(): void {
    this.scale.set(initialMealScale(null));
    this.portion.set(null);
  }

  private setDateTime(value: string): void {
    if (value === this.dateTime()) {
      return;
    }
    this.dateTime.set(value);
    const guess = this.autoMealType() ? mealTypeAt(value) : null;
    if (guess) {
      this.mealType.set(guess);
    }
  }

  private resetNameSync(): void {
    this.itemNameBaseline = new Map(this.items().map((item) => [item.key, item.name]));
    this.manualItemKeys = new Set();
    this.filledKeys.set(new Set());
  }

  private syncSingleItemName(previous: string, value: string): void {
    const items = this.items();
    const item = items.length === 1 ? items[0] : undefined;
    const name = value.trim().slice(0, API_LIMITS.nameMax);
    if (!item || !name || item.name === name || !this.itemFollowsName(item, previous)) {
      return;
    }
    if (item.name.trim() === '') {
      this.filledKeys.update((keys) => new Set(keys).add(item.key));
    }
    this.itemNameBaseline.set(item.key, name);
    this.items.set([{ ...item, name }]);
  }

  private itemFollowsName(item: DraftItem, previousMealName: string): boolean {
    if (this.manualItemKeys.has(item.key)) {
      return false;
    }
    const baseline = this.itemNameBaseline.get(item.key);
    const untouched = baseline === undefined ? item.name.trim() === '' : item.name === baseline;
    if (untouched || sameFoodName(item.name, previousMealName)) {
      return true;
    }
    this.manualItemKeys.add(item.key);
    return false;
  }
}
