import {
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  API_LIMITS,
  guessMealType,
  zeroNutrients,
  type CatalogFoodDto,
  type FoodSearchResult,
} from '@food/shared';
import { AiAvailability } from '../../core/ai-availability.service';
import { CaptureService } from '../../core/capture.service';
import { KeyboardPrimer } from '../../core/keyboard-primer';
import { ToastService } from '../../core/toast.service';
import { VoiceIntentService } from '../../core/voice-intent.service';
import { VoiceRecorderService } from '../../core/voice-recorder.service';
import {
  FoodActionsSheet,
  type FoodActionsSelection,
  type RenameFood,
} from '../../shared/ui/food-actions-sheet';
import { Icon } from '../../shared/ui/icon';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { hasLibraryMenu } from '../../shared/utils/food-library';
import { formatNutrientValue } from '../../shared/utils/format';
import { ProductEditSheet } from './barcode/product-edit-sheet';
import { ProductLibrary } from './barcode/product-library';
import { CatalogFoodSheet, catalogIdentity, type CatalogSelection } from './catalog-food-sheet';
import { CatalogResultRow } from '../../shared/ui/catalog/catalog-result-row';
import { CatalogSuggestions } from './catalog-suggestions.store';
import { DraftsList } from './drafts/drafts-list';
import { currentDateTimeInput, logNowTiming } from './entry-timing';
import { foodNameKey } from './food-search';
import { FoodResultRow } from './food-result-row';
import { FoodSearchStore } from './food-search.store';
import { LibraryActions } from './library-actions';
import type { LibraryDraft } from './log.store';
import { QuickLogSheet, type QuickLogSelection } from './quick-log-sheet';
import { defaultMealType, defaultPortion, quickLogBody } from './quick-log-math';
import { StickyActions } from './sticky-actions';

@Component({
  selector: 'app-capture-home',
  imports: [
    CatalogFoodSheet,
    CatalogResultRow,
    DraftsList,
    FoodActionsSheet,
    FoodResultRow,
    Icon,
    NgTemplateOutlet,
    ProductEditSheet,
    QuickLogSheet,
    RouterLink,
    Skeleton,
    Spinner,
    StickyActions,
  ],
  host: { class: 'block' },
  providers: [CatalogSuggestions],
  templateUrl: './capture-home.html',
  styleUrl: './capture-home.css',
})
export class CaptureHome {
  protected readonly search = inject(FoodSearchStore);
  protected readonly catalog = inject(CatalogSuggestions);
  protected readonly ai = inject(AiAvailability);
  protected readonly actions = inject(LibraryActions);
  private readonly capture = inject(CaptureService);
  private readonly keyboardPrimer = inject(KeyboardPrimer);
  private readonly products = inject(ProductLibrary);
  private readonly toast = inject(ToastService);
  private readonly voiceIntent = inject(VoiceIntentService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private selectionSeq = 0;

  readonly focusSearch = input(false);
  readonly focusDrafts = input(false);
  readonly searchFocused = output<void>();
  readonly describe = output<string>();
  readonly manual = output<void>();
  readonly edit = output<LibraryDraft>();

  protected readonly queryMax = API_LIMITS.foodQueryMax;
  protected readonly voiceSupported = inject(VoiceRecorderService).supported;
  protected readonly tileColumns = computed(() => {
    if (!this.ai.enabled()) {
      return 'grid-cols-1';
    }
    return this.voiceSupported ? 'capture-tiles-stacked grid-cols-4' : 'grid-cols-3';
  });
  protected readonly skeletons = [0, 1, 2, 3];
  protected readonly selection = signal<QuickLogSelection | null>(null);
  protected readonly catalogSelection = signal<CatalogSelection | null>(null);
  protected readonly catalogOpen = signal(false);
  protected readonly sheetOpen = signal(false);
  protected readonly menuSelection = signal<FoodActionsSelection | null>(null);
  protected readonly menuOpen = signal(false);
  protected readonly productTarget = signal<FoodSearchResult | null>(null);
  protected readonly productEditorOpen = signal(false);
  protected readonly renameFood: RenameFood = async (result, to) =>
    (await this.actions.rename(result, to)) !== null;
  protected readonly now = computed(() => {
    this.search.results();
    return new Date();
  });
  protected readonly query = this.search.query;
  protected readonly browsing = this.search.browsing;
  protected readonly highlightQuery = computed(() => this.search.shownQuery() ?? '');
  protected readonly initialLoading = computed(
    () => !this.search.loaded() && this.search.error() === null,
  );
  protected readonly loadFailed = computed(
    () => !this.search.loaded() && this.search.error() !== null,
  );
  protected readonly searchResults = computed(() =>
    this.browsing() || !this.search.loaded() ? [] : this.search.results(),
  );
  protected readonly catalogResults = computed(() => {
    if (this.browsing() || this.catalog.shownQuery() !== this.query()) {
      return [];
    }
    const own = new Set(this.searchResults().map((result) => foodNameKey(result.name)));
    return this.catalog.results().filter((food) => !own.has(foodNameKey(food.name)));
  });
  protected readonly catalogMore = computed(
    () => this.catalog.total() > this.catalogResults().length,
  );
  protected readonly showNoMatches = computed(
    () =>
      !this.browsing() &&
      this.search.settled() &&
      this.search.error() === null &&
      this.search.results().length === 0,
  );
  protected readonly nothingFound = computed(
    () => this.showNoMatches() && !this.catalog.loading() && this.catalogResults().length === 0,
  );
  protected readonly strongAskAi = computed(
    () => this.search.settled() && this.search.quality() !== 'good',
  );
  protected readonly libraryEmpty = computed(
    () =>
      this.browsing() &&
      this.search.loaded() &&
      this.search.shownQuery() === '' &&
      this.search.results().length === 0,
  );
  protected readonly status = computed(() => {
    if (this.browsing() || !this.search.settled()) {
      return '';
    }
    const count = this.search.results().length + this.catalogResults().length;
    return count === 0 ? 'No matching foods' : `${count} ${count === 1 ? 'food' : 'foods'} found`;
  });
  protected readonly trayText = computed(() => {
    const logged = this.actions.logged();
    const kcal = formatNutrientValue('calories', this.actions.loggedCalories());
    if (logged.length === 1) {
      return { title: `Logged ${logged[0]?.name ?? ''}`, detail: `${kcal} kcal` };
    }
    return { title: `${logged.length} foods logged`, detail: `${kcal} kcal in total` };
  });

  constructor() {
    this.search.activate();
    inject(DestroyRef).onDestroy(() => this.search.deactivate());
    effect(() => this.catalog.search(this.query()));
    afterRenderEffect(() => {
      if (this.focusSearch()) {
        untracked(() => {
          this.focusInput();
          this.searchFocused.emit();
        });
      }
    });
  }

  protected onInput(event: Event): void {
    this.search.setText((event.target as HTMLInputElement).value);
  }

  protected clear(): void {
    this.search.clear();
    this.focusInput();
  }

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    const query = this.query();
    if (!query) {
      return;
    }
    const results = await this.search.flush();
    const first = results[0];
    if (first) {
      this.openResult(first);
      return;
    }
    const catalogFirst = (await this.catalog.flush(query))[0];
    if (catalogFirst && this.query() === query) {
      this.openCatalog(catalogFirst);
    } else if (this.query() === query && this.search.error() === null) {
      if (this.ai.enabled()) {
        this.askAi();
      } else {
        this.addManually();
      }
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.search.text() !== '') {
      event.preventDefault();
      this.search.clear();
    }
  }

  protected openResult(result: FoodSearchResult): void {
    this.searchInput()?.nativeElement.blur();
    this.selection.set({ id: ++this.selectionSeq, result });
    this.sheetOpen.set(true);
  }

  protected openCatalog(food: CatalogFoodDto): void {
    this.searchInput()?.nativeElement.blur();
    this.catalogSelection.set({ id: ++this.selectionSeq, food });
    this.catalogOpen.set(true);
  }

  protected isCatalogLogged(food: CatalogFoodDto): boolean {
    return this.actions.isIdentityLogged(catalogIdentity(food));
  }

  protected openMenu(result: FoodSearchResult): void {
    this.searchInput()?.nativeElement.blur();
    this.menuSelection.set({ id: ++this.selectionSeq, result });
    this.menuOpen.set(true);
  }

  protected hasMenu(result: FoodSearchResult): boolean {
    return hasLibraryMenu(result);
  }

  protected hideFood(result: FoodSearchResult): void {
    void this.actions.hide(result);
  }

  protected editProduct(result: FoodSearchResult): void {
    this.productTarget.set(result);
    this.productEditorOpen.set(true);
  }

  protected deleteProduct(result: FoodSearchResult): void {
    void this.products.remove(result);
  }

  protected onProductMissing(result: FoodSearchResult): void {
    this.toast.error(`“${result.name}” is no longer in your library.`);
    void this.search.refresh();
  }

  protected async quickLog(result: FoodSearchResult): Promise<void> {
    const timing = logNowTiming();
    await this.actions.log(
      result,
      quickLogBody(result, defaultPortion(result), defaultMealType(result), timing),
    );
  }

  protected askAi(): void {
    this.keyboardPrimer.prime();
    this.describe.emit(this.query());
  }

  protected addManually(): void {
    const name = this.query().slice(0, API_LIMITS.nameMax).trim();
    this.edit.emit({
      name,
      items: [{ name, grams: 0, nutrients: zeroNutrients() }],
      mealType: guessMealType(new Date()),
      mealTypeAuto: true,
      dateTime: currentDateTimeInput(),
      photo: null,
      portion: null,
    });
  }

  protected describeFood(): void {
    this.keyboardPrimer.prime();
    this.describe.emit('');
  }

  protected speak(): void {
    this.voiceIntent.request();
    this.describe.emit('');
  }

  protected takePhoto(): void {
    this.capture.requestCamera('food_photo', this.query() || undefined);
  }

  protected scanBarcode(): void {
    this.capture.requestBarcode();
  }

  protected scanLabel(): void {
    this.capture.requestCamera('nutrition_label', this.query() || undefined);
  }

  protected isLogged(result: FoodSearchResult): boolean {
    return this.actions.isLogged(result);
  }

  private focusInput(): void {
    const input = this.searchInput()?.nativeElement;
    if (!input) {
      return;
    }
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }
}
