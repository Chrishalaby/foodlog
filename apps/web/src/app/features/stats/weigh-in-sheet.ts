import {
  Component,
  computed,
  effect,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { isValidLocalDate, type WeightLogDto } from '@food/shared';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { injectDiscardGuard } from '../../shared/ui/discard-guard';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { WeightField } from './weight-field';
import {
  bodyFatText,
  dayPhrase,
  firstMissingDate,
  formatKg,
  readWeighInDraft,
  weighInEdit,
  weightText,
  type WeighInInput,
} from './weight-math';

@Component({
  selector: 'app-weigh-in-sheet',
  imports: [BottomSheet, Icon, Spinner, WeightField],
  template: `
    <app-bottom-sheet [(open)]="open" title="Add weigh-in" [canClose]="canClose">
      <form class="flex flex-col gap-4" novalidate (submit)="submit($event)">
        <div>
          <label class="label" for="weigh-in-sheet-date">Date</label>
          <input
            id="weigh-in-sheet-date"
            type="date"
            class="input"
            [attr.max]="today()"
            [attr.aria-invalid]="dateError() ? true : null"
            [attr.aria-describedby]="dateError() ? errorId : null"
            [value]="date()"
            (input)="onDateInput($event)"
            (change)="onDateInput($event)"
          />
          @if (replaces(); as note) {
            <p class="mt-1.5 text-xs text-warn">{{ note }}</p>
          }
        </div>
        <div>
          <label class="label" for="weigh-in-sheet-weight">Weight</label>
          <app-weight-field
            inputId="weigh-in-sheet-weight"
            ariaLabel="Weight in kg"
            [(text)]="weight"
            [fallback]="defaultWeight()"
            [invalid]="showErrors() && draft().weightError !== null"
            [describedBy]="showErrors() && draft().weightError ? errorId : null"
          />
        </div>
        <div>
          <label class="label" for="weigh-in-sheet-fat">
            Body fat <span class="font-normal">(optional)</span>
          </label>
          <div class="relative">
            <input
              id="weigh-in-sheet-fat"
              type="text"
              inputmode="decimal"
              autocomplete="off"
              class="input pr-10 tabular-nums"
              placeholder="e.g. 18.5"
              [attr.aria-invalid]="showErrors() && draft().bodyFatError ? true : null"
              [attr.aria-describedby]="showErrors() && draft().bodyFatError ? errorId : null"
              [value]="bodyFat()"
              (input)="onFatInput($event)"
            />
            <span
              class="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted"
              aria-hidden="true"
              >%</span
            >
          </div>
        </div>
        @if (errorText(); as message) {
          <p class="-mt-1 text-sm text-danger" role="alert" [id]="errorId">{{ message }}</p>
        }
        <button type="submit" class="btn btn-primary min-h-12 w-full" [disabled]="busy()">
          @if (busy()) {
            <app-spinner [size]="18" label="Saving" />
          } @else {
            <app-icon name="check" [size]="18" />
          }
          Save weigh-in
        </button>
      </form>
    </app-bottom-sheet>
  `,
})
export class WeighInSheet {
  readonly open = model(false);
  readonly today = input.required<string>();
  readonly defaultWeight = input<number | null>(null);
  readonly logs = input<readonly WeightLogDto[]>([]);
  readonly busy = input(false);

  readonly submitted = output<WeighInInput>();

  protected readonly errorId = 'weigh-in-sheet-error';
  protected readonly date = signal('');
  protected readonly weight = signal('');
  protected readonly bodyFat = signal('');
  protected readonly showErrors = signal(false);
  private readonly initial = signal('');
  private readonly prefilledWeight = signal('');
  private readonly prefilledFat = signal('');
  protected readonly dirty = computed(() => this.snapshot() !== this.initial());
  protected readonly canClose = injectDiscardGuard(
    () => this.dirty(),
    'This weigh-in hasn’t been saved.',
  );

  protected readonly draft = computed(() => readWeighInDraft(this.weight(), this.bodyFat()));
  protected readonly dateError = computed(() => {
    if (!this.showErrors()) {
      return null;
    }
    const date = this.date();
    if (!isValidLocalDate(date)) {
      return 'Pick a date.';
    }
    return date > this.today() ? 'Weigh-ins can’t be in the future.' : null;
  });
  protected readonly errorText = computed(() => {
    if (!this.showErrors()) {
      return null;
    }
    return this.dateError() ?? this.draft().weightError ?? this.draft().bodyFatError;
  });
  protected readonly replaces = computed(() => {
    const existing = this.existingLog(this.date());
    if (!existing) {
      return null;
    }
    return `Replaces the ${formatKg(existing.weightKg)} kg weigh-in for ${dayPhrase(existing.date, this.today())}.`;
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.reset());
      }
    });
  }

  protected onDateInput(event: Event): void {
    const date = (event.target as HTMLInputElement).value;
    const untouched =
      this.weight().trim() === this.prefilledWeight() &&
      this.bodyFat().trim() === this.prefilledFat();
    this.date.set(date);
    if (untouched) {
      this.prefill(date);
    }
  }

  protected onFatInput(event: Event): void {
    this.bodyFat.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    if (this.busy()) {
      return;
    }
    this.showErrors.set(true);
    const draft = this.draft();
    if (this.dateError() || draft.weightError || draft.bodyFatError || draft.weightKg === null) {
      return;
    }
    const date = this.date();
    const stored = this.existingLog(date) ?? { date, weightKg: draft.weightKg, bodyFatPct: null };
    this.submitted.emit(
      weighInEdit(stored, { weightKg: draft.weightKg, bodyFatPct: draft.bodyFatPct }),
    );
  }

  private reset(): void {
    const date = firstMissingDate(this.logs(), this.today());
    this.date.set(date);
    this.prefill(date);
    this.showErrors.set(false);
    this.initial.set(this.snapshot());
  }

  private prefill(date: string): void {
    const existing = this.existingLog(date);
    const weight = weightText(existing ? existing.weightKg : this.defaultWeight());
    const fat = existing ? bodyFatText(existing.bodyFatPct) : '';
    this.weight.set(weight);
    this.bodyFat.set(fat);
    this.prefilledWeight.set(weight);
    this.prefilledFat.set(fat);
  }

  private existingLog(date: string): WeightLogDto | undefined {
    return this.logs().find((log) => log.date === date);
  }

  private snapshot(): string {
    return JSON.stringify([this.date(), this.weight().trim(), this.bodyFat().trim()]);
  }
}
