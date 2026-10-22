import { Component, computed, input } from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import type { Goal } from '@food/shared';
import { formatNumber } from '../../../shared/utils/format';
import { type ProfileFormModel, previewInput } from '../../settings/profile-model';
import { ChoiceCards, type CardOption } from '../choice-cards';
import { goalPreviews } from '../onboarding-math';

@Component({
  selector: 'app-goal-step',
  imports: [FormField, ChoiceCards],
  host: { class: 'block' },
  template: `
    <h2 class="sr-only" id="ob-goal-label">Goal</h2>
    <app-choice-cards labelledBy="ob-goal-label" [options]="options()" [formField]="form().goal" />
    <p class="mt-4 text-xs leading-relaxed text-muted">
      Protein is set per kg of body weight so you keep or build muscle. Fat and carbs fill the rest
      of your calories.
    </p>
  `,
})
export class GoalStep {
  readonly form = input.required<FieldTree<ProfileFormModel>>();

  protected readonly options = computed<CardOption<Goal>[]>(() =>
    goalPreviews(previewInput(this.form()().value())).map((preview) => ({
      value: preview.goal,
      title: preview.title,
      detail: preview.detail,
      aside: preview.kcal === null ? null : formatNumber(preview.kcal),
      asideHint: 'kcal/day',
    })),
  );
}
