import { Component, computed, input } from '@angular/core';
import type { BodyMetricsDto } from '@food/shared';
import {
  BMI_BANDS,
  BMI_EXPLANATION,
  BMI_SCALE_MAX,
  BMI_SCALE_MIN,
  BMI_TONES,
  FFMI_EXPLANATION,
  FFMI_TONES,
  LEAN_MASS_EXPLANATION,
  TONE_CHIP_CLASSES,
  bmiLabel,
  ffmiLabel,
  oneDecimal,
  scalePercent,
} from '../body-metrics';

const BAND_CLASSES = {
  underweight: 'bg-fat/70',
  normal: 'bg-ok/80',
  overweight: 'bg-warn/80',
  obese: 'bg-danger/70',
} as const;

interface BmiView {
  value: string;
  label: string;
  chipClass: string;
  marker: number;
}

interface CompositionView {
  lean: string;
  fat: string;
  ffmi: string;
  normalized: string;
  label: string | null;
  chipClass: string;
}

@Component({
  selector: 'app-body-metrics-view',
  host: { class: 'flex flex-col gap-3' },
  template: `
    @if (bmi(); as view) {
      <div class="rounded-2xl bg-surface-2/60 p-3.5">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-xs font-medium text-muted">BMI</p>
            <p class="text-2xl leading-8 font-bold text-fg tabular-nums">{{ view.value }}</p>
          </div>
          <span class="chip" [class]="view.chipClass">{{ view.label }}</span>
        </div>
        <div class="relative mt-3" aria-hidden="true">
          <div class="flex h-2 gap-0.5 overflow-hidden rounded-full">
            @for (band of bands; track band.category) {
              <span [class]="band.className" [style.flex-grow]="band.width"></span>
            }
          </div>
          <span
            class="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg bg-fg shadow-soft"
            [style.left.%]="view.marker"
          ></span>
        </div>
        <div class="relative mt-1.5 h-3.5 text-[10px] text-muted tabular-nums" aria-hidden="true">
          @for (tick of ticks; track tick.label) {
            <span class="absolute -translate-x-1/2" [style.left.%]="tick.left">{{
              tick.label
            }}</span>
          }
        </div>
        <p class="mt-2 text-xs leading-relaxed text-muted">{{ bmiExplanation }}</p>
      </div>
    } @else {
      <p class="rounded-2xl bg-surface-2/60 px-3.5 py-3 text-sm leading-snug text-muted">
        {{ missingBmiText() }}
      </p>
    }

    @if (composition(); as view) {
      <div class="rounded-2xl bg-surface-2/60 p-3.5">
        <dl class="grid grid-cols-3 gap-2 text-center">
          <div>
            <dt class="text-[11px] font-medium text-muted">Lean mass</dt>
            <dd class="text-lg leading-6 font-bold text-fg tabular-nums">{{ view.lean }}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-medium text-muted">Fat mass</dt>
            <dd class="text-lg leading-6 font-bold text-fg tabular-nums">{{ view.fat }}</dd>
          </div>
          <div>
            <dt class="text-[11px] font-medium text-muted">FFMI</dt>
            <dd class="text-lg leading-6 font-bold text-fg tabular-nums">{{ view.ffmi }}</dd>
          </div>
        </dl>
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm text-fg tabular-nums">
            Normalized FFMI <span class="font-semibold">{{ view.normalized }}</span>
          </p>
          @if (view.label) {
            <span class="chip" [class]="view.chipClass">{{ view.label }}</span>
          }
        </div>
        <p class="mt-2 text-xs leading-relaxed text-muted">{{ leanExplanation }}</p>
        <p class="mt-1 text-xs leading-relaxed text-muted">{{ ffmiExplanation }}</p>
      </div>
    } @else if (bmi()) {
      <p class="rounded-2xl bg-surface-2/60 px-3.5 py-3 text-sm leading-snug text-muted">
        {{ missingBodyFatText() }}
      </p>
    }
  `,
})
export class BodyMetricsView {
  readonly metrics = input.required<BodyMetricsDto>();
  readonly missingBmiText = input('Add your height and weight to see your BMI.');
  readonly missingBodyFatText = input('Add your body fat % to see lean mass and FFMI.');

  protected readonly bmiExplanation = BMI_EXPLANATION;
  protected readonly leanExplanation = LEAN_MASS_EXPLANATION;
  protected readonly ffmiExplanation = FFMI_EXPLANATION;
  protected readonly bands = BMI_BANDS.map((band) => ({
    category: band.category,
    className: BAND_CLASSES[band.category],
    width: band.to - band.from,
  }));
  protected readonly ticks = BMI_BANDS.slice(1).map((band) => ({
    label: String(band.from),
    left: scalePercent(band.from, BMI_SCALE_MIN, BMI_SCALE_MAX),
  }));

  protected readonly bmi = computed<BmiView | null>(() => {
    const { bmi, bmiCategory } = this.metrics();
    if (bmi === null || bmiCategory === null) {
      return null;
    }
    return {
      value: oneDecimal(bmi),
      label: bmiLabel(bmiCategory),
      chipClass: TONE_CHIP_CLASSES[BMI_TONES[bmiCategory]],
      marker: scalePercent(bmi),
    };
  });

  protected readonly composition = computed<CompositionView | null>(() => {
    const m = this.metrics();
    if (m.leanMassKg === null || m.fatMassKg === null || m.ffmi === null) {
      return null;
    }
    return {
      lean: `${oneDecimal(m.leanMassKg)} kg`,
      fat: `${oneDecimal(m.fatMassKg)} kg`,
      ffmi: oneDecimal(m.ffmi),
      normalized: m.ffmiNormalized === null ? '—' : oneDecimal(m.ffmiNormalized),
      label: m.ffmiCategory ? ffmiLabel(m.ffmiCategory) : null,
      chipClass: m.ffmiCategory ? TONE_CHIP_CLASSES[FFMI_TONES[m.ffmiCategory]] : '',
    };
  });
}
