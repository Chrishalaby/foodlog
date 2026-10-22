import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import type { DraftDto } from '@food/shared';
import { ApiService } from '../../../core/api.service';
import { DraftSyncService } from '../../../core/draft-sync.service';
import { errorMessage, httpStatus } from '../../../core/errors';
import {
  OfflineDraftsStore,
  type LocalDraft,
  type LocalDraftImage,
} from '../../../core/offline-drafts.store';
import { onSessionReset } from '../../../core/session-scope';
import { localDraftRow, serverDraftRow, sortDraftRows, type DraftRow } from './draft-rows';

export type DraftsStatus = 'idle' | 'loading' | 'ready' | 'error';

export const DRAFTS_STALE_MS = 60_000;
export const DRAFTS_LOAD_ERROR = 'Could not load your drafts.';

interface ThumbCache {
  images: readonly LocalDraftImage[];
  urls: string[];
}

function canCreateObjectUrls(): boolean {
  return typeof URL.createObjectURL === 'function' && typeof URL.revokeObjectURL === 'function';
}

@Injectable({ providedIn: 'root' })
export class DraftsStore {
  private readonly api = inject(ApiService);
  private readonly sync = inject(DraftSyncService);
  private readonly offline = inject(OfflineDraftsStore);
  private readonly serverState = signal<readonly DraftDto[]>([]);
  private readonly statusState = signal<DraftsStatus>('idle');
  private readonly errorState = signal<string | null>(null);
  private readonly thumbs = new Map<string, ThumbCache>();
  private inflight: Promise<void> | null = null;
  private generation = 0;
  private loadedAt = 0;

  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly server = this.serverState.asReadonly();
  readonly rows = computed<readonly DraftRow[]>(() => {
    const uploading = this.sync.uploading();
    const locals = this.sync.drafts();
    this.sweepThumbs(locals);
    const localRows = locals.map((draft) =>
      localDraftRow(draft, this.localThumbs(draft), uploading.has(draft.localId)),
    );
    const serverRows = this.serverState().map((draft) => serverDraftRow(draft));
    return sortDraftRows([...localRows, ...serverRows]);
  });
  readonly count = computed(() => this.rows().length);

  constructor() {
    const stop = this.sync.onUploaded((draft) => {
      if (draft) {
        this.upsert(draft);
      }
      void this.refresh();
    });
    inject(DestroyRef).onDestroy(() => {
      stop();
      this.revokeAll();
    });
    onSessionReset(() => this.reset());
  }

  activate(): void {
    this.sync.start();
    void this.offline.load();
    if (this.statusState() !== 'ready' || Date.now() - this.loadedAt > DRAFTS_STALE_MS) {
      void this.refresh();
    }
  }

  refresh(): Promise<void> {
    if (this.inflight) {
      return this.inflight;
    }
    const generation = this.generation;
    if (this.statusState() !== 'ready') {
      this.statusState.set('loading');
    }
    const run = this.fetch(generation).finally(() => {
      if (this.inflight === run) {
        this.inflight = null;
      }
    });
    this.inflight = run;
    return run;
  }

  upsert(draft: DraftDto): void {
    this.invalidate();
    this.serverState.update((drafts) => [
      draft,
      ...drafts.filter((candidate) => candidate.id !== draft.id),
    ]);
  }

  forget(id: string): void {
    this.invalidate();
    this.serverState.update((drafts) => drafts.filter((draft) => draft.id !== id));
  }

  find(id: string): DraftDto | null {
    return this.serverState().find((draft) => draft.id === id) ?? null;
  }

  async remove(row: DraftRow): Promise<void> {
    const { source } = row;
    const id =
      source.kind === 'server' ? source.draft.id : this.sync.uploadedAs(source.draft.localId);
    if (source.kind === 'local') {
      await this.sync.discardLocal(source.draft.localId);
    }
    if (id === null) {
      return;
    }
    const previous = this.serverState();
    this.forget(id);
    try {
      await this.api.deleteDraft(id);
    } catch (err) {
      if (httpStatus(err) === 404) {
        return;
      }
      this.invalidate();
      this.serverState.set(previous);
      throw err;
    }
  }

  retryUpload(row: DraftRow): Promise<void> {
    return row.source.kind === 'local'
      ? this.sync.retry(row.source.draft.localId)
      : Promise.resolve();
  }

  private async fetch(generation: number): Promise<void> {
    try {
      const drafts = await this.api.listDrafts();
      if (generation !== this.generation) {
        return;
      }
      this.serverState.set(drafts);
      this.statusState.set('ready');
      this.errorState.set(null);
      this.loadedAt = Date.now();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      this.errorState.set(errorMessage(err, DRAFTS_LOAD_ERROR));
      if (this.statusState() !== 'ready') {
        this.statusState.set('error');
      }
    }
  }

  private invalidate(): void {
    this.generation += 1;
    this.inflight = null;
  }

  private localThumbs(draft: LocalDraft): string[] {
    const cached = this.thumbs.get(draft.localId);
    if (cached && cached.images === draft.images) {
      return cached.urls;
    }
    cached?.urls.forEach((url) => URL.revokeObjectURL(url));
    const urls = canCreateObjectUrls()
      ? draft.images.map((image) => URL.createObjectURL(image.blob))
      : [];
    this.thumbs.set(draft.localId, { images: draft.images, urls });
    return urls;
  }

  private sweepThumbs(locals: readonly LocalDraft[]): void {
    const live = new Set(locals.map((draft) => draft.localId));
    for (const [localId, cache] of this.thumbs) {
      if (!live.has(localId)) {
        cache.urls.forEach((url) => URL.revokeObjectURL(url));
        this.thumbs.delete(localId);
      }
    }
  }

  private revokeAll(): void {
    for (const cache of this.thumbs.values()) {
      cache.urls.forEach((url) => URL.revokeObjectURL(url));
    }
    this.thumbs.clear();
  }

  private reset(): void {
    this.invalidate();
    this.revokeAll();
    this.serverState.set([]);
    this.statusState.set('idle');
    this.errorState.set(null);
    this.loadedAt = 0;
  }
}
