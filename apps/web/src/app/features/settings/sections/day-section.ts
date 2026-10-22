import { Component, computed, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { autoFluidTargetMl, isFiniteNumber } from '@food/shared';
import {
  DAY_START_HOURS,
  dayStartHint,
  dayStartLabel,
  normalizeDayStartHour,
} from '../../../core/day-start';
import { DecimalField } from '../controls/decimal-field';
import { FieldError } from '../controls/field-error';
import { fluidLitresFromMl, type ProfileFormModel } from '../profile-model';
import { SettingsSection } from './settings-section';

export const DAY_START_OPTIONS = DAY_START_HOURS.map((hour) => ({
  value: hour,
  label: dayStartLabel(hour),
}));

function litresText(ml: number): string {
  return (fluidLitresFromMl(ml) ?? 0).toLocaleString('en-US', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  });
}

export function autoFluidsText(weightKg: number | null, custom = false): string {
  const weight = isFiniteNumber(weightKg) && weightKg > 0 ? weightKg : null;
  const base = litresText(autoFluidTargetMl(weight, false));
  if (custom) {
    return `Same every day · auto ${base} L`;
  }
  const training = litresText(autoFluidTargetMl(weight, true));
  const source = weight === null ? 'add your weight for a personal value' : 'from your weight';
  return `Auto ${base} L (${source}), ${training} L on training days`;
}

@Component({
  selector: 'app-day-section',
  imports: [SettingsSection, FormField, DecimalField, FieldError],
  template: `
    @let f = form();
    <app-settings-section
      sectionId="settings-day"
      heading="Day & fluids"
      icon="clock"
      tone="accent"
      description="When your day rolls over and how much you aim to drink."
    >
      <label class="label" for="settings-day-start">Day starts at</label>
      <select
        id="settings-day-start"
        class="input"
        aria-describedby="settings-day-start-hint"
        (change)="onDayStart($event)"
      >
        @for (option of dayStartOptions; track option.value) {
          <option [value]="option.value" [selected]="option.value === dayStart()">
            {{ option.label }}
          </option>
        }
      </select>
      <p id="settings-day-start-hint" class="mt-1.5 text-xs leading-relaxed text-muted">
        {{ dayStartHint() }} Logs you already saved keep their day.
      </p>

      <div class="mt-5 flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <label class="block text-sm font-semibold text-fg" for="settings-fluid-target">
            Daily fluids
          </label>
          <p id="settings-fluid-target-hint" class="mt-0.5 text-xs text-muted tabular-nums">
            {{ autoText() }}
            @if (custom()) {
              <span class="font-medium text-accent"> · custom</span>
            }
          </p>
        </div>
        <app-decimal-field
          class="w-[7.5rem] shrink-0"
          inputId="settings-fluid-target"
          describedBy="settings-fluid-target-hint settings-fluid-target-error"
          unit="L"
          [decimals]="2"
          [placeholder]="autoPlaceholder()"
          [formField]="f.fluidTargetL"
        />
        <button
          type="button"
          class="btn btn-ghost min-w-11 shrink-0 px-2 text-sm text-accent"
          [class.invisible]="!custom()"
          aria-label="Use the automatic daily fluids"
          (click)="useAuto()"
        >
          Auto
        </button>
      </div>
      <app-field-error errorId="settings-fluid-target-error" [field]="f.fluidTargetL" />
    </app-settings-section>
  `,
})
export class DaySection {
  readonly form = input.required<FieldTree<ProfileFormModel>>();
  readonly weightKg = input<number | null>(null);

  protected readonly dayStartOptions = DAY_START_OPTIONS;
  protected readonly dayStart = computed(() =>
    normalizeDayStartHour(this.form().dayStartHour().value()),
  );
  protected readonly dayStartHint = computed(() => dayStartHint(this.dayStart()));
  protected readonly custom = computed(() => this.form().fluidTargetL().value() !== null);
  protected readonly autoText = computed(() => autoFluidsText(this.weightKg(), this.custom()));
  protected readonly autoPlaceholder = computed(() =>
    litresText(autoFluidTargetMl(this.weightKg(), false)),
  );

  protected onDayStart(event: Event): void {
    const hour = Number((event.target as HTMLSelectElement).value);
    this.form().dayStartHour().value.set(normalizeDayStartHour(hour));
  }

  protected useAuto(): void {
    const field = this.form().fluidTargetL;
    field().value.set(null);
    field().focusBoundControl();
  }
}
