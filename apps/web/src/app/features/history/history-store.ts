import { Injectable, computed, inject, signal } from '@angular/core';
import type { EntryDto, EntryListQuery } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { DataEventsService } from '../../core/data-events.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { onSessionReset } from '../../core/session-scope';
import {
  appendPage,
  groupEntriesByDay,
  mergeHead,
  removeEntry,
  sortNewestFirst,
  upsertEntry,
} from './history-list';

export const HISTORY_PAGE_SIZE = 30;
export const HISTORY_CACHE_TTL_MS = 30 * 60_000;

export type HistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface HistoryReturnPoint {
  entryId: string;
  scrollY: number;
}

export interface HistoryLoadOptions {
  reset?: boolean;
}

interface HistoryState {
  query: string;
  entriesQuery: string;
  entries: EntryDto[];
  nextCursor: string | null;
  status: HistoryStatus;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
  loadedAt: number | null;
}

interface SavedReturnPoint extends HistoryReturnPoint {
  savedAt: number;
}

const INITIAL_STATE: HistoryState = {
  query: '',
  entriesQuery: '',
  entries: [],
  nextCursor: null,
  status: 'idle',
  error: null,
  loadingMore: false,
  moreError: null,
  loadedAt: null,
};

@Injectable({ providedIn: 'root' })
export class HistoryStore {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);
  private readonly state = signal<HistoryState>(INITIAL_STATE);
  private generation = 0;
  private returnPoint: SavedReturnPoint | null = null;
  private syncedVersion = -1;

  readonly query = computed(() => this.state().query);
  readonly entries = computed(() => this.state().entries);
  readonly status = computed(() => this.state().status);
  readonly error = computed(() => this.state().error);
  readonly loadingMore = computed(() => this.state().loadingMore);
  readonly moreError = computed(() => this.state().moreError);
  readonly hasMore = computed(() => this.state().nextCursor !== null);
  readonly groups = computed(() => groupEntriesByDay(this.entries(), this.hasMore()));

  constructor() {
    onSessionReset(() => this.reset());
  }

  reset(): void {
    this.generation++;
    this.returnPoint = null;
    this.syncedVersion = -1;
    this.state.set(INITIAL_STATE);
  }

  isStale(): boolean {
    return this.syncedVersion !== this.events.entries();
  }

  notifyLocalChange(): void {
    const inSync = !this.isStale();
    this.events.notify('entries');
    if (inSync) {
      this.syncedVersion = this.events.entries();
    }
  }

  canReuse(now: number = Date.now()): boolean {
    const { status, loadedAt } = this.state();
    return status === 'ready' && loadedAt !== null && now - loadedAt < HISTORY_CACHE_TTL_MS;
  }

  async load(query: string, options: HistoryLoadOptions = {}): Promise<void> {
    const generation = ++this.generation;
    const version = this.events.entries();
    this.state.update((current) => ({
      ...current,
      ...(options.reset ? { entries: [], nextCursor: null, entriesQuery: query } : {}),
      query,
      status: 'loading',
      error: null,
      loadingMore: false,
      moreError: null,
    }));
    try {
      const page = await this.api.listEntries(this.pageQuery(query));
      if (generation !== this.generation) {
        return;
      }
      this.syncedVersion = version;
      this.state.update((current) => ({
        ...current,
        entriesQuery: query,
        entries: sortNewestFirst(page.items),
        nextCursor: page.nextCursor,
        status: 'ready',
        loadedAt: Date.now(),
      }));
      if (this.isStale()) {
        void this.revalidate();
      }
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      this.state.update((current) => {
        const keep = current.entriesQuery === query;
        return {
          ...current,
          entries: keep ? current.entries : [],
          nextCursor: keep ? current.nextCursor : null,
          entriesQuery: query,
          status: 'error',
          error: errorMessage(err, 'Could not load your history.'),
        };
      });
    }
  }

  async loadMore(): Promise<void> {
    const snapshot = this.state();
    if (snapshot.nextCursor === null || snapshot.loadingMore || snapshot.status !== 'ready') {
      return;
    }
    const generation = this.generation;
    this.state.update((current) => ({ ...current, loadingMore: true, moreError: null }));
    try {
      const page = await this.api.listEntries({
        ...this.pageQuery(snapshot.query),
        before: snapshot.nextCursor,
      });
      if (generation !== this.generation) {
        return;
      }
      this.state.update((current) => ({
        ...current,
        entries: appendPage(current.entries, page.items),
        nextCursor: page.nextCursor,
        loadingMore: false,
      }));
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      this.state.update((current) => ({
        ...current,
        loadingMore: false,
        moreError: errorMessage(err, 'Could not load more entries.'),
      }));
    }
  }

  async revalidate(): Promise<void> {
    const snapshot = this.state();
    if (snapshot.status !== 'ready') {
      return;
    }
    const generation = this.generation;
    const version = this.events.entries();
    try {
      const page = await this.api.listEntries(this.pageQuery(snapshot.query));
      if (generation !== this.generation) {
        return;
      }
      this.syncedVersion = version;
      const complete = page.nextCursor === null;
      this.state.update((current) => ({
        ...current,
        entries: mergeHead(current.entries, page.items, complete),
        nextCursor: complete ? null : current.nextCursor,
        loadedAt: Date.now(),
      }));
    } catch {
      return;
    }
  }

  async refreshEntry(id: string): Promise<void> {
    const generation = this.generation;
    try {
      const entry = await this.api.getEntry(id);
      if (generation === this.generation) {
        this.upsert(entry);
      }
    } catch (err) {
      if (generation === this.generation && httpStatus(err) === 404) {
        this.remove(id);
      }
    }
  }

  upsert(entry: EntryDto): void {
    this.state.update((current) => ({
      ...current,
      entries: upsertEntry(current.entries, entry, current.nextCursor !== null),
    }));
  }

  restore(entry: EntryDto): void {
    this.state.update((current) => ({
      ...current,
      entries: upsertEntry(current.entries, entry, false),
    }));
  }

  remove(id: string): EntryDto | null {
    const removed = this.state().entries.find((entry) => entry.id === id) ?? null;
    if (removed) {
      this.state.update((current) => ({ ...current, entries: removeEntry(current.entries, id) }));
    }
    return removed;
  }

  rememberReturn(point: HistoryReturnPoint, now: number = Date.now()): void {
    this.returnPoint = { ...point, savedAt: now };
  }

  takeReturn(now: number = Date.now()): HistoryReturnPoint | null {
    const point = this.returnPoint;
    this.returnPoint = null;
    if (!point || now - point.savedAt >= HISTORY_CACHE_TTL_MS) {
      return null;
    }
    return { entryId: point.entryId, scrollY: point.scrollY };
  }

  private pageQuery(query: string): EntryListQuery {
    return query ? { limit: HISTORY_PAGE_SIZE, q: query } : { limit: HISTORY_PAGE_SIZE };
  }
}
