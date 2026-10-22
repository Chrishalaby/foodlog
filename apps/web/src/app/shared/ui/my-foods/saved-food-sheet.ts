import { Component, computed, inject, input, linkedSignal, model, output } from '@angular/core';
import type { MyFoodDto } from '@food/shared';
import { MyFoodsStore } from '../../../core/my-foods.store';
import { searchSavedFoods } from '../../utils/food-match';
import { kcalPer100Text } from '../../utils/saved-foods';
import { BottomSheet } from '../bottom-sheet';
import { Icon } from '../icon';
import { Spinner } from '../spinner';

export type SavedFoodSheetView = 'menu' | 'pick';

export interface SavedFoodSheetRequest {
  id: number;
  itemName: string;
  productId: string | null;
  linkedName: string | null;
  view: SavedFoodSheetView;
}

let nextSheetId = 0;

@Component({
  selector: 'app-saved-food-sheet',
  imports: [BottomSheet, Icon, Spinner],
  template: `
    <app-bottom-sheet [(open)]="open" [ariaLabel]="ariaLabel()">
      @if (request(); as current) {
        @if (view() === 'menu') {
          <div class="flex flex-col gap-3">
            <header class="flex items-center gap-3">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand"
                aria-hidden="true"
              >
                <app-icon name="link" [size]="20" />
              </span>
              <div class="min-w-0 flex-1">
                <h2 class="truncate text-lg leading-6 font-semibold tracking-tight">
                  {{ current.linkedName ?? current.itemName }}
                </h2>
                <p class="text-xs text-muted">Uses the values saved in My foods</p>
              </div>
              <button
                type="button"
                class="btn btn-ghost btn-icon -mr-2 text-muted"
                aria-label="Close"
                (click)="open.set(false)"
              >
                <app-icon name="close" [size]="22" />
              </button>
            </header>
            <div class="-mx-2 flex flex-col" role="group" aria-label="My food options">
              <button
                type="button"
                class="flex min-h-14 w-full items-center gap-3.5 rounded-2xl px-3 py-2 text-left transition hover:bg-surface-2 active:bg-surface-2"
                (click)="showPicker()"
              >
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent"
                >
                  <app-icon name="search" [size]="18" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[15px] leading-5 font-semibold text-fg"
                    >Use another saved food…</span
                  >
                  <span class="block text-xs text-muted">Pick the right food from My foods</span>
                </span>
              </button>
              <button
                type="button"
                class="flex min-h-14 w-full items-center gap-3.5 rounded-2xl px-3 py-2 text-left transition hover:bg-surface-2 active:bg-surface-2"
                (click)="unlinkItem()"
              >
                <span
                  class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warn/15 text-warn"
                >
                  <app-icon name="close" [size]="18" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block text-[15px] leading-5 font-semibold text-fg">Unlink</span>
                  <span class="block text-xs text-muted"
                    >Keep these values without the saved food</span
                  >
                </span>
              </button>
            </div>
          </div>
        } @else {
          <div class="flex flex-col gap-3">
            <header class="flex items-center gap-1">
              @if (current.view === 'menu') {
                <button
                  type="button"
                  class="btn btn-ghost btn-icon -ml-2 text-muted"
                  aria-label="Back to options"
                  (click)="view.set('menu')"
                >
                  <app-icon name="chevron-left" [size]="22" />
                </button>
              }
              <h2 class="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
                Use a saved food
              </h2>
              <button
                type="button"
                class="btn btn-ghost btn-icon -mr-2 text-muted"
                aria-label="Close"
                (click)="open.set(false)"
              >
                <app-icon name="close" [size]="22" />
              </button>
            </header>
            <div class="relative" role="search">
              <label class="sr-only" [for]="searchId">Search my foods</label>
              <span
                class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted"
              >
                <app-icon name="search" [size]="18" />
              </span>
              <input
                type="search"
                class="input pl-10 [&::-webkit-search-cancel-button]:appearance-none"
                placeholder="Search my foods"
                autocomplete="off"
                enterkeyhint="search"
                [id]="searchId"
                [value]="query()"
                (input)="onQuery($event)"
              />
            </div>
            @switch (status()) {
              @case ('error') {
                <div
                  class="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3"
                  role="alert"
                >
                  <p class="min-w-0 flex-1 text-sm text-muted">Could not load your saved foods.</p>
                  <button type="button" class="btn btn-ghost px-3 text-brand" (click)="retry()">
                    Retry
                  </button>
                </div>
              }
              @case ('ready') {
                @if (results().length > 0) {
                  <ul class="-mx-2 flex flex-col" aria-label="Saved foods">
                    @for (food of results(); track food.id) {
                      <li>
                        <button
                          type="button"
                          class="flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition hover:bg-surface-2 active:bg-surface-2"
                          (click)="pick(food)"
                        >
                          <span class="min-w-0 flex-1">
                            <span
                              class="block truncate text-[15px] leading-5 font-semibold text-fg"
                            >
                              {{ food.name }}
                            </span>
                            <span class="block truncate text-xs text-muted tabular-nums">
                              {{ detail(food) }}
                            </span>
                          </span>
                          <app-icon class="text-muted" name="chevron-right" [size]="18" />
                        </button>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="rounded-xl bg-surface-2 px-3.5 py-3 text-sm leading-snug text-muted">
                    {{ emptyText() }}
                  </p>
                }
              }
              @default {
                <div class="flex justify-center py-8">
                  <app-spinner [size]="24" label="Loading saved foods" />
                </div>
              }
            }
          </div>
        }
      }
    </app-bottom-sheet>
  `,
})
export class SavedFoodSheet {
  private readonly store = inject(MyFoodsStore);

  readonly request = input<SavedFoodSheetRequest | null>(null);
  readonly open = model(false);
  readonly unlink = output<void>();
  readonly picked = output<MyFoodDto>();

  protected readonly searchId = `saved-food-search-${nextSheetId++}`;
  protected readonly view = linkedSignal<SavedFoodSheetView>(() => this.request()?.view ?? 'menu');
  protected readonly query = linkedSignal(() => {
    this.request();
    return '';
  });
  protected readonly status = this.store.status;
  protected readonly results = computed(() => {
    const current = this.request()?.productId ?? null;
    return searchSavedFoods(this.store.foods(), this.query()).filter((food) => food.id !== current);
  });
  protected readonly emptyText = computed(() =>
    this.query().trim()
      ? 'No saved food matches that.'
      : 'No other saved foods yet. Use “Save as my food” on an item to add one.',
  );
  protected readonly ariaLabel = computed(() => {
    const request = this.request();
    return request ? `My food options for ${request.itemName || 'item'}` : 'My food options';
  });

  protected detail(food: MyFoodDto): string {
    const parts = [food.brand?.trim() || null, kcalPer100Text(food.per100, food.basisUnit)];
    return parts.filter((part): part is string => part !== null).join(' · ');
  }

  protected showPicker(): void {
    this.view.set('pick');
    void this.store.ensureLoaded();
  }

  protected retry(): void {
    void this.store.refresh();
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  protected unlinkItem(): void {
    this.unlink.emit();
    this.open.set(false);
  }

  protected pick(food: MyFoodDto): void {
    this.picked.emit(food);
    this.open.set(false);
  }
}
