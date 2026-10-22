import { Component, computed, input, output, signal, viewChild } from '@angular/core';
import { MEAL_TYPE_LABELS, NUTRIENT_META, type EntryDto, type EntrySource } from '@food/shared';
import { toTimeLabel } from '../../core/time';
import { entryPhotoRefs, photoCountLabel } from '../utils/entry-photos';
import { formatNutrientValue } from '../utils/format';
import { amountLine, sumGrams } from '../utils/portion';
import { BottomSheet } from './bottom-sheet';
import { Icon, type IconName } from './icon';
import { MealTypeBadge } from './meal-type-badge';
import { NUTRIENT_COLORS } from './nutrient-colors';

export const ENTRY_SOURCE_ICONS: Record<EntrySource, IconName> = {
  food_photo: 'camera',
  nutrition_label: 'label',
  text: 'text',
  favorite: 'star',
  manual: 'edit',
  copy: 'copy',
  barcode: 'barcode',
  database: 'book',
  import: 'download',
};

type EntryCardAction = 'edit' | 'logAgain' | 'favorite' | 'delete';

@Component({
  selector: 'app-entry-card',
  imports: [Icon, MealTypeBadge, BottomSheet],
  host: { class: 'block' },
  templateUrl: './entry-card.html',
})
export class EntryCard {
  private static nextId = 0;

  private readonly menu = viewChild(BottomSheet);

  readonly entry = input.required<EntryDto>();
  readonly showActions = input(true);
  readonly showMealType = input(true);

  readonly opened = output<EntryDto>();
  readonly edit = output<EntryDto>();
  readonly logAgain = output<EntryDto>();
  readonly favorite = output<EntryDto>();
  readonly delete = output<EntryDto>();

  protected readonly nameId = `app-entry-card-name-${EntryCard.nextId++}`;
  protected readonly menuOpen = signal(false);
  protected readonly photos = computed(() => entryPhotoRefs(this.entry()));
  protected readonly thumbUrl = computed(
    () => this.entry().photo?.thumbUrl ?? this.photos()[0]?.photo.thumbUrl ?? null,
  );
  protected readonly extraPhotos = computed(() => Math.max(0, this.photos().length - 1));
  protected readonly photoCount = computed(() => photoCountLabel(this.photos().length));
  protected readonly sourceIcon = computed(() => ENTRY_SOURCE_ICONS[this.entry().source]);
  protected readonly time = computed(() => toTimeLabel(this.entry().timestamp));
  protected readonly amount = computed(() => {
    const entry = this.entry();
    return amountLine(entry.portion, sumGrams(entry.items));
  });
  protected readonly calories = computed(() =>
    formatNutrientValue('calories', this.entry().totals.calories),
  );
  protected readonly macros = computed(() => {
    const totals = this.entry().totals;
    return (['protein', 'carbs', 'fat'] as const).map((key) => ({
      key,
      letter: key[0].toUpperCase(),
      label: NUTRIENT_META[key].label.toLowerCase(),
      value: formatNutrientValue(key, totals[key]),
      color: NUTRIENT_COLORS[key],
    }));
  });

  protected readonly summaryLabel = computed(() => {
    const entry = this.entry();
    const parts = [entry.name];
    if (this.showMealType()) {
      parts.push(MEAL_TYPE_LABELS[entry.mealType]);
    }
    const time = this.time();
    if (time) {
      parts.push(time);
    }
    const amount = this.amount();
    if (amount) {
      parts.push(amount);
    }
    parts.push(`${this.calories()} kcal`);
    const macros = this.macros()
      .map((macro) => `${macro.label} ${macro.value} g`)
      .join(', ');
    const photos = this.extraPhotos() > 0 ? `, ${this.photoCount()}` : '';
    return `${parts.join(', ')}, ${macros}${photos}`;
  });

  protected run(action: EntryCardAction): void {
    this.menu()?.close();
    const entry = this.entry();
    switch (action) {
      case 'edit':
        this.edit.emit(entry);
        break;
      case 'logAgain':
        this.logAgain.emit(entry);
        break;
      case 'favorite':
        this.favorite.emit(entry);
        break;
      case 'delete':
        this.delete.emit(entry);
        break;
    }
  }
}
