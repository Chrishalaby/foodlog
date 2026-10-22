import {
  Component,
  DOCUMENT,
  DestroyRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import type { EntryDto, FoodSearchResult } from '@food/shared';
import { CaptureService, LOG_PATH } from '../../core/capture.service';
import type { DataTopic } from '../../core/data-events.service';
import { dayEndsNote, dayStartHour, msUntilNextDayBoundary } from '../../core/day-start';
import { DraftSyncService } from '../../core/draft-sync.service';
import { errorMessage } from '../../core/errors';
import { KeyboardPrimer } from '../../core/keyboard-primer';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import {
  FoodActionsSheet,
  type FoodActionsSelection,
  type RenameFood,
} from '../../shared/ui/food-actions-sheet';
import { Icon } from '../../shared/ui/icon';
import { hiddenMessage, renamedMessage } from '../../shared/utils/food-library';
import { formatNumber } from '../../shared/utils/format';
import { DraftsList } from '../log/drafts/drafts-list';
import { currentDateTimeInput } from '../log/entry-timing';
import { LibraryActions } from '../log/library-actions';
import type { LibraryDraft } from '../log/log.store';
import { QuickLogSheet, type QuickLogSelection } from '../log/quick-log-sheet';
import { watchData } from './data-watch';
import { DayHeader } from './day-header';
import { DayHero } from './day-hero';
import { DayLimits } from './day-limits';
import { DayMicros } from './day-micros';
import { FluidsCard } from './fluids-card';
import { FluidsStore } from './fluids-store';
import { FoodMergeCard } from './food-merge-card';
import { LibraryDraftHandoff } from '../log/library-draft-handoff';
import { MealIdeasCard } from './meal-ideas-card';
import { MealIdeasSheet } from './meal-ideas-sheet';
import { MealTimeline } from './meal-timeline';
import { ProductEditSheet } from '../log/barcode/product-edit-sheet';
import { ProductLibrary } from '../log/barcode/product-library';
import { QuickAdd } from './quick-add';
import { TodaySkeleton } from './today-skeleton';
import { TodayStore } from './today-store';
import {
  emptyDayTitle,
  logMomentFor,
  loggedDayNote,
  quickLogMessage,
  resolveViewDate,
} from './today-view';
import { WeightCard } from './weight-card';
import { WeightCardStore } from './weight-card-store';

function afterPendingRouterScroll(view: Window | null): Promise<void> {
  return new Promise((resolve) => {
    if (view && typeof view.requestAnimationFrame === 'function') {
      view.requestAnimationFrame(() => setTimeout(resolve));
    } else {
      setTimeout(resolve);
    }
  });
}

export const RENAME_FAILED_MESSAGE = 'Could not rename this food.';

export interface TodayQuickLogSelection extends QuickLogSelection {
  dateTime: string;
}

export const TODAY_DATA_TOPICS: readonly DataTopic[] = [
  'entries',
  'favorites',
  'products',
  'weights',
  'profile',
  'fluids',
];

@Component({
  selector: 'app-today-page',
  imports: [
    DayHeader,
    DayHero,
    DayLimits,
    DayMicros,
    DraftsList,
    FluidsCard,
    FoodActionsSheet,
    FoodMergeCard,
    Icon,
    MealIdeasCard,
    MealIdeasSheet,
    MealTimeline,
    ProductEditSheet,
    QuickAdd,
    QuickLogSheet,
    RouterLink,
    TodaySkeleton,
    WeightCard,
  ],
  providers: [LibraryActions],
  templateUrl: './today-page.html',
})
export class TodayPage {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly capture = inject(CaptureService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly library = inject(LibraryActions);
  private readonly products = inject(ProductLibrary);
  private readonly handoff = inject(LibraryDraftHandoff);
  private readonly keyboardPrimer = inject(KeyboardPrimer);
  private readonly weightCard = viewChild(WeightCard);
  private readonly fluids = inject(FluidsStore);
  private readonly clock = signal(Date.now());
  private dayTimer: ReturnType<typeof setTimeout> | null = null;
  private selectionSeq = 0;

  protected readonly store = inject(TodayStore);
  protected readonly weights = inject(WeightCardStore);

  readonly date = input<string>();
  readonly weight = input<string>();
  readonly ideas = input<string>();

  protected readonly today = computed(() => todayLocalDate(new Date(this.clock())));
  protected readonly viewDate = computed(() => resolveViewDate(this.date(), this.today()));
  protected readonly dayEnds = computed(() =>
    this.viewDate() === this.today() ? dayEndsNote(new Date(this.clock()), dayStartHour()) : null,
  );
  protected readonly dashboard = computed(() => {
    const data = this.store.dashboard();
    return data && this.store.date() === this.viewDate() ? data : null;
  });
  protected readonly trainingDay = computed(() => this.dashboard()?.day.trainingDay ?? false);
  protected readonly trainingBusy = signal(false);
  protected readonly foodBusyKey = signal<string | null>(null);
  protected readonly chipBusyKey = computed(() => this.foodBusyKey() ?? this.library.busyKey());
  protected readonly foodActions = signal<FoodActionsSelection | null>(null);
  protected readonly foodActionsOpen = signal(false);
  protected readonly quickLogSelection = signal<TodayQuickLogSelection | null>(null);
  protected readonly quickLogOpen = signal(false);
  protected readonly ideasOpen = signal(false);
  protected readonly ideasDay = computed(() =>
    this.viewDate() === this.today() ? (this.dashboard()?.day ?? null) : null,
  );
  protected readonly productTarget = signal<FoodSearchResult | null>(null);
  protected readonly productEditorOpen = signal(false);
  protected readonly renameFood: RenameFood = (result, to) => this.rename(result, to);
  protected readonly profileIncomplete = computed(() => this.store.targets()?.complete === false);
  protected readonly status = computed(() =>
    this.store.date() === this.viewDate() ? this.store.status() : 'loading',
  );
  protected readonly emptyTitle = computed(() => emptyDayTitle(this.viewDate(), this.today()));
  private readonly weightFocusPending = linkedSignal(() => this.weight() === '1');
  private readonly ideasPending = linkedSignal(() => this.ideas() === '1');

  constructor() {
    inject(DraftSyncService).start();
    effect(() => {
      const date = this.viewDate();
      untracked(() => {
        void this.store.show(date);
        void this.weights.show(date);
        void this.fluids.show(date);
      });
    });
    effect(() => {
      dayStartHour();
      untracked(() => {
        this.syncToday();
        this.scheduleDayChange();
      });
    });
    effect(() => {
      if (!this.ideasPending() || !this.dashboard()) {
        return;
      }
      const showsToday = this.viewDate() === this.today();
      untracked(() => {
        this.ideasPending.set(false);
        this.ideasOpen.set(showsToday);
        void this.clearQueryParam('ideas');
      });
    });
    void this.store.loadExtras();

    const watch = watchData(TODAY_DATA_TOPICS, (changed) => this.onDataChanged(changed));

    afterRenderEffect(() => {
      const card = this.weightCard();
      if (!this.weightFocusPending() || !card?.ready()) {
        return;
      }
      untracked(() => {
        this.weightFocusPending.set(false);
        void this.focusWeightEntry(card);
      });
    });

    const onVisibility = (): void => {
      if (this.document.visibilityState !== 'visible') {
        return;
      }
      watch.cancel();
      const shown = this.viewDate();
      this.syncToday();
      if (this.viewDate() === shown) {
        void this.store.refresh();
        void this.weights.refresh();
        void this.fluids.refresh();
      }
      void this.store.loadFoods({ stable: true });
      this.store.refreshProfileIfStale();
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibility);
      this.clearDayTimer();
    });
  }

  protected goTo(date: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { date: date === this.today() ? null : date },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  protected retry(): void {
    void this.store.retry();
  }

  protected async setTrainingDay(trainingDay: boolean): Promise<void> {
    if (this.trainingBusy()) {
      return;
    }
    this.trainingBusy.set(true);
    try {
      await this.store.setTrainingDay(trainingDay);
      void this.fluids.refresh();
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not update the training day.'));
    } finally {
      this.trainingBusy.set(false);
    }
  }

  protected openEntry(entry: EntryDto): void {
    void this.router.navigate(['/entries', entry.id]);
  }

  protected async logAgain(entry: EntryDto): Promise<void> {
    try {
      const created = await this.store.logAgain(entry);
      this.toast.success(`Logged “${entry.name}” again${this.dayNote(created)}`, {
        action: { label: 'Undo', run: () => void this.undo(created) },
      });
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not log that again.'));
    }
  }

  protected async saveFavorite(entry: EntryDto): Promise<void> {
    try {
      const favorite = await this.store.saveAsFavorite(entry);
      this.toast.success(`Saved “${favorite.name}” to favorites`);
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not save this favorite.'));
    }
  }

  protected async deleteEntry(entry: EntryDto): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Delete this entry?',
      message: `“${entry.name}” (${formatNumber(entry.totals.calories)} kcal) will be removed from your log.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.store.deleteEntry(entry);
      this.toast.success('Entry deleted');
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not delete this entry.'));
    }
  }

  protected async quickLog(result: FoodSearchResult): Promise<void> {
    if (this.chipBusyKey() !== null) {
      return;
    }
    this.foodBusyKey.set(result.key);
    try {
      const created = await this.store.quickLog(result);
      this.toast.success(quickLogMessage(created.name, created.localDate, this.today()), {
        action: { label: 'Undo', run: () => void this.undo(created) },
      });
    } catch (err) {
      this.toast.error(errorMessage(err, `Could not log “${result.name}”.`));
    } finally {
      this.foodBusyKey.set(null);
    }
  }

  protected retryFoods(): void {
    void this.store.loadFoods({ stable: true });
  }

  protected adjustFood(result: FoodSearchResult): void {
    if (this.chipBusyKey() !== null) {
      return;
    }
    this.quickLogSelection.set({
      id: ++this.selectionSeq,
      result,
      dateTime: currentDateTimeInput(logMomentFor(this.viewDate()).at),
    });
    this.quickLogOpen.set(true);
  }

  protected openFoodActions(result: FoodSearchResult): void {
    this.foodActions.set({ id: ++this.selectionSeq, result });
    this.foodActionsOpen.set(true);
  }

  protected onQuickLogged(entry: EntryDto): void {
    this.store.addLogged(entry);
  }

  protected openIdeas(): void {
    this.ideasOpen.set(true);
  }

  protected onIdeaLogged(entry: EntryDto): void {
    this.store.addLogged(entry);
    this.toast.success(quickLogMessage(entry.name, entry.localDate, this.today()), {
      action: { label: 'Undo', run: () => void this.undo(entry) },
    });
  }

  protected async editFood(draft: LibraryDraft): Promise<void> {
    this.handoff.offer(draft);
    const moved = await this.router.navigateByUrl(LOG_PATH).catch(() => false);
    const unclaimed = this.handoff.take();
    if (moved && unclaimed) {
      this.capture.openSearch(unclaimed.name);
    }
  }

  protected editProduct(result: FoodSearchResult): void {
    this.productTarget.set(result);
    this.productEditorOpen.set(true);
  }

  protected async deleteProduct(result: FoodSearchResult): Promise<void> {
    if (await this.products.remove(result)) {
      this.store.removeFood(result.key);
    }
  }

  protected onProductMissing(result: FoodSearchResult): void {
    this.toast.error(`“${result.name}” is no longer in your library.`);
    this.store.removeFood(result.key);
    void this.store.loadFoods({ stable: true });
  }

  protected scanBarcode(): void {
    this.capture.requestBarcode();
  }

  protected scanLabel(): void {
    this.capture.requestCamera('nutrition_label');
  }

  protected describe(): void {
    this.keyboardPrimer.prime();
    this.capture.startText();
  }

  protected takePhoto(): void {
    this.capture.requestCamera('food_photo');
  }

  protected chooseFromLibrary(): void {
    this.capture.requestLibrary('food_photo');
  }

  private onDataChanged(changed: ReadonlySet<DataTopic>): void {
    const has = (topic: DataTopic): boolean => changed.has(topic);
    if (has('entries') || has('weights') || has('profile') || has('fluids')) {
      void this.store.refresh();
    }
    if (has('entries') || has('weights') || has('profile')) {
      void this.fluids.refresh();
    }
    if (has('entries') || has('favorites') || has('products')) {
      void this.store.loadFoods({ stable: true });
    }
    if (has('weights')) {
      void this.weights.refresh();
    }
  }

  protected async hideFood(food: FoodSearchResult): Promise<void> {
    try {
      const position = await this.store.hideFood(food);
      this.toast.info(hiddenMessage(food.name), {
        action: { label: 'Undo', run: () => void this.unhideFood(food, position) },
      });
    } catch (err) {
      this.toast.error(errorMessage(err, `Could not remove “${food.name}” from suggestions.`));
    }
  }

  private async rename(result: FoodSearchResult, to: string): Promise<boolean> {
    try {
      const response = await this.store.renameFood(result, to);
      this.toast.success(renamedMessage(response.renamedEntries, to));
      return true;
    } catch (err) {
      this.toast.error(errorMessage(err, RENAME_FAILED_MESSAGE));
      return false;
    }
  }

  private async unhideFood(food: FoodSearchResult, position: number): Promise<void> {
    try {
      await this.store.unhideFood(food, position);
    } catch (err) {
      this.toast.error(errorMessage(err, `Could not bring back “${food.name}”.`));
    }
  }

  private async undo(entry: EntryDto): Promise<void> {
    try {
      await this.store.undoCreate(entry);
      this.toast.info(`Removed “${entry.name}”`);
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not undo.'));
    }
  }

  private clearQueryParam(name: string): Promise<boolean> {
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { [name]: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
      scroll: 'manual',
    });
  }

  private async focusWeightEntry(card: WeightCard): Promise<void> {
    await this.clearQueryParam('weight');
    await afterPendingRouterScroll(this.document.defaultView);
    if (!this.destroyRef.destroyed) {
      card.focusEntry();
    }
  }

  private dayNote(entry: EntryDto): string {
    return loggedDayNote(entry.localDate, this.viewDate(), this.today());
  }

  private syncToday(): void {
    this.clock.set(Date.now());
  }

  private scheduleDayChange(): void {
    this.clearDayTimer();
    this.dayTimer = setTimeout(() => {
      this.syncToday();
      this.scheduleDayChange();
    }, msUntilNextDayBoundary(new Date()));
  }

  private clearDayTimer(): void {
    if (this.dayTimer !== null) {
      clearTimeout(this.dayTimer);
      this.dayTimer = null;
    }
  }
}
