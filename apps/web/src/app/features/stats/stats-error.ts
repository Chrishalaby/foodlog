import { Component, input, output } from '@angular/core';
import { Icon } from '../../shared/ui/icon';

@Component({
  selector: 'app-stats-error',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div
      class="card flex flex-col items-center px-6 py-10 text-center animate-fade-in"
      role="alert"
    >
      <div
        class="mb-4 flex size-12 items-center justify-center rounded-2xl bg-danger/12 text-danger"
      >
        <app-icon name="alert" [size]="24" />
      </div>
      <h2 class="text-base font-semibold text-fg">{{ title() }}</h2>
      <p class="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{{ message() }}</p>
      <button type="button" class="btn btn-secondary mt-5" (click)="retry.emit()">
        <app-icon name="refresh" [size]="18" />
        Try again
      </button>
    </div>
  `,
})
export class StatsError {
  readonly title = input('Couldn’t load your stats');
  readonly message = input.required<string>();

  readonly retry = output();
}
