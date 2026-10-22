import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import {
  MAX_ITEM_GRAMS,
  MICRO_KEYS,
  MICRO_META,
  guessMealType,
  type LogProductRequest,
  type MealType,
  type ProductDto,
} from '@food/shared';
import { Icon } from '../../../shared/ui/icon';
import { formatMicroAmount } from '../../../shared/ui/micros/micros-model';
import { portionFactorLabel, stepGrams } from '../../../shared/ui/items-editor/items-math';
import { NUTRIENT_COLORS } from '../../../shared/ui/nutrient-colors';
import { NumberInput } from '../../../shared/ui/number-input';
import { Spinner } from '../../../shared/ui/spinner';
import { formatList, formatNumber, formatNutrientValue } from '../../../shared/utils/format';
import { cleanMicrosPer100 } from '../../../shared/utils/micros';
import { currentDateTimeInput, mealTypeAt, timingFromInput } from '../entry-timing';
import { MealTypePicker } from '../meal-type-picker';
import { AfterMidnightNote } from '../after-midnight-note';
import { formatBarcode } from './gs1';
import { missingNutrientNames, per100Fields } from './product-form';
import {
  PRODUCT_GRAMS_MIN,
  PRODUCT_SERVINGS_MIN,
  chipSelected,
  clampProductGrams,
  defaultProductPortion,
  isValidProductPortion,
  logProductBody,
  maxProductServings,
  portionChips,
  portionGrams,
  portionServings,
  productDisplayName,
  productTotals,
  packSizeOf,
  servingSizeOf,
  stepProductServings,
  type ProductPortion,
} from './product-portion';

const MACROS = [
  { key: 'protein', short: 'P', label: 'Protein' },
  { key: 'carbs', short: 'C', label: 'Carbs' },
  { key: 'fat', short: 'F', label: 'Fat' },
] as const;

let nextDetailsId = 0;

@Component({
  selector: 'app-product-details',
  imports: [AfterMidnightNote, Icon, MealTypePicker, NumberInput, Spinner],
  host: { class: 'block' },
  templateUrl: './product-details.html',
})
export class ProductDetails {
  readonly product = input.required<ProductDto>();
  readonly barcode = input.required<string>();
  readonly busy = input(false);
  readonly logged = output<LogProductRequest>();
  readonly editValues = output<void>();
  readonly scanAgain = output<void>();
  readonly closed = output<void>();

  protected readonly ids = {
    title: `product-${nextDetailsId}-title`,
    amount: `product-${nextDetailsId}-amount`,
    grams: `product-${nextDetailsId}-grams`,
    meal: `product-${nextDetailsId}-meal`,
    time: `product-${nextDetailsId++}-time`,
  };
  protected readonly maxGrams = MAX_ITEM_GRAMS;
  protected readonly minGrams = PRODUCT_GRAMS_MIN;
  protected readonly macros = MACROS.map((macro) => ({
    ...macro,
    color: NUTRIENT_COLORS[macro.key],
  }));

  protected readonly portion = linkedSignal<ProductPortion>(() =>
    defaultProductPortion(this.product()),
  );
  protected readonly mealType = linkedSignal<MealType>(() => {
    this.product();
    return guessMealType(new Date());
  });
  protected readonly mealTypeAuto = linkedSignal(() => {
    this.product();
    return true;
  });
  protected readonly dateTime = linkedSignal(() => {
    this.product();
    return currentDateTimeInput();
  });
  protected readonly showFacts = signal(false);
  protected readonly imageFailed = linkedSignal(() => {
    this.product();
    return false;
  });

  protected readonly name = computed(() => productDisplayName(this.product()));
  protected readonly unit = computed(() => this.product().basisUnit);
  protected readonly ours = computed(() => this.product().source !== 'openfoodfacts');
  protected readonly missing = computed(() => {
    const names = missingNutrientNames(this.product().missingNutrients);
    if (names.length === 0) {
      return null;
    }
    const list = formatList(names);
    return {
      title: this.ours() ? `Missing ${list}` : `Open Food Facts is missing ${list}`,
      detail: `Counted as 0. Check the label to fill ${names.length === 1 ? 'it' : 'them'} in.`,
    };
  });
  protected readonly imageUrl = computed(() => {
    const url = this.product().imageUrl;
    return url && url.startsWith('https://') && !this.imageFailed() ? url : null;
  });
  protected readonly meta = computed(() => {
    const brand = this.product().brand?.trim();
    const code = formatBarcode(this.barcode());
    return brand && !this.name().toLowerCase().startsWith(brand.toLowerCase())
      ? `${brand} · ${code}`
      : code;
  });
  protected readonly grams = computed(() => portionGrams(this.product(), this.portion()));
  protected readonly totals = computed(() => productTotals(this.product(), this.grams()));
  protected readonly kcal = computed(() => formatNutrientValue('calories', this.totals().calories));
  protected readonly per100Summary = computed(() => {
    const per100 = this.product().per100;
    return [
      `${formatNutrientValue('calories', per100.calories)} kcal`,
      `P ${formatNutrientValue('protein', per100.protein)}`,
      `C ${formatNutrientValue('carbs', per100.carbs)}`,
      `F ${formatNutrientValue('fat', per100.fat)}`,
    ].join(' · ');
  });
  protected readonly facts = computed(() => {
    const product = this.product();
    const totals = this.totals();
    return per100Fields(product.basisUnit)
      .filter((field) => field.key !== 'alcohol' || product.per100.alcohol > 0)
      .map((field) => ({
        ...field,
        per100: formatNutrientValue(field.key, product.per100[field.key]),
        portion: formatNutrientValue(field.key, totals[field.key]),
      }));
  });
  protected readonly microFacts = computed(() => {
    const per100 = cleanMicrosPer100(this.product().microsPer100);
    const grams = this.grams();
    return MICRO_KEYS.flatMap((key) => {
      const value = per100?.[key];
      return value === undefined
        ? []
        : [
            {
              key,
              label: MICRO_META[key].label,
              per100: formatMicroAmount(key, value),
              portion: formatMicroAmount(key, (value * grams) / 100),
            },
          ];
    });
  });
  protected readonly sizes = computed(() => {
    const product = this.product();
    const unit = product.basisUnit;
    const serving = servingSizeOf(product);
    const pack = packSizeOf(product);
    return [
      serving !== null ? `Serving ${formatNumber(serving, 1)} ${unit}` : null,
      pack !== null ? `Pack ${formatNumber(pack, 1)} ${unit}` : null,
    ].filter((part): part is string => part !== null);
  });
  protected readonly chips = computed(() => {
    const grams = this.grams();
    return portionChips(this.product()).map((chip) => ({
      ...chip,
      detail: chip.id === 'hundred' ? null : `${formatNumber(chip.grams, 0)} ${this.unit()}`,
      selected: chipSelected(chip, grams),
    }));
  });
  protected readonly servingLabel = computed(() => {
    const serving = servingSizeOf(this.product());
    return serving === null ? null : `${formatNumber(serving, 1)} ${this.unit()}`;
  });
  protected readonly servingsText = computed(() =>
    portionFactorLabel(portionServings(this.product(), this.portion())),
  );
  protected readonly servingsUnit = computed(() =>
    Math.abs(portionServings(this.product(), this.portion()) - 1) < 1e-6 ? 'serving' : 'servings',
  );
  protected readonly timing = computed(() => timingFromInput(this.dateTime()));
  protected readonly portionValid = computed(() => isValidProductPortion(this.portion()));
  protected readonly canLog = computed(
    () => this.portionValid() && this.timing() !== null && !this.busy(),
  );

  protected macroValue(key: 'protein' | 'carbs' | 'fat'): string {
    return formatNutrientValue(key, this.totals()[key]);
  }

  protected setGrams(grams: number): void {
    this.portion.set({ mode: 'grams', grams });
  }

  protected pickChip(grams: number): void {
    this.portion.set({ mode: 'grams', grams });
  }

  protected stepGramsBy(direction: 1 | -1): void {
    this.portion.set({
      mode: 'grams',
      grams: clampProductGrams(stepGrams(this.grams(), direction)),
    });
  }

  protected canStepGrams(direction: 1 | -1): boolean {
    const grams = this.grams();
    return direction > 0 ? grams < MAX_ITEM_GRAMS : grams > PRODUCT_GRAMS_MIN;
  }

  protected stepServings(direction: 1 | -1): void {
    const product = this.product();
    const servings = Math.min(
      stepProductServings(portionServings(product, this.portion()), direction),
      maxProductServings(product),
    );
    this.portion.set({ mode: 'servings', servings });
  }

  protected canStepServings(direction: 1 | -1): boolean {
    const product = this.product();
    const servings = portionServings(product, this.portion());
    return direction > 0 ? servings < maxProductServings(product) : servings > PRODUCT_SERVINGS_MIN;
  }

  protected pickMealType(mealType: MealType): void {
    this.mealType.set(mealType);
    this.mealTypeAuto.set(false);
  }

  protected onDateTime(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.dateTime.set(value);
    const guess = this.mealTypeAuto() ? mealTypeAt(value) : null;
    if (guess) {
      this.mealType.set(guess);
    }
  }

  protected log(): void {
    const timing = this.timing();
    if (!timing || !this.canLog()) {
      return;
    }
    this.logged.emit(logProductBody(this.product(), this.portion(), this.mealType(), timing));
  }
}
