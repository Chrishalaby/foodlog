import { Component, ElementRef, inject, input, model, output } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import { Icon } from '../../shared/ui/icon';

export interface CardOption<T extends string> {
  value: T;
  title: string;
  detail: string;
  aside?: string | null;
  asideHint?: string;
  intensity?: number;
}

export const INTENSITY_LEVELS = [1, 2, 3, 4, 5] as const;

let nextCardsId = 0;

@Component({
  selector: 'app-choice-cards',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div
      role="radiogroup"
      class="flex flex-col gap-2.5"
      [attr.aria-labelledby]="labelledBy()"
      [attr.aria-describedby]="describedBy()"
    >
      @for (option of options(); track option.value) {
        @let selected = option.value === value();
        <label
          class="flex min-h-16 cursor-pointer items-center gap-3.5 rounded-2xl border px-4 py-3.5 transition duration-150 select-none active:scale-[0.99] has-focus-visible:ring-2 has-focus-visible:ring-brand"
          [class]="selected ? 'border-brand bg-brand/10' : 'border-line bg-surface'"
        >
          <input
            type="radio"
            class="sr-only"
            [name]="groupName"
            [value]="option.value"
            [checked]="selected"
            (change)="value.set(option.value)"
            (blur)="touch.emit()"
          />
          @if (option.intensity) {
            <span class="flex h-6 shrink-0 items-end gap-0.5" aria-hidden="true">
              @for (level of levels; track level) {
                <span
                  class="w-1.5 rounded-full transition-colors"
                  [class]="
                    level <= option.intensity ? (selected ? 'bg-brand' : 'bg-fg/70') : 'bg-line'
                  "
                  [style.height.px]="6 + level * 3.5"
                ></span>
              }
            </span>
          }
          <span class="min-w-0 flex-1">
            <span class="flex items-baseline justify-between gap-3">
              <span class="leading-snug font-semibold text-fg">{{ option.title }}</span>
              @if (option.aside) {
                <span class="shrink-0 text-sm font-semibold text-fg tabular-nums">
                  {{ option.aside }}
                  @if (option.asideHint) {
                    <span class="text-[11px] font-medium text-muted">{{ option.asideHint }}</span>
                  }
                </span>
              }
            </span>
            <span class="mt-0.5 block text-sm leading-snug text-muted">{{ option.detail }}</span>
          </span>
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition"
            [class]="
              selected ? 'border-brand bg-brand text-brand-fg' : 'border-line text-transparent'
            "
            aria-hidden="true"
          >
            <app-icon name="check" [size]="14" [strokeWidth]="3" />
          </span>
        </label>
      }
    </div>
  `,
})
export class ChoiceCards<T extends string> implements FormValueControl<T> {
  readonly value = model.required<T>();
  readonly touch = output<void>();
  readonly options = input.required<readonly CardOption<T>[]>();
  readonly labelledBy = input<string | null>(null);
  readonly describedBy = input<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly groupName = `app-cards-${nextCardsId++}`;
  protected readonly levels = INTENSITY_LEVELS;

  focus(options?: FocusOptions): void {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLInputElement>('input:checked') ?? root.querySelector('input');
    target?.focus(options);
  }
}
