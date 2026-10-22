import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { EntryDto, FavoriteDto } from '@food/shared';
import { relativeDayLabel, toTimeLabel } from '../../core/time';
import { Icon } from '../../shared/ui/icon';
import { MealTypeBadge } from '../../shared/ui/meal-type-badge';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';
import { Spinner } from '../../shared/ui/spinner';
import { formatNutrientValue } from '../../shared/utils/format';
import { amountLine, sumGrams } from '../../shared/utils/portion';
import { useCountLabel } from './favorites-math';

@Component({
  selector: 'app-favorite-card',
  imports: [RouterLink, Icon, MealTypeBadge, Spinner],
  host: { class: 'block' },
  template: `
    <article class="card p-3">
      <button
        type="button"
        class="flex w-full min-w-0 items-center gap-3 rounded-2xl text-left transition active:opacity-80"
        aria-haspopup="dialog"
        (click)="customize.emit(favorite())"
      >
        @if (thumbUrl(); as src) {
          <img
            class="size-14 shrink-0 rounded-xl bg-surface-2 object-cover"
            [src]="src"
            alt=""
            loading="lazy"
            decoding="async"
            width="56"
            height="56"
          />
        } @else {
          <div
            class="flex size-14 shrink-0 items-center justify-center rounded-xl bg-warn/12 text-warn"
          >
            <app-icon name="star" [size]="24" />
          </div>
        }
        <div class="min-w-0 flex-1">
          <p class="truncate text-[15px] leading-5 font-semibold text-fg">{{ favorite().name }}</p>
          @if (amount(); as text) {
            <span
              class="mt-0.5 block truncate text-xs leading-4 font-medium text-fg/75 tabular-nums"
              data-favorite-amount
            >
              {{ text }}
            </span>
          }
          <div class="mt-1 flex min-w-0 items-center gap-2 text-xs text-muted">
            @if (favorite().mealType; as mealType) {
              <app-meal-type-badge [mealType]="mealType" />
            }
            <span class="truncate">{{ uses() }}</span>
          </div>
          <div class="mt-1.5 flex items-center gap-3 text-xs text-muted tabular-nums">
            @for (macro of macros(); track macro.key) {
              <span class="inline-flex items-baseline gap-1">
                <span class="font-bold" [style.color]="macro.color">{{ macro.letter }}</span>
                <span class="text-fg/85">{{ macro.value }}</span>
              </span>
            }
          </div>
        </div>
        <div class="shrink-0 pl-1 text-right">
          <div class="text-xl leading-6 font-bold tracking-tight text-fg tabular-nums">
            {{ calories() }}
          </div>
          <div class="text-[11px] font-medium text-muted">kcal</div>
        </div>
      </button>

      @if (recent(); as entry) {
        <div
          class="mt-2.5 flex animate-fade-in items-center gap-2 rounded-xl bg-ok/10 py-0.5 pr-0.5 pl-3 text-sm text-ok"
          role="status"
        >
          <app-icon name="check" [size]="16" [strokeWidth]="2.5" />
          <span class="min-w-0 flex-1 truncate font-medium">{{ recentLabel() }}</span>
          <a
            class="btn min-h-11 rounded-lg px-3 text-sm text-ok hover:bg-ok/10"
            [routerLink]="['/entries', entry.id]"
          >
            View
          </a>
        </div>
      }

      <div class="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          class="btn btn-ghost btn-icon text-muted"
          aria-haspopup="dialog"
          [attr.aria-label]="'More actions for ' + favorite().name"
          (click)="more.emit(favorite())"
        >
          <app-icon name="more-horizontal" [size]="22" [strokeWidth]="2.75" />
        </button>
        <span class="flex-1"></span>
        <button
          type="button"
          class="btn btn-secondary px-3.5"
          aria-haspopup="dialog"
          [attr.aria-label]="'Log ' + favorite().name + ' with options'"
          (click)="customize.emit(favorite())"
        >
          Log…
        </button>
        <button
          type="button"
          class="btn btn-primary min-w-24 px-4"
          [attr.aria-label]="'Log ' + favorite().name + ' now'"
          [disabled]="busy()"
          (click)="log.emit(favorite())"
        >
          @if (busy()) {
            <app-spinner [size]="18" label="Logging" />
          } @else {
            <app-icon name="plus" [size]="18" [strokeWidth]="2.5" />
          }
          Log
        </button>
      </div>
    </article>
  `,
})
export class FavoriteCard {
  readonly favorite = input.required<FavoriteDto>();
  readonly busy = input(false);
  readonly recent = input<EntryDto | null>(null);

  readonly log = output<FavoriteDto>();
  readonly customize = output<FavoriteDto>();
  readonly more = output<FavoriteDto>();

  protected readonly thumbUrl = computed(() => this.favorite().photo?.thumbUrl ?? null);
  protected readonly amount = computed(() => {
    const favorite = this.favorite();
    return amountLine(favorite.portion, sumGrams(favorite.items));
  });
  protected readonly uses = computed(() => useCountLabel(this.favorite().useCount));
  protected readonly calories = computed(() =>
    formatNutrientValue('calories', this.favorite().totals.calories),
  );
  protected readonly macros = computed(() => {
    const totals = this.favorite().totals;
    return (['protein', 'carbs', 'fat'] as const).map((key) => ({
      key,
      letter: key[0].toUpperCase(),
      value: formatNutrientValue(key, totals[key]),
      color: NUTRIENT_COLORS[key],
    }));
  });
  protected readonly recentLabel = computed(() => {
    const entry = this.recent();
    if (!entry) {
      return '';
    }
    return `Logged to ${relativeDayLabel(entry.localDate)} · ${toTimeLabel(entry.timestamp)}`;
  });
}
