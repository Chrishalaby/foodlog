import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  API_LIMITS,
  CATALOG_GROUP_LABELS,
  isCatalogGroup,
  type CatalogFoodDto,
  type CatalogGroup,
  type CatalogInfoResponse,
} from '@food/shared';
import { ApiService } from '../../core/api.service';
import { LOG_PATH } from '../../core/capture.service';
import { errorMessage } from '../../core/errors';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PageHeader } from '../../shared/ui/page-header';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { formatNumber } from '../../shared/utils/format';
import { CatalogFoodSheet, type CatalogSelection } from '../log/catalog-food-sheet';
import { CatalogResultRow } from '../../shared/ui/catalog/catalog-result-row';
import { normalizeQuery } from '../log/food-search';
import { LibraryActions } from '../log/library-actions';
import { LibraryDraftHandoff } from '../log/library-draft-handoff';
import type { LibraryDraft } from '../log/log.store';

export const FOODS_PAGE_SIZE = 30;
export const FOODS_DEBOUNCE_MS = 250;
export const FOODS_LOAD_ERROR = "Couldn't load the food database.";

type Status = 'loading' | 'ready' | 'error';

interface GroupChip {
  group: CatalogGroup | null;
  label: string;
  count: number;
}

@Component({
  selector: 'app-foods-page',
  imports: [CatalogFoodSheet, CatalogResultRow, EmptyState, Icon, PageHeader, Skeleton, Spinner],
  providers: [LibraryActions],
  host: { class: 'block' },
  templateUrl: './foods-page.html',
})
export class FoodsPage {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly actions = inject(LibraryActions);
  private readonly handoff = inject(LibraryDraftHandoff);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;
  private selectionSeq = 0;

  protected readonly queryMax = API_LIMITS.foodQueryMax;
  protected readonly skeletons = [0, 1, 2, 3, 4, 5];
  protected readonly text = signal('');
  protected readonly group = signal<CatalogGroup | null>(null);
  protected readonly info = signal<CatalogInfoResponse | null>(null);
  protected readonly results = signal<readonly CatalogFoodDto[]>([]);
  protected readonly total = signal(0);
  protected readonly status = signal<Status>('loading');
  protected readonly error = signal<string | null>(null);
  protected readonly loadingMore = signal(false);
  protected readonly shownQuery = signal('');
  protected readonly selection = signal<CatalogSelection | null>(null);
  protected readonly sheetOpen = signal(false);

  protected readonly query = computed(() => normalizeQuery(this.text()));
  protected readonly subtitle = computed(() => {
    const info = this.info();
    return info && info.foodCount > 0
      ? `${formatNumber(info.foodCount)} foods from USDA FoodData Central`
      : 'Foods and dishes with full nutrition';
  });
  protected readonly chips = computed<GroupChip[]>(() => {
    const info = this.info();
    if (!info || info.foodCount === 0) {
      return [];
    }
    return [
      { group: null, label: 'All', count: info.foodCount },
      ...info.groups.map((entry) => ({
        group: entry.group,
        label: CATALOG_GROUP_LABELS[entry.group],
        count: entry.count,
      })),
    ];
  });
  protected readonly hasMore = computed(() => this.results().length < this.total());
  protected readonly empty = computed(
    () => this.status() === 'ready' && this.results().length === 0,
  );
  protected readonly unavailable = computed(() => this.info()?.foodCount === 0);
  protected readonly resultsLabel = computed(() => {
    const total = this.total();
    const groupName = this.group() ? CATALOG_GROUP_LABELS[this.group() as CatalogGroup] : null;
    const what = total === 1 ? 'food' : 'foods';
    if (this.shownQuery()) {
      return `${formatNumber(total)} ${what} match “${this.shownQuery()}”${groupName ? ` in ${groupName}` : ''}`;
    }
    return groupName ? `${groupName} · ${formatNumber(total)} ${what}` : `${formatNumber(total)} ${what}, A–Z`;
  });

  constructor() {
    const params = this.route.snapshot.queryParamMap;
    this.text.set(params.get('q') ?? '');
    const group = params.get('group');
    this.group.set(isCatalogGroup(group) ? group : null);
    void this.loadInfo();
    void this.load();
    inject(DestroyRef).onDestroy(() => {
      this.seq += 1;
      this.clearTimer();
    });
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.load();
    }, FOODS_DEBOUNCE_MS);
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    this.clearTimer();
    void this.load();
  }

  protected clear(): void {
    this.text.set('');
    this.clearTimer();
    void this.load();
  }

  protected pickGroup(group: CatalogGroup | null): void {
    if (this.group() === group) {
      return;
    }
    this.group.set(group);
    void this.load();
  }

  protected open(food: CatalogFoodDto): void {
    this.selection.set({ id: ++this.selectionSeq, food });
    this.sheetOpen.set(true);
  }

  protected editFirst(draft: LibraryDraft): void {
    this.handoff.offer(draft);
    void this.router.navigateByUrl(LOG_PATH);
  }

  protected retry(): void {
    void this.loadInfo();
    void this.load();
  }

  protected async loadMore(): Promise<void> {
    if (this.loadingMore() || !this.hasMore()) {
      return;
    }
    const id = this.seq;
    this.loadingMore.set(true);
    try {
      const response = await this.api.searchCatalog(this.request(this.results().length));
      if (id === this.seq) {
        this.results.update((list) => [...list, ...response.results]);
        this.total.set(response.total);
      }
    } catch (err) {
      if (id === this.seq) {
        this.error.set(errorMessage(err, FOODS_LOAD_ERROR));
      }
    } finally {
      if (id === this.seq) {
        this.loadingMore.set(false);
      }
    }
  }

  private async loadInfo(): Promise<void> {
    try {
      this.info.set(await this.api.catalogInfo());
    } catch {
      this.info.set(null);
    }
  }

  private async load(): Promise<void> {
    const id = ++this.seq;
    this.status.set('loading');
    this.error.set(null);
    this.loadingMore.set(false);
    this.syncUrl();
    try {
      const response = await this.api.searchCatalog(this.request(0));
      if (id !== this.seq) {
        return;
      }
      this.results.set(response.results);
      this.total.set(response.total);
      this.shownQuery.set(this.query());
      this.status.set('ready');
    } catch (err) {
      if (id === this.seq) {
        this.error.set(errorMessage(err, FOODS_LOAD_ERROR));
        this.status.set('error');
      }
    }
  }

  private request(offset: number) {
    const query = this.query();
    const group = this.group();
    return {
      ...(query ? { q: query } : {}),
      ...(group ? { group } : {}),
      limit: FOODS_PAGE_SIZE,
      ...(offset > 0 ? { offset } : {}),
    };
  }

  private syncUrl(): void {
    const query = this.query();
    const group = this.group();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: query || null, group: group || null },
      replaceUrl: true,
    });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
