import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from './icon';

@Component({
  selector: 'app-page-header',
  imports: [RouterLink, Icon],
  host: {
    class: 'block',
    '[class]': 'stickyClass()',
  },
  template: `
    <header class="flex min-h-14 items-center gap-2 px-4 pt-3 pb-2">
      @if (backLink(); as link) {
        <a class="btn btn-ghost btn-icon -ml-2" [routerLink]="link" [attr.aria-label]="backLabel()">
          <app-icon name="chevron-left" [size]="24" />
        </a>
      }
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-[22px] leading-7 font-bold tracking-tight text-fg">
          {{ title() }}
        </h1>
        @if (subtitle()) {
          <p class="truncate text-sm text-muted">{{ subtitle() }}</p>
        }
      </div>
      <div class="flex shrink-0 items-center gap-1 empty:hidden">
        <ng-content />
      </div>
    </header>
  `,
})
export class PageHeader {
  readonly title = input.required<string>();
  readonly subtitle = input<string>('');
  readonly backLink = input<string | readonly unknown[] | null>(null);
  readonly backLabel = input('Back');
  readonly sticky = input(false);

  protected readonly stickyClass = computed(() =>
    this.sticky() ? 'sticky top-safe z-20 bg-bg/85 backdrop-blur-xl' : '',
  );
}
