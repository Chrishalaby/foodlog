import { Component, computed, input } from '@angular/core';
import { formatNumber } from '../utils/format';

export type ProgressRingOverTone = 'danger' | 'warn' | 'ok';

const OVER_TONE_COLORS: Record<ProgressRingOverTone, string> = {
  danger: 'var(--color-danger)',
  warn: 'var(--color-warn)',
  ok: 'var(--color-ok)',
};

const OVER_TONE_TEXT: Record<ProgressRingOverTone, string> = {
  danger: 'text-danger',
  warn: 'text-warn',
  ok: 'text-ok',
};

@Component({
  selector: 'app-progress-ring',
  host: {
    class: 'relative inline-flex shrink-0 items-center justify-center',
    role: 'img',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[attr.aria-label]': 'ariaLabel()',
  },
  template: `
    <svg class="absolute inset-0 -rotate-90" [attr.viewBox]="viewBox()" aria-hidden="true">
      <circle
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        fill="none"
        stroke="var(--color-surface-2)"
        [attr.stroke-width]="stroke()"
      />
      <circle
        class="transition-[stroke-dashoffset] duration-700 ease-out"
        [attr.cx]="center()"
        [attr.cy]="center()"
        [attr.r]="radius()"
        fill="none"
        [attr.stroke]="color()"
        [attr.stroke-width]="stroke()"
        stroke-linecap="round"
        [attr.stroke-dasharray]="circumference()"
        [attr.stroke-dashoffset]="progressOffset()"
      />
      @if (over()) {
        <circle
          class="transition-[stroke-dashoffset] duration-700 ease-out"
          [attr.cx]="center()"
          [attr.cy]="center()"
          [attr.r]="radius()"
          fill="none"
          [attr.stroke]="overColor()"
          [attr.stroke-width]="stroke()"
          stroke-linecap="round"
          [attr.stroke-dasharray]="circumference()"
          [attr.stroke-dashoffset]="overflowOffset()"
        />
      }
    </svg>
    <div class="relative flex flex-col items-center text-center leading-none" aria-hidden="true">
      @if (label()) {
        <span class="mb-1 font-medium text-muted" [style.font-size.px]="smallFont()">{{
          label()
        }}</span>
      }
      <span
        class="font-bold tracking-tight whitespace-nowrap tabular-nums"
        [class]="over() ? overText() : 'text-fg'"
        [style.font-size.px]="bigFont()"
      >
        {{ displayRemaining() }}
      </span>
      <span
        class="mt-1 font-medium whitespace-nowrap"
        [class]="over() ? overText() : 'text-muted'"
        [style.font-size.px]="smallFont()"
      >
        {{ unit() }} {{ over() ? 'over' : 'left' }}
      </span>
    </div>
  `,
})
export class ProgressRing {
  readonly value = input.required<number>();
  readonly target = input.required<number>();
  readonly color = input('var(--color-calories)');
  readonly size = input(132);
  readonly stroke = input(11);
  readonly label = input('');
  readonly unit = input('kcal');
  readonly decimals = input(0);
  readonly overTone = input<ProgressRingOverTone>('danger');

  protected readonly center = computed(() => this.size() / 2);
  protected readonly radius = computed(() => Math.max(0, (this.size() - this.stroke()) / 2));
  protected readonly viewBox = computed(() => `0 0 ${this.size()} ${this.size()}`);
  protected readonly circumference = computed(() => 2 * Math.PI * this.radius());
  protected readonly ratio = computed(() => {
    const target = this.target();
    return target > 0 ? Math.max(0, this.value()) / target : 0;
  });
  protected readonly over = computed(() => this.target() > 0 && this.value() > this.target());
  protected readonly overColor = computed(() => OVER_TONE_COLORS[this.overTone()]);
  protected readonly overText = computed(() => OVER_TONE_TEXT[this.overTone()]);
  protected readonly progressOffset = computed(
    () => this.circumference() * (1 - Math.min(1, this.ratio())),
  );
  protected readonly overflowOffset = computed(
    () => this.circumference() * (1 - Math.min(1, Math.max(0, this.ratio() - 1))),
  );
  protected readonly displayRemaining = computed(() =>
    formatNumber(Math.abs(this.target() - this.value()), this.decimals()),
  );
  protected readonly bigFont = computed(() => Math.round(this.size() * 0.2));
  protected readonly smallFont = computed(() => Math.max(10, Math.round(this.size() * 0.09)));
  protected readonly ariaLabel = computed(() => {
    const label = this.label() ? `${this.label()}: ` : '';
    const value = formatNumber(this.value(), this.decimals());
    const target = formatNumber(this.target(), this.decimals());
    const status = `${this.displayRemaining()} ${this.unit()} ${this.over() ? 'over' : 'left'}`;
    return `${label}${value} of ${target} ${this.unit()}, ${status}`;
  });
}
