import {
  Component,
  DOCUMENT,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormField, type FieldTree } from '@angular/forms/signals';
import { TARGET_META, type TargetKey } from '@food/shared';
import { Icon } from '../../../shared/ui/icon';
import { formatNumber } from '../../../shared/utils/format';
import { DecimalField } from '../../settings/controls/decimal-field';
import { FieldError } from '../../settings/controls/field-error';
import { type ProfileFormModel, burnExplanation, previewInput } from '../../settings/profile-model';
import { BodyMetricsView } from '../../settings/sections/body-metrics-view';
import { numbersSummary } from '../onboarding-math';

const MACROS = [
  { key: 'calories', color: 'var(--color-calories)' },
  { key: 'protein', color: 'var(--color-protein)' },
  { key: 'carbs', color: 'var(--color-carbs)' },
  { key: 'fat', color: 'var(--color-fat)' },
] as const satisfies readonly { key: TargetKey; color: string }[];

const LIMITS = [
  { key: 'fiberMin', label: 'Fiber', kind: 'minimum' },
  { key: 'satFatMax', label: 'Sat. fat', kind: 'limit' },
  { key: 'sodiumMax', label: 'Sodium', kind: 'limit' },
] as const satisfies readonly { key: TargetKey; label: string; kind: string }[];

export const BURN_INPUT_ID = 'ob-tdee';
export const BURN_EDIT_ID = 'ob-tdee-edit';

@Component({
  selector: 'app-numbers-step',
  imports: [FormField, DecimalField, FieldError, Icon, BodyMetricsView],
  templateUrl: './numbers-step.html',
  host: { class: 'flex flex-col gap-4' },
})
export class NumbersStep {
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  readonly form = input.required<FieldTree<ProfileFormModel>>();
  readonly editAbout = output<void>();

  protected readonly burnInputId = BURN_INPUT_ID;
  protected readonly burnEditId = BURN_EDIT_ID;
  protected readonly editingBurn = signal(false);
  protected readonly input = computed(() => previewInput(this.form()().value()));
  protected readonly summary = computed(() => numbersSummary(this.input()));
  protected readonly showBurnEditor = computed(() => {
    const field = this.form().tdeeOverride();
    return this.editingBurn() || field.value() !== null || field.invalid();
  });

  protected readonly calories = computed(() => formatNumber(this.summary().targets.base.calories));
  protected readonly heroMacros = computed(() => {
    const base = this.summary().targets.base;
    return MACROS.slice(1).map((macro) => ({
      key: macro.key,
      label: TARGET_META[macro.key].label,
      color: macro.color,
      text: formatNumber(base[macro.key]),
    }));
  });
  protected readonly cycleNote = computed(() => {
    const { targets } = this.summary();
    const days = this.input().trainingDaysPerWeek;
    if (targets.trainingDeltaKcal === 0 && targets.restDeltaKcal === 0) {
      return '';
    }
    const training = `${formatNumber(targets.trainingDay.calories)} kcal`;
    if (days === 0) {
      return `Days you mark as training days get ${training}.`;
    }
    return `Training days ${training}, rest days ${formatNumber(targets.restDay.calories)} kcal.`;
  });
  protected readonly energy = computed(() => {
    const summary = this.summary();
    const { bmr, tdee } = summary.targets;
    return {
      bmr: bmr === null ? '—' : formatNumber(bmr),
      bmrHint: summary.formulaLabel ?? 'Needs your details',
      tdee: tdee === null ? '—' : formatNumber(tdee),
      tdeeHint: summary.burnSource === 'override' ? 'Your value' : 'Estimated',
      explanation: burnExplanation(summary.targets, this.input()),
      placeholder: summary.formulaTdee === null ? '' : String(summary.formulaTdee),
    };
  });
  protected readonly rows = computed(() => {
    const { auto } = this.summary();
    const overrides = this.form().overrides().value();
    return MACROS.map((macro) => ({
      key: macro.key,
      color: macro.color,
      label: TARGET_META[macro.key].label,
      unit: TARGET_META[macro.key].unit,
      autoText: formatNumber(auto[macro.key]),
      placeholder: String(Math.round(auto[macro.key])),
      overridden: overrides[macro.key] !== null,
    }));
  });
  protected readonly limits = computed(() => {
    const base = this.summary().targets.base;
    return LIMITS.map((limit) => ({
      key: limit.key,
      label: limit.label,
      kind: limit.kind,
      unit: TARGET_META[limit.key].unit,
      text: formatNumber(base[limit.key]),
    }));
  });

  protected editBurn(): void {
    this.editingBurn.set(true);
    this.focusAfterRender(BURN_INPUT_ID);
  }

  protected useFormula(): void {
    this.form().tdeeOverride().value.set(null);
    this.editingBurn.set(false);
    this.focusAfterRender(BURN_EDIT_ID);
  }

  protected useAuto(key: TargetKey): void {
    const field = this.form().overrides[key];
    field().value.set(null);
    field().focusBoundControl();
  }

  private focusAfterRender(id: string): void {
    afterNextRender(() => this.document.getElementById(id)?.focus(), {
      injector: this.injector,
    });
  }
}
