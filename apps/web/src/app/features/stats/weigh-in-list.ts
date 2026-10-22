import { Component, computed, input, model, output, signal } from '@angular/core';
import { relativeDayLabel, shortDateLabel } from '../../core/time';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { WeightField } from './weight-field';
import {
  RECENT_WEIGH_INS_LIMIT,
  bodyFatText,
  formatKg,
  formatSignedKg,
  readWeighInDraft,
  weighInEdit,
  weightText,
  type WeighInInput,
  type WeighInRow,
} from './weight-math';

interface RowView extends WeighInRow {
  title: string;
  subtitle: string;
  weight: string;
  delta: string | null;
  ariaLabel: string;
}

@Component({
  selector: 'app-weigh-in-list',
  imports: [Icon, Spinner, WeightField],
  host: { class: 'block' },
  template: `
    <section class="card overflow-hidden" aria-labelledby="weigh-ins-title">
      <div class="flex items-center justify-between gap-3 py-2 pr-2 pl-4">
        <div class="min-w-0">
          <h2 id="weigh-ins-title" class="text-base font-semibold text-fg">Weigh-ins</h2>
          <p class="text-xs text-muted">{{ countLabel() }}</p>
        </div>
        <button
          type="button"
          class="btn btn-ghost min-h-11 gap-1.5 px-3 text-brand"
          (click)="add.emit()"
        >
          <app-icon name="plus" [size]="18" [strokeWidth]="2.4" />
          Add
        </button>
      </div>
      <ul id="weigh-ins-list" class="divide-y divide-line/60 border-t border-line/60">
        @for (row of views(); track row.date) {
          <li>
            <button
              type="button"
              class="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition active:bg-surface-2"
              [attr.aria-expanded]="editing() === row.date"
              [attr.aria-controls]="'weigh-in-editor-' + row.date"
              [attr.aria-label]="row.ariaLabel"
              (click)="toggle(row)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate text-sm font-semibold text-fg">{{ row.title }}</span>
                @if (row.subtitle) {
                  <span class="block truncate text-xs text-muted">{{ row.subtitle }}</span>
                }
              </span>
              @if (row.delta) {
                <span class="shrink-0 text-xs font-medium text-muted tabular-nums">{{
                  row.delta
                }}</span>
              }
              <span class="shrink-0 text-base font-bold text-fg tabular-nums">
                {{ row.weight }}<span class="ml-0.5 text-xs font-medium text-muted">kg</span>
              </span>
              @if (busyDate() === row.date) {
                <app-spinner class="text-muted" [size]="16" label="Saving" />
              } @else {
                <app-icon
                  class="shrink-0 text-muted transition-transform duration-200"
                  [class.rotate-180]="editing() === row.date"
                  name="chevron-down"
                  [size]="18"
                />
              }
            </button>
            @if (editing() === row.date) {
              <form
                class="space-y-3 px-4 pt-1 pb-4 animate-fade-in"
                novalidate
                [id]="'weigh-in-editor-' + row.date"
                (submit)="submit($event, row)"
              >
                <app-weight-field
                  [(text)]="draftWeight"
                  [fallback]="row.weightKg"
                  [inputId]="'weigh-in-weight-' + row.date"
                  [ariaLabel]="'Weight on ' + row.title + ' in kg'"
                  [invalid]="weightErrorText() !== null"
                  [describedBy]="weightErrorText() ? 'weigh-in-error-' + row.date : null"
                />
                <div class="flex items-center gap-3">
                  <label
                    class="min-w-0 flex-1 text-sm text-muted"
                    [for]="'weigh-in-fat-' + row.date"
                  >
                    Body fat <span class="text-xs">(optional)</span>
                  </label>
                  <div class="relative w-28 shrink-0">
                    <input
                      type="text"
                      inputmode="decimal"
                      autocomplete="off"
                      class="input pr-8 text-right tabular-nums"
                      placeholder="–"
                      [id]="'weigh-in-fat-' + row.date"
                      [attr.aria-invalid]="fatErrorText() ? true : null"
                      [attr.aria-describedby]="fatErrorText() ? 'weigh-in-error-' + row.date : null"
                      [value]="draftFat()"
                      (input)="onFatInput($event)"
                    />
                    <span
                      class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted"
                      aria-hidden="true"
                      >%</span
                    >
                  </div>
                </div>
                @if (errorText(); as message) {
                  <p class="text-sm text-danger" role="alert" [id]="'weigh-in-error-' + row.date">
                    {{ message }}
                  </p>
                }
                <div class="flex items-center gap-2">
                  <button
                    type="button"
                    class="btn btn-ghost min-h-11 gap-1.5 px-3 text-danger"
                    [disabled]="busyDate() !== null"
                    (click)="remove.emit(row.date)"
                  >
                    <app-icon name="trash" [size]="18" />
                    Delete
                  </button>
                  <span class="flex-1"></span>
                  <button type="button" class="btn btn-secondary" (click)="cancel()">Cancel</button>
                  <button type="submit" class="btn btn-primary" [disabled]="busyDate() !== null">
                    Save
                  </button>
                </div>
              </form>
            }
          </li>
        }
      </ul>
      @if (collapsible()) {
        <div class="border-t border-line/60 p-2">
          <button
            type="button"
            class="btn btn-ghost min-h-11 w-full gap-1.5 text-sm text-muted"
            aria-controls="weigh-ins-list"
            [attr.aria-expanded]="expanded()"
            (click)="toggleExpanded()"
          >
            <app-icon [name]="expanded() ? 'chevron-up' : 'chevron-down'" [size]="18" />
            {{ expanded() ? 'Show fewer' : 'Show all ' + rows().length }}
          </button>
        </div>
      }
    </section>
  `,
})
export class WeighInList {
  readonly rows = input.required<readonly WeighInRow[]>();
  readonly today = input.required<string>();
  readonly busyDate = input<string | null>(null);
  readonly editing = model<string | null>(null);

  readonly save = output<WeighInInput>();
  readonly remove = output<string>();
  readonly add = output();

  protected readonly draftWeight = signal('');
  protected readonly draftFat = signal('');
  protected readonly showErrors = signal(false);
  protected readonly expanded = signal(false);
  protected readonly collapsible = computed(() => this.rows().length > RECENT_WEIGH_INS_LIMIT);
  private readonly visibleRows = computed(() =>
    this.expanded() ? this.rows() : this.rows().slice(0, RECENT_WEIGH_INS_LIMIT),
  );

  protected readonly views = computed<RowView[]>(() => {
    const today = this.today();
    return this.visibleRows().map((row) => {
      const title = relativeDayLabel(row.date, today);
      const date = shortDateLabel(row.date, today);
      const parts = [date === title ? '' : date];
      if (row.bodyFatPct !== null) {
        parts.push(`${bodyFatText(row.bodyFatPct)}% body fat`);
      }
      const weight = formatKg(row.weightKg);
      const delta = row.deltaKg === null ? null : formatSignedKg(row.deltaKg);
      return {
        ...row,
        title,
        subtitle: parts.filter((part) => part.length > 0).join(' · '),
        weight,
        delta,
        ariaLabel: `${title}: ${weight} kg${delta ? `, ${delta} kg since the previous weigh-in` : ''}. Edit`,
      };
    });
  });

  protected readonly countLabel = computed(() => {
    const shown = this.visibleRows().length;
    const total = this.rows().length;
    if (total > shown) {
      return `Latest ${shown} of ${total} in this range`;
    }
    return total === 1 ? '1 in this range' : `${total} in this range`;
  });

  private readonly draft = computed(() => readWeighInDraft(this.draftWeight(), this.draftFat()));
  protected readonly weightErrorText = computed(() =>
    this.showErrors() ? this.draft().weightError : null,
  );
  protected readonly fatErrorText = computed(() =>
    this.showErrors() ? this.draft().bodyFatError : null,
  );
  protected readonly errorText = computed(() => this.weightErrorText() ?? this.fatErrorText());

  protected toggle(row: WeighInRow): void {
    if (this.editing() === row.date) {
      this.cancel();
      return;
    }
    this.draftWeight.set(weightText(row.weightKg));
    this.draftFat.set(bodyFatText(row.bodyFatPct));
    this.showErrors.set(false);
    this.editing.set(row.date);
  }

  protected toggleExpanded(): void {
    const expanded = !this.expanded();
    this.expanded.set(expanded);
    const editing = this.editing();
    if (!expanded && editing !== null && !this.visibleRows().some((row) => row.date === editing)) {
      this.cancel();
    }
  }

  protected cancel(): void {
    this.editing.set(null);
    this.showErrors.set(false);
  }

  protected onFatInput(event: Event): void {
    this.draftFat.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event, row: WeighInRow): void {
    event.preventDefault();
    const draft = this.draft();
    if (draft.weightError || draft.bodyFatError || draft.weightKg === null) {
      this.showErrors.set(true);
      return;
    }
    this.save.emit(weighInEdit(row, { weightKg: draft.weightKg, bodyFatPct: draft.bodyFatPct }));
  }
}
