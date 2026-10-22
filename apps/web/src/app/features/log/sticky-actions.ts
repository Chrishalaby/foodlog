import { Component, computed, inject } from '@angular/core';
import { KeyboardService } from '../../core/keyboard.service';
import { NetworkService } from '../../core/network.service';

const NAV_OFFSET = 'calc(env(safe-area-inset-bottom) + 4rem)';
const ONLINE_LIFT = '2.25rem';
const OFFLINE_LIFT = '4.5rem';

export const FLOATING_ACTIONS_CLASS =
  'fixed inset-x-0 z-30 mx-auto block w-full max-w-2xl bg-linear-to-t from-bg from-75% to-transparent px-4 pt-6';
export const INLINE_ACTIONS_CLASS = 'relative z-10 mx-auto block w-full max-w-2xl px-4 pt-4 pb-4';

@Component({
  selector: 'app-sticky-actions',
  host: { class: 'block' },
  template: `
    <div
      data-testid="sticky-actions"
      data-toast-clearance
      [class]="containerClass()"
      [style.bottom]="bottom()"
      [style.padding-bottom]="lift()"
    >
      <div class="flex flex-col gap-2"><ng-content /></div>
    </div>
  `,
})
export class StickyActions {
  private readonly online = inject(NetworkService).online;
  private readonly keyboardOpen = inject(KeyboardService).open;

  protected readonly containerClass = computed(() =>
    this.keyboardOpen() ? INLINE_ACTIONS_CLASS : FLOATING_ACTIONS_CLASS,
  );
  protected readonly bottom = computed(() => (this.keyboardOpen() ? null : NAV_OFFSET));
  protected readonly lift = computed(() => {
    if (this.keyboardOpen()) {
      return null;
    }
    return this.online() ? ONLINE_LIFT : OFFLINE_LIFT;
  });
}
