import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  input,
  model,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import type { ViewerPhoto } from '../utils/entry-photos';
import { Icon } from './icon';
import { Spinner } from './spinner';

export const SWIPE_MIN_PX = 48;

interface SwipeStart {
  x: number;
  y: number;
  multi: boolean;
}

function pageZoomed(): boolean {
  return (globalThis.visualViewport?.scale ?? 1) > 1.01;
}

@Component({
  selector: 'app-photo-viewer',
  imports: [Icon, Spinner],
  template: `
    <dialog
      #dialog
      class="fixed inset-0 m-0 size-full max-h-none max-w-none touch-manipulation items-center justify-center overflow-hidden border-0 bg-black/95 p-0 text-white backdrop:bg-black/80 open:flex open:animate-fade-in"
      [attr.aria-label]="label()"
      (close)="open.set(false)"
      (click)="close()"
      (keydown)="onKeydown($event)"
      (touchstart)="onTouchStart($event)"
      (touchend)="onTouchEnd($event)"
      (touchcancel)="cancelSwipe()"
    >
      @if (open() && current(); as photo) {
        <app-spinner class="absolute text-white/60" [size]="28" label="Loading photo" />
        @for (shown of [photo]; track shown.id) {
          <img
            class="relative max-h-full max-w-full object-contain select-none"
            decoding="async"
            draggable="false"
            [src]="shown.url"
            [alt]="shown.alt"
          />
        }
        <div
          class="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-linear-to-b from-black/60 to-transparent px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)] pb-6 text-sm font-semibold"
        >
          <p class="min-w-0 flex-1 truncate tabular-nums" aria-live="polite">{{ caption() }}</p>
        </div>
        @if (count() > 1) {
          <button
            type="button"
            class="btn btn-icon absolute top-1/2 left-2 -translate-y-1/2 bg-black/45 text-white backdrop-blur hover:bg-black/60 disabled:opacity-30"
            aria-label="Previous photo"
            [disabled]="position() === 0"
            (click)="step(-1, $event)"
          >
            <app-icon name="chevron-left" [size]="24" />
          </button>
          <button
            type="button"
            class="btn btn-icon absolute top-1/2 right-2 -translate-y-1/2 bg-black/45 text-white backdrop-blur hover:bg-black/60 disabled:opacity-30"
            aria-label="Next photo"
            [disabled]="position() === count() - 1"
            (click)="step(1, $event)"
          >
            <app-icon name="chevron-right" [size]="24" />
          </button>
        }
        @if (canPickCover()) {
          <div
            class="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-linear-to-t from-black/60 to-transparent px-4 pt-8 pb-[calc(env(safe-area-inset-bottom)+1.25rem)]"
            (click)="$event.stopPropagation()"
          >
            @if (coverError(); as message) {
              <p
                class="rounded-xl bg-danger px-3 py-1.5 text-center text-sm font-medium text-danger-fg"
                role="alert"
              >
                {{ message }}
              </p>
            }
            <button
              type="button"
              class="btn min-h-11 gap-1.5 rounded-full px-4 text-sm font-semibold"
              [class]="
                isCover()
                  ? 'bg-white/15 text-white backdrop-blur'
                  : 'bg-white text-black hover:bg-white/90'
              "
              [attr.aria-disabled]="isCover() || coverBusy() ? 'true' : null"
              [attr.aria-busy]="coverBusy() ? 'true' : null"
              (click)="pickCover(photo, $event)"
            >
              @if (coverBusy()) {
                <app-spinner [size]="16" label="Setting cover" />
              } @else {
                <app-icon [name]="isCover() ? 'check' : 'image'" [size]="16" [strokeWidth]="2.5" />
              }
              {{ isCover() ? 'Cover photo' : 'Set as cover' }}
            </button>
          </div>
        }
      }
      <button
        type="button"
        class="btn btn-icon absolute top-[calc(env(safe-area-inset-top)+0.75rem)] right-3 bg-white/15 text-white backdrop-blur hover:bg-white/25"
        aria-label="Close photo"
        (click)="close()"
      >
        <app-icon name="close" [size]="22" />
      </button>
    </dialog>
  `,
})
export class PhotoViewer {
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private swipe: SwipeStart | null = null;

  readonly photos = input<readonly ViewerPhoto[]>([]);
  readonly index = model(0);
  readonly open = model(false);
  readonly coverId = input<string | null>(null);
  readonly coverBusy = input(false);
  readonly coverError = input<string | null>(null);
  readonly coverPicked = output<string>();

  protected readonly count = computed(() => this.photos().length);
  protected readonly position = computed(() =>
    Math.min(Math.max(0, this.index()), Math.max(0, this.count() - 1)),
  );
  protected readonly current = computed(() => this.photos()[this.position()] ?? null);
  protected readonly canPickCover = computed(() => this.coverId() !== null && this.count() > 1);
  protected readonly isCover = computed(() => this.current()?.id === this.coverId());
  protected readonly caption = computed(() => {
    const count = this.count();
    const parts = count > 1 ? [`${this.position() + 1} / ${count}`] : [];
    const caption = this.current()?.caption;
    if (caption) {
      parts.push(caption);
    }
    if (this.canPickCover() && this.isCover()) {
      parts.push('Cover');
    }
    return parts.join(' · ');
  });
  protected readonly label = computed(() => {
    const photo = this.current();
    if (!photo) {
      return 'Photo';
    }
    const count = this.count();
    return count > 1 ? `${photo.alt}, ${this.position() + 1} of ${count}` : photo.alt;
  });

  constructor() {
    afterRenderEffect(() => {
      const open = this.open() && this.current() !== null;
      untracked(() => this.sync(open));
    });
  }

  close(): void {
    this.open.set(false);
  }

  protected step(delta: number, event?: Event): void {
    event?.stopPropagation();
    const next = this.position() + delta;
    if (next >= 0 && next < this.count()) {
      this.index.set(next);
    }
  }

  protected pickCover(photo: ViewerPhoto, event: Event): void {
    event.stopPropagation();
    if (!this.coverBusy() && photo.id !== this.coverId()) {
      this.coverPicked.emit(photo.id);
    }
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      this.step(event.key === 'ArrowLeft' ? -1 : 1);
    }
  }

  protected onTouchStart(event: TouchEvent): void {
    if (event.touches.length > 1) {
      if (this.swipe) {
        this.swipe.multi = true;
      }
      return;
    }
    const touch = event.touches[0];
    this.swipe = touch ? { x: touch.clientX, y: touch.clientY, multi: false } : null;
  }

  protected onTouchEnd(event: TouchEvent): void {
    const start = this.swipe;
    if (!start || event.touches.length > 0) {
      return;
    }
    this.swipe = null;
    const touch = event.changedTouches[0];
    if (start.multi || !touch || pageZoomed()) {
      return;
    }
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.step(dx < 0 ? 1 : -1);
    }
  }

  protected cancelSwipe(): void {
    this.swipe = null;
  }

  private sync(open: boolean): void {
    const dialog = this.dialog().nativeElement;
    if (open && !dialog.open) {
      dialog.showModal?.();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }
}
