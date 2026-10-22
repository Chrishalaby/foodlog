import { Component, computed, input } from '@angular/core';
import {
  NUTRIENT_META,
  type NutrientKey,
  type Nutrients,
  type TargetKey,
  type TargetValues,
} from '@food/shared';
import { NutrientBar, type NutrientBarKind } from '../../shared/ui/nutrient-bar';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';

interface LimitBar {
  key: NutrientKey;
  label: string;
  value: number;
  target: number;
  kind: NutrientBarKind;
  unit: string;
  color: string;
  decimals: number;
}

const LIMIT_BARS = [
  { key: 'fiber', target: 'fiberMin', kind: 'min' },
  { key: 'satFat', target: 'satFatMax', kind: 'max' },
  { key: 'sodium', target: 'sodiumMax', kind: 'max' },
  { key: 'sugar', target: 'sugarMax', kind: 'max' },
] as const satisfies readonly { key: NutrientKey; target: TargetKey; kind: NutrientBarKind }[];

@Component({
  selector: 'app-day-limits',
  imports: [NutrientBar],
  host: { class: 'block' },
  template: `
    <section class="card p-4" aria-label="Daily limits">
      <div class="space-y-3.5">
        @for (bar of limits(); track bar.key) {
          <app-nutrient-bar
            [label]="bar.label"
            [value]="bar.value"
            [target]="bar.target"
            [kind]="bar.kind"
            [unit]="bar.unit"
            [color]="bar.color"
            [decimals]="bar.decimals"
          />
        }
      </div>
    </section>
  `,
})
export class DayLimits {
  readonly totals = input.required<Nutrients>();
  readonly targets = input.required<TargetValues>();

  protected readonly limits = computed<LimitBar[]>(() =>
    LIMIT_BARS.map(({ key, target, kind }) => {
      const meta = NUTRIENT_META[key];
      return {
        key,
        label: meta.label,
        value: this.totals()[key],
        target: this.targets()[target],
        kind,
        unit: meta.unit,
        color: NUTRIENT_COLORS[key],
        decimals: meta.decimals,
      };
    }),
  );
}
