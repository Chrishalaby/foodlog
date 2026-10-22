import { Component, afterEveryRender, computed, inject } from '@angular/core';
import { KeyboardService } from '../core/keyboard.service';
import { TOAST_DOCK_GAP_PX, ToastDock } from '../core/toast-dock.service';
import { ToastService } from '../core/toast.service';
import { SheetStack } from '../shared/ui/sheet-stack';
import { ToastAnnouncer } from '../shared/ui/toast-announcer';
import { ToastStack } from '../shared/ui/toast-stack';

export const TOAST_TOP_OFFSET = 'calc(env(safe-area-inset-top) + 0.75rem)';
export const TOAST_BOTTOM_ENTER_OFFSET = '12px';

@Component({
  selector: 'app-toast-outlet',
  imports: [ToastAnnouncer, ToastStack],
  host: {
    class:
      'pointer-events-none fixed inset-x-0 z-[60] flex justify-center pr-[max(1rem,env(safe-area-inset-right))] pl-[max(1rem,env(safe-area-inset-left))]',
    role: 'region',
    'aria-label': 'Notifications',
    '[attr.data-placement]': "atBottom() ? 'bottom' : 'top'",
    '[style.top]': 'atBottom() ? null : topOffset',
    '[style.bottom]': 'bottomOffset()',
    '[style.--toast-enter-offset]': 'atBottom() ? bottomEnterOffset : null',
  },
  template: `
    <app-toast-announcer [active]="!sheets.hasOpen()" />
    @if (!sheets.hasOpen()) {
      <app-toast-stack
        [announce]="false"
        [style.flex-direction]="atBottom() ? 'column-reverse' : null"
      />
    }
  `,
})
export class ToastOutlet {
  private readonly dock = inject(ToastDock);
  private readonly keyboardOpen = inject(KeyboardService).open;
  private readonly toasts = inject(ToastService).toasts;

  protected readonly sheets = inject(SheetStack);
  protected readonly topOffset = TOAST_TOP_OFFSET;
  protected readonly bottomEnterOffset = TOAST_BOTTOM_ENTER_OFFSET;
  protected readonly atBottom = computed(() => !this.keyboardOpen() && this.dock.clearance() > 0);
  protected readonly bottomOffset = computed(() =>
    this.atBottom() ? `${this.dock.clearance() + TOAST_DOCK_GAP_PX}px` : null,
  );

  constructor() {
    afterEveryRender(() => {
      if (this.toasts().length > 0 && !this.sheets.hasOpen()) {
        this.dock.measure();
      }
    });
  }
}
