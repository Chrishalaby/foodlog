import { Component, input } from '@angular/core';
import { Icon, type IconName } from './icon';

@Component({
  selector: 'app-empty-state',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div class="flex flex-col items-center px-6 py-10 text-center">
      <div
        class="mb-4 flex size-14 items-center justify-center rounded-2xl bg-brand/12 text-brand ring-1 ring-brand/20"
      >
        <app-icon [name]="icon()" [size]="26" />
      </div>
      <h2 class="text-base font-semibold text-fg">{{ title() }}</h2>
      @if (text()) {
        <p class="mt-1.5 max-w-xs text-sm leading-relaxed text-muted">{{ text() }}</p>
      }
      <div class="mt-5 flex flex-wrap items-center justify-center gap-2 empty:hidden">
        <ng-content />
      </div>
    </div>
  `,
})
export class EmptyState {
  readonly icon = input<IconName>('sparkles');
  readonly title = input.required<string>();
  readonly text = input<string>('');
}
