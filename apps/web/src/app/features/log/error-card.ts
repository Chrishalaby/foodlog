import { Component, computed, input, output } from '@angular/core';
import { Icon } from '../../shared/ui/icon';
import type { AnalyzeFailure } from './analyze-errors';

const SOFT_KINDS = new Set<AnalyzeFailure['kind']>(['offline', 'rate_limited']);

@Component({
  selector: 'app-error-card',
  imports: [Icon],
  host: { class: 'block animate-pop-in' },
  template: `
    <div
      class="rounded-card border p-3.5"
      role="alert"
      [class]="soft() ? 'border-warn/30 bg-warn/10' : 'border-danger/30 bg-danger/10'"
    >
      <div class="flex items-start gap-2.5">
        <app-icon
          class="mt-0.5"
          [class]="soft() ? 'text-warn' : 'text-danger'"
          [name]="failure().kind === 'offline' ? 'wifi-off' : 'alert'"
        />
        <div class="min-w-0 flex-1">
          <p
            class="text-[15px] leading-5 font-semibold"
            [class]="soft() ? 'text-warn' : 'text-danger'"
          >
            {{ failure().title }}
          </p>
          <p class="mt-1 text-sm leading-snug text-fg/85">{{ failure().message }}</p>
        </div>
        <button
          type="button"
          class="btn btn-ghost -mt-2.5 -mr-2.5 size-11 shrink-0 rounded-full p-0 text-muted"
          aria-label="Dismiss error"
          (click)="dismissed.emit()"
        >
          <app-icon name="close" [size]="18" />
        </button>
      </div>
      <div class="mt-3 flex flex-wrap gap-2 empty:hidden">
        <ng-content />
      </div>
    </div>
  `,
})
export class ErrorCard {
  readonly failure = input.required<AnalyzeFailure>();
  readonly dismissed = output<void>();

  protected readonly soft = computed(() => SOFT_KINDS.has(this.failure().kind));
}
