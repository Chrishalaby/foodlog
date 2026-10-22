import { Component, computed, input, output } from '@angular/core';
import { formatPortion, type FoodSearchResult } from '@food/shared';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { formatNumber, formatNutrientValue } from '../../shared/utils/format';
import { highlightParts, resultDetail, resultDetailParts } from './food-search';
import { FoodThumb } from '../../shared/ui/food-thumb';
import { LONG_PRESS_MS, LongPress } from './long-press';

let nextRowId = 0;

const STARRED_DETAIL = 'Starred';

@Component({
  selector: 'app-food-result-row',
  imports: [FoodThumb, Icon, LongPress, Spinner],
  host: { class: 'flex items-center', role: 'listitem' },
  template: `
    <button
      #press="longPress"
      type="button"
      appLongPress
      class="relative flex min-h-16 min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-3.5 text-left transition select-none [-webkit-touch-callout:none] hover:bg-surface-2/60 active:bg-surface-2"
      [class.bg-surface-2]="press.pressing()"
      [attr.data-result-key]="result().key"
      [attr.aria-label]="rowLabel()"
      [attr.aria-describedby]="menu() ? hintId : null"
      [longPressDisabled]="!menu()"
      (longPress)="menuRequested.emit(result())"
      (click)="open(press)"
    >
      @if (menu()) {
        <span
          class="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 origin-left bg-brand/70 ease-linear"
          aria-hidden="true"
          [style.transform]="press.pressing() ? 'scaleX(1)' : 'scaleX(0)'"
          [style.transition]="press.pressing() ? pressTransition : 'none'"
        ></span>
      }
      <app-food-thumb [result]="result()" />
      <span class="min-w-0 flex-1">
        <span class="line-clamp-2 text-[15px] leading-5 break-words">
          @for (part of parts(); track $index) {
            @if (part.match) {
              <mark class="bg-transparent font-bold text-fg">{{ part.text }}</mark>
            } @else {
              <span [class]="highlighting() ? 'font-medium text-fg/75' : 'font-semibold text-fg'">{{
                part.text
              }}</span>
            }
          }
        </span>
        <span class="mt-0.5 flex min-w-0 items-center gap-1 text-xs text-muted">
          @if (result().starred) {
            <app-icon class="shrink-0 text-warn" name="star-filled" [size]="12" />
          }
          <span class="truncate">
            @if (portionText(); as portion) {
              <span class="font-semibold text-fg/80" data-result-portion>{{ portion }}</span
              ><span> · </span>
            }
            @for (part of detailParts(); track $index) {
              @if (part.match) {
                <mark class="bg-transparent font-semibold text-fg">{{ part.text }}</mark>
              } @else {
                <span>{{ part.text }}</span>
              }
            }
          </span>
        </span>
      </span>
      <span class="shrink-0 text-right tabular-nums">
        <span class="block text-[15px] leading-5 font-bold text-fg"
          >{{ kcal() }}<span class="ml-0.5 text-[11px] font-medium text-muted">kcal</span></span
        >
        @if (grams(); as amount) {
          <span class="block text-xs text-muted">{{ amount }} g</span>
        }
      </span>
    </button>
    @if (menu()) {
      <span class="sr-only" [id]="hintId">Long-press for more actions.</span>
      <button
        type="button"
        class="mr-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-fg active:scale-90"
        aria-haspopup="dialog"
        [attr.aria-label]="'More actions for ' + result().name"
        (click)="menuRequested.emit(result())"
      >
        <app-icon name="more-horizontal" [size]="20" />
      </button>
    }
    <button
      type="button"
      class="mr-2 flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-50"
      [class]="logged() ? 'bg-ok/15 text-ok' : 'bg-brand/12 text-brand hover:bg-brand/20'"
      [disabled]="disabled()"
      [attr.aria-label]="quickLabel()"
      (click)="quickLog.emit(result())"
    >
      @if (busy()) {
        <app-spinner [size]="18" label="Logging" />
      } @else if (logged()) {
        <app-icon name="check" [size]="20" [strokeWidth]="2.5" />
      } @else {
        <app-icon name="plus" [size]="20" [strokeWidth]="2.5" />
      }
    </button>
  `,
})
export class FoodResultRow {
  readonly result = input.required<FoodSearchResult>();
  readonly query = input('');
  readonly now = input<Date>(new Date());
  readonly busy = input(false);
  readonly disabled = input(false);
  readonly logged = input(false);
  readonly menu = input(false);
  readonly opened = output<FoodSearchResult>();
  readonly quickLog = output<FoodSearchResult>();
  readonly menuRequested = output<FoodSearchResult>();

  protected readonly hintId = `food-row-hint-${nextRowId++}`;
  protected readonly pressTransition = `transform ${LONG_PRESS_MS}ms linear`;

  protected readonly parts = computed(() => highlightParts(this.result().name, this.query()));
  protected readonly highlighting = computed(() => this.parts().some((part) => part.match));
  protected readonly detail = computed(() => resultDetail(this.result(), this.now()));
  protected readonly detailParts = computed(() =>
    resultDetailParts(this.result(), this.query(), this.now()),
  );
  protected readonly kcal = computed(() =>
    formatNutrientValue('calories', this.result().totals.calories),
  );
  protected readonly portionText = computed(() => {
    const portion = this.result().portion;
    return portion ? formatPortion(portion) : null;
  });
  protected readonly grams = computed(() => {
    const grams = this.result().grams;
    return grams > 0 ? formatNumber(grams, 0) : null;
  });
  protected readonly rowLabel = computed(() => {
    const grams = this.grams();
    const amount = grams ? `, ${grams} g` : '';
    const detail = this.detail();
    const starred = this.result().starred && detail !== STARRED_DETAIL ? ' Starred.' : '';
    const portion = this.portionText();
    const count = portion ? `, ${portion}` : '';
    return `${this.result().name}${count}, ${this.kcal()} kcal${amount}.${starred} ${detail}`;
  });
  protected readonly quickLabel = computed(() => {
    const portion = this.portionText();
    const amount = portion ? `${portion}, ` : '';
    return `Log ${this.result().name} now, ${amount}${this.kcal()} kcal`;
  });

  protected open(press: LongPress): void {
    if (press.consumeLongPress()) {
      return;
    }
    this.opened.emit(this.result());
  }
}
