import {
  Component,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ToastService } from '../../core/toast.service';

const REPEAT_MARKER = '\u00a0';

interface Announcement {
  id: number;
  text: string;
  assertive: boolean;
}

@Component({
  selector: 'app-toast-announcer',
  host: { class: 'sr-only' },
  template: `
    <div role="status" aria-live="polite" aria-atomic="true">{{ politeText() }}</div>
    <div role="alert" aria-live="assertive" aria-atomic="true">{{ assertiveText() }}</div>
  `,
})
export class ToastAnnouncer {
  private readonly service = inject(ToastService);
  private readonly current = signal<Announcement | null>(null);
  private alternate = false;

  readonly active = input(true);

  private readonly visible = computed(() => {
    const current = this.current();
    if (!current || !this.active()) {
      return null;
    }
    return this.service.toasts().some((t) => t.id === current.id) ? current : null;
  });

  protected readonly politeText = computed(() => {
    const visible = this.visible();
    return visible && !visible.assertive ? visible.text : '';
  });
  protected readonly assertiveText = computed(() => {
    const visible = this.visible();
    return visible?.assertive ? visible.text : '';
  });

  constructor() {
    afterRenderEffect(() => {
      const toast = this.service.announcement();
      if (!toast || !this.active()) {
        return;
      }
      untracked(() => {
        if (!this.service.claimAnnouncement(toast.id)) {
          return;
        }
        this.alternate = !this.alternate;
        this.current.set({
          id: toast.id,
          text: this.alternate ? toast.message : `${toast.message}${REPEAT_MARKER}`,
          assertive: toast.kind === 'error',
        });
      });
    });
  }
}
