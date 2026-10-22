import { Component, input, model } from '@angular/core';
import { Icon, type IconName } from './icon';

@Component({
  selector: 'app-toggle-row',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <button
      type="button"
      role="switch"
      class="flex min-h-14 w-full items-center gap-3 rounded-2xl py-2 text-left transition active:opacity-80 disabled:opacity-50"
      [attr.aria-checked]="checked()"
      [disabled]="disabled()"
      (click)="checked.set(!checked())"
    >
      @if (icon(); as name) {
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-xl transition-colors"
          [class]="checked() ? 'bg-brand/15 text-brand' : 'bg-surface-2 text-muted'"
        >
          <app-icon [name]="name" />
        </span>
      }
      <span class="min-w-0 flex-1">
        <span class="block text-[15px] leading-5 font-semibold text-fg">{{ title() }}</span>
        @if (detail()) {
          <span class="mt-0.5 block text-xs leading-snug text-muted">{{ detail() }}</span>
        }
      </span>
      <span
        class="relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200"
        [class.bg-brand]="checked()"
        [class.bg-field-line]="!checked()"
      >
        <span
          class="absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-soft transition-transform duration-200"
          [class.translate-x-5]="checked()"
        ></span>
      </span>
    </button>
  `,
})
export class ToggleRow {
  readonly checked = model(false);
  readonly title = input.required<string>();
  readonly detail = input('');
  readonly icon = input<IconName | null>(null);
  readonly disabled = input(false);
}
