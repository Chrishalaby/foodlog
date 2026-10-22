import { Component, ElementRef, computed, inject, input, model, output } from '@angular/core';
import type { FormValueControl } from '@angular/forms/signals';
import type { AiModelOption } from '@food/shared';
import { formatUsd } from '../usage-math';

export interface ModelChoice {
  id: string;
  label: string;
  description: string;
  cost: string | null;
  recommended: boolean;
}

export const SERVER_DEFAULT_ID = '';

export function modelChoices(
  options: readonly AiModelOption[],
  defaultModel: string,
  selected: string,
): ModelChoice[] {
  const fallback = options.find((option) => option.id === defaultModel);
  const choices: ModelChoice[] = [
    {
      id: SERVER_DEFAULT_ID,
      label: 'Default (server)',
      description: `Follows the server setting, currently ${fallback?.label ?? defaultModel}.`,
      cost: fallback ? formatUsd(fallback.estCostPerRequestUsd) : null,
      recommended: false,
    },
    ...options.map((option) => ({
      id: option.id,
      label: option.label,
      description: option.description,
      cost: formatUsd(option.estCostPerRequestUsd),
      recommended: option.recommended,
    })),
  ];
  if (selected !== SERVER_DEFAULT_ID && !options.some((option) => option.id === selected)) {
    choices.push({
      id: selected,
      label: selected,
      description: 'No longer available. The server default is used instead.',
      cost: null,
      recommended: false,
    });
  }
  return choices;
}

let nextPickerId = 0;

@Component({
  selector: 'app-model-picker',
  host: { class: 'block' },
  template: `
    <div
      role="radiogroup"
      class="flex flex-col gap-2"
      [attr.aria-labelledby]="labelledBy()"
      [attr.aria-describedby]="describedBy()"
      [attr.aria-invalid]="invalid() && touched() ? 'true' : null"
    >
      @for (choice of choices(); track choice.id) {
        <label
          class="flex cursor-pointer items-start gap-3 rounded-2xl border border-line bg-surface-2 p-3.5 transition duration-150 has-checked:border-brand has-checked:bg-brand/10 has-focus-visible:ring-2 has-focus-visible:ring-brand"
        >
          <input
            type="radio"
            class="mt-0.5 size-5 shrink-0 accent-brand"
            [name]="groupName"
            [value]="choice.id"
            [checked]="choice.id === value()"
            [attr.aria-describedby]="groupName + '-d' + $index"
            (change)="value.set(choice.id)"
            (blur)="touch.emit()"
          />
          <span class="min-w-0 flex-1">
            <span class="flex items-start justify-between gap-3">
              <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="font-semibold text-fg">{{ choice.label }}</span>
                @if (choice.recommended) {
                  <span class="chip bg-brand/15 text-brand">Recommended</span>
                }
              </span>
              @if (choice.cost) {
                <span
                  class="shrink-0 text-sm font-semibold text-fg tabular-nums"
                  aria-hidden="true"
                >
                  ~{{ choice.cost }}
                </span>
              }
            </span>
            <span
              class="mt-0.5 block text-sm leading-snug text-muted"
              [id]="groupName + '-d' + $index"
            >
              {{ choice.description }}
              @if (choice.cost) {
                <span class="sr-only">About {{ choice.cost }} per analysis.</span>
              }
            </span>
          </span>
        </label>
      }
    </div>
  `,
})
export class ModelPicker implements FormValueControl<string> {
  readonly value = model.required<string>();
  readonly touch = output<void>();
  readonly options = input.required<readonly AiModelOption[]>();
  readonly defaultModel = input.required<string>();
  readonly labelledBy = input<string | null>(null);
  readonly describedBy = input<string | null>(null);
  readonly invalid = input(false);
  readonly touched = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly groupName = `app-model-${nextPickerId++}`;
  protected readonly choices = computed(() =>
    modelChoices(this.options(), this.defaultModel(), this.value()),
  );

  focus(options?: FocusOptions): void {
    const root = this.host.nativeElement;
    const target =
      root.querySelector<HTMLInputElement>('input:checked') ?? root.querySelector('input');
    target?.focus(options);
  }
}
