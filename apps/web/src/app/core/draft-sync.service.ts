import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  Injector,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import type { CreateDraftFields, DraftDto } from '@food/shared';
import { ApiService, type AnalyzeImage } from './api.service';
import { AuthService } from './auth.service';
import { errorMessage, httpStatus } from './errors';
import { NetworkService } from './network.service';
import {
  OfflineDraftsStore,
  type LocalDraft,
  type LocalDraftInput,
  type SavedLocalDraft,
} from './offline-drafts.store';
import { onSessionReset } from './session-scope';

export const DRAFT_RETRY_BASE_MS = 5_000;
export const DRAFT_RETRY_MAX_MS = 5 * 60_000;
export const DRAFT_DEDUPE_SKEW_MS = 15 * 60_000;
export const DRAFT_SYNC_LOCK = 'foodlog-draft-sync';
export const DRAFT_UPLOAD_FAILED = 'Could not upload this draft.';

export type UploadFailureKind = 'offline' | 'retry' | 'auth' | 'rejected';

export type DraftUploadListener = (draft: DraftDto | null) => void;

export function draftRetryDelay(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(DRAFT_RETRY_MAX_MS, DRAFT_RETRY_BASE_MS * 2 ** exponent);
}

const UNREACHABLE_STATUSES: ReadonlySet<number> = new Set([0, 502, 503, 504]);

export function isNetworkFailure(err: unknown): boolean {
  return httpStatus(err) === 0;
}

export function isServerUnreachable(err: unknown): boolean {
  const status = httpStatus(err);
  return status !== null && UNREACHABLE_STATUSES.has(status);
}

export function classifyUploadError(err: unknown): UploadFailureKind {
  const status = httpStatus(err);
  if (status === 0) {
    return 'offline';
  }
  if (status === 401) {
    return 'auth';
  }
  if (status === null || status === 408 || status === 429 || status >= 500) {
    return 'retry';
  }
  return 'rejected';
}

export function withoutAnalysis(fields: CreateDraftFields): CreateDraftFields {
  const copy = { ...fields };
  delete copy.analysisId;
  return copy;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? '').trim() === (b ?? '').trim();
}

export function matchesUploadedDraft(local: LocalDraft, server: DraftDto): boolean {
  if (local.firstSentAt === null || local.lastSentAt === null) {
    return false;
  }
  const created = Date.parse(server.createdAt);
  const sameTime = Date.parse(server.timestamp) === Date.parse(local.fields.timestamp);
  const analysisId = local.fields.analysisId ?? null;
  const samePhotos = analysisId
    ? server.analysisId === analysisId || server.photos.length === local.images.length
    : server.photos.length === local.images.length;
  return (
    sameTime &&
    server.mode === local.fields.mode &&
    sameText(server.description, local.fields.description) &&
    sameText(server.name, local.fields.name) &&
    samePhotos &&
    created >= local.firstSentAt - DRAFT_DEDUPE_SKEW_MS &&
    created <= local.lastSentAt + DRAFT_DEDUPE_SKEW_MS
  );
}

interface LockManagerLike {
  request(
    name: string,
    options: { ifAvailable: boolean },
    callback: (lock: unknown) => Promise<void>,
  ): Promise<unknown>;
}

type UploadStep = 'next' | 'stop';

@Injectable({ providedIn: 'root' })
export class DraftSyncService {
  private readonly api = inject(ApiService);
  private readonly store = inject(OfflineDraftsStore);
  private readonly network = inject(NetworkService);
  private readonly auth = inject(AuthService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly uploadingState = signal<ReadonlySet<string>>(new Set());
  private readonly syncingState = signal(false);
  private readonly claimed = new Set<string>();
  private readonly uploadedIds = new Map<string, string>();
  private readonly listeners = new Set<DraftUploadListener>();
  private running: Promise<void> | null = null;
  private again = false;
  private forceNext = false;
  private pausedUntil = 0;
  private started = false;
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly drafts = this.store.drafts;
  readonly uploading = this.uploadingState.asReadonly();
  readonly syncing = this.syncingState.asReadonly();

  constructor() {
    const doc = this.document;
    const onVisibility = (): void => {
      if (this.started && doc.visibilityState === 'visible') {
        void this.sync();
      }
    };
    doc.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      doc.removeEventListener('visibilitychange', onVisibility);
      this.clearTimer();
    });
    onSessionReset(() => {
      this.claimed.clear();
      this.uploadedIds.clear();
      this.clearTimer();
    });
  }

  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    let wasReady = this.canSync();
    effect(
      () => {
        const ready = this.network.online() && this.auth.user() !== null;
        untracked(() => {
          if (ready && !wasReady) {
            void this.sync({ force: true });
          }
          wasReady = ready;
        });
      },
      { injector: this.injector },
    );
    void this.sync({ force: true });
  }

  async createRemote(
    fields: CreateDraftFields,
    images: readonly AnalyzeImage[],
  ): Promise<DraftDto> {
    if (!fields.analysisId) {
      return this.api.createDraft(fields, images);
    }
    try {
      return await this.api.createDraft(fields, []);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        throw err;
      }
      return this.api.createDraft(withoutAnalysis(fields), images);
    }
  }

  onUploaded(listener: DraftUploadListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async keepLocally(
    input: LocalDraftInput,
    attemptedAt: number | null,
  ): Promise<SavedLocalDraft | null> {
    const saved = await this.store.add(
      input,
      attemptedAt === null
        ? {}
        : {
            attempts: 1,
            nextAttemptAt: attemptedAt + draftRetryDelay(1),
            firstSentAt: attemptedAt,
            lastSentAt: attemptedAt,
          },
    );
    if (saved) {
      this.schedule();
    }
    return saved;
  }

  discardLocal(localId: string): Promise<void> {
    this.claimed.delete(localId);
    return this.store.remove(localId);
  }

  claim(localId: string): boolean {
    if (this.uploadingState().has(localId) || this.store.get(localId) === null) {
      return false;
    }
    this.claimed.add(localId);
    return true;
  }

  release(localId: string): void {
    if (this.claimed.delete(localId)) {
      this.schedule();
    }
  }

  isUploading(localId: string): boolean {
    return this.uploadingState().has(localId);
  }

  uploadedAs(localId: string): string | null {
    return this.uploadedIds.get(localId) ?? null;
  }

  async retry(localId: string): Promise<void> {
    await this.store.update(localId, { failure: null, attempts: 0, nextAttemptAt: 0 });
    this.pausedUntil = 0;
    await this.sync({ force: true });
  }

  sync(options: { force?: boolean } = {}): Promise<void> {
    if (options.force) {
      this.forceNext = true;
    }
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = this.withLock(() => this.drain()).finally(() => {
      this.running = null;
      if (this.again && !this.destroyed) {
        this.again = false;
        void this.sync();
      }
    });
    this.running = run;
    return run;
  }

  private async withLock(task: () => Promise<void>): Promise<void> {
    const locks = (this.document.defaultView?.navigator as { locks?: LockManagerLike } | undefined)
      ?.locks;
    if (!locks || typeof locks.request !== 'function') {
      await task();
      return;
    }
    await locks.request(DRAFT_SYNC_LOCK, { ifAvailable: true }, async (lock) => {
      if (lock) {
        await task();
      }
    });
  }

  private async drain(): Promise<void> {
    const force = this.forceNext;
    this.forceNext = false;
    this.clearTimer();
    if (!this.canSync()) {
      return;
    }
    const now = Date.now();
    if (force) {
      this.pausedUntil = 0;
    } else if (now < this.pausedUntil) {
      this.schedule();
      return;
    }
    await this.store.refresh();
    const due = this.store
      .drafts()
      .filter((draft) => this.isEligible(draft) && (force || draft.nextAttemptAt <= now));
    if (due.length === 0) {
      this.schedule();
      return;
    }
    this.syncingState.set(true);
    try {
      let server: DraftDto[] | null = null;
      const matched = new Set<string>();
      for (const draft of due) {
        if (!this.canSync()) {
          break;
        }
        const current = this.eligibleDraft(draft.localId);
        if (!current) {
          continue;
        }
        if (current.firstSentAt !== null) {
          if (server === null) {
            try {
              server = await this.api.listDrafts();
            } catch (err) {
              await this.backOff(current, err);
              break;
            }
          }
          const twin = server.find(
            (candidate) => !matched.has(candidate.id) && matchesUploadedDraft(current, candidate),
          );
          if (twin) {
            matched.add(twin.id);
            if (this.eligibleDraft(current.localId)) {
              this.uploadedIds.set(current.localId, twin.id);
              await this.store.remove(current.localId);
              this.emit(null);
            }
            continue;
          }
        }
        const ready = this.eligibleDraft(current.localId);
        if (ready && (await this.upload(ready)) === 'stop') {
          break;
        }
      }
    } finally {
      this.syncingState.set(false);
      this.schedule();
    }
  }

  private async upload(draft: LocalDraft): Promise<UploadStep> {
    this.setUploading(draft.localId, true);
    const sentAt = Date.now();
    try {
      const created = await this.createRemote(draft.fields, draft.images);
      this.uploadedIds.set(draft.localId, created.id);
      await this.store.remove(draft.localId);
      this.emit(created);
      return 'next';
    } catch (err) {
      return this.handleFailure(draft, err, sentAt);
    } finally {
      this.setUploading(draft.localId, false);
    }
  }

  private async handleFailure(
    draft: LocalDraft,
    err: unknown,
    sentAt: number,
  ): Promise<UploadStep> {
    const kind = classifyUploadError(err);
    if (kind === 'auth') {
      this.pausedUntil = Date.now() + DRAFT_RETRY_MAX_MS;
      return 'stop';
    }
    if (kind === 'rejected') {
      await this.store.update(draft.localId, { failure: errorMessage(err, DRAFT_UPLOAD_FAILED) });
      return 'next';
    }
    const attempts = draft.attempts + 1;
    const nextAttemptAt = sentAt + draftRetryDelay(attempts);
    this.pausedUntil = nextAttemptAt;
    await this.store.update(draft.localId, {
      attempts,
      nextAttemptAt,
      firstSentAt: draft.firstSentAt ?? sentAt,
      lastSentAt: sentAt,
    });
    return 'stop';
  }

  private async backOff(draft: LocalDraft, err: unknown): Promise<void> {
    if (classifyUploadError(err) === 'auth') {
      this.pausedUntil = Date.now() + DRAFT_RETRY_MAX_MS;
      return;
    }
    const attempts = draft.attempts + 1;
    const nextAttemptAt = Date.now() + draftRetryDelay(attempts);
    this.pausedUntil = nextAttemptAt;
    await this.store.update(draft.localId, { attempts, nextAttemptAt });
  }

  private eligibleDraft(localId: string): LocalDraft | null {
    const draft = this.store.get(localId);
    return draft && this.isEligible(draft) ? draft : null;
  }

  private isEligible(draft: LocalDraft): boolean {
    return (
      draft.failure === null &&
      !this.claimed.has(draft.localId) &&
      !this.uploadingState().has(draft.localId)
    );
  }

  private canSync(): boolean {
    return !this.destroyed && this.network.online() && this.auth.user() !== null;
  }

  private schedule(): void {
    this.clearTimer();
    if (!this.started || !this.canSync()) {
      return;
    }
    const waits = this.store
      .drafts()
      .filter((draft) => this.isEligible(draft))
      .map((draft) => draft.nextAttemptAt);
    if (waits.length === 0) {
      return;
    }
    const delay = Math.max(0, Math.min(...waits), this.pausedUntil) - Date.now();
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.sync();
      },
      Math.max(0, delay),
    );
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private setUploading(localId: string, uploading: boolean): void {
    this.uploadingState.update((current) => {
      const next = new Set(current);
      if (uploading) {
        next.add(localId);
      } else {
        next.delete(localId);
      }
      return next;
    });
  }

  private emit(draft: DraftDto | null): void {
    for (const listener of [...this.listeners]) {
      listener(draft);
    }
  }
}
