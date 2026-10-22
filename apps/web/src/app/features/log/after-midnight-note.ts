import { Component, computed, input, output } from '@angular/core';
import { dayStartHour } from '../../core/day-start';
import { shortDateLabel, todayLocalDate } from '../../core/time';
import { Icon } from '../../shared/ui/icon';
import { afterMidnightNote, dateTimeInputParts } from './entry-timing';

export interface StoredDay {
  date: string;
  moving: boolean;
}

@Component({
  selector: 'app-after-midnight-note',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <p class="text-xs leading-snug text-accent empty:hidden" aria-live="polite">
      @if (counted(); as count) {
        @if (count.action) {
          <span class="mt-0.5 flex flex-wrap items-center gap-x-1.5" data-counted-on>
            <app-icon name="moon" [size]="14" />
            <span>{{ count.text }}</span>
            <button
              type="button"
              class="btn btn-ghost min-h-11 px-2 text-xs font-semibold text-brand"
              (click)="recount.emit()"
            >
              {{ count.action }}
            </button>
          </span>
        } @else {
          <span class="mt-1.5 flex items-start gap-1.5" data-day-move>
            <app-icon class="mt-px" name="moon" [size]="14" />
            <span class="min-w-0">{{ count.text }}</span>
          </span>
        }
      } @else if (note(); as text) {
        <span class="mt-1.5 flex items-start gap-1.5">
          <app-icon class="mt-px" name="moon" [size]="14" />
          <span class="min-w-0">{{ text }}</span>
        </span>
      }
    </p>
  `,
})
export class AfterMidnightNote {
  readonly value = input.required<string>();
  readonly storedDay = input<StoredDay | null>(null);
  readonly recount = output<void>();

  protected readonly counted = computed(() => {
    const stored = this.storedDay();
    const parts = stored ? dateTimeInputParts(this.value()) : null;
    if (!stored || !parts || parts.localDate === stored.date) {
      return null;
    }
    const today = todayLocalDate();
    const target = shortDateLabel(parts.localDate, today);
    return stored.moving
      ? { text: `Moves to ${target} when you save`, action: null }
      : { text: `Counted on ${shortDateLabel(stored.date, today)}`, action: `Move to ${target}` };
  });

  protected readonly note = computed(() =>
    afterMidnightNote(this.value(), dayStartHour(), todayLocalDate()),
  );
}
