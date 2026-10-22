import { Component, computed, input } from '@angular/core';
import { formatNumber } from '../utils/format';
import { Icon } from './icon';

export type NutrientBarKind = 'goal' | 'min' | 'max';
export type NutrientBarStatus = 'normal' | 'met' | 'over';

@Component({
  selector: 'app-nutrient-bar',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div class="flex items-baseline justify-between gap-3 text-sm">
      <span class="flex min-w-0 items-center gap-1.5 font-medium text-fg">
        <span
          class="size-2 shrink-0 rounded-full"
          aria-hidden="true"
          [style.background-color]="color()"
        ></span>
        <span class="truncate">{{ label() }}</span>
        @if (status() === 'met') {
          <app-icon class="text-ok" name="check" [size]="16" [strokeWidth]="2.5" />
        }
        @if (status() === 'over') {
          <app-icon class="text-danger" name="alert" [size]="16" />
        }
      </span>
      <span class="shrink-0 whitespace-nowrap text-muted tabular-nums">
        <span
          class="font-semibold"
          [class.text-danger]="status() === 'over'"
          [class.text-fg]="status() !== 'over'"
        >
          {{ valueText() }}
        </span>
        <span> / {{ targetText() }} {{ unit() }}</span>
      </span>
    </div>
    <div
      class="relative mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2"
      role="progressbar"
      [attr.aria-label]="label()"
      [attr.aria-valuenow]="ariaNow()"
      aria-valuemin="0"
      [attr.aria-valuemax]="ariaMax()"
      [attr.aria-valuetext]="ariaText()"
    >
      <div
        class="h-full rounded-full transition-[width] duration-500 ease-out"
        [style.width.%]="fillPercent()"
        [style.background-color]="barColor()"
      ></div>
    </div>
    @if (hint()) {
      <p
        class="mt-1 text-xs"
        [class.text-danger]="status() === 'over'"
        [class.text-ok]="status() === 'met'"
        [class.text-muted]="status() === 'normal'"
      >
        {{ hint() }}
      </p>
    }
  `,
})
export class NutrientBar {
  readonly label = input.required<string>();
  readonly value = input.required<number>();
  readonly target = input.required<number>();
  readonly kind = input<NutrientBarKind>('goal');
  readonly unit = input('g');
  readonly color = input('var(--color-brand)');
  readonly decimals = input(0);
  readonly showHint = input(true);

  protected readonly ratio = computed(() => {
    const target = this.target();
    return target > 0 ? Math.max(0, this.value()) / target : 0;
  });

  protected readonly status = computed<NutrientBarStatus>(() => {
    const kind = this.kind();
    if (kind === 'max' && this.target() > 0 && this.value() > this.target()) {
      return 'over';
    }
    if (kind === 'min' && this.target() > 0 && this.value() >= this.target()) {
      return 'met';
    }
    return 'normal';
  });

  protected readonly fillPercent = computed(() => Math.min(100, this.ratio() * 100));

  protected readonly barColor = computed(() => {
    switch (this.status()) {
      case 'over':
        return 'var(--color-danger)';
      case 'met':
        return 'var(--color-ok)';
      default:
        return this.color();
    }
  });

  protected readonly valueText = computed(() => formatNumber(this.value(), this.decimals()));
  protected readonly targetText = computed(() => formatNumber(this.target(), this.decimals()));

  protected readonly hint = computed(() => (this.showHint() ? this.statusText() : ''));

  protected readonly statusText = computed(() => {
    if (this.target() <= 0) {
      return '';
    }
    const diff = formatNumber(Math.abs(this.target() - this.value()), this.decimals());
    switch (this.kind()) {
      case 'max':
        return this.status() === 'over' ? `${diff} ${this.unit()} over limit` : '';
      case 'min':
        return this.status() === 'met' ? 'Minimum reached' : `${diff} ${this.unit()} to go`;
      default:
        return '';
    }
  });

  protected readonly ariaMax = computed(() => (this.target() > 0 ? this.target() : 100));
  protected readonly ariaNow = computed(() =>
    this.target() > 0 ? Math.min(this.ariaMax(), Math.max(0, this.value() || 0)) : 0,
  );

  protected readonly ariaText = computed(() => {
    const base = `${this.valueText()} of ${this.targetText()} ${this.unit()}`;
    const status = this.statusText();
    return status ? `${base}, ${status}` : base;
  });
}
