import { Component, computed, effect, inject, model, signal, untracked } from '@angular/core';
import { ApiService } from '../../../core/api.service';
import { DataEventsService } from '../../../core/data-events.service';
import { errorMessage } from '../../../core/errors';
import { BottomSheet } from '../../../shared/ui/bottom-sheet';
import { Icon } from '../../../shared/ui/icon';
import { Spinner } from '../../../shared/ui/spinner';
import { formatNumber } from '../../../shared/utils/format';
import {
  UNKNOWN_FILE_MESSAGE,
  detectImport,
  type ImportPlan,
  type WeightUnit,
} from './import-formats';
import { importSummary, runImport } from './import-runner';

type ImportPhase = 'pick' | 'ready' | 'importing' | 'done';

export const IMPORT_FILE_MAX_BYTES = 50 * 1024 * 1024;

@Component({
  selector: 'app-import-sheet',
  imports: [BottomSheet, Icon, Spinner],
  template: `
    <app-bottom-sheet [(open)]="open" title="Import from another app">
      <div class="flex flex-col gap-4">
        @switch (phase()) {
          @case ('pick') {
            <p class="text-sm leading-snug text-muted">
              Bring your history with you. Your file is read on this device and only the meals,
              weigh-ins and water it contains are sent to your FoodLog.
            </p>
            <ul class="flex flex-col gap-1.5 text-sm text-fg/90">
              <li><span class="font-semibold">FoodLog</span>: the JSON or CSV export</li>
              <li>
                <span class="font-semibold">Cronometer</span>: “Food &amp; Recipe Entries” or
                biometrics export
              </li>
              <li>
                <span class="font-semibold">MyFitnessPal</span>: Nutrition or Measurement Summary
                CSV
              </li>
              <li>
                <span class="font-semibold">Any scale or app</span>: a CSV with date and weight
              </li>
            </ul>
            <label class="btn btn-primary min-h-12 w-full cursor-pointer text-base">
              <app-icon name="download" [size]="18" />
              Choose a file
              <input
                type="file"
                class="sr-only"
                accept=".csv,.json,text/csv,application/json"
                data-testid="import-file"
                (change)="onFile($event)"
              />
            </label>
            @if (error(); as message) {
              <p class="text-sm leading-snug text-danger" role="alert">{{ message }}</p>
            }
          }
          @case ('ready') {
            @if (plan(); as current) {
              <div class="card flex flex-col gap-2 p-3.5" data-testid="import-summary">
                <p class="text-[15px] font-semibold text-fg">{{ current.label }}</p>
                <p class="text-sm text-muted">{{ countsText() }}</p>
                @if (rangeText(); as range) {
                  <p class="text-xs text-muted">{{ range }}</p>
                }
                @if (current.skippedRows > 0) {
                  <p class="text-xs text-warn">
                    {{ current.skippedRows }} rows without a usable date were left out.
                  </p>
                }
              </div>
              @if (current.weights.length > 0 && current.weightUnit === null) {
                <div>
                  <p class="label" id="import-unit">Weights in this file are in</p>
                  <div class="grid grid-cols-2 gap-2" role="group" aria-labelledby="import-unit">
                    @for (option of units; track option) {
                      <button
                        type="button"
                        class="min-h-11 rounded-xl border text-sm font-semibold transition"
                        [class]="
                          unit() === option
                            ? 'border-brand bg-brand/15 text-brand'
                            : 'border-line/70 bg-surface text-fg hover:bg-surface-2'
                        "
                        [attr.aria-pressed]="unit() === option"
                        (click)="unit.set(option)"
                      >
                        {{ option }}
                      </button>
                    }
                  </div>
                </div>
              }
              <p class="text-xs leading-snug text-muted">
                Anything already in your log is skipped, so importing the same file twice is safe.
              </p>
              <button
                type="button"
                class="btn btn-primary min-h-12 w-full text-base"
                (click)="start()"
              >
                Import
              </button>
              <button
                type="button"
                class="btn btn-ghost min-h-11 w-full text-muted"
                (click)="reset()"
              >
                Choose another file
              </button>
            }
          }
          @case ('importing') {
            <div class="flex flex-col items-center gap-3 py-4" role="status" aria-live="polite">
              <app-spinner [size]="28" label="Importing" />
              <p class="text-sm text-muted">Importing… {{ progressText() }}</p>
              <div class="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div
                  class="h-full rounded-full bg-brand transition-all"
                  [style.width.%]="percent()"
                ></div>
              </div>
            </div>
          }
          @case ('done') {
            <p class="flex items-start gap-2 text-sm leading-snug text-fg" role="status">
              <app-icon class="mt-0.5 shrink-0 text-ok" name="check" [size]="18" />
              {{ resultText() }}
            </p>
            @if (error(); as message) {
              <p class="text-sm leading-snug text-danger" role="alert">{{ message }}</p>
            }
            <button type="button" class="btn btn-primary min-h-12 w-full" (click)="open.set(false)">
              Done
            </button>
          }
        }
      </div>
    </app-bottom-sheet>
  `,
})
export class ImportSheet {
  private readonly api = inject(ApiService);
  private readonly events = inject(DataEventsService);

  readonly open = model(false);

  protected readonly units: readonly WeightUnit[] = ['kg', 'lb'];
  protected readonly phase = signal<ImportPhase>('pick');
  protected readonly plan = signal<ImportPlan | null>(null);
  protected readonly unit = signal<WeightUnit>('kg');
  protected readonly error = signal<string | null>(null);
  protected readonly done = signal(0);
  protected readonly total = signal(0);
  protected readonly resultText = signal('');
  protected readonly percent = computed(() =>
    this.total() > 0 ? Math.round((this.done() / this.total()) * 100) : 0,
  );
  protected readonly progressText = computed(() =>
    this.total() > 0 ? `${this.done()} of ${this.total()}` : '',
  );
  protected readonly countsText = computed(() => {
    const plan = this.plan();
    if (!plan) {
      return '';
    }
    const parts = [
      plan.entries.length > 0 ? `${formatNumber(plan.entries.length)} meals` : null,
      plan.weights.length > 0 ? `${formatNumber(plan.weights.length)} weigh-ins` : null,
      plan.fluids.length > 0 ? `${formatNumber(plan.fluids.length)} drinks` : null,
      plan.trainingDays.length > 0
        ? `${formatNumber(plan.trainingDays.length)} training days`
        : null,
    ].filter((part): part is string => part !== null);
    return parts.length > 0 ? parts.join(' · ') : 'Nothing to import in this file.';
  });
  protected readonly rangeText = computed(() => {
    const plan = this.plan();
    if (!plan?.firstDate || !plan.lastDate) {
      return null;
    }
    return plan.firstDate === plan.lastDate
      ? `On ${plan.firstDate}`
      : `From ${plan.firstDate} to ${plan.lastDate}`;
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.reset());
      }
    });
  }

  protected reset(): void {
    this.phase.set('pick');
    this.plan.set(null);
    this.error.set(null);
    this.unit.set('kg');
    this.done.set(0);
    this.total.set(0);
  }

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.error.set(null);
    if (file.size > IMPORT_FILE_MAX_BYTES) {
      this.error.set('That file is too large to import here (over 50 MB).');
      return;
    }
    const plan = detectImport(file.name, await file.text());
    const empty =
      !plan ||
      plan.entries.length + plan.weights.length + plan.fluids.length + plan.trainingDays.length ===
        0;
    if (!plan || empty) {
      this.error.set(
        plan ? 'This file has no meals, weigh-ins or water to import.' : UNKNOWN_FILE_MESSAGE,
      );
      return;
    }
    this.plan.set(plan);
    this.phase.set('ready');
  }

  protected async start(): Promise<void> {
    const plan = this.plan();
    if (!plan || this.phase() !== 'ready') {
      return;
    }
    this.phase.set('importing');
    this.error.set(null);
    try {
      const result = await runImport(
        plan,
        this.unit(),
        (body) => this.api.importBatch(body),
        (done, total) => {
          this.done.set(done);
          this.total.set(total);
        },
      );
      this.resultText.set(importSummary(result));
    } catch (err) {
      this.resultText.set(
        this.done() > 0
          ? `Part of the file was imported (${this.done()} of ${this.total()} batches).`
          : 'Nothing was imported.',
      );
      this.error.set(
        errorMessage(
          err,
          "Couldn't finish the import. Try again; parts already imported are skipped.",
        ),
      );
    } finally {
      this.events.notify('entries', 'weights', 'profile', 'fluids');
      this.phase.set('done');
    }
  }
}
