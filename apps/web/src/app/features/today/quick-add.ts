import { Component, DestroyRef, computed, inject, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatPortion, type FoodSearchResult } from '@food/shared';
import { AiAvailability } from '../../core/ai-availability.service';
import { KeyboardPrimer } from '../../core/keyboard-primer';
import { FoodThumb } from '../../shared/ui/food-thumb';
import { Icon } from '../../shared/ui/icon';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { isProductResult } from '../../shared/utils/food-library';
import { formatNumber } from '../../shared/utils/format';
import type { FoodsStatus } from './today-store';
import { offersFoodActions } from './today-view';

export const QUICK_ADD_LONG_PRESS_MS = 450;
export const QUICK_ADD_TWO_ROWS_FROM = 4;

const ACTION_TILE_CLASS =
  'btn btn-secondary h-auto min-h-[4.5rem] flex-col gap-1.5 rounded-2xl px-1.5 py-2.5 text-center text-[13px] leading-tight whitespace-normal';

export const QUICK_ADD_HINTS = {
  library: 'quick-add-hint',
  product: 'quick-add-product-hint',
  adjust: 'quick-add-adjust-hint',
} as const;

function chipHint(result: FoodSearchResult, opensSheet: boolean): string {
  if (!opensSheet) {
    return QUICK_ADD_HINTS.adjust;
  }
  return isProductResult(result) ? QUICK_ADD_HINTS.product : QUICK_ADD_HINTS.library;
}

interface FoodChip {
  result: FoodSearchResult;
  thumbUrl: string | null;
  calories: string;
  ariaLabel: string;
  moreLabel: string;
  opensSheet: boolean;
  hintId: string;
}

@Component({
  selector: 'app-quick-add',
  imports: [FoodThumb, Icon, RouterLink, Skeleton, Spinner],
  host: { class: 'block' },
  template: `
    <section aria-labelledby="quick-add-title">
      <div class="flex items-center justify-between">
        <h2 id="quick-add-title" class="section-title">Quick add</h2>
        <a
          routerLink="/favorites"
          class="-mr-2 inline-flex min-h-11 items-center gap-0.5 rounded-xl px-2 text-xs font-semibold text-brand"
        >
          Favorites
          <app-icon name="chevron-right" [size]="14" [strokeWidth]="2.5" />
        </a>
      </div>

      <div
        class="no-scrollbar -mx-4 flex snap-x scroll-px-4 items-stretch gap-2 overflow-x-auto px-4 pt-0.5 pb-2"
        role="group"
        aria-label="Log again from your food library"
      >
        <a
          routerLink="/log"
          [queryParams]="searchQuery"
          class="flex shrink-0 snap-start items-center justify-center gap-1.5 border border-brand/30 bg-brand/10 text-sm font-semibold text-brand transition active:scale-[0.97]"
          [class]="
            rows().length > 1 ? 'w-[4.5rem] flex-col rounded-3xl' : 'h-12 rounded-full pr-4 pl-3'
          "
          aria-label="Search everything you have logged"
          (click)="primeKeyboard()"
        >
          <app-icon name="search" [size]="rows().length > 1 ? 22 : 18" [strokeWidth]="2.25" />
          Search
        </a>
        <div class="flex flex-col gap-2">
          @if (status() === 'loading' && chips().length === 0) {
            <div class="flex gap-2" aria-hidden="true">
              @for (placeholder of placeholders; track placeholder) {
                <app-skeleton class="h-12 w-40 shrink-0 rounded-full" />
              }
            </div>
          }
          @for (row of rows(); track $index) {
            <ul class="flex gap-2">
              @for (chip of row; track chip.result.key) {
                <li
                  class="flex h-12 shrink-0 snap-start items-stretch rounded-full border border-line/70 bg-surface shadow-soft"
                >
                  <button
                    type="button"
                    class="flex max-w-[14rem] min-w-0 items-center gap-2 rounded-l-full pr-2.5 pl-2 text-left transition select-none [-webkit-touch-callout:none] active:bg-surface-2 disabled:opacity-60"
                    [disabled]="busyKey() !== null"
                    [attr.aria-label]="chip.ariaLabel"
                    [attr.aria-busy]="busyKey() === chip.result.key"
                    [attr.aria-describedby]="chip.hintId"
                    (pointerdown)="startPress($event, chip.result)"
                    (pointerup)="cancelPress()"
                    (pointerleave)="cancelPress()"
                    (pointercancel)="cancelPress()"
                    (contextmenu)="$event.preventDefault()"
                    (click)="tap(chip.result)"
                  >
                    @if (busyKey() === chip.result.key) {
                      <span class="flex size-8 shrink-0 items-center justify-center text-brand">
                        <app-spinner [size]="18" label="Logging" />
                      </span>
                    } @else if (chip.thumbUrl; as src) {
                      <span class="relative size-8 shrink-0">
                        <img
                          class="size-8 rounded-full bg-surface-2 object-cover"
                          [src]="src"
                          alt=""
                          width="32"
                          height="32"
                          loading="lazy"
                          decoding="async"
                          draggable="false"
                        />
                        @if (chip.result.starred) {
                          <span
                            class="absolute -right-0.5 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-surface text-warn"
                          >
                            <app-icon name="star-filled" [size]="10" />
                          </span>
                        }
                      </span>
                    } @else {
                      <app-food-thumb [result]="chip.result" [size]="32" />
                    }
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate text-sm leading-tight font-semibold text-fg">
                        {{ chip.result.name }}
                      </span>
                      <span
                        class="truncate text-xs leading-tight font-medium text-muted tabular-nums"
                      >
                        {{ chip.calories }}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="flex w-11 shrink-0 items-center justify-center rounded-r-full border-l border-line/60 text-muted transition active:bg-surface-2 disabled:opacity-60"
                    [disabled]="busyKey() !== null"
                    [attr.aria-label]="chip.moreLabel"
                    [attr.aria-haspopup]="chip.opensSheet ? 'dialog' : null"
                    (click)="more(chip.result)"
                  >
                    <app-icon name="more-horizontal" [size]="18" />
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      </div>
      <p [id]="hints.library" class="sr-only">
        Long-press for more: adjust the amount, rename, or remove from suggestions.
      </p>
      <p [id]="hints.product" class="sr-only">
        Long-press for more: adjust the amount, edit or delete the product.
      </p>
      <p [id]="hints.adjust" class="sr-only">Long-press to adjust the amount before logging.</p>

      @if (chips().length === 0) {
        @if (status() === 'ready') {
          <p class="mb-2 flex items-center gap-2 text-xs text-muted">
            <app-icon name="sparkles" [size]="14" />
            Everything you log shows up here for one-tap logging.
          </p>
        } @else if (status() === 'error') {
          <p class="mb-1 flex items-center gap-2 text-xs text-muted" role="status">
            <app-icon class="text-warn" name="alert" [size]="14" />
            <span class="min-w-0 flex-1">Couldn’t load your foods.</span>
            <button
              type="button"
              class="-my-1 inline-flex min-h-11 items-center rounded-xl px-3 text-xs font-semibold text-brand"
              (click)="retry.emit()"
            >
              Retry
            </button>
          </p>
        }
      }

      <div
        class="grid gap-2"
        role="group"
        aria-label="More ways to log"
        [class]="ai.enabled() ? 'grid-cols-3' : 'grid-cols-2'"
      >
        <button type="button" [class]="tileClass" (click)="scanBarcode.emit()">
          <span
            class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
          >
            <app-icon name="barcode" [size]="20" />
          </span>
          Scan barcode
        </button>
        @if (ai.enabled()) {
          <button type="button" [class]="tileClass" (click)="scanLabel.emit()">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-carbs/15 text-carbs"
            >
              <app-icon name="label" [size]="20" />
            </span>
            Scan label
          </button>
          <button type="button" [class]="tileClass" (click)="describe.emit()">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-fat/15 text-fat"
            >
              <app-icon name="text" [size]="20" />
            </span>
            Describe
          </button>
        } @else {
          <a [class]="tileClass" routerLink="/foods">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
            >
              <app-icon name="book" [size]="20" />
            </span>
            Food database
          </a>
        }
      </div>

      <a
        routerLink="/compare"
        class="mt-2 flex min-h-14 items-center gap-3 rounded-2xl border border-line/70 bg-surface py-2 pr-3 pl-2.5 shadow-soft transition active:scale-[0.99] active:bg-surface-2"
      >
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand/12 text-brand"
          aria-hidden="true"
        >
          <app-icon name="utensils" [size]="20" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-sm leading-5 font-semibold text-fg">What should I eat?</span>
          <span class="block truncate text-xs leading-4 text-muted"
            >Compare options against what's left today</span
          >
        </span>
        <app-icon class="text-muted" name="chevron-right" [size]="18" />
      </a>
    </section>
  `,
})
export class QuickAdd {
  private readonly keyboardPrimer = inject(KeyboardPrimer);
  protected readonly ai = inject(AiAvailability);
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressed = false;

  readonly foods = input.required<readonly FoodSearchResult[]>();
  readonly status = input<FoodsStatus>('ready');
  readonly busyKey = input<string | null>(null);

  readonly log = output<FoodSearchResult>();
  readonly adjust = output<FoodSearchResult>();
  readonly options = output<FoodSearchResult>();
  readonly retry = output();
  readonly scanBarcode = output();
  readonly scanLabel = output();
  readonly describe = output();

  protected readonly searchQuery = { search: 1 };
  protected readonly hints = QUICK_ADD_HINTS;
  protected readonly tileClass = ACTION_TILE_CLASS;
  protected readonly placeholders = [0, 1, 2];

  protected readonly chips = computed<FoodChip[]>(() =>
    this.foods().map((result) => {
      const kcal = `${formatNumber(result.totals.calories)} kcal`;
      const calories = result.portion ? `${formatPortion(result.portion)} · ${kcal}` : kcal;
      const starred = result.starred ? ', starred' : '';
      const opensSheet = offersFoodActions(result);
      return {
        result,
        thumbUrl: result.photo?.thumbUrl ?? null,
        calories,
        ariaLabel: `Log ${result.name}, ${calories.replace(' · ', ', ')}${starred}`,
        moreLabel: opensSheet
          ? `More options for ${result.name}`
          : `Adjust ${result.name} before logging`,
        opensSheet,
        hintId: chipHint(result, opensSheet),
      };
    }),
  );

  protected readonly rows = computed<FoodChip[][]>(() => {
    const chips = this.chips();
    if (chips.length === 0) {
      return [];
    }
    if (chips.length < QUICK_ADD_TWO_ROWS_FROM) {
      return [chips];
    }
    return [chips.filter((_, i) => i % 2 === 0), chips.filter((_, i) => i % 2 === 1)];
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.cancelPress());
  }

  protected startPress(event: PointerEvent, result: FoodSearchResult): void {
    if (event.button !== 0 || this.busyKey() !== null) {
      return;
    }
    this.longPressed = false;
    this.cancelPress();
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.longPressed = true;
      navigator.vibrate?.(12);
      this.more(result);
    }, QUICK_ADD_LONG_PRESS_MS);
  }

  protected primeKeyboard(): void {
    this.keyboardPrimer.prime();
  }

  protected more(result: FoodSearchResult): void {
    if (offersFoodActions(result)) {
      this.options.emit(result);
    } else {
      this.adjust.emit(result);
    }
  }

  protected cancelPress(): void {
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
  }

  protected tap(result: FoodSearchResult): void {
    this.cancelPress();
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }
    this.log.emit(result);
  }
}
