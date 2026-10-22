import { Component, computed, inject, input, output } from '@angular/core';
import type { DaySummary } from '@food/shared';
import { AiAvailability } from '../../core/ai-availability.service';
import { Icon } from '../../shared/ui/icon';
import { IDEAS_TITLE, ideasCardNote } from './meal-ideas-model';

@Component({
  selector: 'app-meal-ideas-card',
  imports: [Icon],
  host: { class: 'block', '[class.hidden]': '!ai.enabled()' },
  template: `
    <button
      type="button"
      class="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-line/70 bg-surface py-2 pr-3 pl-2.5 text-left shadow-soft transition active:scale-[0.99] active:bg-surface-2"
      aria-haspopup="dialog"
      (click)="ask.emit()"
    >
      <span
        class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand"
        aria-hidden="true"
      >
        <app-icon name="sparkles" [size]="20" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block text-sm leading-5 font-semibold text-fg">{{ title }}</span>
        <span class="block truncate text-xs leading-4 text-muted tabular-nums">{{ note() }}</span>
      </span>
      <app-icon class="text-muted" name="chevron-right" [size]="18" />
    </button>
  `,
})
export class MealIdeasCard {
  protected readonly ai = inject(AiAvailability);
  readonly day = input.required<DaySummary>();
  readonly ask = output<void>();

  protected readonly title = IDEAS_TITLE;
  protected readonly note = computed(() => ideasCardNote(this.day()));
}
