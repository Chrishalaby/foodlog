import {
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  API_LIMITS,
  MEAL_TYPES,
  MEAL_TYPE_LABELS,
  type FavoriteDto,
  type MealType,
  type Portion,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/errors';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { injectDiscardGuard } from '../../shared/ui/discard-guard';
import { Icon } from '../../shared/ui/icon';
import { ItemsEditor } from '../../shared/ui/items-editor/items-editor';
import {
  applyMealCount,
  createDraftItem,
  draftFromEntryItem,
  initialMealScale,
  toEntryItemInputs,
  type DraftItem,
  type MealScale,
} from '../../shared/ui/items-editor/items-math';
import { Spinner } from '../../shared/ui/spinner';
import { toPortion } from '../../shared/utils/portion';
import { MealPortion } from '../log/meal-portion';
import { validateFavoriteDraft } from './favorites-math';

export interface FavoriteSaved {
  favorite: FavoriteDto;
  created: boolean;
  previousName: string | null;
}

const MEAL_TYPE_NONE = '';

function draftSnapshot(
  name: string,
  mealType: MealType | null,
  items: readonly DraftItem[],
  portion: Portion | null,
): string {
  return JSON.stringify({
    name: name.trim(),
    mealType,
    items: toEntryItemInputs(items),
    portion,
  });
}

@Component({
  selector: 'app-favorite-editor-sheet',
  imports: [BottomSheet, Icon, ItemsEditor, MealPortion, Spinner],
  templateUrl: './favorite-editor-sheet.html',
})
export class FavoriteEditorSheet {
  private static nextId = 0;

  private readonly api = inject(ApiService);

  readonly favorite = input<FavoriteDto | null>(null);
  readonly open = model(false);
  readonly saved = output<FavoriteSaved>();
  readonly deleteRequested = output<FavoriteDto>();

  protected readonly idPrefix = `favorite-editor-${FavoriteEditorSheet.nextId++}`;
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly mealTypes = MEAL_TYPES;
  protected readonly mealTypeLabels = MEAL_TYPE_LABELS;
  protected readonly noneValue = MEAL_TYPE_NONE;
  protected readonly name = signal('');
  protected readonly mealType = signal<MealType | null>(null);
  protected readonly items = signal<DraftItem[]>([]);
  protected readonly portion = signal<Portion | null>(null);
  protected readonly scale = signal<MealScale>(initialMealScale(null));
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly title = computed(() => (this.favorite() ? 'Edit favorite' : 'New favorite'));
  private readonly baseline = signal('');
  protected readonly dirty = computed(
    () =>
      draftSnapshot(this.name(), this.mealType(), this.items(), this.portion()) !== this.baseline(),
  );
  protected readonly canClose = injectDiscardGuard(
    () => this.dirty(),
    'Your changes to this favorite will be lost.',
  );

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.reset(this.favorite()));
      }
    });
  }

  protected onNameInput(event: Event): void {
    this.name.set((event.target as HTMLInputElement).value);
    this.error.set(null);
  }

  protected onMealTypeChange(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    this.mealType.set(this.isMealType(value) ? value : null);
  }

  protected onItemsChange(items: DraftItem[]): void {
    this.items.set(items);
    this.error.set(null);
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

  protected setPortion(portion: Portion | null, rebase: boolean): void {
    if (rebase) {
      this.scale.set(initialMealScale(portion));
    }
    this.portion.set(portion);
  }

  protected requestDelete(): void {
    const favorite = this.favorite();
    if (favorite) {
      this.deleteRequested.emit(favorite);
    }
  }

  protected async save(): Promise<void> {
    if (this.saving()) {
      return;
    }
    const problem = validateFavoriteDraft(this.name(), this.items());
    if (problem) {
      this.error.set(problem);
      return;
    }
    const existing = this.favorite();
    const body = {
      name: this.name().trim(),
      mealType: this.mealType(),
      items: toEntryItemInputs(this.items()),
      portion: this.portion(),
    };
    this.saving.set(true);
    this.error.set(null);
    try {
      const favorite = existing
        ? await this.api.updateFavorite(existing.id, body)
        : await this.api.createFavorite(body);
      this.open.set(false);
      this.saved.emit({ favorite, created: !existing, previousName: existing?.name ?? null });
    } catch (err) {
      this.error.set(errorMessage(err, 'Could not save this favorite.'));
    } finally {
      this.saving.set(false);
    }
  }

  private reset(favorite: FavoriteDto | null): void {
    this.name.set(favorite?.name ?? '');
    this.mealType.set(favorite?.mealType ?? null);
    this.items.set(
      favorite && favorite.items.length > 0
        ? favorite.items.map((item) => draftFromEntryItem(item))
        : [createDraftItem()],
    );
    this.portion.set(toPortion(favorite?.portion));
    this.scale.set(initialMealScale(this.portion()));
    this.error.set(null);
    this.saving.set(false);
    this.baseline.set(draftSnapshot(this.name(), this.mealType(), this.items(), this.portion()));
  }

  private isMealType(value: string): value is MealType {
    return (MEAL_TYPES as readonly string[]).includes(value);
  }
}
