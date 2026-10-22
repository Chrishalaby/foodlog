import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  NUTRIENT_META,
  PORTION_UNIT_MAX,
  roundTo,
  type AmountSource,
  type Confidence,
  type FoodState,
  type MyFoodDto,
  type NutrientKey,
  type SavedFoodRef,
} from '@food/shared';
import { MyFoodsStore } from '../../../core/my-foods.store';
import { CatalogPickerSheet, type CatalogPick } from '../catalog/catalog-picker-sheet';
import { formatNumber, formatNutrientValue, parseDecimal } from '../../utils/format';
import { FLUID_ITEM_MAX_ML, itemMicrosPer100 } from '../../utils/micros';
import { savedFoodItemName, savedFoodRef } from '../../utils/saved-foods';
import { canStepCount, countLabel, stepCount, unitLabel } from '../../utils/portion';
import { Icon } from '../icon';
import { MacroSummary } from '../macro-summary';
import { EXTRA_NUTRIENT_KEYS, MACRO_KEYS, NUTRIENT_COLORS } from '../nutrient-colors';
import { NumberInput } from '../number-input';
import { SaveMyFoodSheet, type SaveMyFoodSeed } from '../my-foods/save-my-food-sheet';
import { SavedFoodSheet, type SavedFoodSheetRequest } from '../my-foods/saved-food-sheet';
import {
  ITEM_PORTION_FACTORS,
  applyItemFactor,
  attachSavedFood,
  createDraftItem,
  draftFromCatalogItem,
  isBlankDraftItem,
  defaultDrinkMl,
  gramsForFactor,
  hasItemFactor,
  isAddedByAi,
  isDrink,
  itemPer100,
  itemSuggestion,
  itemsTotals,
  linkSavedFood,
  needsSavedFoods,
  portionBaseGrams,
  portionFactorLabel,
  renameItem,
  rescaleItem,
  setItemCount,
  setItemFluid,
  setItemUnit,
  stepGrams,
  unlinkItem,
  updateNutrient,
  useSavedFood,
  type DraftItem,
} from './items-math';

interface NutrientField {
  key: NutrientKey;
  label: string;
  unit: string;
  decimals: number;
  max: number;
  color: string;
}

interface RemovedItem {
  item: DraftItem;
  index: number;
  siblings: ReadonlySet<string>;
}

export const UNDO_REMOVE_MS = 6000;

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
};

const CONFIDENCE_CLASSES: Record<Confidence, string> = {
  low: 'bg-warn/15 text-warn',
  medium: 'bg-accent/15 text-accent',
  high: 'bg-ok/15 text-ok',
};

const CONFIDENCE_DOTS: Record<Confidence, string> = {
  low: 'bg-warn',
  medium: 'bg-accent',
  high: 'bg-ok',
};

const AMOUNT_SOURCE_LABELS: Record<AmountSource, string> = {
  user_stated: 'Amount you gave',
  label: 'From label',
  visual_estimate: 'Visual estimate',
  assumed_hidden: 'Added by AI',
  typical_serving: 'Typical serving',
};

const AMOUNT_SOURCE_HINTS: Record<AmountSource, string> = {
  user_stated: 'from your description',
  label: 'from label',
  visual_estimate: 'estimated from photo',
  assumed_hidden: 'Added by AI',
  typical_serving: 'typical serving',
};

const FOOD_STATE_LABELS: Record<FoodState, string> = {
  raw: 'Raw',
  cooked: 'Cooked',
  dry_uncooked: 'Dry weight',
  as_served: 'As served',
};

function toField(key: NutrientKey): NutrientField {
  const meta = NUTRIENT_META[key];
  return {
    key,
    label: meta.label,
    unit: meta.unit,
    decimals: meta.decimals,
    max: meta.max,
    color: NUTRIENT_COLORS[key],
  };
}

function humanizeFlag(flag: string): string {
  const text = flag.replace(/[_-]+/g, ' ').trim();
  return text.length > 0 ? text[0].toUpperCase() + text.slice(1) : text;
}

function suggestionKey(item: Pick<DraftItem, 'key'>, foodId: string): string {
  return `${item.key}:${foodId}`;
}

function toggled(keys: ReadonlySet<string>, key: string, on: boolean): ReadonlySet<string> {
  if (keys.has(key) === on) {
    return keys;
  }
  const next = new Set(keys);
  if (on) {
    next.add(key);
  } else {
    next.delete(key);
  }
  return next;
}

@Component({
  selector: 'app-items-editor',
  imports: [
    CatalogPickerSheet,
    Icon,
    MacroSummary,
    NgTemplateOutlet,
    NumberInput,
    SaveMyFoodSheet,
    SavedFoodSheet,
  ],
  host: { class: 'block' },
  templateUrl: './items-editor.html',
})
export class ItemsEditor {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly myFoods = inject(MyFoodsStore);
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private sheetSeq = 0;
  private foodSheetKey: string | null = null;
  private saveKey: string | null = null;

  readonly items = model.required<DraftItem[]>();
  readonly showTotals = input(true);
  readonly allowAdd = input(true);
  readonly compact = input(false);
  readonly showErrors = input(false);

  protected readonly macroFields = MACRO_KEYS.map(toField);
  protected readonly extraFields = EXTRA_NUTRIENT_KEYS.map(toField);
  protected readonly itemFactors = ITEM_PORTION_FACTORS;
  protected readonly maxGrams = MAX_ITEM_GRAMS;
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly unitMax = PORTION_UNIT_MAX;
  protected readonly fluidMax = FLUID_ITEM_MAX_ML;
  protected readonly expanded = signal<ReadonlySet<string>>(new Set());
  protected readonly opened = signal<ReadonlySet<string>>(new Set());
  protected readonly touchedNames = signal<ReadonlySet<string>>(new Set());
  protected readonly counting = signal<ReadonlySet<string>>(new Set());
  protected readonly removed = signal<RemovedItem | null>(null);
  protected readonly totals = computed(() => itemsTotals(this.items()));
  protected readonly canAdd = computed(
    () => this.allowAdd() && this.items().length < API_LIMITS.itemsMax,
  );
  protected readonly pendingUndo = computed(() => {
    const removed = this.removed();
    if (!removed) {
      return null;
    }
    const items = this.items();
    const related =
      items.length === 0
        ? removed.siblings.size === 0
        : items.some((item) => removed.siblings.has(item.key));
    return related && !items.some((item) => item.key === removed.item.key) ? removed : null;
  });
  protected readonly undoIndex = computed(() => {
    const pending = this.pendingUndo();
    return pending ? Math.min(pending.index, this.items().length) : -1;
  });
  protected readonly hiddenSuggestions = signal<ReadonlySet<string>>(new Set());
  protected readonly suggestions = computed<ReadonlyMap<string, SavedFoodRef>>(() => {
    const foods = this.myFoods.foods();
    const hidden = this.hiddenSuggestions();
    const found = new Map<string, SavedFoodRef>();
    for (const item of this.items()) {
      const ref = itemSuggestion(item, foods);
      if (ref && !hidden.has(suggestionKey(item, ref.id))) {
        found.set(item.key, ref);
      }
    }
    return found;
  });
  protected readonly foodSheet = signal<SavedFoodSheetRequest | null>(null);
  protected readonly foodSheetOpen = signal(false);
  protected readonly saveSeed = signal<SaveMyFoodSeed | null>(null);
  protected readonly saveOpen = signal(false);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearUndoTimer());
    effect(() => {
      if (this.items().some(needsSavedFoods)) {
        untracked(() => void this.myFoods.ensureLoaded());
      }
    });
  }

  protected suggestion(item: DraftItem): SavedFoodRef | null {
    return this.suggestions().get(item.key) ?? null;
  }

  protected linkedName(item: DraftItem): string | null {
    const food = item.savedFood ?? this.myFoods.find(item.productId);
    return food ? savedFoodItemName(food) : null;
  }

  protected chipName(item: DraftItem): string | null {
    const linked = this.linkedName(item);
    return linked && linked.trim().toLowerCase() !== item.name.trim().toLowerCase() ? linked : null;
  }

  protected canSaveFood(item: DraftItem): boolean {
    return item.productId === null && item.grams > 0 && item.name.trim().length > 0;
  }

  protected useSuggestion(item: DraftItem, ref: SavedFoodRef): void {
    this.replaceKey(item.key, (current) => useSavedFood(current, ref));
  }

  protected hideSuggestion(item: DraftItem, ref: SavedFoodRef): void {
    this.hiddenSuggestions.update((keys) => toggled(keys, suggestionKey(item, ref.id), true));
  }

  protected openFoodMenu(item: DraftItem, index: number): void {
    this.openFoodSheet(item, index, 'menu');
  }

  protected openFoodPicker(item: DraftItem, index: number): void {
    this.openFoodSheet(item, index, 'pick');
  }

  protected openSaveFood(item: DraftItem): void {
    const per100 = itemPer100(item);
    if (!per100) {
      return;
    }
    const counted = item.count !== null && item.count > 0 && item.unit;
    this.saveKey = item.key;
    this.saveSeed.set({
      id: ++this.sheetSeq,
      name: item.name.trim(),
      brand: null,
      basisUnit: 'g',
      per100,
      microsPer100: itemMicrosPer100(item.micros, item.grams),
      unitName: counted ? item.unit : null,
      unitGrams: counted && item.count ? roundTo(item.grams / item.count, 1) : null,
      servingSizeG: null,
      source: 'manual',
    });
    this.saveOpen.set(true);
  }

  protected onUnlink(): void {
    const key = this.foodSheetKey;
    if (key) {
      this.replaceKey(key, (item) => this.unlinked(item, unlinkItem(item)));
    }
  }

  protected onPicked(food: MyFoodDto): void {
    const key = this.foodSheetKey;
    if (key) {
      this.replaceKey(key, (item) => useSavedFood(item, savedFoodRef(food)));
    }
  }

  protected onSavedFood(food: MyFoodDto): void {
    const key = this.saveKey;
    if (key) {
      this.replaceKey(key, (item) => linkSavedFood(item, savedFoodRef(food)));
    }
  }

  protected label(item: DraftItem, index: number): string {
    return item.name.trim() || `item ${index + 1}`;
  }

  protected confidenceLabel(confidence: Confidence): string {
    return CONFIDENCE_LABELS[confidence];
  }

  protected confidenceClass(confidence: Confidence): string {
    return CONFIDENCE_CLASSES[confidence];
  }

  protected dotClass(item: DraftItem): string {
    return item.confidence ? CONFIDENCE_DOTS[item.confidence] : 'bg-line';
  }

  protected amountSourceLabel(source: AmountSource): string {
    return AMOUNT_SOURCE_LABELS[source];
  }

  protected amountHint(item: DraftItem): string | null {
    const source = item.hints?.amountSource;
    return source && source !== 'assumed_hidden' ? AMOUNT_SOURCE_HINTS[source] : null;
  }

  protected stateLabel(state: FoodState): string {
    return FOOD_STATE_LABELS[state];
  }

  protected flagLabel(flag: string): string {
    return humanizeFlag(flag);
  }

  protected addedByAi(item: DraftItem): boolean {
    return isAddedByAi(item);
  }

  protected lowConfidence(item: DraftItem): boolean {
    return item.confidence === 'low';
  }

  protected value(key: NutrientKey, item: DraftItem): string {
    return formatNutrientValue(key, item.nutrients[key]);
  }

  protected gramsText(grams: number): string {
    return formatNumber(grams, 1);
  }

  protected countText(item: DraftItem): string | null {
    return item.count !== null && item.unit
      ? countLabel({ unit: item.unit, unitPlural: item.unitPlural ?? '' }, item.count)
      : null;
  }

  protected amountText(item: DraftItem): string {
    const grams = `${this.gramsText(item.grams)} g`;
    const count = this.countText(item);
    return count ? `${count} · ${grams}` : grams;
  }

  protected countValue(item: DraftItem): string {
    return item.count === null ? '' : formatNumber(item.count, 2).replace(/,/g, '');
  }

  protected unitValue(item: DraftItem): string {
    if (!item.unit) {
      return '';
    }
    return item.count === null
      ? item.unitPlural || item.unit
      : unitLabel({ unit: item.unit, unitPlural: item.unitPlural ?? '' }, item.count);
  }

  protected showCount(item: DraftItem): boolean {
    return item.count !== null || item.unit !== null || this.counting().has(item.key);
  }

  protected canStepCount(item: DraftItem, direction: 1 | -1): boolean {
    return item.count !== null && canStepCount(item.count, direction);
  }

  protected baseGrams(item: DraftItem): number {
    return portionBaseGrams(item);
  }

  protected factorLabel(factor: number): string {
    return `${portionFactorLabel(factor)}×`;
  }

  protected factorAria(item: DraftItem, factor: number): string {
    return `${this.factorLabel(factor)}, ${this.gramsText(gramsForFactor(item, factor))} g`;
  }

  protected hasFactor(item: DraftItem, factor: number): boolean {
    return hasItemFactor(item, factor);
  }

  protected nameInvalid(item: DraftItem): boolean {
    return (
      item.name.trim().length === 0 && (this.showErrors() || this.touchedNames().has(item.key))
    );
  }

  protected touchName(item: DraftItem): void {
    this.touchedNames.update((keys) => toggled(keys, item.key, true));
  }

  protected isOpen(item: DraftItem): boolean {
    return !this.compact() || this.opened().has(item.key) || item.name.trim().length === 0;
  }

  protected canCollapse(item: DraftItem): boolean {
    return this.compact() && item.name.trim().length > 0;
  }

  protected open(item: DraftItem): void {
    this.opened.update((keys) => toggled(keys, item.key, true));
    this.focusAfterRender(`button[data-item-collapse="${item.key}"]`);
  }

  protected collapse(item: DraftItem): void {
    this.opened.update((keys) => toggled(keys, item.key, false));
    this.focusAfterRender(`button[data-item-row="${item.key}"]`);
  }

  protected isExpanded(item: DraftItem): boolean {
    return this.expanded().has(item.key);
  }

  protected toggleExpanded(item: DraftItem): void {
    this.expanded.update((keys) => toggled(keys, item.key, !keys.has(item.key)));
  }

  protected rename(index: number, event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    const key = this.items()[index]?.key;
    if (key) {
      this.keepOpen(key);
    }
    this.replace(index, (item) => renameItem(item, name));
  }

  protected setGrams(index: number, grams: number): void {
    this.replace(index, (item) => rescaleItem(this.withSavedFood(item), grams));
  }

  protected step(index: number, direction: 1 | -1): void {
    this.replace(index, (item) =>
      rescaleItem(this.withSavedFood(item), stepGrams(item.grams, direction)),
    );
  }

  protected blurInput(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  protected addCount(item: DraftItem): void {
    this.counting.update((keys) => toggled(keys, item.key, true));
    this.focusAfterRender(`input[data-item-count="${item.key}"]`);
  }

  protected commitCount(index: number, event: Event): void {
    const target = event.target as HTMLInputElement;
    const text = target.value.trim();
    const parsed = text === '' ? null : parseDecimal(text);
    if (parsed !== null || text === '') {
      this.replace(index, (item) => setItemCount(this.withSavedFood(item), parsed));
    }
    const item = this.items()[index];
    target.value = item ? this.countValue(item) : '';
  }

  protected stepItemCount(index: number, direction: 1 | -1): void {
    this.replace(index, (item) =>
      item.count === null
        ? item
        : setItemCount(this.withSavedFood(item), stepCount(item.count, direction)),
    );
  }

  protected commitUnit(index: number, event: Event): void {
    const target = event.target as HTMLInputElement;
    this.replace(index, (item) => setItemUnit(item, target.value));
    const item = this.items()[index];
    target.value = item ? this.unitValue(item) : '';
  }

  protected applyFactor(index: number, factor: number): void {
    this.replace(index, (item) => applyItemFactor(this.withSavedFood(item), factor));
  }

  protected isDrink(item: DraftItem): boolean {
    return isDrink(item);
  }

  protected toggleDrink(index: number): void {
    this.replace(index, (item) => setItemFluid(item, isDrink(item) ? null : defaultDrinkMl(item)));
  }

  protected setDrinkMl(index: number, ml: number): void {
    if (ml > 0) {
      this.replace(index, (item) => setItemFluid(item, ml));
    }
  }

  protected setNutrient(index: number, key: NutrientKey, value: number): void {
    this.replace(index, (item) => this.unlinked(item, updateNutrient(item, key, value)));
  }

  protected remove(index: number): void {
    const items = this.items();
    const removed = items[index];
    if (!removed) {
      return;
    }
    const rest = items.filter((_, i) => i !== index);
    this.items.set(rest);
    this.expanded.update((keys) => toggled(keys, removed.key, false));
    this.opened.update((keys) => toggled(keys, removed.key, false));
    this.touchedNames.update((keys) => toggled(keys, removed.key, false));
    this.counting.update((keys) => toggled(keys, removed.key, false));
    this.removed.set({
      item: removed,
      index,
      siblings: new Set(rest.map((item) => item.key)),
    });
    this.clearUndoTimer();
    this.undoTimer = setTimeout(() => {
      this.undoTimer = null;
      this.removed.set(null);
    }, UNDO_REMOVE_MS);
  }

  protected undoRemove(): void {
    const pending = this.pendingUndo();
    this.clearUndoTimer();
    this.removed.set(null);
    if (!pending) {
      return;
    }
    this.items.update((items) => {
      const copy = [...items];
      copy.splice(Math.min(pending.index, copy.length), 0, pending.item);
      return copy;
    });
  }

  protected readonly catalogOpen = signal(false);

  protected addFromCatalog(pick: CatalogPick): void {
    const item = draftFromCatalogItem(pick.item, pick.food.per100, pick.food.microsPer100);
    this.keepOpen(item.key);
    this.items.update((items) => [...items.filter((current) => !isBlankDraftItem(current)), item]);
  }

  protected add(): void {
    const item = createDraftItem();
    this.keepOpen(item.key);
    this.items.update((items) => [...items, item]);
    this.focusAfterRender(`input[data-item-name="${item.key}"]`);
  }

  private keepOpen(key: string): void {
    if (this.compact()) {
      this.opened.update((keys) => toggled(keys, key, true));
    }
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(
      () => {
        this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
      },
      { injector: this.injector },
    );
  }

  private clearUndoTimer(): void {
    if (this.undoTimer !== null) {
      clearTimeout(this.undoTimer);
      this.undoTimer = null;
    }
  }

  private unlinked(before: DraftItem, after: DraftItem): DraftItem {
    const productId = before.productId;
    if (productId !== null && after.productId === null) {
      this.hiddenSuggestions.update((keys) =>
        toggled(keys, suggestionKey(before, productId), true),
      );
    }
    return after;
  }

  private withSavedFood(item: DraftItem): DraftItem {
    if (item.productId === null || item.savedFood !== null) {
      return item;
    }
    const food = this.myFoods.find(item.productId);
    return food ? attachSavedFood(item, savedFoodRef(food)) : item;
  }

  private openFoodSheet(item: DraftItem, index: number, view: 'menu' | 'pick'): void {
    this.foodSheetKey = item.key;
    this.foodSheet.set({
      id: ++this.sheetSeq,
      itemName: this.label(item, index),
      productId: item.productId,
      linkedName: this.linkedName(item),
      view,
    });
    this.foodSheetOpen.set(true);
    void this.myFoods.ensureLoaded();
  }

  private replaceKey(key: string, change: (item: DraftItem) => DraftItem): void {
    const index = this.items().findIndex((item) => item.key === key);
    if (index >= 0) {
      this.replace(index, change);
    }
  }

  private replace(index: number, change: (item: DraftItem) => DraftItem): void {
    this.items.update((items) => {
      const current = items[index];
      if (!current) {
        return items;
      }
      const next = change(current);
      if (next === current) {
        return items;
      }
      const copy = [...items];
      copy[index] = next;
      return copy;
    });
  }
}
