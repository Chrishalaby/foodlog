import { Component, computed, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { type ActivityLevel, computeTargets } from '@food/shared';
import { formatNumber } from '../../../shared/utils/format';
import { StepperField } from '../../settings/controls/stepper-field';
import {
  type ProfileFormModel,
  previewInput,
  trainingDaysExplanation,
} from '../../settings/profile-model';
import { ChoiceCards, type CardOption } from '../choice-cards';
import { activityPreviews } from '../onboarding-math';

@Component({
  selector: 'app-activity-step',
  imports: [FormField, ChoiceCards, StepperField],
  host: { class: 'flex flex-col gap-7' },
  template: `
    @let f = form();
    <div>
      <h2 class="sr-only" id="ob-activity-label">Activity level</h2>
      <app-choice-cards
        labelledBy="ob-activity-label"
        [options]="options()"
        [formField]="f.activityLevel"
      />
      @if (showsBurn()) {
        <p class="mt-3 text-xs leading-relaxed text-muted">
          The numbers are your estimated daily calorie burn at each level.
        </p>
      }
    </div>

    <div>
      <span class="label" id="ob-training-label">Training days per week</span>
      <app-stepper-field
        labelledBy="ob-training-label"
        describedBy="ob-training-hint"
        unitLabel="training days per week"
        decreaseLabel="Fewer training days"
        increaseLabel="More training days"
        [formField]="f.trainingDaysPerWeek"
      />
      <p id="ob-training-hint" class="mt-2 text-xs leading-relaxed text-muted">
        {{ trainingHint() }}
      </p>
    </div>
  `,
})
export class ActivityStep {
  readonly form = input.required<FieldTree<ProfileFormModel>>();

  private readonly input = computed(() => previewInput(this.form()().value()));

  protected readonly options = computed<CardOption<ActivityLevel>[]>(() =>
    activityPreviews(this.input()).map((preview) => ({
      value: preview.level,
      title: preview.title,
      detail: preview.detail,
      intensity: preview.intensity,
      aside: preview.burnKcal === null ? null : formatNumber(preview.burnKcal),
      asideHint: 'kcal/day',
    })),
  );

  protected readonly showsBurn = computed(() => this.options().some((option) => option.aside));

  protected readonly trainingHint = computed(() => {
    const input = this.input();
    const result = computeTargets(input);
    return trainingDaysExplanation(
      input.trainingDaysPerWeek,
      result.trainingDeltaKcal,
      result.restDeltaKcal,
    );
  });
}
