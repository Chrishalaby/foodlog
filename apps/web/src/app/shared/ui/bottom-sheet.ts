import {
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { captureReturnFocus, restoreFocusAfterClose } from './focus-return';
import { Icon } from './icon';
import { lockScroll } from './scroll-lock';
import { SheetStack } from './sheet-stack';
import { ToastStack } from './toast-stack';

const CLOSE_DISTANCE_PX = 96;
const CLOSE_VELOCITY_PX_PER_MS = 0.6;

export type SheetCloseReason = 'backdrop' | 'escape' | 'swipe' | 'button';
export type SheetCloseGuard = (reason: SheetCloseReason) => boolean | Promise<boolean>;

interface DragState {
  pointerId: number;
  startY: number;
  startTime: number;
}

function showLayer(layer: HTMLElement): void {
  if (typeof layer.showPopover !== 'function' || layer.matches(':popover-open')) {
    return;
  }
  try {
    layer.showPopover();
  } catch {
    return;
  }
}

@Component({
  selector: 'app-bottom-sheet',
  imports: [Icon, ToastStack],
  styleUrl: './bottom-sheet.css',
  template: `
    <dialog
      #dialog
      class="sheet"
      [class.dragging]="dragging()"
      [style.transform]="dragTransform()"
      [attr.aria-labelledby]="title() ? titleId : null"
      [attr.aria-label]="title() ? null : ariaLabel()"
      (close)="onNativeClose()"
      (cancel)="onCancel($event)"
      (pointerdown)="onDialogPointerDown($event)"
      (click)="onDialogClick($event)"
    >
      <div
        class="flex max-h-[inherit] flex-col overflow-hidden rounded-t-[28px] border border-b-0 border-line/70 bg-elevated text-fg shadow-lifted"
      >
        <div
          class="drag-zone shrink-0 cursor-grab pt-2.5 pr-[max(1.25rem,env(safe-area-inset-right))] pl-[max(1.25rem,env(safe-area-inset-left))]"
          (pointerdown)="onDragStart($event)"
          (pointermove)="onDragMove($event)"
          (pointerup)="onDragEnd($event)"
          (pointercancel)="onDragCancel()"
        >
          <div class="mx-auto h-1.5 w-10 rounded-full bg-muted/40" aria-hidden="true"></div>
          @if (title()) {
            <div class="flex items-center justify-between gap-3 pt-3 pb-1">
              <h2 class="min-w-0 truncate text-lg font-semibold tracking-tight" [id]="titleId">
                {{ title() }}
              </h2>
              <button
                type="button"
                class="btn btn-ghost btn-icon -mr-2 text-muted"
                aria-label="Close"
                (click)="onCloseButton()"
              >
                <app-icon name="close" [size]="22" />
              </button>
            </div>
          } @else {
            <div class="h-3"></div>
          }
        </div>
        <div
          class="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-1 pr-[max(1.25rem,env(safe-area-inset-right))] pb-[calc(1.25rem+env(safe-area-inset-bottom))] pl-[max(1.25rem,env(safe-area-inset-left))]"
        >
          <ng-content />
        </div>
      </div>
      @if (hostsToasts()) {
        <div
          #toastLayer
          popover="manual"
          class="toast-layer"
          role="region"
          aria-label="Notifications"
        >
          <div class="flex justify-center">
            <app-toast-stack />
          </div>
        </div>
      }
    </dialog>
  `,
})
export class BottomSheet {
  private static nextId = 0;

  private readonly document = inject(DOCUMENT);
  private readonly sheets = inject(SheetStack);
  private readonly dialogRef = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  private readonly toastLayer = viewChild<ElementRef<HTMLElement>>('toastLayer');
  private readonly dragOffset = signal(0);
  private drag: DragState | null = null;
  private backdropPressed = false;
  private returnFocus: HTMLElement | null = null;
  private shownDialog: HTMLDialogElement | null = null;
  private releaseScroll: (() => void) | null = null;
  private pendingGuardFor: number | null = null;
  private openCount = 0;

  readonly open = model(false);
  readonly title = input('');
  readonly ariaLabel = input('Sheet');
  readonly canClose = input<SheetCloseGuard | null>(null);
  readonly closed = output<void>();

  protected readonly titleId = `app-sheet-title-${BottomSheet.nextId++}`;
  protected readonly dragging = signal(false);
  protected readonly dragTransform = computed(() =>
    this.dragOffset() > 0 ? `translateY(${this.dragOffset()}px)` : null,
  );
  protected readonly hostsToasts = computed(() => this.open() && this.sheets.top() === this);

  constructor() {
    afterRenderEffect(() => {
      const open = this.open();
      untracked(() => this.sync(open));
    });
    afterRenderEffect(() => {
      const layer = this.toastLayer()?.nativeElement;
      if (layer) {
        untracked(() => showLayer(layer));
      }
    });
    inject(DestroyRef).onDestroy(() => this.onDestroy());
  }

  close(): void {
    const dialog = this.dialogRef().nativeElement;
    if (dialog.open) {
      dialog.close();
    }
    this.finishClose();
  }

  requestClose(reason: SheetCloseReason = 'button'): Promise<boolean> {
    const guard = this.canClose();
    if (!guard || !this.dialogRef().nativeElement.open) {
      this.close();
      return Promise.resolve(true);
    }
    const openCount = this.openCount;
    if (this.pendingGuardFor === openCount) {
      return Promise.resolve(false);
    }
    let verdict: boolean | Promise<boolean>;
    try {
      verdict = guard(reason);
    } catch {
      return Promise.resolve(false);
    }
    if (typeof verdict === 'boolean') {
      return Promise.resolve(this.settleClose(verdict, openCount));
    }
    this.pendingGuardFor = openCount;
    return Promise.resolve(verdict)
      .then(
        (allowed) => allowed === true,
        () => false,
      )
      .then((allowed) => {
        if (this.pendingGuardFor === openCount) {
          this.pendingGuardFor = null;
        }
        return this.settleClose(allowed, openCount);
      });
  }

  protected onCloseButton(): void {
    void this.requestClose('button');
  }

  protected onCancel(event: Event): void {
    if (!this.canClose() || !event.cancelable) {
      return;
    }
    event.preventDefault();
    void this.requestClose('escape');
  }

  protected onNativeClose(): void {
    if (!this.dialogRef().nativeElement.open) {
      this.finishClose();
    }
  }

  protected onDialogPointerDown(event: PointerEvent): void {
    this.backdropPressed = event.target === this.dialogRef().nativeElement;
  }

  protected onDialogClick(event: MouseEvent): void {
    const pressed = this.backdropPressed;
    this.backdropPressed = false;
    if (pressed && event.target === this.dialogRef().nativeElement) {
      void this.requestClose('backdrop');
    }
  }

  protected onDragStart(event: PointerEvent): void {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      return;
    }
    this.drag = { pointerId: event.pointerId, startY: event.clientY, startTime: event.timeStamp };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    this.dragging.set(true);
  }

  protected onDragMove(event: PointerEvent): void {
    if (this.drag?.pointerId !== event.pointerId) {
      return;
    }
    this.dragOffset.set(Math.max(0, event.clientY - this.drag.startY));
  }

  protected onDragEnd(event: PointerEvent): void {
    const drag = this.drag;
    if (drag?.pointerId !== event.pointerId) {
      return;
    }
    const distance = Math.max(0, event.clientY - drag.startY);
    const elapsed = Math.max(1, event.timeStamp - drag.startTime);
    const shouldClose =
      distance > CLOSE_DISTANCE_PX ||
      (distance > 24 && distance / elapsed > CLOSE_VELOCITY_PX_PER_MS);
    this.resetDrag();
    if (shouldClose) {
      void this.requestClose('swipe');
    }
  }

  protected onDragCancel(): void {
    this.resetDrag();
  }

  private settleClose(allowed: boolean, openCount: number): boolean {
    if (!allowed || openCount !== this.openCount) {
      return false;
    }
    this.close();
    return true;
  }

  private sync(open: boolean): void {
    const dialog = this.dialogRef().nativeElement;
    if (open && !dialog.open) {
      this.returnFocus = captureReturnFocus(this.document, dialog);
      this.shownDialog = dialog;
      dialog.showModal();
      this.openCount++;
      this.releaseScroll ??= lockScroll(this.document);
      this.sheets.push(this);
    } else if (!open && dialog.open) {
      dialog.close();
      this.finishClose();
    }
  }

  private finishClose(): void {
    this.resetDrag();
    this.release();
    if (this.open()) {
      this.open.set(false);
    }
    if (!this.shownDialog) {
      return;
    }
    this.restoreFocus();
    this.closed.emit();
  }

  private onDestroy(): void {
    this.release();
    this.restoreFocus();
  }

  private restoreFocus(): void {
    const returnFocus = this.returnFocus;
    const dialog = this.shownDialog;
    this.returnFocus = null;
    this.shownDialog = null;
    if (dialog) {
      restoreFocusAfterClose(this.document, dialog, returnFocus);
    }
  }

  private release(): void {
    this.releaseScroll?.();
    this.releaseScroll = null;
    this.sheets.remove(this);
  }

  private resetDrag(): void {
    this.drag = null;
    this.dragging.set(false);
    this.dragOffset.set(0);
  }
}
