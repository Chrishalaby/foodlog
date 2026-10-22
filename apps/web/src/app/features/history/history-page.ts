import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router, RouterLink, Scroll } from '@angular/router';
import { type EntryDto, type FavoriteDto } from '@food/shared';
import { filter, take } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { CaptureService } from '../../core/capture.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { todayLocalDate } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { EntryCard } from '../../shared/ui/entry-card';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { FavoriteRenameOffer } from '../favorites/favorite-rename-offer';
import { logNowTiming } from '../log/entry-timing';
import { normalizeSearch, toDayHeader } from './history-list';
import { HistoryStore } from './history-store';
import { SaveFavoriteSheet } from './save-favorite-sheet';

export const SEARCH_DEBOUNCE_MS = 300;
export const LOAD_AHEAD_MARGIN = '0px 0px 800px 0px';
export const REMOVE_ANIMATION_MS = 260;
export const EXTERNAL_REFRESH_DEBOUNCE_MS = 150;

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

@Component({
  selector: 'app-history-page',
  imports: [
    RouterLink,
    PageHeader,
    Icon,
    EntryCard,
    EmptyState,
    Skeleton,
    Spinner,
    SaveFavoriteSheet,
  ],
  templateUrl: './history-page.html',
  styleUrl: './history-page.css',
})
export class HistoryPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly capture = inject(CaptureService);
  private readonly events = inject(DataEventsService);
  private readonly renameOffer = inject(FavoriteRenameOffer);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sentinel = viewChild<ElementRef<HTMLElement>>('sentinel');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private externalTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly store = inject(HistoryStore);
  protected readonly today = todayLocalDate();
  protected readonly searchText = signal('');
  protected readonly favoriteTarget = signal<EntryDto | null>(null);
  protected readonly favoriteSheetOpen = signal(false);
  protected readonly removing = signal<ReadonlySet<string>>(new Set());
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly days = computed(() =>
    this.store.groups().map((group) => toDayHeader(group, this.today)),
  );
  protected readonly hasEntries = computed(() => this.store.entries().length > 0);
  protected readonly initialLoading = computed(
    () =>
      !this.hasEntries() && (this.store.status() === 'loading' || this.store.status() === 'idle'),
  );
  protected readonly busy = computed(() => this.store.status() === 'loading');
  protected readonly searching = computed(() => this.busy() && this.hasEntries());

  constructor() {
    this.restoreOrLoad();
    this.observeSentinel();
    this.watchExternalChanges();
    this.destroyRef.onDestroy(() => {
      this.cancelSearchTimer();
      this.cancelExternalTimer();
    });
  }

  protected onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchText.set(value);
    this.cancelSearchTimer();
    this.searchTimer = setTimeout(() => {
      this.searchTimer = null;
      this.applySearch(value);
    }, SEARCH_DEBOUNCE_MS);
  }

  protected submitSearch(event: Event): void {
    event.preventDefault();
    this.cancelSearchTimer();
    this.applySearch(this.searchText());
    this.searchInput()?.nativeElement.blur();
  }

  protected clearSearch(): void {
    this.cancelSearchTimer();
    this.searchText.set('');
    this.applySearch('');
    this.searchInput()?.nativeElement.focus();
  }

  protected refresh(): void {
    this.cancelSearchTimer();
    void this.store.load(normalizeSearch(this.searchText()));
  }

  protected loadMore(): void {
    void this.store.loadMore();
  }

  protected logFirstMeal(): void {
    this.capture.requestCamera('food_photo');
  }

  protected describeMeal(): void {
    this.capture.startText();
  }

  protected openEntry(entry: EntryDto): void {
    this.store.rememberReturn({
      entryId: entry.id,
      scrollY: this.document.defaultView?.scrollY ?? 0,
    });
    void this.router.navigate(['/entries', entry.id]);
  }

  protected async logAgain(entry: EntryDto): Promise<void> {
    try {
      const copy = await this.api.duplicateEntry(entry.id, logNowTiming());
      this.store.upsert(copy);
      this.store.notifyLocalChange();
      this.toast.success(`Logged “${copy.name}” again`, {
        action: { label: 'View', run: () => this.viewEntry(copy) },
      });
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not log this meal again.'));
    }
  }

  protected startFavorite(entry: EntryDto): void {
    this.favoriteTarget.set(entry);
    this.favoriteSheetOpen.set(true);
  }

  protected onFavoriteSaved(favorite: FavoriteDto): void {
    const entryName = this.favoriteTarget()?.name ?? '';
    this.events.notify('favorites');
    this.toast.success(`Saved “${favorite.name}” to favorites`, {
      action: { label: 'View', run: () => void this.router.navigateByUrl('/favorites') },
    });
    void this.renameOffer.offer(entryName, favorite.name);
  }

  protected async deleteEntry(entry: EntryDto): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Delete this entry?',
      message: `“${entry.name}” will be permanently removed from your log.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed || this.removing().has(entry.id)) {
      return;
    }
    const outcome = this.api.deleteEntry(entry.id).then(
      () => null,
      (error: unknown) => (httpStatus(error) === 404 ? null : { error }),
    );
    this.setRemoving(entry.id, true);
    await wait(REMOVE_ANIMATION_MS);
    const removed = this.store.remove(entry.id);
    this.setRemoving(entry.id, false);
    const failure = await outcome;
    if (!failure) {
      this.store.notifyLocalChange();
      this.toast.success('Entry deleted');
      return;
    }
    if (removed) {
      this.store.restore(removed);
    }
    this.toast.error(errorMessage(failure.error, 'Could not delete this entry.'));
  }

  private viewEntry(entry: EntryDto): void {
    if (this.destroyRef.destroyed) {
      void this.router.navigate(['/entries', entry.id]);
      return;
    }
    this.openEntry(entry);
  }

  private setRemoving(id: string, active: boolean): void {
    this.removing.update((ids) => {
      const next = new Set(ids);
      if (active) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private applySearch(raw: string): void {
    const query = normalizeSearch(raw);
    if (query === this.store.query() && this.store.status() === 'ready') {
      return;
    }
    void this.store.load(query);
  }

  private cancelSearchTimer(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private watchExternalChanges(): void {
    let seen = untracked(() => this.events.entries());
    effect(() => {
      const version = this.events.entries();
      untracked(() => {
        if (version === seen) {
          return;
        }
        seen = version;
        if (!this.store.isStale()) {
          return;
        }
        this.cancelExternalTimer();
        this.externalTimer = setTimeout(() => {
          this.externalTimer = null;
          if (this.store.isStale()) {
            void this.store.revalidate();
          }
        }, EXTERNAL_REFRESH_DEBOUNCE_MS);
      });
    });
  }

  private cancelExternalTimer(): void {
    if (this.externalTimer !== null) {
      clearTimeout(this.externalTimer);
      this.externalTimer = null;
    }
  }

  private restoreOrLoad(): void {
    const point = this.store.takeReturn();
    const reusable = this.store.canReuse() && (point !== null || this.store.query() === '');
    if (!reusable) {
      void this.store.load('', { reset: true });
      return;
    }
    this.searchText.set(this.store.query());
    if (!point && this.store.isStale()) {
      void this.store.load(this.store.query());
      return;
    }
    void this.store.revalidate();
    if (point) {
      void this.store.refreshEntry(point.entryId);
      this.restoreScroll(point.scrollY);
    }
  }

  private restoreScroll(scrollY: number): void {
    const view = this.document.defaultView;
    if (!view || scrollY <= 0) {
      return;
    }
    const subscription = this.router.events
      .pipe(
        filter((event) => event instanceof Scroll),
        take(1),
      )
      .subscribe(() => {
        view.setTimeout(() => view.scrollTo({ top: scrollY, behavior: 'instant' }));
      });
    this.destroyRef.onDestroy(() => subscription.unsubscribe());
  }

  private observeSentinel(): void {
    const view = this.document.defaultView;
    if (!view || typeof view.IntersectionObserver !== 'function') {
      return;
    }
    const observer = new view.IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting) && !this.store.moreError()) {
          void this.store.loadMore();
        }
      },
      { rootMargin: LOAD_AHEAD_MARGIN },
    );
    afterRenderEffect(() => {
      const element = this.sentinel()?.nativeElement;
      this.store.entries();
      this.store.loadingMore();
      untracked(() => {
        observer.disconnect();
        if (element) {
          observer.observe(element);
        }
      });
    });
    this.destroyRef.onDestroy(() => observer.disconnect());
  }
}
