import {
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  model,
  output,
  signal,
} from '@angular/core';
import {
  API_LIMITS,
  MAX_ITEM_GRAMS,
  NUTRIENT_META,
  isFiniteNumber,
  roundTo,
  type Micros,
  type MyFoodDto,
  type NutrientKey,
  type Nutrients,
  type ProductSource,
  type SaveMyFoodRequest,
} from '@food/shared';
import { errorMessage } from '../../../core/errors';
import { MyFoodsStore } from '../../../core/my-foods.store';
import { ToastService } from '../../../core/toast.service';
import { formatNutrientValue } from '../../utils/format';
import { cleanMicrosPer100 } from '../../utils/micros';
import { BottomSheet } from '../bottom-sheet';
import { Icon } from '../icon';
import { NumberInput } from '../number-input';
import { Spinner } from '../spinner';

export interface SaveMyFoodSeed {
  id: number;
  name: string;
  brand: string | null;
  basisUnit: 'g' | 'ml';
  per100: Nutrients;
  microsPer100: Micros | null;
  unitName: string | null;
  unitGrams: number | null;
  servingSizeG: number | null;
  source: ProductSource;
}

export const SAVE_MY_FOOD_FAILED = 'Could not save this food.';
export const UNIT_INCOMPLETE = 'Give the unit a name and its weight, or leave both empty.';
export const UNIT_NAME_MAX = 40;

const VALUE_KEYS: readonly NutrientKey[] = ['calories', 'protein', 'carbs', 'fat'];

let nextSaveId = 0;

function cleanText(text: string, max: number): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

export function saveMyFoodRequest(
  seed: SaveMyFoodSeed,
  name: string,
  brand: string,
  unitName: string,
  unitGrams: number,
): SaveMyFoodRequest | null {
  const cleanName = cleanText(name, API_LIMITS.nameMax);
  const unit = cleanText(unitName, UNIT_NAME_MAX);
  const grams = isFiniteNumber(unitGrams) && unitGrams > 0 ? roundTo(unitGrams, 1) : 0;
  if (!cleanName || (unit === '') !== (grams === 0)) {
    return null;
  }
  const cleanBrand = cleanText(brand, API_LIMITS.nameMax);
  const microsPer100 = cleanMicrosPer100(seed.microsPer100);
  return {
    name: cleanName,
    brand: cleanBrand || null,
    basisUnit: seed.basisUnit,
    per100: seed.per100,
    ...(microsPer100 ? { microsPer100 } : {}),
    unitName: unit || null,
    unitGrams: grams || null,
    servingSizeG: seed.servingSizeG,
    source: seed.source,
  };
}

@Component({
  selector: 'app-save-my-food-sheet',
  imports: [BottomSheet, Icon, NumberInput, Spinner],
  template: `
    <app-bottom-sheet [(open)]="open" title="Save as my food">
      @if (seed(); as current) {
        <form class="flex flex-col gap-4" novalidate (submit)="save($event)">
          <p class="text-sm leading-snug text-muted">
            Next time you log it, it gets exactly these values.
          </p>
          <div>
            <label class="label" [for]="ids.name">Name</label>
            <input
              type="text"
              class="input font-semibold"
              autocomplete="off"
              autocapitalize="sentences"
              enterkeyhint="next"
              [id]="ids.name"
              [attr.maxlength]="nameMax"
              [attr.aria-invalid]="submitted() && !name().trim() ? true : null"
              [value]="name()"
              (input)="name.set(textOf($event))"
            />
          </div>
          <div>
            <label class="label" [for]="ids.brand">Brand (optional)</label>
            <input
              type="text"
              class="input"
              autocomplete="off"
              autocapitalize="words"
              enterkeyhint="done"
              placeholder="e.g. Heinz"
              [id]="ids.brand"
              [attr.maxlength]="nameMax"
              [value]="brand()"
              (input)="brand.set(textOf($event))"
            />
          </div>
          <div class="rounded-2xl bg-surface-2 p-3">
            <h3 class="text-sm font-semibold text-fg">Per 100 {{ current.basisUnit }}</h3>
            <dl class="mt-2 grid grid-cols-4 gap-2 text-center">
              @for (row of rows(); track row.key) {
                <div class="min-w-0">
                  <dt class="truncate text-[11px] text-muted">{{ row.label }}</dt>
                  <dd class="truncate font-semibold text-fg tabular-nums">
                    {{ row.value }}&ngsp;<span class="text-[11px] font-medium text-muted">{{
                      row.unit
                    }}</span>
                  </dd>
                </div>
              }
            </dl>
            <p class="mt-2 text-xs leading-snug text-muted">
              {{ sourceNote() }} You can change them later in Settings → My foods.
            </p>
          </div>
          <div>
            <span class="label" [id]="ids.unit">Handy unit (optional)</span>
            <div
              class="flex flex-wrap items-center gap-2"
              role="group"
              [attr.aria-labelledby]="ids.unit"
            >
              <span class="text-sm font-semibold text-muted">1</span>
              <input
                type="text"
                class="input w-28 min-w-0 flex-1"
                autocomplete="off"
                enterkeyhint="done"
                placeholder="tbsp"
                aria-label="Unit name"
                [attr.maxlength]="unitMax"
                [attr.aria-invalid]="unitProblem() ? true : null"
                [value]="unitName()"
                (input)="unitName.set(textOf($event))"
              />
              <span class="text-sm font-semibold text-muted">=</span>
              <div class="relative w-24">
                <app-number-input
                  inputClass="input pr-7 text-right tabular-nums"
                  ariaLabel="Grams in one unit"
                  [value]="unitGrams()"
                  [decimals]="1"
                  [max]="maxGrams"
                  (valueChange)="unitGrams.set($event)"
                />
                <span
                  class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted"
                  >g</span
                >
              </div>
            </div>
          </div>
          @if (message(); as text) {
            <p class="text-sm text-danger" role="alert">{{ text }}</p>
          }
          <button type="submit" class="btn btn-primary min-h-12 w-full" [disabled]="saving()">
            @if (saving()) {
              <app-spinner [size]="18" label="Saving" />
            } @else {
              <app-icon name="check" [size]="18" [strokeWidth]="2.5" />
            }
            Save to My foods
          </button>
        </form>
      }
    </app-bottom-sheet>
  `,
})
export class SaveMyFoodSheet {
  private readonly store = inject(MyFoodsStore);
  private readonly toast = inject(ToastService);

  readonly seed = input<SaveMyFoodSeed | null>(null);
  readonly open = model(false);
  readonly saved = output<MyFoodDto>();

  private readonly prefix = `save-my-food-${nextSaveId++}`;
  protected readonly ids = {
    name: `${this.prefix}-name`,
    brand: `${this.prefix}-brand`,
    unit: `${this.prefix}-unit`,
  };
  protected readonly nameMax = API_LIMITS.nameMax;
  protected readonly unitMax = UNIT_NAME_MAX;
  protected readonly maxGrams = MAX_ITEM_GRAMS;
  protected readonly name = linkedSignal(() => this.seed()?.name ?? '');
  protected readonly brand = linkedSignal(() => this.seed()?.brand ?? '');
  protected readonly unitName = linkedSignal(() => this.seed()?.unitName ?? '');
  protected readonly unitGrams = linkedSignal(() => this.seed()?.unitGrams ?? 0);
  protected readonly submitted = linkedSignal(() => {
    this.seed();
    return false;
  });
  protected readonly failure = linkedSignal<string | null>(() => {
    this.seed();
    return null;
  });
  protected readonly saving = signal(false);
  protected readonly rows = computed(() => {
    const per100 = this.seed()?.per100;
    return VALUE_KEYS.map((key) => ({
      key,
      label: NUTRIENT_META[key].label,
      unit: key === 'calories' ? 'kcal' : NUTRIENT_META[key].unit,
      value: per100 ? formatNutrientValue(key, per100[key]) : '0',
    }));
  });
  protected readonly sourceNote = computed(() =>
    this.seed()?.source === 'label' ? 'From the label.' : 'From this item.',
  );
  protected readonly unitProblem = computed(() => {
    const unit = this.unitName().trim();
    const grams = this.unitGrams() > 0;
    return this.submitted() && (unit === '') !== !grams;
  });
  protected readonly message = computed(() => {
    const failure = this.failure();
    if (failure) {
      return failure;
    }
    if (!this.submitted()) {
      return null;
    }
    if (!this.name().trim()) {
      return 'Give this food a name.';
    }
    return this.unitProblem() ? UNIT_INCOMPLETE : null;
  });

  protected textOf(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    const seed = this.seed();
    this.submitted.set(true);
    if (!seed || this.saving()) {
      return;
    }
    const body = saveMyFoodRequest(
      seed,
      this.name(),
      this.brand(),
      this.unitName(),
      this.unitGrams(),
    );
    if (!body) {
      return;
    }
    this.saving.set(true);
    this.failure.set(null);
    try {
      const food = await this.store.create(body);
      this.toast.success(`Saved “${food.name}” to My foods`);
      this.saved.emit(food);
      this.open.set(false);
    } catch (err) {
      this.failure.set(errorMessage(err, SAVE_MY_FOOD_FAILED));
    } finally {
      this.saving.set(false);
    }
  }
}
