import { Component, input } from '@angular/core';

@Component({
  selector: 'app-spinner',
  host: {
    class: 'inline-flex shrink-0 items-center justify-center',
    role: 'status',
    '[attr.aria-label]': 'label()',
  },
  template: `
    <svg
      class="animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      [attr.width]="size()"
      [attr.height]="size()"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-opacity="0.2" stroke-width="3" />
      <path
        d="M21.5 12A9.5 9.5 0 0 0 12 2.5"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
      />
    </svg>
  `,
})
export class Spinner {
  readonly size = input(20);
  readonly label = input('Loading');
}
