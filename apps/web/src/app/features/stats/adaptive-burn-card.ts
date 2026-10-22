import { Component, computed, input, output } from '@angular/core';
import type { AdaptiveTdeeConfidence, AdaptiveTdeeDto, TdeeSource } from '@food/shared';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { formatNumber } from '../../shared/utils/format';
import {
  TARGET_WEIGH_INS_PER_WEEK,
  compareBurn,
  formatSigned,
  formatSignedKg,
} from './weight-math';

interface ConfidenceStyle {
  label: string;
  classes: string;
  note: string;
}

const CONFIDENCE_STYLES: Record<AdaptiveTdeeConfidence, ConfidenceStyle> = {
  high: {
    label: 'High confidence',
    classes: 'bg-ok/12 text-ok ring-ok/25',
    note: 'Plenty of consistent data behind this number.',
  },
  medium: {
    label: 'Medium confidence',
    classes: 'bg-accent/12 text-accent ring-accent/25',
    note: 'A solid estimate. More logged days and weigh-ins make it sharper.',
  },
  low: {
    label: 'Low confidence',
    classes: 'bg-warn/12 text-warn ring-warn/25',
    note: 'Early estimate. Keep logging meals and weighing in to firm it up.',
  },
};

const SOURCE_LABELS: Record<TdeeSource, string> = {
  formula: 'from your profile',
  override: 'set by you',
};

@Component({
  selector: 'app-adaptive-burn-card',
  imports: [Icon, Spinner],
  host: { class: 'block' },
  template: `
    <section class="card p-4" aria-labelledby="adaptive-burn-title">
      <div class="flex items-center gap-2.5">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-calories/15 text-calories"
        >
          <app-icon name="flame" [size]="18" />
        </span>
        <h2 id="adaptive-burn-title" class="text-base font-semibold text-fg">
          Measured daily burn
        </h2>
      </div>

      @if (view(); as view) {
        <div class="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p class="text-[28px] leading-8 font-bold tracking-tight text-fg tabular-nums">
            ≈ {{ view.kcal }}<span class="ml-1 text-sm font-medium text-muted">kcal/day</span>
          </p>
          <span
            class="rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1"
            [class]="view.confidence.classes"
          >
            {{ view.confidence.label }}
          </span>
        </div>
        <p class="mt-1.5 text-sm leading-relaxed text-muted">{{ view.basis }}</p>

        <dl class="mt-3 grid grid-cols-2 gap-2">
          <div class="rounded-2xl bg-surface-2/70 px-3 py-2.5">
            <dt class="text-[11px] font-medium text-muted">Average intake</dt>
            <dd class="text-sm font-semibold text-fg tabular-nums">{{ view.intake }} kcal</dd>
          </div>
          <div class="rounded-2xl bg-surface-2/70 px-3 py-2.5">
            <dt class="text-[11px] font-medium text-muted">Weight change</dt>
            <dd class="text-sm font-semibold text-fg tabular-nums">{{ view.change }} kg</dd>
          </div>
        </dl>

        @if (view.comparison; as comparison) {
          <div class="mt-3 flex items-center gap-3 border-t border-line/60 pt-3">
            <div class="min-w-0 flex-1">
              <p class="text-[11px] font-medium text-muted">
                Current daily burn · {{ comparison.source }}
              </p>
              <p class="text-sm font-semibold text-fg tabular-nums">
                {{ comparison.current }} kcal
              </p>
            </div>
            @if (!view.inUse) {
              <span
                class="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold tabular-nums"
                [class.text-fg]="!comparison.large"
                [class.text-warn]="comparison.large"
              >
                {{ comparison.diff }}
              </span>
            }
          </div>
        }

        <p class="mt-3 text-xs leading-relaxed text-muted">{{ view.confidence.note }}</p>

        @if (view.inUse) {
          <p
            class="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ok/10 text-sm font-semibold text-ok"
            role="status"
          >
            <app-icon name="check" [size]="18" />
            Used as your daily burn
          </p>
        } @else {
          <button
            type="button"
            class="btn btn-primary mt-3 min-h-12 w-full"
            [disabled]="busy()"
            (click)="adopt.emit(view.value)"
          >
            @if (busy()) {
              <app-spinner [size]="18" label="Saving" />
            }
            Use as my daily burn
          </button>
        }
      } @else {
        <p class="mt-3 text-sm font-semibold text-fg">Not enough data yet</p>
        <p class="mt-1 text-sm leading-relaxed text-muted">
          FoodLog can measure how much you really burn by comparing what you eat with how your
          weight moves. Log your meals on most days and weigh in 3+ times a week for 2–4 weeks.
        </p>
        <div class="mt-3 rounded-2xl bg-surface-2/70 px-3 py-2.5">
          <div class="flex items-center justify-between text-xs">
            <span class="font-medium text-muted">Weigh-ins, last 4 weeks</span>
            <span class="font-semibold text-fg tabular-nums">{{ perWeekLabel() }}</span>
          </div>
          <div
            class="mt-2 h-1.5 overflow-hidden rounded-full bg-line/70"
            role="progressbar"
            aria-label="Weigh-ins per week"
            aria-valuemin="0"
            [attr.aria-valuemax]="targetPerWeek"
            [attr.aria-valuenow]="perWeek()"
          >
            <div
              class="h-full rounded-full bg-accent transition-[width] duration-500"
              [style.width.%]="perWeekPercent()"
            ></div>
          </div>
        </div>
      }
    </section>
  `,
})
export class AdaptiveBurnCard {
  readonly adaptive = input<AdaptiveTdeeDto | null>(null);
  readonly currentKcal = input<number | null>(null);
  readonly source = input<TdeeSource | null>(null);
  readonly perWeek = input(0);
  readonly busy = input(false);

  readonly adopt = output<number>();

  protected readonly targetPerWeek = TARGET_WEIGH_INS_PER_WEEK;

  protected readonly perWeekLabel = computed(
    () => `${formatNumber(this.perWeek(), 1)} / week (aim for ${TARGET_WEIGH_INS_PER_WEEK}+)`,
  );
  protected readonly perWeekPercent = computed(() =>
    Math.min(100, Math.round((this.perWeek() / TARGET_WEIGH_INS_PER_WEEK) * 100)),
  );

  protected readonly view = computed(() => {
    const adaptive = this.adaptive();
    if (!adaptive) {
      return null;
    }
    const current = this.currentKcal();
    const source = this.source();
    const comparison = compareBurn(adaptive.kcal, current);
    const days = (count: number, noun: string): string =>
      `${count} ${noun}${count === 1 ? '' : 's'}`;
    return {
      value: adaptive.kcal,
      kcal: formatNumber(adaptive.kcal),
      intake: formatNumber(adaptive.avgIntakeKcal),
      change: formatSignedKg(adaptive.weightChangeKg),
      basis: `Based on ${days(adaptive.loggedDays, 'logged day')} and ${days(adaptive.weighIns, 'weigh-in')} over the last ${adaptive.windowDays} days.`,
      confidence: CONFIDENCE_STYLES[adaptive.confidence],
      inUse: source === 'override' && current === adaptive.kcal,
      comparison: comparison
        ? {
            current: formatNumber(comparison.currentKcal),
            source: source ? SOURCE_LABELS[source] : '',
            diff: `${formatSigned(comparison.diffKcal, 0)} kcal (${formatSigned(comparison.diffPercent, 0)}%)`,
            large: Math.abs(comparison.diffPercent) > 10,
          }
        : null,
    };
  });
}
