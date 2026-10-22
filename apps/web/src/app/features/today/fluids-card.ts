import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { FluidKind, FluidLogDto } from '@food/shared';
import { errorMessage } from '../../core/errors';
import { localDateTimeToIso } from '../../core/time';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/ui/icon';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { FluidSheet, type FluidSheetRequest } from './fluid-sheet';
import {
  FLUID_LOGS_COLLAPSED,
  FLUID_QUICK_AMOUNTS_ML,
  fluidAddLabel,
  fluidDrinkRows,
  fluidLogRows,
  fluidPercent,
  fluidSummaryNote,
  fluidTargetReached,
  fluidTotalLitres,
  formatLitres,
  type FluidLogRow,
} from './fluids-model';
import { FluidsStore } from './fluids-store';
import { logMomentFor, loggedDayNote, type LogMoment } from './today-view';

export const FLUID_ADD_FAILED = 'Could not add that drink.';
export const FLUID_REMOVE_FAILED = 'Could not delete that drink.';

function momentFor(date: string, time: string | null): Pick<LogMoment, 'timestamp' | 'localDate'> {
  if (time !== null) {
    const timestamp = localDateTimeToIso(date, time);
    if (timestamp) {
      return { timestamp, localDate: date };
    }
  }
  const { timestamp, localDate } = logMomentFor(date);
  return { timestamp, localDate };
}

@Component({
  selector: 'app-fluids-card',
  imports: [FluidSheet, Icon, Skeleton, Spinner],
  host: { class: 'block' },
  template: `
    <section class="card p-4" aria-labelledby="fluids-card-title">
      @switch (status()) {
        @case ('loading') {
          <div class="flex items-center gap-3" role="status" aria-label="Loading fluids">
            <app-skeleton class="size-10 shrink-0 rounded-xl" />
            <div class="flex-1 space-y-2">
              <app-skeleton shape="text" class="w-16" />
              <app-skeleton class="h-5 w-24" />
            </div>
          </div>
          <app-skeleton class="mt-3 h-2 w-full rounded-full" />
          <div class="mt-3 grid grid-cols-3 gap-2">
            <app-skeleton class="h-12" />
            <app-skeleton class="h-12" />
            <app-skeleton class="h-12" />
          </div>
        }
        @case ('error') {
          <div class="flex items-center gap-3" role="alert">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger/12 text-danger"
            >
              <app-icon name="droplet" [size]="20" />
            </span>
            <p id="fluids-card-title" class="min-w-0 flex-1 text-sm text-muted">
              Couldn’t load your fluids.
            </p>
            <button type="button" class="btn btn-ghost min-h-11 px-3 text-brand" (click)="retry()">
              Retry
            </button>
          </div>
        }
        @default {
          @if (view(); as view) {
            <div class="flex items-center gap-3">
              <span
                class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fluid/15 text-fluid"
              >
                <app-icon name="droplet" [size]="20" />
              </span>
              <div class="min-w-0 flex-1">
                <h2 id="fluids-card-title" class="text-xs font-medium text-muted">Fluids</h2>
                <p
                  class="text-xl leading-7 font-bold tracking-tight text-fg tabular-nums"
                  data-fluids-progress
                >
                  {{ view.total
                  }}<span class="ml-1 text-sm font-semibold text-muted">/ {{ view.target }} L</span>
                </p>
              </div>
              <span
                class="shrink-0 text-sm font-semibold tabular-nums"
                [class]="view.reached ? 'text-ok' : 'text-muted'"
                data-fluids-percent
              >
                @if (view.reached) {
                  <app-icon class="mr-0.5 align-[-3px]" name="check" [size]="16" />
                }
                {{ view.percent }}%
              </span>
            </div>
            <div
              class="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-labelledby="fluids-card-title"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="view.fill"
              [attr.aria-valuetext]="view.valueText"
            >
              <div
                class="h-full rounded-full bg-fluid transition-[width] duration-500"
                [style.width.%]="view.fill"
              ></div>
            </div>
            @if (view.note) {
              <p class="mt-1.5 text-xs text-muted" data-fluids-note>{{ view.note }}</p>
            }

            <div class="mt-3 grid grid-cols-3 gap-2">
              @for (ml of quickAmounts; track ml) {
                <button
                  type="button"
                  class="btn btn-secondary min-h-12 gap-1 px-2 tabular-nums"
                  [attr.aria-label]="'Add ' + ml + ' ml water'"
                  (click)="addQuick(ml)"
                >
                  <app-icon name="plus" [size]="16" [strokeWidth]="2.5" />
                  {{ ml }} ml
                </button>
              }
              <button
                type="button"
                class="btn btn-secondary min-h-12 px-2"
                aria-haspopup="dialog"
                (click)="sheetOpen.set(true)"
              >
                Other…
              </button>
            </div>

            @if (view.rows.length > 0 || view.drinks.length > 0) {
              <ul class="mt-3 divide-y divide-line/60 border-t border-line/60" aria-label="Drinks">
                @for (row of view.rows; track row.id) {
                  <li class="flex min-h-12 items-center gap-3 py-1" data-fluid-log>
                    <span class="min-w-0 flex-1 truncate text-sm">
                      <span class="font-medium text-fg">{{ row.title }}</span>
                      <span class="text-muted tabular-nums"> · {{ row.amount }}</span>
                    </span>
                    <span class="shrink-0 text-xs text-muted tabular-nums">{{ row.time }}</span>
                    @if (row.pending) {
                      <span class="flex size-11 shrink-0 items-center justify-center text-muted">
                        <app-spinner [size]="16" label="Saving" />
                      </span>
                    } @else {
                      <button
                        type="button"
                        class="btn btn-ghost btn-icon -mr-2 text-muted"
                        [attr.aria-label]="'Delete ' + row.label"
                        (click)="remove(row)"
                      >
                        <app-icon name="trash" [size]="18" />
                      </button>
                    }
                  </li>
                }
                @if (view.hidden > 0) {
                  <li>
                    <button
                      type="button"
                      class="btn btn-ghost min-h-11 w-full text-sm text-brand"
                      (click)="showAll.set(true)"
                    >
                      Show all {{ view.logCount }} drinks
                    </button>
                  </li>
                }
                @for (drink of view.drinks; track drink.key) {
                  <li
                    class="flex min-h-11 items-center gap-3 py-1.5"
                    data-fluid-drink
                    [attr.aria-label]="drink.label"
                  >
                    <app-icon class="text-muted" name="utensils" [size]="16" />
                    <span class="min-w-0 flex-1 truncate text-sm" aria-hidden="true">
                      <span class="font-medium text-fg">{{ drink.name }}</span>
                      <span class="text-muted tabular-nums"> · {{ drink.amount }}</span>
                      <span class="text-muted"> · {{ drink.entryName }}</span>
                    </span>
                  </li>
                }
              </ul>
            }
          }
        }
      }
    </section>
    <app-fluid-sheet
      [(open)]="sheetOpen"
      [date]="date()"
      [today]="today()"
      (added)="addFromSheet($event)"
    />
  `,
})
export class FluidsCard {
  private readonly store = inject(FluidsStore);
  private readonly toast = inject(ToastService);

  readonly date = input.required<string>();
  readonly today = input.required<string>();

  protected readonly quickAmounts = FLUID_QUICK_AMOUNTS_ML;
  protected readonly sheetOpen = signal(false);
  protected readonly showAll = linkedSignal({ source: this.date, computation: () => false });

  protected readonly status = computed(() =>
    this.store.date() === this.date() ? this.store.status() : 'loading',
  );

  protected readonly view = computed(() => {
    const day = this.store.date() === this.date() ? this.store.day() : null;
    if (!day) {
      return null;
    }
    const percent = fluidPercent(day.totalMl, day.targetMl);
    const rows = fluidLogRows(day.logs);
    const visible = this.showAll() ? rows : rows.slice(0, FLUID_LOGS_COLLAPSED);
    const total = fluidTotalLitres(day.totalMl);
    const target = formatLitres(day.targetMl);
    return {
      total,
      target,
      percent,
      fill: Math.min(100, percent),
      reached: fluidTargetReached(day.totalMl, day.targetMl),
      valueText: `${total} of ${target} litres`,
      note: fluidSummaryNote(day),
      rows: visible,
      hidden: rows.length - visible.length,
      logCount: rows.length,
      drinks: fluidDrinkRows(day),
    };
  });

  protected retry(): void {
    void this.store.retry();
  }

  protected addQuick(ml: number): void {
    void this.add(ml, 'water', null);
  }

  protected addFromSheet(request: FluidSheetRequest): void {
    void this.add(request.ml, request.kind, request.time);
  }

  protected async remove(row: FluidLogRow): Promise<void> {
    const log = this.store.day()?.logs.find((candidate) => candidate.id === row.id);
    if (!log) {
      return;
    }
    const label = fluidAddLabel(log.ml, log.kind);
    try {
      await this.store.remove(log);
      this.toast.info(`Removed ${label}`, {
        action: { label: 'Undo', run: () => void this.restore(log) },
      });
    } catch (err) {
      this.toast.error(errorMessage(err, FLUID_REMOVE_FAILED));
    }
  }

  private async add(ml: number, kind: FluidKind, time: string | null): Promise<void> {
    const viewDate = this.date();
    const moment = momentFor(viewDate, time);
    const label = fluidAddLabel(ml, kind);
    try {
      const log = await this.store.add({ ml, kind, ...moment });
      this.toast.success(`Added ${label}${loggedDayNote(log.localDate, viewDate, this.today())}`, {
        action: { label: 'Undo', run: () => void this.undoAdd(log) },
      });
    } catch (err) {
      this.toast.error(errorMessage(err, `Could not add ${label}.`));
    }
  }

  private async undoAdd(log: FluidLogDto): Promise<void> {
    try {
      await this.store.remove(log);
      this.toast.info(`Removed ${fluidAddLabel(log.ml, log.kind)}`);
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not undo.'));
    }
  }

  private async restore(log: FluidLogDto): Promise<void> {
    try {
      await this.store.add({
        ml: log.ml,
        kind: log.kind,
        timestamp: log.timestamp,
        localDate: log.localDate,
      });
    } catch (err) {
      this.toast.error(errorMessage(err, FLUID_ADD_FAILED));
    }
  }
}
