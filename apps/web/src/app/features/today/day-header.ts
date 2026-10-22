import { Component, computed, input, output } from '@angular/core';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { adjacentDate, daySubtitle, dayTitle } from './today-view';

@Component({
  selector: 'app-day-header',
  imports: [Icon, Spinner],
  host: { class: 'sticky top-safe z-20 block bg-bg/85 backdrop-blur-xl' },
  template: `
    <header class="flex min-h-16 items-center gap-1 px-2 pt-2 pb-1.5">
      <button
        type="button"
        class="btn btn-ghost btn-icon text-muted"
        aria-label="Previous day"
        (click)="go(previous())"
      >
        <app-icon name="chevron-left" [size]="24" />
      </button>
      <h1 class="min-w-0 flex-1">
        <button
          type="button"
          class="flex min-h-12 w-full flex-col items-start justify-center rounded-xl px-1 text-left transition active:opacity-70 disabled:cursor-default disabled:active:opacity-100"
          [disabled]="isToday()"
          [attr.aria-label]="isToday() ? title() : title() + ', go back to today'"
          (click)="navigate.emit(today())"
        >
          <span
            class="flex max-w-full items-center gap-2 truncate text-[22px] leading-7 font-bold tracking-tight text-fg"
          >
            {{ title() }}
            @if (busy()) {
              <app-spinner class="text-muted" [size]="14" label="Refreshing" />
            }
          </span>
          <span class="truncate text-[13px] leading-4 font-medium text-muted">
            {{ subtitle() }}
            @if (!isToday()) {
              <span class="text-brand"> · Back to today</span>
            } @else if (note(); as text) {
              <span class="text-accent" data-day-ends> · {{ text }}</span>
            }
          </span>
        </button>
      </h1>
      <button
        type="button"
        class="btn btn-ghost btn-icon text-muted"
        aria-label="Next day"
        [disabled]="next() === null"
        (click)="go(next())"
      >
        <app-icon name="chevron-right" [size]="24" />
      </button>
      <button
        type="button"
        class="ml-1 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition active:scale-[0.97] disabled:opacity-60"
        [class]="trainingClass()"
        aria-label="Training day"
        [attr.aria-pressed]="trainingDay()"
        [disabled]="trainingDisabled()"
        [title]="trainingDay() ? 'Training day: higher targets' : 'Mark as training day'"
        (click)="toggleTraining.emit(!trainingDay())"
      >
        <app-icon name="dumbbell" [size]="18" [strokeWidth]="2.25" />
        Training
      </button>
    </header>
  `,
})
export class DayHeader {
  readonly date = input.required<string>();
  readonly today = input.required<string>();
  readonly note = input<string | null>(null);
  readonly trainingDay = input(false);
  readonly trainingDisabled = input(false);
  readonly busy = input(false);

  readonly navigate = output<string>();
  readonly toggleTraining = output<boolean>();

  protected readonly isToday = computed(() => this.date() === this.today());
  protected readonly title = computed(() => dayTitle(this.date(), this.today()));
  protected readonly subtitle = computed(() => daySubtitle(this.date(), this.today()));
  protected readonly previous = computed(() => adjacentDate(this.date(), -1, this.today()));
  protected readonly next = computed(() => adjacentDate(this.date(), 1, this.today()));
  protected readonly trainingClass = computed(() =>
    this.trainingDay()
      ? 'border-accent/40 bg-accent/15 text-accent'
      : 'border-line bg-surface-2 text-muted',
  );

  protected go(date: string | null): void {
    if (date) {
      this.navigate.emit(date);
    }
  }
}
