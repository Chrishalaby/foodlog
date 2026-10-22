import { Component, DOCUMENT, computed, inject, input, output } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { BODY_BOUNDS, type Sex } from '@food/shared';
import { bodyFatHint } from '../../settings/body-metrics';
import { ChoiceField, type ChoiceOption } from '../../settings/controls/choice-field';
import { FieldError } from '../../settings/controls/field-error';
import type { ProfileFormModel } from '../../settings/profile-model';
import { MeasureField } from '../measure-field';

const SEX_OPTIONS: readonly ChoiceOption<Sex | ''>[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

export const DEFAULT_AGE = 30;

@Component({
  selector: 'app-about-step',
  imports: [FormField, ChoiceField, FieldError, MeasureField],
  host: { class: 'flex flex-col gap-6' },
  template: `
    @let f = form();
    <div>
      <span class="label" id="ob-sex-label">Sex</span>
      <app-choice-field
        size="lg"
        labelledBy="ob-sex-label"
        describedBy="ob-sex-hint ob-sex-error"
        [options]="sexOptions"
        [formField]="f.sex"
      />
      <app-field-error errorId="ob-sex-error" [field]="f.sex" />
      <p id="ob-sex-hint" class="mt-1.5 text-xs text-muted">
        Men and women burn energy differently, so the formulas need it.
      </p>
    </div>

    <div>
      <label class="label" for="ob-age">Age</label>
      <app-measure-field
        inputId="ob-age"
        label="age"
        unit="yrs"
        placeholder="30"
        describedBy="ob-age-error"
        [decimals]="0"
        [step]="1"
        [stepStart]="defaultAge"
        [stepMin]="bounds.age.min"
        [stepMax]="bounds.age.max"
        [formField]="f.age"
        (enter)="focusField('ob-height')"
      />
      <app-field-error errorId="ob-age-error" [field]="f.age" />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div class="min-w-0">
        <label class="label" for="ob-height">Height</label>
        <app-measure-field
          inputId="ob-height"
          label="height"
          unit="cm"
          placeholder="175"
          describedBy="ob-height-error"
          [decimals]="1"
          [formField]="f.heightCm"
          (enter)="focusField('ob-weight')"
        />
        <app-field-error errorId="ob-height-error" [field]="f.heightCm" />
      </div>
      <div class="min-w-0">
        <label class="label" for="ob-weight">Weight</label>
        <app-measure-field
          inputId="ob-weight"
          label="weight"
          unit="kg"
          placeholder="72.5"
          describedBy="ob-weight-error"
          [decimals]="1"
          [formField]="f.weightKg"
          (enter)="focusField('ob-body-fat')"
        />
        <app-field-error errorId="ob-weight-error" [field]="f.weightKg" />
      </div>
    </div>

    <div>
      <div class="mb-1.5 flex items-center justify-between gap-2">
        <label class="text-sm font-medium text-muted" for="ob-body-fat">Body fat</label>
        <span class="chip">Optional</span>
      </div>
      <app-measure-field
        inputId="ob-body-fat"
        label="body fat"
        unit="%"
        placeholder="—"
        enterKeyHint="done"
        describedBy="ob-body-fat-hint ob-body-fat-error"
        [decimals]="1"
        [formField]="f.bodyFatPct"
        (enter)="done.emit()"
      />
      <app-field-error errorId="ob-body-fat-error" [field]="f.bodyFatPct" />
      <p id="ob-body-fat-hint" class="mt-1.5 text-xs leading-relaxed text-muted">
        {{ bodyFatHint() }} With it, FoodLog uses your lean mass for a more precise burn and shows
        your FFMI.
      </p>
    </div>
  `,
})
export class AboutStep {
  private readonly document = inject(DOCUMENT);

  readonly form = input.required<FieldTree<ProfileFormModel>>();
  readonly done = output<void>();

  protected readonly sexOptions = SEX_OPTIONS;
  protected readonly bounds = BODY_BOUNDS;
  protected readonly defaultAge = DEFAULT_AGE;
  protected readonly bodyFatHint = computed(() => bodyFatHint(this.form().sex().value()));

  protected focusField(id: string): void {
    this.document.getElementById(id)?.focus();
  }
}
