import { Component, input } from '@angular/core';
import { Icon, type IconName } from '../../../shared/ui/icon';
import { Logo } from '../../../shared/ui/logo';

interface Highlight {
  icon: IconName;
  tone: string;
  title: string;
  text: string;
}

const HIGHLIGHTS: readonly Highlight[] = [
  {
    icon: 'camera',
    tone: 'bg-brand/15 text-brand',
    title: 'Snap, scan or describe',
    text: 'A photo, a nutrition label or a few words is enough.',
  },
  {
    icon: 'search',
    tone: 'bg-accent/15 text-accent',
    title: 'Log repeats in one tap',
    text: 'Everything you log is remembered, no AI needed next time.',
  },
  {
    icon: 'chart',
    tone: 'bg-calories/15 text-calories',
    title: 'See what matters',
    text: 'Daily targets, weight trend and weekly insights.',
  },
];

@Component({
  selector: 'app-welcome-step',
  imports: [Icon, Logo],
  host: { class: 'flex flex-col items-center text-center' },
  template: `
    <div class="relative mt-4">
      <div
        class="pointer-events-none absolute inset-0 -z-10 scale-150 rounded-full bg-brand/25 blur-3xl"
        aria-hidden="true"
      ></div>
      <app-logo class="rounded-[26px] shadow-lifted" [size]="88" />
    </div>
    <h1
      id="onboarding-title"
      tabindex="-1"
      class="mt-7 text-[30px] leading-9 font-bold tracking-tight text-fg outline-none"
    >
      {{ title() }}
    </h1>
    <p class="mt-3 max-w-xs text-base leading-relaxed text-muted">{{ subtitle() }}</p>

    <ul class="mt-8 flex w-full flex-col gap-2.5 text-left">
      @for (item of highlights; track item.title) {
        <li class="card flex items-center gap-3.5 px-4 py-3.5">
          <span
            class="flex size-11 shrink-0 items-center justify-center rounded-2xl"
            [class]="item.tone"
            aria-hidden="true"
          >
            <app-icon [name]="item.icon" [size]="22" />
          </span>
          <span class="min-w-0">
            <span class="block font-semibold text-fg">{{ item.title }}</span>
            <span class="block text-sm leading-snug text-muted">{{ item.text }}</span>
          </span>
        </li>
      }
    </ul>

    <p class="mt-7 inline-flex items-center gap-2 text-sm font-medium text-muted">
      <app-icon name="clock" [size]="16" />
      Setting up your targets takes about a minute
    </p>
  `,
})
export class WelcomeStep {
  readonly title = input.required<string>();
  readonly subtitle = input.required<string>();

  protected readonly highlights = HIGHLIGHTS;
}
