import { Component, computed, input, output } from '@angular/core';
import { Icon } from '../../shared/ui/icon';
import { photoTimeLabel } from './entry-timing';

@Component({
  selector: 'app-photo-time-note',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    @if (matches()) {
      <p class="flex min-h-9 flex-wrap items-center gap-x-1.5 text-xs text-muted" role="status">
        <app-icon class="shrink-0" name="image" [size]="14" />
        <span>
          Time from photo ·
          <span class="font-semibold text-fg/80 tabular-nums">{{ label() }}</span>
        </span>
        <span aria-hidden="true">·</span>
        <button
          type="button"
          class="relative rounded-lg px-1 font-semibold text-brand before:absolute before:-inset-x-1.5 before:-inset-y-3 before:content-[''] hover:underline"
          [attr.aria-label]="'Change the time, now ' + label() + ' from the photo'"
          (click)="changeRequested.emit()"
        >
          Change
        </button>
      </p>
    } @else {
      <button
        type="button"
        class="chip relative min-h-9 px-3 text-xs text-muted transition hover:text-fg"
        (click)="restore.emit()"
      >
        <app-icon name="image" [size]="14" />
        Use photo time ·
        <span class="font-semibold tabular-nums">{{ label() }}</span>
      </button>
    }
  `,
})
export class PhotoTimeNote {
  readonly photoTime = input.required<string>();
  readonly dateTime = input.required<string>();
  readonly changeRequested = output<void>();
  readonly restore = output<void>();

  protected readonly matches = computed(() => this.photoTime() === this.dateTime());
  protected readonly label = computed(() => photoTimeLabel(this.photoTime()));
}
