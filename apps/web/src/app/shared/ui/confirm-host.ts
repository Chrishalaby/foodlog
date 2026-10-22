import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  inject,
  untracked,
  viewChild,
} from '@angular/core';
import { ConfirmService } from './confirm.service';
import { captureReturnFocus, restoreFocusAfterClose } from './focus-return';
import { Icon } from './icon';
import { lockScroll } from './scroll-lock';

@Component({
  selector: 'app-confirm-host',
  imports: [Icon],
  template: `
    <dialog
      #dialog
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="app-confirm-title"
      aria-describedby="app-confirm-message"
      class="m-auto max-h-[calc(100dvh-2rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[min(22rem,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-3xl border border-line/70 bg-elevated p-0 text-fg shadow-lifted backdrop:bg-(--app-backdrop) open:animate-pop-in"
      (close)="onClose()"
    >
      @if (confirm.current(); as request) {
        <div class="px-5 pt-5 pb-4">
          @if (request.tone === 'danger') {
            <div
              class="mb-3 flex size-10 items-center justify-center rounded-full bg-danger/15 text-danger"
              aria-hidden="true"
            >
              <app-icon name="alert" [size]="20" />
            </div>
          }
          <h2 id="app-confirm-title" class="text-lg font-semibold tracking-tight break-words">
            {{ request.title }}
          </h2>
          <p
            id="app-confirm-message"
            class="mt-1.5 text-sm leading-relaxed break-words text-muted empty:hidden"
          >
            {{ request.message }}
          </p>
        </div>
        <div class="grid grid-cols-2 gap-2 px-5 pb-5">
          <button
            type="button"
            class="btn btn-secondary"
            autofocus
            (click)="answer(request.id, false)"
          >
            {{ request.cancelLabel }}
          </button>
          <button
            type="button"
            class="btn"
            [class.btn-danger]="request.tone === 'danger'"
            [class.btn-primary]="request.tone !== 'danger'"
            (click)="answer(request.id, true)"
          >
            {{ request.confirmLabel }}
          </button>
        </div>
      }
    </dialog>
  `,
})
export class ConfirmHost {
  protected readonly confirm = inject(ConfirmService);
  private readonly document = inject(DOCUMENT);
  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private releaseScroll: (() => void) | null = null;
  private returnFocus: HTMLElement | null = null;

  constructor() {
    afterRenderEffect(() => {
      const open = this.confirm.current() !== null;
      untracked(() => this.sync(open));
    });
    inject(DestroyRef).onDestroy(() => this.unlock());
  }

  protected answer(id: number, confirmed: boolean): void {
    this.confirm.settle(id, confirmed);
  }

  protected onClose(): void {
    if (this.dialogRef().nativeElement.open) {
      return;
    }
    this.unlock();
    this.restoreFocus();
    const request = this.confirm.current();
    if (request) {
      this.confirm.settle(request.id, false);
    }
  }

  private sync(open: boolean): void {
    const dialog = this.dialogRef().nativeElement;
    if (open && !dialog.open) {
      this.returnFocus = captureReturnFocus(this.document, dialog);
      dialog.showModal();
      this.releaseScroll ??= lockScroll(this.document);
    } else if (!open && dialog.open) {
      dialog.close();
      this.unlock();
      this.restoreFocus();
    }
  }

  private restoreFocus(): void {
    const target = this.returnFocus;
    this.returnFocus = null;
    restoreFocusAfterClose(this.document, this.dialogRef().nativeElement, target);
  }

  private unlock(): void {
    this.releaseScroll?.();
    this.releaseScroll = null;
  }
}
