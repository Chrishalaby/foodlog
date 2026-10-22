import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, type ParamMap, Router } from '@angular/router';
import type { NoteStatus } from '@food/shared';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/errors';
import { NetworkService } from '../../core/network.service';
import { ToastService } from '../../core/toast.service';
import { ConfirmService } from '../../shared/ui/confirm.service';
import { EmptyState } from '../../shared/ui/empty-state';
import { Icon } from '../../shared/ui/icon';
import { PhotoViewer } from '../../shared/ui/photo-viewer';
import { SegmentedControl } from '../../shared/ui/segmented-control';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import type { ViewerPhoto } from '../../shared/utils/entry-photos';
import { InstallPromptService } from '../settings/install-prompt.service';
import { NoteActionsSheet, type NoteEdit } from './note-actions-sheet';
import { NoteCard } from './note-card';
import { NoteComposer, type NoteSubmission } from './note-composer';
import {
  type FeedNote,
  NOTE_FILTERS,
  NOTE_SEARCH_MAX,
  type SharePayload,
  emptyFeedMessage,
  groupNotesByDay,
  hasSharePayload,
  mergeShareText,
  noteViewerPhotos,
  readNoteDraft,
  writeNoteDraft,
} from './notes-model';
import { NotesStore } from './notes.store';

export const NOTES_SEARCH_DEBOUNCE_MS = 250;
export const NOTES_PIN_SLACK_PX = 48;
export const NOTES_EARLIER_TRIGGER_PX = 160;
export const NOTE_UPDATE_FAILED = 'Could not update the note.';
export const NOTE_SAVE_FAILED = 'Could not save the note.';
export const NOTE_DELETE_FAILED = 'Could not delete the note.';
export const NOTE_COPIED = 'Copied.';
export const NOTE_COPY_FAILED = "Couldn't copy to the clipboard.";
export const NOTES_INSTALLING = 'Notes is being added to your home screen.';

const SKELETON_WIDTHS = ['62%', '84%', '48%', '70%'] as const;
const NO_SHARE = { title: null, text: null, url: null } as const;

@Component({
  selector: 'app-notes-page',
  imports: [
    EmptyState,
    Icon,
    NoteActionsSheet,
    NoteCard,
    NoteComposer,
    PhotoViewer,
    SegmentedControl,
    Skeleton,
    Spinner,
  ],
  host: { class: 'fixed inset-0 flex flex-col bg-bg' },
  templateUrl: './notes-page.html',
})
export class NotesPage {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storage = this.resolveStorage();
  private readonly feed = viewChild.required<ElementRef<HTMLElement>>('feed');
  private readonly composer = viewChild.required(NoteComposer);
  private readonly searchField = viewChild<ElementRef<HTMLInputElement>>('searchField');
  private readonly userId = computed(() => this.auth.user()?.id ?? null);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private pinned = true;

  protected readonly store = inject(NotesStore);
  protected readonly install = inject(InstallPromptService);
  protected readonly online = inject(NetworkService).online;
  protected readonly filters = NOTE_FILTERS;
  protected readonly searchMax = NOTE_SEARCH_MAX;
  protected readonly skeletonWidths = SKELETON_WIDTHS;
  protected readonly draft = signal('');
  protected readonly clock = signal(new Date());
  protected readonly searchOpen = signal(this.store.query() !== '');
  protected readonly searchText = signal(this.store.query());
  protected readonly menuNote = signal<FeedNote | null>(null);
  protected readonly menuOpen = signal(false);
  protected readonly viewerPhotos = signal<readonly ViewerPhoto[]>([]);
  protected readonly viewerIndex = signal(0);
  protected readonly viewerOpen = signal(false);
  protected readonly days = computed(() => groupNotesByDay(this.store.feed(), this.clock()));
  protected readonly emptyMessage = computed(() =>
    emptyFeedMessage(this.store.query(), this.store.filter()),
  );

  constructor() {
    this.restoreDraft(this.userId());
    effect(() => {
      const userId = this.userId();
      untracked(() => this.restoreDraft(userId));
    });
    effect(() => {
      const text = this.draft();
      untracked(() => writeNoteDraft(this.storage, this.userId(), text));
    });
    this.route.queryParamMap
      .pipe(takeUntilDestroyed())
      .subscribe((params) => this.acceptShare(params));
    afterRenderEffect(() => {
      this.days();
      this.store.status();
      untracked(() => this.followFeed());
    });
    afterNextRender(() => {
      this.watchFeedSize();
      this.composer().focus();
    });
    this.watchVisibility();
    effect(() => {
      if (this.online()) {
        untracked(() => this.recover());
      }
    });
    this.destroyRef.onDestroy(() => this.cancelSearchTimer());
    void this.store.ensureLoaded();
  }

  protected send(submission: NoteSubmission): void {
    this.pinned = true;
    void this.store.send(submission.text, submission.attachments);
  }

  protected retry(note: FeedNote): void {
    void this.store.retry(note.key);
  }

  protected discard(note: FeedNote): void {
    this.store.discard(note.key);
  }

  protected retryLoad(): void {
    this.pinned = true;
    void this.store.reload();
  }

  protected async loadEarlier(): Promise<void> {
    const feed = this.feed().nativeElement;
    const fromBottom = feed.scrollHeight - feed.scrollTop;
    await this.store.loadEarlier();
    afterNextRender(
      () => {
        feed.scrollTop = feed.scrollHeight - fromBottom;
      },
      { injector: this.injector },
    );
  }

  protected onScroll(): void {
    const feed = this.feed().nativeElement;
    this.pinned = feed.scrollHeight - feed.scrollTop - feed.clientHeight <= NOTES_PIN_SLACK_PX;
    if (
      feed.scrollTop <= NOTES_EARLIER_TRIGGER_PX &&
      this.store.hasEarlier() &&
      this.store.earlier() === 'idle'
    ) {
      void this.loadEarlier();
    }
  }

  protected setFilter(status: NoteStatus): void {
    this.pinned = true;
    void this.store.setFilter(status);
  }

  protected toggleSearch(): void {
    if (this.searchOpen()) {
      this.closeSearch();
      return;
    }
    this.searchOpen.set(true);
    afterNextRender(() => this.searchField()?.nativeElement.focus(), { injector: this.injector });
  }

  protected closeSearch(): void {
    this.searchOpen.set(false);
    this.searchText.set('');
    this.applyQuery('');
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchText.set(value);
    this.cancelSearchTimer();
    this.searchTimer = setTimeout(() => this.applyQuery(value), NOTES_SEARCH_DEBOUNCE_MS);
  }

  protected showAll(): void {
    this.closeSearch();
    this.setFilter('all');
  }

  protected async toggleDone(note: FeedNote): Promise<void> {
    if (!note.id) {
      return;
    }
    try {
      await this.store.toggleDone(note.id);
    } catch (err) {
      this.toast.error(errorMessage(err, NOTE_UPDATE_FAILED));
    }
  }

  protected openMenu(note: FeedNote): void {
    if (note.id) {
      this.menuNote.set(note);
      this.menuOpen.set(true);
    }
  }

  protected openPhoto(note: FeedNote, index: number): void {
    this.viewerPhotos.set(noteViewerPhotos(note));
    this.viewerIndex.set(index);
    this.viewerOpen.set(true);
  }

  protected async saveEdit(edit: NoteEdit): Promise<void> {
    try {
      await this.store.edit(edit.id, edit.text);
    } catch (err) {
      this.toast.error(errorMessage(err, NOTE_SAVE_FAILED));
    }
  }

  protected async copy(note: FeedNote): Promise<void> {
    try {
      await this.document.defaultView?.navigator.clipboard.writeText(note.text);
      this.toast.success(NOTE_COPIED);
    } catch {
      this.toast.error(NOTE_COPY_FAILED);
    }
  }

  protected async remove(note: FeedNote): Promise<void> {
    if (!note.id) {
      return;
    }
    const confirmed = await this.confirm.confirm({
      title: 'Delete this note?',
      message:
        note.photos.length > 0
          ? 'The note and its photos will be gone for good.'
          : 'It will be gone for good.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.store.remove(note.id);
    } catch (err) {
      this.toast.error(errorMessage(err, NOTE_DELETE_FAILED));
    }
  }

  protected async installApp(): Promise<void> {
    if ((await this.install.prompt()) === 'accepted') {
      this.toast.success(NOTES_INSTALLING);
    }
  }

  private recover(): void {
    if (this.store.status() === 'error') {
      void this.store.reload();
    }
  }

  private applyQuery(query: string): void {
    this.cancelSearchTimer();
    if (query.trim() !== this.store.query()) {
      this.pinned = true;
      void this.store.setQuery(query);
    }
  }

  private cancelSearchTimer(): void {
    if (this.searchTimer !== null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
  }

  private restoreDraft(userId: string | null): void {
    const orphan = userId ? readNoteDraft(this.storage, null) : '';
    if (orphan) {
      writeNoteDraft(this.storage, null, '');
    }
    if (this.draft() === '') {
      this.draft.set(readNoteDraft(this.storage, userId) || orphan);
    }
    writeNoteDraft(this.storage, userId, this.draft());
  }

  private acceptShare(params: ParamMap): void {
    const payload: SharePayload = {
      title: params.get('title'),
      text: params.get('text'),
      url: params.get('url'),
    };
    if (!hasSharePayload(payload)) {
      return;
    }
    this.draft.update((text) => mergeShareText(text, payload));
    afterNextRender(() => this.clearShareParams(), { injector: this.injector });
  }

  private clearShareParams(): void {
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: NO_SHARE,
        queryParamsHandling: 'merge',
        replaceUrl: true,
      })
      .catch(() => false);
  }

  private followFeed(): void {
    if (this.pinned) {
      const feed = this.feed().nativeElement;
      feed.scrollTop = feed.scrollHeight;
    }
  }

  private watchFeedSize(): void {
    if (typeof ResizeObserver !== 'function') {
      return;
    }
    const observer = new ResizeObserver(() => this.followFeed());
    observer.observe(this.feed().nativeElement);
    this.destroyRef.onDestroy(() => observer.disconnect());
  }

  private watchVisibility(): void {
    const onVisibility = (): void => {
      if (this.document.visibilityState === 'visible') {
        this.clock.set(new Date());
        void this.store.ensureLoaded();
      }
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisibility),
    );
  }

  private resolveStorage(): Storage | null {
    try {
      return this.document.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }
}
