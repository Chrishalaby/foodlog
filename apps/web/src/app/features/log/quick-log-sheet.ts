import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  MAX_ITEM_GRAMS,
  PORTION_UNIT_MAX,
  formatCount,
  guessMealType,
  type EntryDto,
  type FoodSearchResult,
  type MealType,
} from '@food/shared';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { Icon } from '../../shared/ui/icon';
import { stepGrams } from '../../shared/ui/items-editor/items-math';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';
import { NumberInput } from '../../shared/ui/number-input';
import { Spinner } from '../../shared/ui/spinner';
import { formatNumber, formatNutrientValue, parseDecimal } from '../../shared/utils/format';
import {
  amountSummary,
  canStepCount,
  clampCount,
  countChips,
  countLabel,
  makePortion,
  sameCount,
  stepCount,
} from '../../shared/utils/portion';
import { currentDateTimeInput, mealTypeAt, timingFromInput } from './entry-timing';
import { resultDetail } from './food-search';
import { FoodThumb } from '../../shared/ui/food-thumb';
import { LibraryActions, canSavePortion, favoriteLibraryResult } from './library-actions';
import { AfterMidnightNote } from './after-midnight-note';
import type { LibraryDraft } from './log.store';
import { MealTypePicker } from './meal-type-picker';
import {
  GRAM_CHIP_FACTORS,
  QUICK_GRAMS_MIN,
  QUICK_SERVING_MAX,
  QUICK_SERVING_MIN,
  baselinePhrase,
  clampQuickGrams,
  clampServings,
  defaultMealType,
  defaultPortion,
  isValidPortion,
  portionFactor,
  quickBaseline,
  quickLogBody,
  quickLogGrams,
  quickLogTotals,
  resultPortion,
  scaledEntryItems,
  scaledResultPortion,
  stepQuickServings,
  usesGrams,
  type QuickPortion,
} from './quick-log-math';

export interface QuickLogSelection {
  id: number;
  result: FoodSearchResult;
  dateTime?: string;
}

interface PortionChip {
  value: number;
  label: string;
  detail: string | null;
  ariaLabel: string;
  selected: boolean;
}

const MACROS = [
  { key: 'protein', short: 'P', label: 'Protein' },
  { key: 'carbs', short: 'C', label: 'Carbs' },
  { key: 'fat', short: 'F', label: 'Fat' },
] as const;

const LEAD_LABELS = {
  meal: 'Last time',
  food: 'Last time',
  favorite: 'Favorite',
  product: '1 serving',
} as const;

const sameNumber = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;

let nextSheetId = 0;

@Component({
  selector: 'app-quick-log-sheet',
  imports: [AfterMidnightNote, BottomSheet, FoodThumb, Icon, MealTypePicker, NumberInput, Spinner],
  templateUrl: './quick-log-sheet.html',
})
export class QuickLogSheet {
  private readonly actions = inject(LibraryActions);
  private readonly injector = inject(Injector);
  private readonly countInput = viewChild<ElementRef<HTMLInputElement>>('countInput');

  readonly selection = input<QuickLogSelection | null>(null);
  readonly open = model(false);
  readonly logged = output<EntryDto>();
  readonly edit = output<LibraryDraft>();

  private readonly sheetId = nextSheetId++;
  protected readonly ids = {
    meal: `quick-log-${this.sheetId}-meal`,
    time: `quick-log-${this.sheetId}-time`,
    grams: `quick-log-${this.sheetId}-grams`,
    count: `quick-log-${this.sheetId}-count`,
    unit: `quick-log-${this.sheetId}-unit`,
    units: `quick-log-${this.sheetId}-units`,
  };
  protected readonly macros = MACROS.map((macro) => ({
    ...macro,
    color: NUTRIENT_COLORS[macro.key],
  }));
  protected readonly maxGrams = MAX_ITEM_GRAMS;
  protected readonly minGrams = QUICK_GRAMS_MIN;
  protected readonly unitMax = PORTION_UNIT_MAX;

  protected readonly result = linkedSignal<FoodSearchResult | null>(
    () => this.selection()?.result ?? null,
  );
  private readonly starredFrom = linkedSignal<FoodSearchResult | null>(() => {
    this.selection();
    return null;
  });
  protected readonly portion = linkedSignal<QuickPortion | null>(() => {
    const result = this.selection()?.result;
    return result ? defaultPortion(result) : null;
  });
  protected readonly mealType = linkedSignal<MealType>(() => {
    const result = this.selection()?.result;
    return result ? defaultMealType(result) : guessMealType(new Date());
  });
  protected readonly mealTypeAuto = linkedSignal(() => {
    const result = this.selection()?.result;
    return !(result?.kind === 'favorite' && result.mealType);
  });
  protected readonly dateTime = linkedSignal(
    () => this.selection()?.dateTime ?? currentDateTimeInput(),
  );
  protected readonly counting = linkedSignal(() => {
    this.selection();
    return false;
  });
  protected readonly countDraft = linkedSignal(() => {
    this.selection();
    return '';
  });
  protected readonly unitDraft = linkedSignal(() => {
    this.selection();
    return '';
  });

  protected readonly savingCount = signal(false);
  protected readonly title = computed(() => this.result()?.name ?? 'Log food');
  protected readonly detail = computed(() => {
    const result = this.result();
    return result ? resultDetail(result) : '';
  });
  protected readonly lastPortion = computed(() => {
    const result = this.result();
    return result ? resultPortion(result) : null;
  });
  protected readonly lead = computed(() => {
    const result = this.result();
    if (!result) {
      return null;
    }
    return {
      label: LEAD_LABELS[result.kind],
      text: amountSummary(this.lastPortion(), result.grams, result.totals.calories),
    };
  });
  protected readonly baseline = computed(() => {
    const result = this.result();
    return result ? quickBaseline(result) : 'serving';
  });
  protected readonly countLead = computed(() =>
    this.result()?.kind === 'favorite' ? 'This favorite is' : 'Last time was',
  );
  protected readonly amountQuestion = computed(() =>
    this.baseline() === 'last_time' ? 'How much this time?' : 'How much?',
  );
  protected readonly unitQuestion = computed(() => {
    const portion = this.lastPortion();
    return portion ? `How many ${portion.unitPlural}?` : '';
  });
  protected readonly timing = computed(() => timingFromInput(this.dateTime()));
  protected readonly factor = computed(() => {
    const result = this.result();
    const portion = this.portion();
    return result && portion ? portionFactor(result, portion) : 1;
  });
  protected readonly totals = computed(() => {
    const result = this.result();
    const portion = this.portion();
    return result && portion ? quickLogTotals(result, portion) : null;
  });
  protected readonly kcal = computed(() =>
    formatNutrientValue('calories', this.totals()?.calories ?? 0),
  );
  protected readonly busy = computed(() => {
    const result = this.result();
    return result !== null && this.actions.busyKey() === result.key && !this.savingCount();
  });
  protected readonly locked = computed(() => this.actions.busyKey() !== null);
  protected readonly portionValid = computed(() => {
    const portion = this.portion();
    return portion !== null && isValidPortion(portion);
  });
  protected readonly canLog = computed(
    () => this.portionValid() && this.timing() !== null && !this.locked(),
  );
  protected readonly hasWeight = computed(() => (this.result()?.grams ?? 0) > 0);
  protected readonly countChips = computed<PortionChip[]>(() => {
    const result = this.result();
    const last = this.lastPortion();
    const portion = this.portion();
    if (!result || !last || portion?.mode !== 'count') {
      return [];
    }
    return countChips(last.count).map((count) => {
      const grams = result.grams > 0 ? (result.grams * count) / last.count : 0;
      return {
        value: count,
        label: formatCount(count),
        detail: grams > 0 ? `${formatNumber(grams, 0)} g` : null,
        ariaLabel:
          grams > 0
            ? `${countLabel(last, count)}, ${formatNumber(grams, 0)} g`
            : countLabel(last, count),
        selected: sameCount(portion.count, count),
      };
    });
  });
  protected readonly amountChips = computed<PortionChip[]>(() => {
    const result = this.result();
    const portion = this.portion();
    if (!result || !portion || portion.mode === 'count' || this.lastPortion()) {
      return [];
    }
    const baseline = this.baseline();
    return GRAM_CHIP_FACTORS.map((factor) => {
      const grams = clampQuickGrams(result.grams * factor);
      const label = baselinePhrase(baseline, factor);
      const detail = result.grams > 0 ? `${formatNumber(grams, 0)} g` : null;
      return {
        value: factor,
        label,
        detail,
        ariaLabel: detail ? `${label}, ${detail}` : label,
        selected:
          portion.mode === 'grams'
            ? sameNumber(portion.grams, grams)
            : sameNumber(portion.servings, factor),
      };
    });
  });
  protected readonly amountText = computed(() => {
    const portion = this.portion();
    const last = this.lastPortion();
    if (portion?.mode === 'count' && last) {
      return countLabel(last, portion.count);
    }
    return portion?.mode === 'servings'
      ? baselinePhrase(this.baseline(), clampServings(portion.servings))
      : '';
  });
  protected readonly logLabel = computed(() => {
    const portion = this.portion();
    const last = this.lastPortion();
    return portion?.mode === 'count' && last
      ? `Log ${countLabel(last, portion.count)} · ${this.kcal()} kcal`
      : `Log · ${this.kcal()} kcal`;
  });
  protected readonly aboutGrams = computed(() => {
    const result = this.result();
    const portion = this.portion();
    if (!result || !portion || portion.mode === 'grams' || result.grams <= 0) {
      return null;
    }
    return `${formatNumber(quickLogGrams(result, portion), 0)} g`;
  });
  protected readonly offerCount = computed(() => {
    const result = this.result();
    return result !== null && canSavePortion(result);
  });
  protected readonly draftPortion = computed(() =>
    makePortion(parseDecimal(this.countDraft()) ?? 0, this.unitDraft()),
  );
  protected readonly unitPlaceholder = computed(() => {
    const count = parseDecimal(this.countDraft()) ?? 2;
    return count > 1 ? 'e.g. burgers' : 'e.g. burger';
  });

  protected macroValue(key: 'protein' | 'carbs' | 'fat'): string {
    return formatNutrientValue(key, this.totals()?.[key] ?? 0);
  }

  protected setGrams(grams: number): void {
    this.portion.set({ mode: 'grams', grams });
  }

  protected stepAmount(direction: 1 | -1): void {
    const portion = this.portion();
    if (!portion) {
      return;
    }
    switch (portion.mode) {
      case 'count':
        this.portion.set({ mode: 'count', count: stepCount(portion.count, direction) });
        return;
      case 'grams':
        this.portion.set({
          mode: 'grams',
          grams: clampQuickGrams(stepGrams(portion.grams, direction)),
        });
        return;
      case 'servings':
        this.portion.set({
          mode: 'servings',
          servings: stepQuickServings(portion.servings, direction),
        });
    }
  }

  protected pickCount(count: number): void {
    this.portion.set({ mode: 'count', count: clampCount(count) });
  }

  protected pickFactor(factor: number): void {
    const result = this.result();
    const portion = this.portion();
    if (!result || !portion) {
      return;
    }
    this.portion.set(
      portion.mode === 'grams'
        ? { mode: 'grams', grams: clampQuickGrams(result.grams * factor) }
        : { mode: 'servings', servings: clampServings(factor) },
    );
  }

  protected stepLabel(direction: 1 | -1): string {
    const portion = this.portion();
    const more = direction > 0;
    switch (portion?.mode) {
      case 'grams':
        return more ? 'More, more grams' : 'Less, fewer grams';
      case 'count':
        return `${more ? 'More' : 'Fewer'} ${this.lastPortion()?.unitPlural ?? ''}`.trim();
      default:
        return this.baseline() === 'serving'
          ? `${more ? 'More' : 'Fewer'} servings`
          : `${more ? 'More' : 'Less'} than last time`;
    }
  }

  protected canStep(direction: 1 | -1): boolean {
    const portion = this.portion();
    if (!portion) {
      return false;
    }
    switch (portion.mode) {
      case 'count':
        return canStepCount(portion.count, direction);
      case 'grams':
        return direction > 0 ? portion.grams < MAX_ITEM_GRAMS : portion.grams > QUICK_GRAMS_MIN;
      case 'servings':
        return direction > 0
          ? portion.servings < QUICK_SERVING_MAX
          : portion.servings > QUICK_SERVING_MIN;
    }
  }

  protected useGrams(): void {
    const result = this.result();
    const portion = this.portion();
    if (result && portion && result.grams > 0) {
      this.portion.set({ mode: 'grams', grams: quickLogGrams(result, portion) });
    }
  }

  protected useCount(): void {
    const last = this.lastPortion();
    if (last) {
      this.portion.set({ mode: 'count', count: clampCount(last.count * this.factor()) });
    }
  }

  protected startCounting(): void {
    this.countDraft.set('');
    this.unitDraft.set('');
    this.counting.set(true);
    afterNextRender(() => this.countInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected onCountDraft(event: Event): void {
    this.countDraft.set((event.target as HTMLInputElement).value);
  }

  protected onUnitDraft(event: Event): void {
    this.unitDraft.set((event.target as HTMLInputElement).value);
  }

  protected async savePortion(event: Event): Promise<void> {
    event.preventDefault();
    const result = this.result();
    const portion = this.draftPortion();
    if (!result || !portion || this.locked()) {
      return;
    }
    const factor = this.factor();
    this.savingCount.set(true);
    const saved = await this.actions
      .savePortion(result, portion)
      .finally(() => this.savingCount.set(false));
    if (!saved || this.result()?.key !== result.key) {
      return;
    }
    this.result.set(saved);
    this.counting.set(false);
    this.portion.set({ mode: 'count', count: clampCount(portion.count * factor) });
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

  protected async log(): Promise<void> {
    const result = this.result();
    const portion = this.portion();
    const timing = this.timing();
    if (!result || !portion || !timing || !this.canLog()) {
      return;
    }
    const entry = await this.actions.log(
      result,
      quickLogBody(result, portion, this.mealType(), timing),
    );
    if (entry) {
      this.open.set(false);
      this.logged.emit(entry);
    }
  }

  protected editFirst(): void {
    const result = this.result();
    const portion = this.portion();
    if (!result || !portion || !this.portionValid()) {
      return;
    }
    this.open.set(false);
    this.edit.emit({
      name: result.name,
      items: scaledEntryItems(result.items, portionFactor(result, portion)),
      mealType: this.mealType(),
      mealTypeAuto: this.mealTypeAuto(),
      dateTime: this.dateTime(),
      photo: result.kind === 'food' ? null : result.photo,
      portion: scaledResultPortion(result, portion),
    });
  }

  protected async toggleStar(): Promise<void> {
    const result = this.result();
    if (!result) {
      return;
    }
    if (result.starred) {
      await this.unstar(result);
      return;
    }
    const favorite = await this.actions.star(result);
    if (favorite && this.result()?.key === result.key) {
      const starred = favoriteLibraryResult(favorite);
      this.starredFrom.set(result);
      this.keepAmount(result, starred);
      this.result.set(starred);
    }
  }

  private keepAmount(from: FoodSearchResult, to: FoodSearchResult): void {
    const portion = this.portion();
    if (portion?.mode !== 'count' || resultPortion(to)) {
      return;
    }
    const factor = portionFactor(from, portion);
    this.portion.set(
      usesGrams(to)
        ? { mode: 'grams', grams: clampQuickGrams(to.grams * factor) }
        : { mode: 'servings', servings: clampServings(factor) },
    );
  }

  private async unstar(result: FoodSearchResult): Promise<void> {
    const removed = await this.actions.unstar(result);
    if (!removed || this.result()?.key !== result.key) {
      return;
    }
    const original = this.starredFrom();
    if (original) {
      this.starredFrom.set(null);
      this.result.set(original);
      return;
    }
    if (result.kind === 'favorite') {
      this.open.set(false);
      return;
    }
    this.result.set({ ...result, starred: false, favoriteId: null });
  }
}
