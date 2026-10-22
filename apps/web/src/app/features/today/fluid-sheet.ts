import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FLUID_KINDS, type FluidKind } from '@food/shared';
import { dayStartHour } from '../../core/day-start';
import { localClockTime, localDateTimeToIso } from '../../core/time';
import { BottomSheet } from '../../shared/ui/bottom-sheet';
import { Icon } from '../../shared/ui/icon';
import { parseDecimal } from '../../shared/utils/format';
import { afterMidnightNote, eatingDayPhrase } from '../log/entry-timing';
import {
  FLUID_DEFAULT_SHEET_ML,
  FLUID_SHEET_AMOUNTS_ML,
  fluidAddLabel,
  fluidKindLabel,
  fluidMlError,
  formatMl,
  isValidFluidMl,
} from './fluids-model';

export interface FluidSheetRequest {
  ml: number;
  kind: FluidKind;
  time: string | null;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const FLUID_FUTURE_TOLERANCE_MS = 60_000;
export const FLUID_FUTURE_MESSAGE = 'That time is still to come. Pick a time that has passed.';

export function parseCustomMl(text: string): number | null {
  const parsed = parseDecimal(text);
  return parsed === null ? null : Math.round(parsed);
}

@Component({
  selector: 'app-fluid-sheet',
  imports: [BottomSheet, Icon],
  template: `
    <app-bottom-sheet [(open)]="open" title="Add a drink">
      <form class="flex flex-col gap-5" novalidate (submit)="submit($event)">
        <fieldset>
          <legend class="label">Amount</legend>
          <div class="grid grid-cols-3 gap-1.5">
            @for (chip of amountChips(); track chip.ml) {
              <button
                type="button"
                class="flex min-h-12 items-center justify-center rounded-xl border px-1 text-base font-bold tabular-nums transition active:scale-95"
                [class]="chip.selected ? selectedClass : idleClass"
                [attr.aria-pressed]="chip.selected"
                (click)="pickAmount(chip.ml)"
              >
                {{ chip.label }}
              </button>
            }
            <button
              type="button"
              class="flex min-h-12 items-center justify-center rounded-xl border px-1 text-base font-semibold transition active:scale-95"
              [class]="custom() ? selectedClass : idleClass"
              [attr.aria-pressed]="custom()"
              (click)="useCustom()"
            >
              Custom
            </button>
          </div>
          @if (custom()) {
            <div class="relative mt-2">
              <label class="sr-only" for="fluid-sheet-custom">Custom amount in ml</label>
              <input
                #customInput
                id="fluid-sheet-custom"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                enterkeyhint="done"
                class="input pr-12 text-right tabular-nums"
                placeholder="e.g. 400"
                [value]="customText()"
                [attr.aria-invalid]="customError() ? true : null"
                [attr.aria-describedby]="customError() ? 'fluid-sheet-custom-error' : null"
                (input)="onCustomInput($event)"
              />
              <span
                class="pointer-events-none absolute inset-y-0 right-3.5 flex items-center text-sm text-muted"
                aria-hidden="true"
                >ml</span
              >
            </div>
            @if (customError(); as message) {
              <p id="fluid-sheet-custom-error" class="mt-1.5 text-xs text-danger" role="alert">
                {{ message }}
              </p>
            }
          }
        </fieldset>

        <fieldset>
          <legend class="label">Drink</legend>
          <div class="grid grid-cols-4 gap-1.5">
            @for (option of kindOptions; track option.kind) {
              <button
                type="button"
                class="flex min-h-12 items-center justify-center rounded-xl border px-1 text-sm font-semibold transition active:scale-95"
                [class]="option.kind === kind() ? selectedClass : idleClass"
                [attr.aria-pressed]="option.kind === kind()"
                (click)="kind.set(option.kind)"
              >
                {{ option.label }}
              </button>
            }
          </div>
        </fieldset>

        <div>
          <div class="flex items-center justify-between gap-3">
            <label class="label mb-0" for="fluid-sheet-time">Time</label>
            @if (time() !== null) {
              <button
                type="button"
                class="btn btn-ghost min-h-11 px-3 text-sm text-brand"
                (click)="useNow()"
              >
                Now
              </button>
            }
          </div>
          @if (time() === null) {
            <button
              type="button"
              id="fluid-sheet-time"
              class="input flex items-center justify-between text-left"
              (click)="chooseTime()"
            >
              <span>Now · {{ dayPhrase() }}</span>
              <app-icon class="text-muted" name="clock" [size]="18" />
            </button>
          } @else {
            <input
              id="fluid-sheet-time"
              type="time"
              class="input text-left tabular-nums"
              [value]="time()"
              [attr.aria-invalid]="timeValid() ? null : true"
              [attr.aria-describedby]="timeError() ? 'fluid-sheet-time-error' : null"
              (input)="onTimeInput($event)"
              (change)="onTimeInput($event)"
            />
            @if (timeError(); as message) {
              <p id="fluid-sheet-time-error" class="mt-1.5 text-xs text-danger" role="alert">
                {{ message }}
              </p>
            }
            @if (timeError() === null && timeNote(); as note) {
              <p
                class="mt-1.5 flex items-start gap-1.5 text-xs leading-snug text-accent"
                aria-live="polite"
              >
                <app-icon class="mt-px" name="moon" [size]="14" />
                <span>{{ note }}</span>
              </p>
            }
          }
        </div>

        <div
          class="sticky bottom-[calc(-1.25rem-env(safe-area-inset-bottom))] -mx-5 mb-[calc(-1.25rem-env(safe-area-inset-bottom))] border-t border-line/70 bg-elevated px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <button
            type="submit"
            class="btn btn-primary min-h-13 w-full text-base"
            [disabled]="!canAdd()"
          >
            <app-icon name="plus" [strokeWidth]="2.5" />
            <span class="min-w-0 truncate">{{ addLabel() }}</span>
          </button>
        </div>
      </form>
    </app-bottom-sheet>
  `,
})
export class FluidSheet {
  private readonly injector = inject(Injector);
  private readonly customInput = viewChild<ElementRef<HTMLInputElement>>('customInput');

  readonly open = model(false);
  readonly date = input.required<string>();
  readonly today = input.required<string>();
  readonly added = output<FluidSheetRequest>();

  protected readonly selectedClass = 'border-fluid bg-fluid/15 text-fg';
  protected readonly idleClass = 'border-line/70 bg-surface text-fg hover:bg-surface-2';
  protected readonly kindOptions = FLUID_KINDS.map((kind) => ({
    kind,
    label: fluidKindLabel(kind),
  }));

  protected readonly presetMl = signal<number>(FLUID_DEFAULT_SHEET_ML);
  protected readonly custom = signal(false);
  protected readonly customText = signal('');
  protected readonly kind = signal<FluidKind>('water');
  protected readonly time = signal<string | null>(null);

  protected readonly amountChips = computed(() =>
    FLUID_SHEET_AMOUNTS_ML.map((ml) => ({
      ml,
      label: formatMl(ml),
      selected: !this.custom() && this.presetMl() === ml,
    })),
  );
  protected readonly customMl = computed(() => parseCustomMl(this.customText()));
  protected readonly ml = computed<number | null>(() =>
    this.custom() ? this.customMl() : this.presetMl(),
  );
  protected readonly customError = computed(() =>
    this.custom() && this.customText().trim() !== '' ? fluidMlError(this.customMl()) : null,
  );
  protected readonly timeError = computed(() => {
    const time = this.time();
    if (time === null) {
      return null;
    }
    if (!TIME_PATTERN.test(time)) {
      return 'Pick a time.';
    }
    const timestamp = localDateTimeToIso(this.date(), time, dayStartHour());
    return timestamp && Date.parse(timestamp) > Date.now() + FLUID_FUTURE_TOLERANCE_MS
      ? FLUID_FUTURE_MESSAGE
      : null;
  });
  protected readonly timeValid = computed(() => this.timeError() === null);
  protected readonly canAdd = computed(() => isValidFluidMl(this.ml()) && this.timeValid());
  protected readonly addLabel = computed(() => {
    const ml = this.ml();
    return isValidFluidMl(ml) ? `Add ${fluidAddLabel(ml, this.kind())}` : 'Add drink';
  });
  protected readonly dayPhrase = computed(() => eatingDayPhrase(this.date(), this.today()));
  protected readonly timeNote = computed(() => {
    const time = this.time();
    return time && TIME_PATTERN.test(time)
      ? afterMidnightNote(`${this.date()}T${time}`, dayStartHour(), this.today())
      : null;
  });

  constructor() {
    effect(() => {
      if (this.open()) {
        untracked(() => this.reset());
      }
    });
  }

  protected pickAmount(ml: number): void {
    this.custom.set(false);
    this.presetMl.set(ml);
  }

  protected useCustom(): void {
    this.custom.set(true);
    afterNextRender(() => this.customInput()?.nativeElement.focus(), { injector: this.injector });
  }

  protected onCustomInput(event: Event): void {
    this.customText.set((event.target as HTMLInputElement).value);
  }

  protected chooseTime(): void {
    this.time.set(localClockTime());
  }

  protected useNow(): void {
    this.time.set(null);
  }

  protected onTimeInput(event: Event): void {
    this.time.set((event.target as HTMLInputElement).value);
  }

  protected submit(event: Event): void {
    event.preventDefault();
    const ml = this.ml();
    if (!isValidFluidMl(ml) || !this.timeValid()) {
      return;
    }
    this.added.emit({ ml, kind: this.kind(), time: this.time() });
    this.open.set(false);
  }

  private reset(): void {
    this.presetMl.set(FLUID_DEFAULT_SHEET_ML);
    this.custom.set(false);
    this.customText.set('');
    this.kind.set('water');
    this.time.set(null);
  }
}
