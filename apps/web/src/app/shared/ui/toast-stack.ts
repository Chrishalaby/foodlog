import { Component, inject, input } from '@angular/core';
import {
  type Toast,
  type ToastHoldReason,
  type ToastKind,
  ToastService,
} from '../../core/toast.service';
import { Icon, type IconName } from './icon';
import { ToastAnnouncer } from './toast-announcer';

const TOAST_ICONS: Record<ToastKind, IconName> = {
  success: 'check',
  error: 'alert',
  info: 'info',
};

const TOAST_ICON_CLASSES: Record<ToastKind, string> = {
  success: 'bg-ok/15 text-ok',
  error: 'bg-danger/15 text-danger',
  info: 'bg-accent/15 text-accent',
};

const FRESH_TOLERANCE_MS = 50;

@Component({
  selector: 'app-toast-stack',
  imports: [Icon, ToastAnnouncer],
  host: { class: 'flex w-full max-w-md flex-col items-stretch gap-2' },
  template: `
    @if (announce()) {
      <app-toast-announcer />
    }
    @for (toast of toasts(); track toast.id) {
      <div
        class="pointer-events-auto rounded-2xl border border-line/70 bg-elevated/95 text-fg shadow-lifted backdrop-blur-xl"
        role="group"
        [class.animate-toast-in]="isFresh(toast)"
        [attr.data-kind]="toast.kind"
        [attr.aria-labelledby]="messageId(toast)"
        (pointerenter)="hold(toast.id, 'hover')"
        (pointerleave)="release(toast.id, 'hover')"
        (focusin)="hold(toast.id, 'focus')"
        (focusout)="onFocusOut($event, toast.id)"
        (keydown.escape)="onEscape($event, toast.id)"
      >
        <div class="flex items-center gap-3 py-1.5 pr-1.5 pl-3">
          <span
            class="flex size-8 shrink-0 items-center justify-center rounded-full"
            [class]="iconClass(toast.kind)"
          >
            <app-icon [name]="icon(toast.kind)" [size]="18" [strokeWidth]="2.25" />
          </span>
          <p
            class="min-w-0 flex-1 py-1.5 text-sm leading-snug font-medium break-words"
            [id]="messageId(toast)"
          >
            {{ toast.message }}
          </p>
          @if (toast.actions.length === 1) {
            <button
              type="button"
              class="btn min-h-11 shrink-0 rounded-xl px-3 text-sm text-brand hover:bg-brand/10 active:bg-brand/10"
              (click)="run(toast.id, 0)"
            >
              {{ toast.actions[0].label }}
            </button>
          }
          <button
            type="button"
            class="btn btn-ghost btn-icon text-muted"
            aria-label="Dismiss notification"
            (click)="dismiss(toast.id)"
          >
            <app-icon name="close" [size]="18" />
          </button>
        </div>
        @if (toast.actions.length > 1) {
          <div class="-mt-1 flex flex-wrap justify-end gap-1 pr-1.5 pb-1.5 pl-14">
            @for (action of toast.actions; track $index) {
              <button
                type="button"
                class="btn min-h-11 rounded-xl px-3 text-sm text-brand hover:bg-brand/10 active:bg-brand/10"
                (click)="run(toast.id, $index)"
              >
                {{ action.label }}
              </button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class ToastStack {
  private static nextInstance = 0;

  private readonly service = inject(ToastService);
  private readonly instance = ToastStack.nextInstance++;
  private readonly mountedAt = Date.now();

  readonly announce = input(true);

  protected readonly toasts = this.service.toasts;

  protected messageId(toast: Toast): string {
    return `app-toast-${this.instance}-${toast.id}`;
  }

  protected isFresh(toast: Toast): boolean {
    return toast.createdAt >= this.mountedAt - FRESH_TOLERANCE_MS;
  }

  protected icon(kind: ToastKind): IconName {
    return TOAST_ICONS[kind];
  }

  protected iconClass(kind: ToastKind): string {
    return TOAST_ICON_CLASSES[kind];
  }

  protected hold(id: number, reason: ToastHoldReason): void {
    this.service.pause(id, reason);
  }

  protected release(id: number, reason: ToastHoldReason): void {
    this.service.resume(id, reason);
  }

  protected onFocusOut(event: FocusEvent, id: number): void {
    const container = event.currentTarget as HTMLElement;
    const next = event.relatedTarget;
    if (next instanceof Node && container.contains(next)) {
      return;
    }
    this.service.resume(id, 'focus');
  }

  protected onEscape(event: Event, id: number): void {
    event.preventDefault();
    event.stopPropagation();
    this.dismiss(id);
  }

  protected run(id: number, index: number): void {
    this.service.runAction(id, index);
  }

  protected dismiss(id: number): void {
    this.service.dismiss(id);
  }
}
