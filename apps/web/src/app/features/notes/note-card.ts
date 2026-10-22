import { Component, computed, input, output } from '@angular/core';
import { toTimeLabel } from '../../core/time';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { LongPress } from '../log/long-press';
import { type FeedNote, linkSegments } from './notes-model';

@Component({
  selector: 'app-note-card',
  imports: [Icon, LongPress, Spinner],
  host: { class: 'block' },
  templateUrl: './note-card.html',
})
export class NoteCard {
  readonly note = input.required<FeedNote>();
  readonly toggled = output<void>();
  readonly menu = output<void>();
  readonly photoOpened = output<number>();
  readonly retried = output<void>();
  readonly discarded = output<void>();

  protected readonly sent = computed(() => this.note().state === 'sent');
  protected readonly segments = computed(() => linkSegments(this.note().text));
  protected readonly time = computed(() => toTimeLabel(this.note().createdAt));
  protected readonly label = computed(() => {
    const note = this.note();
    const state = note.state === 'sent' ? (note.done ? ', done' : '') : `, ${this.stateLabel()}`;
    return `Note from ${this.time()}${state}`;
  });
  protected readonly toggleLabel = computed(() =>
    this.note().done ? 'Done. Mark as to do' : 'Mark as done',
  );

  protected tileClass(index: number): string {
    return this.note().photos.length === 3 && index === 0
      ? 'col-span-2 aspect-[2/1]'
      : 'aspect-square';
  }

  protected photoLabel(index: number): string {
    const count = this.note().photos.length;
    return count > 1 ? `Open photo ${index + 1} of ${count}` : 'Open photo';
  }

  protected openPhoto(index: number, press: LongPress): void {
    if (!press.consumeLongPress()) {
      this.photoOpened.emit(index);
    }
  }

  protected openMenu(press: LongPress): void {
    if (!press.consumeLongPress()) {
      this.menu.emit();
    }
  }

  protected onClick(event: Event, press: LongPress): void {
    if (press.consumeLongPress()) {
      event.preventDefault();
    }
  }

  private stateLabel(): string {
    return this.note().state === 'failed' ? 'not sent' : 'sending';
  }
}
