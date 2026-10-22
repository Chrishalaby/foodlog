import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import {
  ANALYSIS_MODES,
  IMAGE_ROLES,
  MEAL_TYPES,
  type AnalysisMode,
  type CreateDraftFields,
  type ImageRole,
  type MealType,
} from '@food/shared';
import { AuthService } from './auth.service';

export interface LocalDraftImage {
  blob: Blob;
  role: ImageRole;
}

export interface LocalDraft {
  localId: string;
  userId: string;
  fields: CreateDraftFields;
  images: LocalDraftImage[];
  photoId: string | null;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  firstSentAt: number | null;
  lastSentAt: number | null;
  failure: string | null;
}

export interface LocalDraftInput {
  fields: CreateDraftFields;
  images: readonly LocalDraftImage[];
  photoId?: string | null;
}

export type LocalDraftPatch = Partial<
  Pick<LocalDraft, 'attempts' | 'nextAttemptAt' | 'firstSentAt' | 'lastSentAt' | 'failure'>
>;

export interface SavedLocalDraft {
  draft: LocalDraft;
  persisted: boolean;
}

export interface OfflineDraftsBackend {
  list(): Promise<LocalDraft[]>;
  put(draft: LocalDraft): Promise<void>;
  delete(localId: string): Promise<void>;
}

interface StoredImage {
  role: ImageRole;
  type: string;
  data: ArrayBuffer;
}

interface StoredDraft extends Omit<LocalDraft, 'images'> {
  images: StoredImage[];
}

export const OFFLINE_DB_NAME = 'foodlog-offline';
export const OFFLINE_DB_VERSION = 1;
export const OFFLINE_DRAFTS_STORE = 'drafts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value));
}

export function isDraftFields(value: unknown): value is CreateDraftFields {
  if (!isRecord(value)) {
    return false;
  }
  return (
    ANALYSIS_MODES.includes(value['mode'] as AnalysisMode) &&
    typeof value['timestamp'] === 'string' &&
    typeof value['localDate'] === 'string' &&
    (value['mealType'] === undefined || MEAL_TYPES.includes(value['mealType'] as MealType)) &&
    ['name', 'description', 'analysisId', 'items', 'imageRoles', 'portion'].every((key) =>
      optionalString(value[key]),
    )
  );
}

function fromStored(value: unknown): LocalDraft | null {
  if (!isRecord(value) || !Array.isArray(value['images'])) {
    return null;
  }
  const record = value as unknown as StoredDraft;
  const valid =
    typeof record.localId === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.createdAt === 'string' &&
    typeof record.attempts === 'number' &&
    typeof record.nextAttemptAt === 'number' &&
    isNumberOrNull(record.firstSentAt ?? null) &&
    isNumberOrNull(record.lastSentAt ?? null) &&
    (record.failure === null || typeof record.failure === 'string') &&
    (record.photoId === null || typeof record.photoId === 'string') &&
    isDraftFields(record.fields) &&
    record.images.every(
      (image) => isRecord(image) && IMAGE_ROLES.includes(image.role) && isArrayBuffer(image.data),
    );
  if (!valid) {
    return null;
  }
  return {
    ...record,
    firstSentAt: record.firstSentAt ?? null,
    lastSentAt: record.lastSentAt ?? null,
    images: record.images.map((image) => ({
      role: image.role,
      blob: new Blob([image.data], { type: image.type || 'image/jpeg' }),
    })),
  };
}

async function toStored(draft: LocalDraft): Promise<StoredDraft> {
  const images = await Promise.all(
    draft.images.map(async (image) => ({
      role: image.role,
      type: image.blob.type,
      data: await image.blob.arrayBuffer(),
    })),
  );
  return { ...draft, images };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function indexedDbDraftsBackend(factory: IDBFactory): OfflineDraftsBackend {
  let opening: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OFFLINE_DRAFTS_STORE)) {
          db.createObjectStore(OFFLINE_DRAFTS_STORE, { keyPath: 'localId' });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'));
      request.onblocked = () => reject(new Error('IndexedDB is blocked'));
    }).catch((error: unknown) => {
      opening = null;
      throw error;
    });
    return opening;
  };

  const transact = async <T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> => {
    const db = await open();
    const transaction = db.transaction(OFFLINE_DRAFTS_STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB write failed'));
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB write aborted'));
    });
    const result = requestResult(action(transaction.objectStore(OFFLINE_DRAFTS_STORE)));
    const [value] = await Promise.all([result, done]);
    return value;
  };

  return {
    list: async () => {
      const records = await transact<unknown[]>('readonly', (store) => store.getAll());
      return records.map(fromStored).filter((draft): draft is LocalDraft => draft !== null);
    },
    put: async (draft) => {
      const record = await toStored(draft);
      await transact('readwrite', (store) => store.put(record));
    },
    delete: async (localId) => {
      await transact('readwrite', (store) => store.delete(localId));
    },
  };
}

export function memoryDraftsBackend(): OfflineDraftsBackend {
  const drafts = new Map<string, LocalDraft>();
  return {
    list: async () => [...drafts.values()],
    put: async (draft) => {
      drafts.set(draft.localId, draft);
    },
    delete: async (localId) => {
      drafts.delete(localId);
    },
  };
}

export const OFFLINE_DRAFTS_BACKEND = new InjectionToken<OfflineDraftsBackend>(
  'OFFLINE_DRAFTS_BACKEND',
  {
    providedIn: 'root',
    factory: () =>
      typeof indexedDB === 'undefined' ? memoryDraftsBackend() : indexedDbDraftsBackend(indexedDB),
  },
);

export function newLocalId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function withKnownImages(stored: LocalDraft, known: LocalDraft | undefined): LocalDraft {
  const same =
    known !== undefined &&
    known.images.length === stored.images.length &&
    known.images.every((image, index) => image.role === stored.images[index]?.role);
  return same ? { ...stored, images: known.images } : stored;
}

function newestFirst(a: LocalDraft, b: LocalDraft): number {
  return b.createdAt.localeCompare(a.createdAt);
}

@Injectable({ providedIn: 'root' })
export class OfflineDraftsStore {
  private readonly backend = inject(OFFLINE_DRAFTS_BACKEND);
  private readonly auth = inject(AuthService);
  private readonly all = signal<readonly LocalDraft[]>([]);
  private readonly memoryOnly = new Set<string>();
  private readonly removed = new Set<string>();
  private readonly loadedState = signal(false);
  private loading: Promise<void> | null = null;

  readonly loaded = this.loadedState.asReadonly();
  readonly drafts = computed<readonly LocalDraft[]>(() => {
    const userId = this.auth.user()?.id;
    return userId
      ? this.all()
          .filter((draft) => draft.userId === userId)
          .sort(newestFirst)
      : [];
  });

  load(): Promise<void> {
    this.loading ??= this.refresh();
    return this.loading;
  }

  async refresh(): Promise<void> {
    let stored: LocalDraft[];
    try {
      stored = await this.backend.list();
    } catch {
      this.loadedState.set(true);
      return;
    }
    const current = new Map(this.all().map((draft) => [draft.localId, draft]));
    const live = stored
      .filter((draft) => !this.removed.has(draft.localId))
      .map((draft) => withKnownImages(draft, current.get(draft.localId)));
    const kept = [...current.values()].filter((draft) => this.memoryOnly.has(draft.localId));
    const ids = new Set(live.map((draft) => draft.localId));
    this.all.set([...live, ...kept.filter((draft) => !ids.has(draft.localId))]);
    this.loadedState.set(true);
    const stale = stored.filter((draft) => this.removed.has(draft.localId));
    await Promise.all(stale.map((draft) => this.deleteStored(draft.localId)));
  }

  get(localId: string): LocalDraft | null {
    return this.all().find((draft) => draft.localId === localId) ?? null;
  }

  async add(input: LocalDraftInput, patch: LocalDraftPatch = {}): Promise<SavedLocalDraft | null> {
    const userId = this.auth.user()?.id;
    if (!userId) {
      return null;
    }
    const draft: LocalDraft = {
      localId: newLocalId(),
      userId,
      fields: { ...input.fields },
      images: input.images.map((image) => ({ blob: image.blob, role: image.role })),
      photoId: input.photoId ?? null,
      createdAt: new Date().toISOString(),
      attempts: 0,
      nextAttemptAt: 0,
      firstSentAt: null,
      lastSentAt: null,
      failure: null,
      ...patch,
    };
    this.memoryOnly.add(draft.localId);
    this.all.update((drafts) => [...drafts, draft]);
    const persisted = await this.persist(draft);
    return { draft: this.get(draft.localId) ?? draft, persisted };
  }

  async update(localId: string, patch: LocalDraftPatch): Promise<LocalDraft | null> {
    const current = this.get(localId);
    if (!current) {
      return null;
    }
    const next: LocalDraft = { ...current, ...patch };
    this.all.update((drafts) => drafts.map((draft) => (draft.localId === localId ? next : draft)));
    await this.persist(next);
    return next;
  }

  async remove(localId: string): Promise<void> {
    this.all.update((drafts) => drafts.filter((draft) => draft.localId !== localId));
    this.memoryOnly.delete(localId);
    this.removed.add(localId);
    await this.deleteStored(localId);
  }

  private async deleteStored(localId: string): Promise<void> {
    try {
      await this.backend.delete(localId);
    } catch {
      return;
    }
  }

  private async persist(draft: LocalDraft): Promise<boolean> {
    try {
      await this.backend.put(draft);
      this.memoryOnly.delete(draft.localId);
      return true;
    } catch {
      this.memoryOnly.add(draft.localId);
      return false;
    }
  }
}
