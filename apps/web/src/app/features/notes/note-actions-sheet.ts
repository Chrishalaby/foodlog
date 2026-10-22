import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { injectDiscardGuard } from '../../shared/ui/discard-guard';
import { Icon } from '../../shared/ui/icon';
import { type FeedNote, NOTE_TEXT_MAX } from './notes-model';

export interface NoteEdit {
  readonly id: string;
  readonly text: string;
}

type SheetView = 'actions' | 'edit';

let nextSheetId = 0;

@Component({
  selector: 'app-note-actions-sheet',
  imports: [BottomSheet, Icon],
  templateUrl: './note-actions-sheet.html',
})
export class NoteActionsSheet {
  private readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');
  private armed = false;

  readonly note = input<FeedNote | null>(null);
  readonly open = model(false);
  readonly edited = output<NoteEdit>();
  readonly copied = output<FeedNote>();
  readonly deleted = output<FeedNote>();

  protected readonly fieldId = `note-actions-${nextSheetId++}-text`;
  protected readonly textMax = NOTE_TEXT_MAX;
  protected readonly view = signal<SheetView>('actions');
  protected readonly draft = signal('');
  protected readonly hasText = computed(() => (this.note()?.text.trim() ?? '') !== '');
  protected readonly preview = computed(() => {
    const note = this.note();
    if (!note) {
      return '';
    }
    const text = note.text.trim();
    if (text) {
      return text;
    }
    return note.photos.length === 1 ? 'Photo' : `${note.photos.length} photos`;
  });
  private readonly changed = computed(
    () => this.draft().trim() !== (this.note()?.text.trim() ?? ''),
  );
  protected readonly canSave = computed(() => {
    const note = this.note();
    return (
      note !== null && this.changed() && (this.draft().trim() !== '' || note.photos.length > 0)
    );
  });
  protected readonly canClose = injectDiscardGuard(
    () => this.view() === 'edit' && this.changed(),
    'Your changes to this note won’t be saved.',
  );

  constructor() {
    afterRenderEffect(() => {
      const field = this.field()?.nativeElement;
      if (field && this.view() === 'edit') {
        untracked(() => {
          field.focus({ preventScroll: true });
          field.setSelectionRange(field.value.length, field.value.length);
        });
      }
    });
  }

  protected arm(): void {
    this.armed = true;
  }

  protected reset(): void {
    this.armed = false;
    this.view.set('actions');
    this.draft.set('');
  }

  protected startEdit(event: MouseEvent): void {
    const note = this.note();
    if (note && this.accepts(event)) {
      this.draft.set(note.text);
      this.view.set('edit');
    }
  }

  protected copy(event: MouseEvent): void {
    this.choose(event, (note) => this.copied.emit(note));
  }

  protected remove(event: MouseEvent): void {
    this.choose(event, (note) => this.deleted.emit(note));
  }

  protected backToActions(): void {
    this.view.set('actions');
  }

  protected onInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value.slice(0, this.textMax));
  }

  protected save(event: Event): void {
    event.preventDefault();
    const note = this.note();
    if (!note?.id || !this.canSave()) {
      return;
    }
    const edit: NoteEdit = { id: note.id, text: this.draft().trim() };
    this.open.set(false);
    this.edited.emit(edit);
  }

  private choose(event: MouseEvent, emit: (note: FeedNote) => void): void {
    const note = this.note();
    if (!note || !this.accepts(event)) {
      return;
    }
    this.open.set(false);
    emit(note);
  }

  private accepts(event: MouseEvent): boolean {
    return event.detail === 0 || this.armed;
  }
}
