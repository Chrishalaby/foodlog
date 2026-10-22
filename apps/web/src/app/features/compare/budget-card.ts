import { Component, computed, input, output } from '@angular/core';
import { NUTRIENT_META, type NutrientKey } from '@food/shared';
import { Icon } from '../../shared/ui/icon';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';
import { Skeleton } from '../../shared/ui/skeleton';
import { formatNutrientValue } from '../../shared/utils/format';
import { FULL_DAY_NOTE, remainingBudget, type DayBudget } from './compare-ranking';

interface BudgetTile {
  key: NutrientKey;
  label: string;
  value: string;
  caption: string;
  over: boolean;
  done: boolean;
}

function amount(key: NutrientKey, value: number): string {
  return `${formatNutrientValue(key, value)} ${NUTRIENT_META[key].unit}`;
}

@Component({
  selector: 'app-compare-budget',
  imports: [Icon, Skeleton],
  host: { class: 'block' },
  template: `
    <section class="card p-4" aria-labelledby="compare-budget-title">
      <h2 id="compare-budget-title" class="sr-only">What's left for today</h2>
      @if (view(); as v) {
        <div class="flex items-end justify-between gap-4">
          <div class="min-w-0">
            <p class="text-xs font-medium text-muted">{{ v.kcalLabel }}</p>
            <p
              class="text-[30px] leading-9 font-bold tracking-tight tabular-nums"
              [class.text-danger]="v.kcalOver"
              [class.text-fg]="!v.kcalOver"
            >
              {{ v.kcal }}<span class="ml-1 text-sm font-medium text-muted">kcal</span>
            </p>
          </div>
          <div class="min-w-0 text-right">
            <p class="text-xs font-medium text-muted">{{ v.proteinLabel }}</p>
            <p
              class="flex items-center justify-end gap-1 text-lg leading-7 font-semibold text-fg tabular-nums"
            >
              @if (v.proteinDone) {
                <app-icon class="text-ok" name="check" [size]="18" [strokeWidth]="2.5" />
              }
              {{ v.protein }}
            </p>
          </div>
        </div>
        <dl class="mt-3 grid grid-cols-4 gap-1.5">
          @for (tile of v.tiles; track tile.key) {
            <div class="min-w-0 rounded-xl bg-surface-2 px-2 py-1.5">
              <dt
                class="flex min-w-0 items-center gap-1 text-[11px] leading-4 font-medium text-muted"
              >
                <span
                  class="size-1.5 shrink-0 rounded-full"
                  aria-hidden="true"
                  [style.background-color]="colors[tile.key]"
                ></span>
                <span class="truncate">{{ tile.label }}</span>
              </dt>
              <dd class="mt-0.5 min-w-0">
                <span
                  class="block truncate text-[13px] leading-5 font-semibold tabular-nums"
                  [class.text-danger]="tile.over"
                  [class.text-ok]="tile.done"
                  [class.text-fg]="!tile.over && !tile.done"
                  >{{ tile.value }}</span
                >
                <span class="block text-[11px] leading-4 text-muted">{{ tile.caption }}</span>
              </dd>
            </div>
          }
        </dl>
        @if (v.fullDay) {
          <p class="mt-3 flex items-start gap-1.5 text-xs leading-snug text-muted">
            <app-icon class="mt-px shrink-0" name="info" [size]="14" />
            {{ fullDayNote }}
          </p>
        }
        @if (error()) {
          <p class="mt-3 flex items-center justify-between gap-2 text-xs text-warn" role="status">
            Couldn't refresh today's totals.
            <button type="button" class="btn btn-ghost min-h-9 px-2 text-xs" (click)="retry.emit()">
              Retry
            </button>
          </p>
        }
      } @else if (error(); as message) {
        <div class="flex flex-col items-start gap-3" role="alert">
          <p class="flex items-start gap-2 text-sm text-fg/90">
            <app-icon class="mt-0.5 shrink-0 text-warn" name="alert" [size]="16" />
            {{ message }} Options can still be compared, but not ranked.
          </p>
          <button type="button" class="btn btn-secondary" (click)="retry.emit()">
            <app-icon name="refresh" [size]="18" />
            Try again
          </button>
        </div>
      } @else {
        <div class="flex items-end justify-between gap-4" aria-busy="true">
          <div class="flex flex-col gap-2">
            <app-skeleton shape="text" class="w-20" />
            <app-skeleton class="h-8 w-32" />
          </div>
          <div class="flex flex-col items-end gap-2">
            <app-skeleton shape="text" class="w-16" />
            <app-skeleton class="h-6 w-14" />
          </div>
        </div>
        <div class="mt-3 grid grid-cols-4 gap-1.5">
          @for (i of placeholders; track i) {
            <app-skeleton class="h-14" />
          }
        </div>
        <span class="sr-only" role="status">Loading today's totals</span>
      }
    </section>
  `,
})
export class CompareBudget {
  readonly budget = input<DayBudget | null>(null);
  readonly error = input<string | null>(null);
  readonly retry = output<void>();

  protected readonly colors = NUTRIENT_COLORS;
  protected readonly fullDayNote = FULL_DAY_NOTE;
  protected readonly placeholders = [0, 1, 2, 3];

  protected readonly view = computed(() => {
    const budget = this.budget();
    if (!budget) {
      return null;
    }
    const left = remainingBudget(budget);
    const kcalOver = Math.round(left.calories) < 0;
    const tiles: BudgetTile[] = [
      {
        key: 'fiber',
        label: 'Fiber',
        value: left.fiber >= 0.5 ? amount('fiber', left.fiber) : 'Done',
        caption: left.fiber >= 0.5 ? 'to go' : 'target hit',
        over: false,
        done: left.fiber < 0.5,
      },
      ...(['satFat', 'sodium', 'sugar'] as const).map((key) => {
        const room = left[key];
        return {
          key,
          label: key === 'satFat' ? 'Sat fat' : NUTRIENT_META[key].label,
          value: amount(key, Math.abs(room)),
          caption: room < 0 ? 'over' : 'left',
          over: room < 0,
          done: false,
        };
      }),
    ];
    return {
      kcalLabel: kcalOver ? 'Over today by' : 'Left for today',
      kcal: formatNutrientValue('calories', Math.abs(left.calories)),
      kcalOver,
      proteinLabel: left.protein >= 0.5 ? 'Protein to go' : 'Protein',
      protein: left.protein >= 0.5 ? amount('protein', left.protein) : 'Target hit',
      proteinDone: left.protein < 0.5,
      tiles,
      fullDay: budget.fullDay,
    };
  });
}
