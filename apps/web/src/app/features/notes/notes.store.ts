import { Injectable, computed, inject, signal } from '@angular/core';
import type { NoteDto, NoteListQuery, NoteStatus, UpdateNoteRequest } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { onSessionReset } from '../../core/session-scope';
import {
  type FeedNote,
  type NoteAttachment,
  type OutboxNote,
  oldestFirst,
  outboxNote,
  sentNote,
} from './notes-model';

export type NotesStatus = 'idle' | 'loading' | 'ready' | 'error';
export type EarlierStatus = 'idle' | 'loading' | 'error';

export const NOTES_PAGE_SIZE = 40;
export const NOTES_LOAD_FAILED = 'Could not load your notes.';
export const NOTE_SEND_FAILED = 'Could not send this note.';

type NoteChange = Partial<Pick<NoteDto, 'text' | 'done' | 'doneAt'>>;

function releaseAttachments(attachments: readonly NoteAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

@Injectable({ providedIn: 'root' })
export class NotesStore {
  private readonly api = inject(ApiService);
  private readonly notesState = signal<readonly NoteDto[]>([]);
  private readonly outboxState = signal<readonly OutboxNote[]>([]);
  private readonly statusState = signal<NotesStatus>('idle');
  private readonly errorState = signal<string | null>(null);
  private readonly cursorState = signal<string | null>(null);
  private readonly earlierState = signal<EarlierStatus>('idle');
  private readonly busyState = signal(false);
  private readonly queryState = signal('');
  private readonly filterState = signal<NoteStatus>('all');
  private readonly keys = signal<ReadonlyMap<string, string>>(new Map());
  private readonly chains = new Map<string, Promise<NoteDto>>();
  private readonly queued = new Map<string, number>();
  private pending: Promise<void> | null = null;
  private session = 0;
  private listSeq = 0;
  private changes = 0;
  private nextLocalId = 1;

  readonly status = this.statusState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly earlier = this.earlierState.asReadonly();
  readonly busy = this.busyState.asReadonly();
  readonly query = this.queryState.asReadonly();
  readonly filter = this.filterState.asReadonly();
  readonly hasEarlier = computed(() => this.cursorState() !== null);
  readonly filtered = computed(() => this.queryState() !== '' || this.filterState() !== 'all');
  readonly feed = computed<readonly FeedNote[]>(() => {
    const keys = this.keys();
    return [
      ...this.notesState().map((note) => sentNote(note, keys.get(note.id))),
      ...this.outboxState().map(outboxNote),
    ];
  });

  constructor() {
    onSessionReset(() => this.reset());
  }

  ensureLoaded(): Promise<void> {
    if (this.statusState() === 'ready') {
      return this.refresh();
    }
    return this.statusState() === 'loading' && this.pending ? this.pending : this.reload();
  }

  reload(): Promise<void> {
    return this.track(this.loadLatest(false));
  }

  refresh(): Promise<void> {
    if (this.statusState() !== 'ready') {
      return Promise.resolve();
    }
    return this.busyState()
      ? (this.pending ?? Promise.resolve())
      : this.track(this.loadLatest(true));
  }

  setQuery(query: string): Promise<void> {
    const next = query.trim();
    if (next === this.queryState()) {
      return Promise.resolve();
    }
    this.queryState.set(next);
    return this.reload();
  }

  setFilter(status: NoteStatus): Promise<void> {
    if (status === this.filterState()) {
      return Promise.resolve();
    }
    this.filterState.set(status);
    return this.reload();
  }

  async loadEarlier(): Promise<void> {
    const cursor = this.cursorState();
    if (!cursor || this.earlierState() === 'loading' || this.statusState() !== 'ready') {
      return;
    }
    const seq = this.listSeq;
    this.earlierState.set('loading');
    try {
      const response = await this.api.listNotes({ ...this.listQuery(), before: cursor });
      if (seq !== this.listSeq) {
        return;
      }
      const known = new Set(this.notesState().map((note) => note.id));
      const older = oldestFirst(response.notes).filter((note) => !known.has(note.id));
      this.notesState.update((notes) => [...older, ...notes]);
      this.cursorState.set(response.nextCursor);
      this.earlierState.set('idle');
    } catch {
      if (seq === this.listSeq) {
        this.earlierState.set('error');
      }
    }
  }

  send(text: string, attachments: readonly NoteAttachment[] = []): Promise<boolean> {
    const note: OutboxNote = {
      key: `local-${this.nextLocalId++}`,
      text,
      attachments,
      createdAt: new Date().toISOString(),
      state: 'sending',
      error: null,
    };
    this.outboxState.update((outbox) => [...outbox, note]);
    return this.deliver(note.key);
  }

  retry(key: string): Promise<boolean> {
    const note = this.outboxState().find((item) => item.key === key);
    return note?.state === 'failed' ? this.deliver(key) : Promise.resolve(false);
  }

  discard(key: string): void {
    const note = this.outboxState().find((item) => item.key === key);
    if (!note || note.state !== 'failed') {
      return;
    }
    this.outboxState.update((outbox) => outbox.filter((item) => item.key !== key));
    releaseAttachments(note.attachments);
  }

  toggleDone(id: string): Promise<void> {
    const done = !this.find(id)?.done;
    return this.change(id, { done, doneAt: done ? new Date().toISOString() : null }, { done });
  }

  edit(id: string, text: string): Promise<void> {
    return this.change(id, { text }, { text });
  }

  async remove(id: string): Promise<void> {
    const note = this.find(id);
    if (!note) {
      return;
    }
    const session = this.session;
    this.notesState.update((notes) => notes.filter((item) => item.id !== id));
    try {
      await this.api.deleteNote(id);
    } catch (err) {
      if (httpStatus(err) !== 404) {
        if (session === this.session && !this.find(id)) {
          this.notesState.update((notes) => oldestFirst([...notes, note]));
        }
        throw err;
      }
    } finally {
      this.changes++;
    }
    this.forgetKey(id);
  }

  reset(): void {
    this.session++;
    this.listSeq++;
    this.changes++;
    this.outboxState().forEach((note) => releaseAttachments(note.attachments));
    this.chains.clear();
    this.queued.clear();
    this.pending = null;
    this.notesState.set([]);
    this.outboxState.set([]);
    this.keys.set(new Map());
    this.statusState.set('idle');
    this.errorState.set(null);
    this.cursorState.set(null);
    this.earlierState.set('idle');
    this.busyState.set(false);
    this.queryState.set('');
    this.filterState.set('all');
  }

  private track(run: Promise<void>): Promise<void> {
    this.pending = run;
    const clear = (): void => {
      if (this.pending === run) {
        this.pending = null;
      }
    };
    void run.then(clear, clear);
    return run;
  }

  private find(id: string): NoteDto | null {
    return this.notesState().find((note) => note.id === id) ?? null;
  }

  private listQuery(): NoteListQuery {
    const query: NoteListQuery = { limit: NOTES_PAGE_SIZE };
    if (this.queryState()) {
      query.q = this.queryState();
    }
    if (this.filterState() !== 'all') {
      query.status = this.filterState();
    }
    return query;
  }

  private async loadLatest(merge: boolean): Promise<void> {
    const seq = ++this.listSeq;
    const changes = this.changes;
    if (this.statusState() !== 'ready') {
      this.statusState.set('loading');
    }
    this.errorState.set(null);
    this.earlierState.set('idle');
    this.busyState.set(true);
    try {
      const response = await this.api.listNotes(this.listQuery());
      if (seq !== this.listSeq) {
        return;
      }
      if (changes !== this.changes) {
        await this.loadLatest(merge);
        return;
      }
      this.accept(oldestFirst(response.notes), response.nextCursor, merge);
      this.statusState.set('ready');
    } catch (err) {
      if (seq === this.listSeq && !merge) {
        this.notesState.set([]);
        this.cursorState.set(null);
        this.errorState.set(errorMessage(err, NOTES_LOAD_FAILED));
        this.statusState.set('error');
      }
    } finally {
      if (seq === this.listSeq) {
        this.busyState.set(false);
      }
    }
  }

  private accept(latest: readonly NoteDto[], nextCursor: string | null, merge: boolean): void {
    const current = this.notesState();
    const oldest = latest[0]?.createdAt;
    const ids = new Set(latest.map((note) => note.id));
    const continues =
      merge &&
      nextCursor !== null &&
      oldest !== undefined &&
      current.some((note) => ids.has(note.id));
    const kept = continues
      ? current.filter((note) => note.createdAt < oldest && !ids.has(note.id))
      : [];
    this.notesState.set([...kept, ...latest]);
    if (kept.length === 0) {
      this.cursorState.set(nextCursor);
    }
  }

  private async deliver(key: string): Promise<boolean> {
    const note = this.outboxState().find((item) => item.key === key);
    if (!note) {
      return false;
    }
    const session = this.session;
    this.patchOutbox(key, { state: 'sending', error: null });
    try {
      const saved = await this.api.createNote(
        note.text,
        note.attachments.map((attachment) => attachment.blob),
      );
      if (session !== this.session) {
        return false;
      }
      this.changes++;
      this.keys.update((keys) => new Map(keys).set(saved.id, key));
      this.outboxState.update((outbox) => outbox.filter((item) => item.key !== key));
      this.notesState.update((notes) => [...notes.filter((item) => item.id !== saved.id), saved]);
      releaseAttachments(note.attachments);
      return true;
    } catch (err) {
      if (session === this.session) {
        this.patchOutbox(key, { state: 'failed', error: errorMessage(err, NOTE_SEND_FAILED) });
      }
      return false;
    }
  }

  private async change(id: string, change: NoteChange, body: UpdateNoteRequest): Promise<void> {
    const before = this.find(id);
    if (!before) {
      return;
    }
    const session = this.session;
    const undo: NoteChange = {};
    for (const key of Object.keys(change) as (keyof NoteChange)[]) {
      Object.assign(undo, { [key]: before[key] });
    }
    this.queued.set(id, (this.queued.get(id) ?? 0) + 1);
    this.patch(id, change);
    const save = (): Promise<NoteDto> => this.api.updateNote(id, body);
    const previous = this.chains.get(id);
    const request = previous ? previous.then(save, save) : save();
    this.chains.set(id, request);
    try {
      const saved = await request;
      if (session === this.session && this.settle(id, request)) {
        this.patch(id, saved);
      }
    } catch (err) {
      if (session === this.session) {
        this.settle(id, request);
        this.rollback(id, undo, err);
      }
      throw err;
    } finally {
      this.changes++;
    }
  }

  private settle(id: string, request: Promise<unknown>): boolean {
    const left = (this.queued.get(id) ?? 1) - 1;
    if (left > 0) {
      this.queued.set(id, left);
      return false;
    }
    this.queued.delete(id);
    if (this.chains.get(id) === request) {
      this.chains.delete(id);
    }
    return true;
  }

  private rollback(id: string, undo: NoteChange, err: unknown): void {
    if (httpStatus(err) === 404) {
      this.notesState.update((notes) => notes.filter((note) => note.id !== id));
      this.forgetKey(id);
      return;
    }
    this.patch(id, undo);
  }

  private patch(id: string, change: Partial<NoteDto>): void {
    this.notesState.update((notes) =>
      notes.map((note) => (note.id === id ? { ...note, ...change, id } : note)),
    );
  }

  private patchOutbox(key: string, change: Partial<OutboxNote>): void {
    this.outboxState.update((outbox) =>
      outbox.map((note) => (note.key === key ? { ...note, ...change } : note)),
    );
  }

  private forgetKey(id: string): void {
    if (this.keys().has(id)) {
      this.keys.update((keys) => {
        const next = new Map(keys);
        next.delete(id);
        return next;
      });
    }
  }
}
