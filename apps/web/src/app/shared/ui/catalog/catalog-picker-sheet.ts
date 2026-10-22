import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { API_LIMITS, type CatalogFoodDto, type EntryItemInput } from '@food/shared';

export interface CatalogPick {
  item: EntryItemInput;
  food: CatalogFoodDto;
}
import { ApiService } from '../../../core/api.service';
import {
  amountLabel,
  catalogAmountNutrients,
  catalogEntryItem,
  catalogSubtitle,
  defaultCatalogAmount,
  type CatalogAmount,
} from '../../utils/catalog';
import { formatNutrientValue } from '../../utils/format';
import { normalizeQuery } from '../../utils/text-match';
import { BottomSheet } from '../bottom-sheet';
import { Icon } from '../icon';
import { Spinner } from '../spinner';
import { CatalogAmountPicker } from './catalog-amount-picker';
import { CatalogResultRow } from './catalog-result-row';

export const CATALOG_PICKER_LIMIT = 20;
export const CATALOG_PICKER_DEBOUNCE_MS = 250;

type PickerStatus = 'idle' | 'loading' | 'ready' | 'error';

@Component({
  selector: 'app-catalog-picker-sheet',
  imports: [BottomSheet, CatalogAmountPicker, CatalogResultRow, Icon, Spinner],
  template: `
    <app-bottom-sheet [(open)]="open" ariaLabel="Add from the food database">
      @if (selected(); as food) {
        <div class="flex flex-col gap-4">
          <header class="flex items-start gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-icon -mt-1 -ml-2 text-muted"
              aria-label="Back to results"
              (click)="back()"
            >
              <app-icon name="chevron-left" [size]="22" />
            </button>
            <div class="min-w-0 flex-1 pt-0.5">
              <h2 class="line-clamp-3 text-lg leading-6 font-semibold tracking-tight break-words">
                {{ food.name }}
              </h2>
              <p class="mt-0.5 truncate text-xs text-muted">{{ subtitle() }}</p>
            </div>
          </header>
          @if (amount(); as amt) {
            <app-catalog-amount-picker
              [food]="food"
              [amount]="amt"
              (amountChange)="amount.set($event)"
            />
          }
          <p
            class="flex items-baseline justify-between rounded-2xl bg-surface-2 px-3.5 py-2.5 tabular-nums"
            aria-live="polite"
          >
            <span class="text-sm text-muted">{{ amountText() }}</span>
            <span class="text-lg font-bold text-fg"
              >{{ kcal() }}<span class="ml-1 text-xs font-medium text-muted">kcal</span></span
            >
          </p>
          <button
            type="button"
            class="btn btn-primary min-h-13 w-full text-base"
            [disabled]="!canAdd()"
            (click)="add()"
          >
            <app-icon name="plus" [strokeWidth]="2.5" />
            Add to meal
          </button>
        </div>
      } @else {
        <div class="flex flex-col gap-3">
          <h2 class="text-lg font-semibold tracking-tight">Add from the food database</h2>
          <form class="relative" role="search" (submit)="$event.preventDefault()">
            <label for="catalog-picker-search" class="sr-only">Search the food database</label>
            <span
              class="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-muted"
              aria-hidden="true"
            >
              @if (status() === 'loading') {
                <app-spinner [size]="20" label="Searching" />
              } @else {
                <app-icon name="search" [size]="20" />
              }
            </span>
            <input
              id="catalog-picker-search"
              type="search"
              class="input h-12 rounded-2xl pl-11"
              placeholder="e.g. olive oil, basmati rice, egg"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="none"
              spellcheck="false"
              enterkeyhint="search"
              [attr.maxlength]="queryMax"
              [value]="text()"
              (input)="onInput($event)"
            />
          </form>
          @if (status() === 'error') {
            <p class="text-sm text-danger" role="alert">Couldn't search the food database.</p>
          } @else if (results().length > 0) {
            <div class="card divide-y divide-line/60 overflow-hidden" role="list">
              @for (food of results(); track food.id) {
                <app-catalog-result-row [food]="food" [query]="query()" (opened)="choose($event)" />
              }
            </div>
          } @else if (status() === 'ready') {
            <p class="px-1 text-sm text-muted">No foods match “{{ query() }}”.</p>
          } @else if (status() === 'idle') {
            <p class="px-1 text-sm leading-snug text-muted">
              Search thousands of ingredients and dishes with USDA nutrition values. Pick an amount
              and it is added as an item.
            </p>
          }
        </div>
      }
    </app-bottom-sheet>
  `,
})
export class CatalogPickerSheet {
  private readonly api = inject(ApiService);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seq = 0;

  readonly open = model(false);
  readonly picked = output<CatalogPick>();

  protected readonly queryMax = API_LIMITS.foodQueryMax;
  protected readonly text = signal('');
  protected readonly query = computed(() => normalizeQuery(this.text()));
  protected readonly results = signal<readonly CatalogFoodDto[]>([]);
  protected readonly status = signal<PickerStatus>('idle');
  protected readonly selected = signal<CatalogFoodDto | null>(null);
  protected readonly amount = signal<CatalogAmount | null>(null);
  protected readonly subtitle = computed(() => {
    const food = this.selected();
    return food ? catalogSubtitle(food) : '';
  });
  protected readonly amountText = computed(() => {
    const amount = this.amount();
    return amount ? amountLabel(amount) : '';
  });
  protected readonly canAdd = computed(() => (this.amount()?.grams ?? 0) > 0);

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.reset());
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this.seq += 1;
      this.clearTimer();
    });
  }

  protected kcal(): string {
    const food = this.selected();
    const amount = this.amount();
    return food && amount
      ? formatNutrientValue('calories', catalogAmountNutrients(food, amount).calories)
      : '0';
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    this.clearTimer();
    const query = this.query();
    this.seq += 1;
    if (!query) {
      this.results.set([]);
      this.status.set('idle');
      return;
    }
    this.status.set('loading');
    const id = this.seq;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.fetch(query, id);
    }, CATALOG_PICKER_DEBOUNCE_MS);
  }

  protected choose(food: CatalogFoodDto): void {
    this.selected.set(food);
    this.amount.set(defaultCatalogAmount(food));
  }

  protected back(): void {
    this.selected.set(null);
    this.amount.set(null);
  }

  protected add(): void {
    const food = this.selected();
    const amount = this.amount();
    if (!food || !amount || !this.canAdd()) {
      return;
    }
    this.picked.emit({ item: catalogEntryItem(food, amount), food });
    this.open.set(false);
  }

  private async fetch(query: string, id: number): Promise<void> {
    try {
      const response = await this.api.searchCatalog({ q: query, limit: CATALOG_PICKER_LIMIT });
      if (id === this.seq) {
        this.results.set(response.results);
        this.status.set('ready');
      }
    } catch {
      if (id === this.seq) {
        this.results.set([]);
        this.status.set('error');
      }
    }
  }

  private reset(): void {
    this.seq += 1;
    this.clearTimer();
    this.text.set('');
    this.results.set([]);
    this.status.set('idle');
    this.selected.set(null);
    this.amount.set(null);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
