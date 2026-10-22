import { Component, input } from '@angular/core';

@Component({
  selector: 'app-logo',
  host: { class: 'inline-flex shrink-0' },
  template: `
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      [attr.width]="size()"
      [attr.height]="size()"
      role="img"
      aria-label="FoodLog"
    >
      <defs>
        <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#5ee89a" />
          <stop offset="1" stop-color="#118a3f" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="116" [attr.fill]="'url(#' + gradientId + ')'" />
      <circle cx="256" cy="256" r="150" fill="none" stroke="#fff" stroke-width="30" />
      <path d="M176 336C158 246 218 162 336 176C350 294 266 354 176 336Z" fill="#fff" />
      <path
        d="M190 322L292 220"
        fill="none"
        stroke="#1a9c4c"
        stroke-width="14"
        stroke-linecap="round"
      />
    </svg>
  `,
})
export class Logo {
  private static nextId = 0;

  readonly size = input(48);

  protected readonly gradientId = `app-logo-gradient-${Logo.nextId++}`;
}
