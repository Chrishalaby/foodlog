import { Component, computed, input, output } from '@angular/core';
import { CATALOG_GROUP_LABELS, catalogNutrients, type CatalogFoodDto } from '@food/shared';
import { formatNutrientValue } from '../../utils/format';
import { highlightParts } from '../../utils/text-match';
import { Icon } from '../icon';

@Component({
  selector: 'app-catalog-result-row',
  imports: [Icon],
  host: { class: 'flex items-center', role: 'listitem' },
  template: `
    <button
      type="button"
      class="flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pr-3.5 pl-3.5 text-left transition hover:bg-surface-2/60 active:bg-surface-2"
      [attr.data-catalog-id]="food().id"
      [attr.aria-label]="label()"
      (click)="opened.emit(food())"
    >
      <span
        class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent"
        aria-hidden="true"
      >
        <app-icon name="book" [size]="20" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="line-clamp-2 text-[15px] leading-5 break-words">
          @for (part of parts(); track $index) {
            @if (part.match) {
              <mark class="bg-transparent font-bold text-fg">{{ part.text }}</mark>
            } @else {
              <span [class]="query() ? 'font-medium text-fg/75' : 'font-semibold text-fg'">{{
                part.text
              }}</span>
            }
          }
        </span>
        <span class="mt-0.5 block truncate text-xs text-muted">{{ detail() }}</span>
      </span>
      <span class="shrink-0 text-right tabular-nums">
        <span class="block text-[15px] leading-5 font-bold text-fg"
          >{{ kcal() }}<span class="ml-0.5 text-[11px] font-medium text-muted">kcal</span></span
        >
        <span class="block max-w-24 truncate text-xs text-muted">{{ amount() }}</span>
      </span>
    </button>
  `,
})
export class CatalogResultRow {
  readonly food = input.required<CatalogFoodDto>();
  readonly query = input('');
  readonly opened = output<CatalogFoodDto>();

  protected readonly parts = computed(() => highlightParts(this.food().name, this.query()));
  private readonly defaultGrams = computed(() => this.food().portions[0]?.grams ?? 100);
  protected readonly kcal = computed(() =>
    formatNutrientValue('calories', catalogNutrients(this.food().per100, this.defaultGrams()).calories),
  );
  protected readonly amount = computed(() => {
    const portion = this.food().portions[0];
    return portion ? portion.label : '100 g';
  });
  protected readonly detail = computed(() => {
    const food = this.food();
    const protein = catalogNutrients(food.per100, this.defaultGrams()).protein;
    return `${CATALOG_GROUP_LABELS[food.group]} · ${formatNutrientValue('protein', protein)} g protein`;
  });
  protected readonly label = computed(
    () => `${this.food().name}, ${this.kcal()} kcal per ${this.amount()}. Open to log`,
  );
}
