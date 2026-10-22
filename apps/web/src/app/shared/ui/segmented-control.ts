import { Component, computed, input, model } from '@angular/core';
import { Icon, type IconName } from './icon';

export interface SegmentOption<T> {
  value: T;
  label: string;
  icon?: IconName;
}

@Component({
  selector: 'app-segmented-control',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div
      class="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl border border-line/70 bg-surface-2 p-1"
      role="radiogroup"
      [attr.aria-label]="ariaLabel()"
    >
      @for (option of options(); track option.value) {
        <button
          type="button"
          role="radio"
          class="relative flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition duration-150 before:absolute before:-inset-x-0.5 before:-inset-y-1 before:content-[''] hover:text-fg"
          [class.bg-elevated]="option.value === value()"
          [class.text-fg]="option.value === value()"
          [class.shadow-soft]="option.value === value()"
          [class.text-muted]="option.value !== value()"
          [attr.aria-checked]="option.value === value()"
          [attr.tabindex]="$index === focusIndex() ? 0 : -1"
          (click)="select(option.value)"
          (keydown)="onKeydown($event, $index)"
        >
          @if (option.icon) {
            <app-icon [name]="option.icon" [size]="16" />
          }
          <span class="truncate">{{ option.label }}</span>
        </button>
      }
    </div>
  `,
})
export class SegmentedControl<T> {
  readonly options = input.required<readonly SegmentOption<T>[]>();
  readonly value = model.required<T>();
  readonly ariaLabel = input('Options');

  protected readonly focusIndex = computed(() =>
    Math.max(
      0,
      this.options().findIndex((option) => option.value === this.value()),
    ),
  );

  protected select(value: T): void {
    this.value.set(value);
  }

  protected onKeydown(event: KeyboardEvent, index: number): void {
    const options = this.options();
    const target = keyTarget(event.key, index, options.length);
    const next = target === null ? undefined : options[target];
    if (target === null || !next) {
      return;
    }
    event.preventDefault();
    this.select(next.value);
    const group = (event.currentTarget as HTMLElement).parentElement;
    group?.querySelectorAll<HTMLButtonElement>('button[role="radio"]').item(target)?.focus();
  }
}

function keyTarget(key: string, index: number, count: number): number | null {
  if (count === 0) {
    return null;
  }
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
