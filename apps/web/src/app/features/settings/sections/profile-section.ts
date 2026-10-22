import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import {
  ACTIVITY_LEVELS,
  ACTIVITY_LEVEL_LABELS,
  type AdaptiveTdeeDto,
  GOALS,
  GOAL_LABELS,
  type Goal,
  type Sex,
  type TargetsResult,
} from '@food/shared';
import { ONBOARDING_PATH } from '../../../core/guards';
import { Icon } from '../../../shared/ui/icon';
import { formatNumber } from '../../../shared/utils/format';
import { adaptiveSummary, bodyFatHint } from '../body-metrics';
import { ChoiceField, type ChoiceOption } from '../controls/choice-field';
import { DecimalField } from '../controls/decimal-field';
import { FieldError } from '../controls/field-error';
import { StepperField } from '../controls/stepper-field';
import {
  type ProfileFormModel,
  burnExplanation,
  formulaTdee,
  labelParts,
  missingProfileFields,
  previewColumns,
  previewInput,
  trainingDaysExplanation,
} from '../profile-model';
import { SettingsSection } from './settings-section';

const SEX_OPTIONS: readonly ChoiceOption<Sex | ''>[] = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
];

const GOAL_OPTIONS: readonly ChoiceOption<Goal>[] = GOALS.map((goal) => {
  const parts = labelParts(GOAL_LABELS[goal]);
  return { value: goal, label: parts.title, hint: parts.detail || 'keep weight' };
});

const ACTIVITY_OPTIONS = ACTIVITY_LEVELS.map((level) => ({
  value: level,
  label: ACTIVITY_LEVEL_LABELS[level],
}));

const MACRO_ROWS = [
  { key: 'calories', label: 'Calories', unit: 'kcal', color: 'var(--color-calories)' },
  { key: 'protein', label: 'Protein', unit: 'g', color: 'var(--color-protein)' },
  { key: 'carbs', label: 'Carbs', unit: 'g', color: 'var(--color-carbs)' },
  { key: 'fat', label: 'Fat', unit: 'g', color: 'var(--color-fat)' },
] as const;

function joinWords(words: readonly string[]): string {
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words.join('');
}

export interface AdaptiveView {
  value: number;
  kcal: string;
  summary: string;
  inUse: boolean;
}

@Component({
  selector: 'app-profile-section',
  imports: [
    SettingsSection,
    FormField,
    DecimalField,
    ChoiceField,
    StepperField,
    FieldError,
    Icon,
    RouterLink,
  ],
  templateUrl: './profile-section.html',
})
export class ProfileSection {
  readonly form = input.required<FieldTree<ProfileFormModel>>();
  readonly preview = input.required<TargetsResult>();
  readonly adaptive = input<AdaptiveTdeeDto | null>(null);

  private readonly injector = inject(Injector);
  private readonly useFormulaButton =
    viewChild.required<ElementRef<HTMLButtonElement>>('useFormulaButton');

  protected readonly sexOptions = SEX_OPTIONS;
  protected readonly goalOptions = GOAL_OPTIONS;
  protected readonly activityOptions = ACTIVITY_OPTIONS;
  protected readonly macroRows = MACRO_ROWS;
  protected readonly onboardingLink = ONBOARDING_PATH;

  private readonly input = computed(() => previewInput(this.form()().value()));

  protected readonly trainingDays = computed(() => this.form().trainingDaysPerWeek().value());
  protected readonly missingHint = computed(() => {
    if (this.preview().complete) {
      return '';
    }
    const missing = missingProfileFields(this.input());
    return missing.length > 0 ? `Add your ${joinWords(missing)} for personal targets.` : '';
  });
  protected readonly bodyFatHint = computed(() => bodyFatHint(this.form().sex().value()));
  protected readonly burnOverridden = computed(() => this.form().tdeeOverride().value() !== null);
  protected readonly burnPlaceholder = computed(() => {
    const formula = formulaTdee(this.input());
    return formula === null ? '' : String(formula);
  });
  protected readonly burnHint = computed(() => burnExplanation(this.preview(), this.input()));
  protected readonly adaptiveView = computed<AdaptiveView | null>(() => {
    const adaptive = this.adaptive();
    if (!adaptive) {
      return null;
    }
    return {
      value: adaptive.kcal,
      kcal: formatNumber(adaptive.kcal),
      summary: adaptiveSummary(adaptive),
      inUse: this.form().tdeeOverride().value() === adaptive.kcal,
    };
  });
  protected readonly columns = computed(() => previewColumns(this.preview(), this.trainingDays()));
  protected readonly trainingHint = computed(() => {
    const preview = this.preview();
    return trainingDaysExplanation(
      this.trainingDays(),
      preview.trainingDeltaKcal,
      preview.restDeltaKcal,
    );
  });
  protected readonly energyStats = computed(() => {
    const preview = this.preview();
    return [
      { label: 'BMR', value: preview.bmr, hint: 'kcal at rest' },
      {
        label: 'Burn',
        value: preview.tdee,
        hint: preview.tdeeSource === 'override' ? 'your value' : 'kcal per day',
      },
      { label: 'Target', value: preview.base.calories, hint: 'kcal per day' },
    ].map((stat) => ({ ...stat, text: stat.value === null ? '—' : formatNumber(stat.value) }));
  });

  protected format(value: number): string {
    return formatNumber(value);
  }

  protected useFormula(): void {
    const field = this.form().tdeeOverride;
    field().value.set(null);
    field().focusBoundControl();
  }

  protected useMeasured(kcal: number): void {
    const field = this.form().tdeeOverride;
    field().value.set(kcal);
    field().markAsTouched();
    afterNextRender(() => this.useFormulaButton().nativeElement.focus(), {
      injector: this.injector,
    });
  }
}
