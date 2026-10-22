import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  formatPortion,
  guessMealType,
  type EntryDto,
  type FavoriteDto,
  type LogFavoriteRequest,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { relativeDayLabel, todayLocalDate } from '../../core/time';
import { TOAST_ACTION_DURATION_MS, ToastService } from '../../core/toast.service';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { SegmentedControl, type SegmentOption } from '../../shared/ui/segmented-control';
import { Skeleton } from '../../shared/ui/skeleton';
import { FavoriteCard } from './favorite-card';
import { FavoriteEditorSheet, type FavoriteSaved } from './favorite-editor-sheet';
import { FavoriteRenameOffer } from './favorite-rename-offer';
import {
  filterFavorites,
  formatServings,
  momentAt,
  recordUse,
  sortFavorites,
  upsertFavorite,
  type FavoriteSort,
} from './favorites-math';
import { watchData } from '../today/data-watch';
import { LogFavoriteSheet } from './log-favorite-sheet';

type LoadStatus = 'loading' | 'ready' | 'error';

interface LoadOptions {
  silent?: boolean;
}

const SORT_OPTIONS: readonly SegmentOption<FavoriteSort>[] = [
  { value: 'most-used', label: 'Most used' },
  { value: 'name', label: 'A–Z' },
];

@Component({
  selector: 'app-favorites-page',
  imports: [
    RouterLink,
    PageHeader,
    Icon,
    EmptyState,
    Skeleton,
    SegmentedControl,
    BottomSheet,
    FavoriteCard,
    LogFavoriteSheet,
    FavoriteEditorSheet,
  ],
  templateUrl: './favorites-page.html',
})
export class FavoritesPage {
  private readonly api = inject(ApiService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly renameOffer = inject(FavoriteRenameOffer);
  private readonly recentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly watch = watchData(['favorites'], () => void this.load({ silent: true }));
  private loadVersion = 0;

  protected readonly sortOptions = SORT_OPTIONS;
  protected readonly searchQuery = { search: 1 };
  protected readonly skeletonRows = [0, 1, 2];
  protected readonly status = signal<LoadStatus>('loading');
  protected readonly loadError = signal<string | null>(null);
  protected readonly favorites = signal<FavoriteDto[]>([]);
  protected readonly search = signal('');
  protected readonly sort = signal<FavoriteSort>('most-used');
  protected readonly busyIds = signal<ReadonlySet<string>>(new Set());
  protected readonly recentLogs = signal<ReadonlyMap<string, EntryDto>>(new Map());

  protected readonly logTarget = signal<FavoriteDto | null>(null);
  protected readonly logSheetOpen = signal(false);
  protected readonly editTarget = signal<FavoriteDto | null>(null);
  protected readonly editorOpen = signal(false);
  protected readonly menuTarget = signal<FavoriteDto | null>(null);
  protected readonly menuOpen = signal(false);

  protected readonly visible = computed(() =>
    sortFavorites(filterFavorites(this.favorites(), this.search()), this.sort()),
  );
  protected readonly subtitle = computed(() => {
    const count = this.favorites().length;
    if (this.status() !== 'ready' || count === 0) {
      return '';
    }
    return count === 1 ? '1 starred meal' : `${count} starred meals`;
  });
  protected readonly logTargetBusy = computed(() => {
    const target = this.logTarget();
    return target !== null && this.busyIds().has(target.id);
  });

  constructor() {
    void this.load();
    inject(DestroyRef).onDestroy(() => {
      this.recentTimers.forEach((timer) => clearTimeout(timer));
      this.recentTimers.clear();
    });
  }

  protected async load(options: LoadOptions = {}): Promise<void> {
    const silent = options.silent === true && this.status() === 'ready';
    const version = ++this.loadVersion;
    if (!silent) {
      this.status.set('loading');
      this.loadError.set(null);
    }
    try {
      const favorites = await this.api.listFavorites();
      if (version !== this.loadVersion) {
        return;
      }
      this.favorites.set(favorites);
      this.status.set('ready');
    } catch (err) {
      if (version !== this.loadVersion || silent) {
        return;
      }
      this.loadError.set(errorMessage(err, 'Could not load your favorites.'));
      this.status.set('error');
    }
  }

  protected onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected clearSearch(): void {
    this.search.set('');
  }

  protected isBusy(favorite: FavoriteDto): boolean {
    return this.busyIds().has(favorite.id);
  }

  protected recentFor(favorite: FavoriteDto): EntryDto | null {
    return this.recentLogs().get(favorite.id) ?? null;
  }

  protected quickLog(favorite: FavoriteDto): void {
    const now = new Date();
    void this.performLog(favorite, {
      ...momentAt(now),
      mealType: favorite.mealType ?? guessMealType(now),
      servings: 1,
    });
  }

  protected async logWithOptions(request: LogFavoriteRequest): Promise<void> {
    const favorite = this.logTarget();
    if (favorite && (await this.performLog(favorite, request))) {
      this.logSheetOpen.set(false);
    }
  }

  protected openLogSheet(favorite: FavoriteDto): void {
    this.logTarget.set(favorite);
    this.logSheetOpen.set(true);
  }

  protected openMenu(favorite: FavoriteDto): void {
    this.menuTarget.set(favorite);
    this.menuOpen.set(true);
  }

  protected openEditor(favorite: FavoriteDto | null): void {
    this.editTarget.set(favorite);
    this.editorOpen.set(true);
  }

  protected menuLog(): void {
    const favorite = this.menuTarget();
    this.menuOpen.set(false);
    if (favorite) {
      this.openLogSheet(favorite);
    }
  }

  protected menuEdit(): void {
    const favorite = this.menuTarget();
    this.menuOpen.set(false);
    if (favorite) {
      this.openEditor(favorite);
    }
  }

  protected menuDelete(): void {
    const favorite = this.menuTarget();
    this.menuOpen.set(false);
    if (favorite) {
      void this.deleteFavorite(favorite);
    }
  }

  protected onSaved({ favorite, created, previousName }: FavoriteSaved): void {
    this.favorites.update((list) => upsertFavorite(list, favorite));
    this.watch.notifyOthers('favorites');
    this.toast.success(created ? `Created “${favorite.name}”` : 'Favorite updated');
    if (previousName !== null) {
      void this.renameOffer.offer(previousName, favorite.name);
    }
  }

  protected async deleteFavorite(favorite: FavoriteDto): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Delete this favorite?',
      message: `“${favorite.name}” will be removed from Favorites. Meals you already logged with it stay in your history.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.api.deleteFavorite(favorite.id);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        this.toast.error(errorMessage(err, 'Could not delete this favorite.'));
        return;
      }
    }
    this.favorites.update((list) => list.filter((item) => item.id !== favorite.id));
    this.watch.notifyOthers('favorites');
    this.clearRecent(favorite.id);
    if (this.editTarget()?.id === favorite.id) {
      this.editorOpen.set(false);
    }
    if (this.logTarget()?.id === favorite.id) {
      this.logSheetOpen.set(false);
    }
    this.toast.success('Favorite deleted');
  }

  private async performLog(favorite: FavoriteDto, request: LogFavoriteRequest): Promise<boolean> {
    if (this.busyIds().has(favorite.id)) {
      return false;
    }
    this.setBusy(favorite.id, true);
    try {
      const entry = await this.api.logFavorite(favorite.id, request);
      this.favorites.update((list) =>
        list.map((item) => (item.id === favorite.id ? recordUse(item, entry.timestamp) : item)),
      );
      this.watch.notifyOthers('entries', 'favorites');
      this.showRecent(favorite.id, entry);
      this.toast.success(this.loggedMessage(favorite, request, entry), {
        action: { label: 'Undo', run: () => void this.undoLog(favorite, entry) },
      });
      return true;
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not log this favorite.'));
      return false;
    } finally {
      this.setBusy(favorite.id, false);
    }
  }

  private async undoLog(favorite: FavoriteDto, entry: EntryDto): Promise<void> {
    try {
      await this.api.deleteEntry(entry.id);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        this.toast.error(errorMessage(err, 'Could not undo. Delete the entry from History.'));
        return;
      }
    }
    this.watch.notifyOthers('entries');
    if (this.recentLogs().get(favorite.id)?.id === entry.id) {
      this.clearRecent(favorite.id);
    }
    this.toast.info(`Removed “${favorite.name}” from your log`);
  }

  private loggedMessage(
    favorite: FavoriteDto,
    request: LogFavoriteRequest,
    entry: EntryDto,
  ): string {
    const servings = request.servings ?? 1;
    const amount = entry.portion
      ? ` · ${formatPortion(entry.portion)}`
      : servings === 1
        ? ''
        : ` ×${formatServings(servings)}`;
    const day =
      entry.localDate === todayLocalDate() ? '' : ` to ${relativeDayLabel(entry.localDate)}`;
    return `Logged “${favorite.name}”${amount}${day}`;
  }

  private setBusy(id: string, busy: boolean): void {
    this.busyIds.update((ids) => {
      const next = new Set(ids);
      if (busy) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  private showRecent(favoriteId: string, entry: EntryDto): void {
    this.recentLogs.update((logs) => new Map(logs).set(favoriteId, entry));
    const previous = this.recentTimers.get(favoriteId);
    if (previous !== undefined) {
      clearTimeout(previous);
    }
    this.recentTimers.set(
      favoriteId,
      setTimeout(() => this.clearRecent(favoriteId), TOAST_ACTION_DURATION_MS),
    );
  }

  private clearRecent(favoriteId: string): void {
    const timer = this.recentTimers.get(favoriteId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.recentTimers.delete(favoriteId);
    }
    if (this.recentLogs().has(favoriteId)) {
      this.recentLogs.update((logs) => {
        const next = new Map(logs);
        next.delete(favoriteId);
        return next;
      });
    }
  }
}
