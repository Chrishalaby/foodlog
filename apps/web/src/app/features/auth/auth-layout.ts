import { Component, inject, input } from '@angular/core';
import { AppIdentityService, NOTES_APP_IDENTITY } from '../../core/app-identity.service';
import { Logo } from '../../shared/ui/logo';

@Component({
  selector: 'app-auth-layout',
  imports: [Logo],
  host: { class: 'block' },
  template: `
    <div
      class="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 supports-[overflow:clip]:overflow-clip pt-[calc(env(safe-area-inset-top)+2.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)]"
    >
      <div
        class="pointer-events-none absolute -top-48 left-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-brand/18 blur-3xl"
        aria-hidden="true"
      ></div>
      <div
        class="pointer-events-none absolute -bottom-56 -left-24 size-[24rem] rounded-full bg-accent/10 blur-3xl"
        aria-hidden="true"
      ></div>
      <main class="relative w-full max-w-sm animate-fade-in">
        <div class="mb-8 flex flex-col items-center text-center">
          @if (notesIcon; as icon) {
            <img
              class="size-[72px] rounded-[22px] shadow-lifted"
              [src]="icon"
              alt="Notes"
              width="72"
              height="72"
            />
          } @else {
            <app-logo class="rounded-[22px] shadow-lifted" [size]="72" />
          }
          <h1 class="mt-6 text-[28px] leading-9 font-bold tracking-tight text-fg">{{ title() }}</h1>
          @if (subtitle()) {
            <p class="mt-2 max-w-xs text-[15px] leading-relaxed text-muted">{{ subtitle() }}</p>
          }
        </div>
        <ng-content select="[authTop]" />
        <div class="card p-5 shadow-lifted sm:p-6">
          <ng-content />
        </div>
        <div class="mt-6 text-center text-sm text-muted empty:hidden">
          <ng-content select="[authFooter]" />
        </div>
      </main>
    </div>
  `,
})
export class AuthLayout {
  protected readonly notesIcon = inject(AppIdentityService).notesHost
    ? NOTES_APP_IDENTITY.icon
    : null;

  readonly title = input.required<string>();
  readonly subtitle = input('');
}
