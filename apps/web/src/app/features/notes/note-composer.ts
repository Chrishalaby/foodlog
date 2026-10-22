import {
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { errorMessage } from '../../core/errors';
import { KeyboardService } from '../../core/keyboard.service';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { VoiceButton } from '../../shared/ui/voice-button';
import {
  COMPRESS_PRESETS,
  type CompressOptions,
  type CompressedImage,
  compressImage,
} from '../../shared/utils/image-compress';
import { appendTranscript } from '../../shared/utils/voice-text';
import {
  NOTE_PHOTOS_MAX,
  NOTE_TEXT_MAX,
  type NoteAttachment,
  photosLeftOutMessage,
} from './notes-model';

export interface NoteSubmission {
  readonly text: string;
  readonly attachments: readonly NoteAttachment[];
}

export type NotePhotoCompressor = (
  file: Blob,
  options: CompressOptions,
) => Promise<Pick<CompressedImage, 'blob' | 'width' | 'height'>>;

export const NOTE_PHOTO_COMPRESSOR = new InjectionToken<NotePhotoCompressor>(
  'NOTE_PHOTO_COMPRESSOR',
  { providedIn: 'root', factory: () => compressImage },
);

export const NOTE_PHOTO_FAILED = 'Could not add that photo.';
export const NOTE_COUNTER_FROM = 200;

let nextComposerId = 0;

function previewUrl(blob: Blob): string | null {
  try {
    return typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

function release(attachments: readonly NoteAttachment[]): void {
  for (const attachment of attachments) {
    if (attachment.previewUrl) {
      URL.revokeObjectURL(attachment.previewUrl);
    }
  }
}

@Component({
  selector: 'app-note-composer',
  imports: [Icon, Spinner, VoiceButton],
  host: { class: 'block shrink-0' },
  templateUrl: './note-composer.html',
})
export class NoteComposer {
  private readonly compress = inject(NOTE_PHOTO_COMPRESSOR);
  private readonly toast = inject(ToastService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly keyboardOpen = inject(KeyboardService).open;
  private readonly field = viewChild.required<ElementRef<HTMLTextAreaElement>>('field');
  private readonly voice = viewChild(VoiceButton);
  private readonly instance = nextComposerId++;
  private nextPhotoId = 1;
  private destroyed = false;

  readonly text = model('');
  readonly submitted = output<NoteSubmission>();

  protected readonly fieldId = `note-composer-${this.instance}`;
  protected readonly textMax = NOTE_TEXT_MAX;
  protected readonly attachments = signal<readonly NoteAttachment[]>([]);
  protected readonly preparing = signal(0);
  protected readonly preparingSlots = computed(() =>
    Array.from({ length: this.preparing() }, (_, index) => index),
  );
  protected readonly voiceBusy = computed(() => this.voice()?.busy() ?? false);
  protected readonly canAddPhoto = computed(
    () => this.attachments().length + this.preparing() < NOTE_PHOTOS_MAX,
  );
  protected readonly canSend = computed(
    () =>
      (this.text().trim() !== '' || this.attachments().length > 0) &&
      this.preparing() === 0 &&
      !this.voiceBusy(),
  );
  protected readonly remaining = computed(() => this.textMax - this.text().length);
  protected readonly showCounter = computed(() => this.remaining() <= NOTE_COUNTER_FROM);
  protected readonly bottomPadding = computed(() =>
    this.keyboardOpen() ? '0.5rem' : 'calc(env(safe-area-inset-bottom) + 0.5rem)',
  );

  constructor() {
    afterRenderEffect(() => {
      this.text();
      untracked(() => this.fitField());
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      release(this.attachments());
    });
  }

  focus(): void {
    this.field().nativeElement.focus({ preventScroll: true });
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLTextAreaElement).value.slice(0, this.textMax));
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      this.submit();
    }
  }

  protected addTranscript(transcript: string): void {
    this.text.update((text) => appendTranscript(text, transcript, this.textMax));
  }

  protected onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    void this.addPhotos(files);
  }

  protected removePhoto(photo: NoteAttachment, index: number): void {
    this.attachments.update((list) => list.filter((item) => item.id !== photo.id));
    release([photo]);
    afterNextRender(() => this.focusAfterRemoval(index), { injector: this.injector });
  }

  protected submit(): void {
    if (!this.canSend()) {
      return;
    }
    const submission: NoteSubmission = {
      text: this.text().trim(),
      attachments: this.attachments(),
    };
    this.attachments.set([]);
    this.text.set('');
    this.submitted.emit(submission);
  }

  private async addPhotos(files: readonly File[]): Promise<void> {
    const room = Math.max(0, NOTE_PHOTOS_MAX - this.attachments().length - this.preparing());
    const accepted = files.slice(0, room);
    if (accepted.length < files.length) {
      this.toast.info(photosLeftOutMessage(files.length - accepted.length));
    }
    this.preparing.update((count) => count + accepted.length);
    for (const file of accepted) {
      await this.addPhoto(file);
    }
  }

  private async addPhoto(file: File): Promise<void> {
    try {
      const image = await this.compress(file, COMPRESS_PRESETS.food_photo);
      if (this.destroyed) {
        return;
      }
      const attachment: NoteAttachment = {
        id: `photo-${this.instance}-${this.nextPhotoId++}`,
        blob: image.blob,
        previewUrl: previewUrl(image.blob),
        width: image.width,
        height: image.height,
      };
      this.attachments.update((list) => [...list, attachment]);
    } catch (err) {
      this.toast.error(errorMessage(err, NOTE_PHOTO_FAILED));
    } finally {
      this.preparing.update((count) => count - 1);
    }
  }

  private focusAfterRemoval(index: number): void {
    const host = this.host.nativeElement;
    const remaining = host.querySelectorAll<HTMLElement>('[data-photo-remove]');
    const target =
      remaining.item(Math.min(index, remaining.length - 1)) ??
      host.querySelector<HTMLElement>('[data-add-photo]');
    target?.focus({ preventScroll: true });
  }

  private fitField(): void {
    const field = this.field().nativeElement;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + field.offsetHeight - field.clientHeight}px`;
  }
}
