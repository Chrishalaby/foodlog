import { Component, computed, input, output } from '@angular/core';
import { MAX_ITEM_GRAMS, NUTRIENT_META, type NutrientKey } from '@food/shared';
import { Icon, type IconName } from '../../shared/ui/icon';
import { NUTRIENT_COLORS } from '../../shared/ui/nutrient-colors';
import { NumberInput } from '../../shared/ui/number-input';
import { Spinner } from '../../shared/ui/spinner';
import { formatNumber, formatNutrientValue } from '../../shared/utils/format';
import { analyzingProgress, analyzingStage } from '../log/log-helpers';
import { BlobImage } from './blob-image';
import {
  canStepDown,
  optionGrams,
  optionNutrients,
  portionLabel,
  stepPortion,
  type CompareOption,
  type OptionPortion,
  type OptionSource,
} from './compare-model';
import type { RankReason, RankedOption, ReasonTone } from './compare-ranking';
import { slotLabel, type CompareSlot } from './compare.store';

interface NutrientCell {
  key: NutrientKey;
  label: string;
  value: string;
  unit: string;
  color: string;
}

const SOURCE_ICONS: Record<OptionSource, IconName> = {
  library: 'utensils',
  barcode: 'barcode',
  text: 'text',
  food_photo: 'camera',
  nutrition_label: 'label',
  menu: 'utensils',
};

const REASON_ICONS: Record<ReasonTone, IconName> = {
  good: 'check',
  warn: 'alert',
  bad: 'alert',
  neutral: 'info',
};

const REASON_TONES: Record<ReasonTone, string> = {
  good: 'text-ok',
  warn: 'text-warn',
  bad: 'text-danger',
  neutral: 'text-muted',
};

const MACROS = ['protein', 'carbs', 'fat'] as const satisfies readonly NutrientKey[];
const EXTRAS = ['fiber', 'satFat', 'sodium', 'sugar'] as const satisfies readonly NutrientKey[];
const SHORT_LABELS: Partial<Record<NutrientKey, string>> = { satFat: 'Sat fat' };

function cell(key: NutrientKey, value: number): NutrientCell {
  return {
    key,
    label: SHORT_LABELS[key] ?? NUTRIENT_META[key].label,
    value: formatNutrientValue(key, value),
    unit: NUTRIENT_META[key].unit,
    color: NUTRIENT_COLORS[key],
  };
}

@Component({
  selector: 'app-compare-option',
  imports: [BlobImage, Icon, NumberInput, Spinner],
  host: { class: 'block scroll-mt-24', '[attr.id]': "'compare-' + slot().id" },
  templateUrl: './option-card.html',
})
export class OptionCard {
  readonly slot = input.required<CompareSlot>();
  readonly ranked = input<RankedOption | null>(null);
  readonly winnerLabel = input<string | null>(null);
  readonly now = input(0);
  readonly logging = input(false);
  readonly locked = input(false);
  readonly removed = output<void>();
  readonly retried = output<void>();
  readonly logRequested = output<void>();
  readonly portionChange = output<OptionPortion>();
  readonly labelScan = output<void>();

  protected readonly maxGrams = MAX_ITEM_GRAMS;
  protected readonly toneClass = REASON_TONES;
  protected readonly toneIcon = REASON_ICONS;
  protected readonly titleId = computed(() => `compare-title-${this.slot().id}`);

  protected readonly option = computed<CompareOption | null>(() => {
    const slot = this.slot();
    return slot.status === 'ready' ? slot.option : null;
  });
  protected readonly job = computed(() => {
    const slot = this.slot();
    return slot.status === 'ready' ? null : slot.job;
  });
  protected readonly image = computed(() => {
    const job = this.job();
    return job?.kind === 'analyze' ? job.image : null;
  });
  protected readonly label = computed(() => {
    const job = this.job();
    return job ? slotLabel(job) : '';
  });
  protected readonly failure = computed(() => {
    const slot = this.slot();
    return slot.status === 'failed' ? slot.failure : null;
  });
  protected readonly seconds = computed(() => {
    const slot = this.slot();
    return slot.status === 'loading'
      ? Math.max(0, Math.floor((this.now() - slot.startedAt) / 1000))
      : 0;
  });
  protected readonly stage = computed(() => {
    const job = this.job();
    if (!job) {
      return '';
    }
    return job.kind === 'barcode'
      ? 'Looking up the barcode…'
      : analyzingStage(this.seconds(), job.mode, 'initial');
  });
  protected readonly progress = computed(() => {
    const job = this.job();
    return job?.kind === 'analyze' ? analyzingProgress(this.seconds()) : null;
  });
  protected readonly icon = computed<IconName>(() => {
    const option = this.option();
    if (option) {
      return option.badge === 'Favorite' ? 'star-filled' : SOURCE_ICONS[option.source];
    }
    const job = this.job();
    if (!job || job.kind === 'barcode') {
      return 'barcode';
    }
    return SOURCE_ICONS[job.mode];
  });
  protected readonly nutrients = computed(() => {
    const option = this.option();
    return option ? optionNutrients(option) : null;
  });
  protected readonly kcal = computed(() =>
    formatNutrientValue('calories', this.nutrients()?.calories ?? 0),
  );
  protected readonly macros = computed(() => {
    const nutrients = this.nutrients();
    return nutrients ? MACROS.map((key) => cell(key, nutrients[key])) : [];
  });
  protected readonly extras = computed(() => {
    const nutrients = this.nutrients();
    return nutrients ? EXTRAS.map((key) => cell(key, nutrients[key])) : [];
  });
  protected readonly portion = computed(() => this.option()?.portion ?? null);
  protected readonly portionText = computed(() => {
    const portion = this.portion();
    return portion ? portionLabel(portion, this.option()?.base.portion ?? null) : '';
  });
  protected readonly gramsHint = computed(() => {
    const option = this.option();
    if (!option || option.portion.mode === 'grams' || option.base.grams <= 0) {
      return null;
    }
    return `≈ ${formatNumber(optionGrams(option))} g`;
  });
  protected readonly canDecrease = computed(() => {
    const portion = this.portion();
    return portion ? canStepDown(portion) : false;
  });
  protected readonly logged = computed(() => this.option()?.loggedEntryId != null);
  protected readonly best = computed(() => this.ranked()?.best === true);
  protected readonly reasons = computed<readonly RankReason[]>(() => this.ranked()?.reasons ?? []);
  protected readonly name = computed(() => this.option()?.name ?? this.label());

  protected step(direction: 1 | -1): void {
    const portion = this.portion();
    if (portion) {
      this.portionChange.emit(stepPortion(portion, direction));
    }
  }

  protected setGrams(grams: number): void {
    const portion = this.portion();
    if (portion?.mode === 'grams' && grams >= 1 && grams !== portion.grams) {
      this.portionChange.emit({ mode: 'grams', grams });
    }
  }
}
