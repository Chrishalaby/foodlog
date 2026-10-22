import { Component, computed, input } from '@angular/core';
import {
  NUTRIENT_META,
  type NutrientKey,
  type Nutrients,
  type TargetKey,
  type TargetValues,
} from '@food/shared';
import { formatNumber } from '../../shared/utils/format';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';
import { ProgressRing, type ProgressRingOverTone } from '../../shared/ui/progress-ring';

interface MacroRing {
  key: NutrientKey;
  label: string;
  value: number;
  target: number;
  color: string;
  overTone: ProgressRingOverTone;
  summary: string;
}

const MACRO_RINGS = [
  { key: 'protein', target: 'protein', overTone: 'ok' },
  { key: 'carbs', target: 'carbs', overTone: 'danger' },
  { key: 'fat', target: 'fat', overTone: 'danger' },
] as const satisfies readonly {
  key: NutrientKey;
  target: TargetKey;
  overTone: ProgressRingOverTone;
}[];

@Component({
  selector: 'app-day-hero',
  imports: [ProgressRing],
  host: { class: 'block' },
  template: `
    <section class="card p-4" aria-label="Nutrition progress">
      <div class="flex items-center gap-5">
        <app-progress-ring
          [value]="totals().calories"
          [target]="targets().calories"
          [size]="152"
          [stroke]="13"
          label="Calories"
          [color]="caloriesColor"
        />
        <dl class="min-w-0 flex-1 space-y-3">
          <div>
            <dt class="text-xs font-medium text-muted">Eaten</dt>
            <dd class="text-[26px] leading-8 font-bold tracking-tight text-fg tabular-nums">
              {{ eaten() }}<span class="ml-1 text-sm font-medium text-muted">kcal</span>
            </dd>
          </div>
          <div>
            <dt class="text-xs font-medium text-muted">
              {{ trainingDay() ? 'Training day target' : 'Target' }}
            </dt>
            <dd class="text-base leading-6 font-semibold text-fg/90 tabular-nums">
              {{ target() }}<span class="ml-1 text-xs font-medium text-muted">kcal</span>
            </dd>
          </div>
          <div>
            <dt class="sr-only">Progress</dt>
            <dd
              class="text-xs font-semibold tabular-nums"
              [class.text-danger]="caloriesOver()"
              [class.text-muted]="!caloriesOver()"
            >
              {{ percent() }}% of target
            </dd>
          </div>
        </dl>
      </div>

      <div class="mt-4 grid grid-cols-3 gap-2">
        @for (ring of macros(); track ring.key) {
          <div
            class="flex min-w-0 flex-col items-center gap-2 rounded-2xl bg-surface-2/60 px-1 py-3"
          >
            <app-progress-ring
              [value]="ring.value"
              [target]="ring.target"
              [size]="86"
              [stroke]="8"
              [label]="ring.label"
              unit="g"
              [color]="ring.color"
              [overTone]="ring.overTone"
            />
            <p class="truncate text-xs text-muted tabular-nums" aria-hidden="true">
              {{ ring.summary }}
            </p>
          </div>
        }
      </div>

      @if (alcoholNote(); as note) {
        <p class="mt-3 text-xs text-muted">{{ note }}</p>
      }
    </section>
  `,
})
export class DayHero {
  readonly totals = input.required<Nutrients>();
  readonly targets = input.required<TargetValues>();
  readonly trainingDay = input(false);

  protected readonly caloriesColor = NUTRIENT_COLORS.calories;
  protected readonly eaten = computed(() => formatNumber(this.totals().calories));
  protected readonly target = computed(() => formatNumber(this.targets().calories));
  protected readonly caloriesOver = computed(
    () => this.targets().calories > 0 && this.totals().calories > this.targets().calories,
  );
  protected readonly percent = computed(() => {
    const target = this.targets().calories;
    return target > 0 ? Math.round((this.totals().calories / target) * 100) : 0;
  });

  protected readonly macros = computed<MacroRing[]>(() =>
    MACRO_RINGS.map(({ key, target, overTone }) => {
      const value = this.totals()[key];
      const goal = this.targets()[target];
      return {
        key,
        label: NUTRIENT_META[key].label,
        value,
        target: goal,
        color: NUTRIENT_COLORS[key],
        overTone,
        summary: `${formatNumber(value)} / ${formatNumber(goal)} g`,
      };
    }),
  );

  protected readonly alcoholNote = computed(() => {
    const grams = this.totals().alcohol;
    if (grams <= 0) {
      return '';
    }
    return `Includes ${formatNumber(grams, 1)} g alcohol (${formatNumber(grams * 7)} kcal)`;
  });
}
