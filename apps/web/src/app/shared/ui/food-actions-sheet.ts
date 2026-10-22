import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  linkedSignal,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { API_LIMITS, type FoodSearchResult } from '@food/shared';
import {
  canRenameResult,
  cleanFoodName,
  foodUseSummary,
  isProductResult,
  renameScope,
} from '../utils/food-library';
import { BottomSheet } from './bottom-sheet';
import { injectDiscardGuard } from './discard-guard';
import { FoodThumb } from './food-thumb';
import { Icon } from './icon';
import { Spinner } from './spinner';

export interface FoodActionsSelection {
  id: number;
  result: FoodSearchResult;
}

export type RenameFood = (result: FoodSearchResult, to: string) => Promise<boolean>;

type SheetView = 'actions' | 'rename';

let nextActionsId = 0;

@Component({
  selector: 'app-food-actions-sheet',
  imports: [BottomSheet, FoodThumb, Icon, Spinner],
  templateUrl: './food-actions-sheet.html',
})
export class FoodActionsSheet {
  private readonly nameInput = viewChild<ElementRef<HTMLInputElement>>('nameInput');

  readonly selection = input<FoodActionsSelection | null>(null);
  readonly open = model(false);
  readonly busy = input(false);
  readonly rename = input<RenameFood | null>(null);
  readonly adjust = output<FoodSearchResult>();
  readonly hide = output<FoodSearchResult>();
  readonly editProduct = output<FoodSearchResult>();
  readonly deleteProduct = output<FoodSearchResult>();

  protected readonly nameId = `food-actions-${nextActionsId++}-name`;
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly saving = signal(false);
  protected readonly result = computed(() => this.selection()?.result ?? null);
  protected readonly view = linkedSignal<SheetView>(() => {
    this.selection();
    return 'actions';
  });
  protected readonly draft = linkedSignal(() => this.selection()?.result.name ?? '');
  private readonly armed = linkedSignal(() => {
    this.selection();
    return false;
  });
  protected readonly product = computed(() => {
    const result = this.result();
    return result !== null && isProductResult(result);
  });
  protected readonly canRename = computed(() => {
    const result = this.result();
    return result !== null && this.rename() !== null && canRenameResult(result);
  });
  protected readonly summary = computed(() => {
    const result = this.result();
    return result ? foodUseSummary(result) : '';
  });
  protected readonly scope = computed(() => {
    const result = this.result();
    return result ? renameScope(result) : '';
  });
  private readonly cleanDraft = computed(() => cleanFoodName(this.draft()));
  protected readonly canSaveName = computed(() => {
    const result = this.result();
    const name = this.cleanDraft();
    return (
      result !== null && name.length > 0 && name !== result.name && !this.saving() && !this.busy()
    );
  });
  private readonly renameDirty = computed(() => {
    const result = this.result();
    return (
      this.view() === 'rename' &&
      result !== null &&
      this.cleanDraft() !== cleanFoodName(result.name)
    );
  });
  protected readonly canClose = injectDiscardGuard(
    () => this.renameDirty() && !this.saving(),
    'The new name won’t be saved.',
  );

  constructor() {
    afterRenderEffect(() => {
      const input = this.nameInput()?.nativeElement;
      if (input && this.view() === 'rename') {
        untracked(() => {
          input.focus({ preventScroll: true });
          input.select();
        });
      }
    });
  }

  protected arm(): void {
    this.armed.set(true);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected adjustAmount(event: MouseEvent): void {
    this.choose(event, (result) => this.adjust.emit(result));
  }

  protected startRename(event: MouseEvent): void {
    const result = this.result();
    if (result && this.accepts(event)) {
      this.draft.set(result.name);
      this.view.set('rename');
    }
  }

  protected startProductEdit(event: MouseEvent): void {
    this.choose(event, (result) => this.editProduct.emit(result));
  }

  protected remove(event: MouseEvent): void {
    this.choose(event, (result) =>
      isProductResult(result) ? this.deleteProduct.emit(result) : this.hide.emit(result),
    );
  }

  protected backToActions(): void {
    this.view.set('actions');
  }

  protected onName(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected async saveName(event: Event): Promise<void> {
    event.preventDefault();
    const result = this.result();
    const rename = this.rename();
    if (!result || !rename || !this.canSaveName()) {
      return;
    }
    this.saving.set(true);
    try {
      const renamed = await rename(result, this.cleanDraft());
      if (renamed && this.result()?.key === result.key) {
        this.open.set(false);
      }
    } finally {
      this.saving.set(false);
    }
  }

  private choose(event: MouseEvent, emit: (result: FoodSearchResult) => void): void {
    const result = this.result();
    if (!result || !this.accepts(event)) {
      return;
    }
    this.open.set(false);
    emit(result);
  }

  private accepts(event: MouseEvent): boolean {
    return event.detail === 0 || this.armed();
  }
}
