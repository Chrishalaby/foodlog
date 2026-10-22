import { Component, computed, input, model } from '@angular/core';
import { NUTRIENT_META, type NutrientKey, type Nutrients } from '@food/shared';
import { formatNumber, formatNutrientValue } from '../utils/format';
import { Icon } from './icon';
import { EXTRA_NUTRIENT_KEYS, MACRO_KEYS, NUTRIENT_COLORS } from './nutrient-colors';

const TILE_FONT_MAX_PX = 17;
const TILE_FONT_MIN_PX = 12;
const DIGIT_EM = 0.64;
const SEPARATOR_EM = 0.32;
const UNIT_RESERVE_PX: Record<string, number> = { g: 12, mg: 22 };
const COMPACT_FROM = 1000;

interface NutrientCell {
  key: NutrientKey;
  label: string;
  value: string;
  unit: string;
  color: string;
}

interface MacroTile extends NutrientCell {
  showUnit: boolean;
  reservePx: number;
}

function cell(key: NutrientKey, nutrients: Nutrients): NutrientCell {
  const meta = NUTRIENT_META[key];
  return {
    key,
    label: meta.label,
    value: formatNutrientValue(key, nutrients[key]),
    unit: meta.unit,
    color: NUTRIENT_COLORS[key],
  };
}

export function valueWidthEm(value: string): number {
  let width = 0;
  for (const char of value) {
    width += char === ',' || char === '.' ? SEPARATOR_EM : DIGIT_EM;
  }
  return Math.max(width, DIGIT_EM);
}

export function tileFitExpression(value: string, unitReservePx: number): string {
  const em = Math.round(valueWidthEm(value) * 100) / 100;
  return `calc((100cqi - ${unitReservePx}px) / ${em})`;
}

export function tileFontSize(tiles: readonly { value: string; reservePx: number }[]): string {
  const fits = tiles.map((t) => tileFitExpression(t.value, t.reservePx));
  const fit = fits.length > 0 ? `min(${fits.join(', ')})` : `${TILE_FONT_MAX_PX}px`;
  return `clamp(${TILE_FONT_MIN_PX}px, ${fit}, ${TILE_FONT_MAX_PX}px)`;
}

function tile(key: NutrientKey, nutrients: Nutrients): MacroTile {
  const base = cell(key, nutrients);
  const amount = nutrients[key];
  const value = amount >= COMPACT_FROM ? formatNumber(amount, 0) : base.value;
  const showUnit = key !== 'calories';
  const reservePx = showUnit ? (UNIT_RESERVE_PX[base.unit] ?? 0) : 0;
  return { ...base, value, showUnit, reservePx };
}

@Component({
  selector: 'app-macro-summary',
  imports: [Icon],
  host: { class: 'block @container' },
  template: `
    <div class="grid grid-cols-2 gap-2 @min-[18rem]:grid-cols-4">
      @for (item of macros(); track item.key) {
        <div class="@container min-w-0 rounded-2xl bg-surface-2 px-2 py-2">
          <div
            class="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 font-medium text-muted"
          >
            <span
              class="size-1.5 shrink-0 rounded-full @max-[3.5rem]:hidden"
              aria-hidden="true"
              [style.background-color]="item.color"
            ></span>
            <span class="truncate">{{ item.label }}</span>
          </div>
          <div
            class="mt-0.5 overflow-hidden text-[17px] leading-6 font-bold tracking-tight text-ellipsis whitespace-nowrap text-fg tabular-nums"
            [style.font-size]="valueFontSize()"
          >
            <span>{{ item.value }}</span>
            @if (item.showUnit) {
              <span class="ml-0.5 text-xs font-medium tracking-normal text-muted">{{
                item.unit
              }}</span>
            } @else {
              <span class="sr-only">&nbsp;{{ item.unit }}</span>
            }
          </div>
        </div>
      }
    </div>
    @if (collapsible()) {
      <button
        type="button"
        class="mt-1 flex min-h-11 w-full items-center justify-center gap-1 rounded-xl text-xs font-semibold text-muted transition hover:text-fg"
        [attr.aria-expanded]="expanded()"
        (click)="expanded.set(!expanded())"
      >
        {{ expanded() ? 'Fewer nutrients' : 'More nutrients' }}
        <app-icon
          name="chevron-down"
          [size]="16"
          class="transition-transform duration-200"
          [class.rotate-180]="expanded()"
        />
      </button>
    }
    @if (expanded()) {
      <dl
        class="mt-1 grid grid-cols-1 gap-x-4 gap-y-1.5 rounded-2xl bg-surface-2 px-3.5 py-3 text-sm @min-[22rem]:grid-cols-2"
      >
        @for (item of extras(); track item.key) {
          <div class="flex min-w-0 items-center justify-between gap-2">
            <dt class="flex min-w-0 items-center gap-1.5 text-muted">
              <span
                class="size-1.5 shrink-0 rounded-full"
                aria-hidden="true"
                [style.background-color]="item.color"
              ></span>
              <span class="truncate">{{ item.label }}</span>
            </dt>
            <dd class="shrink-0 font-semibold whitespace-nowrap text-fg tabular-nums">
              {{ item.value }} {{ item.unit }}
            </dd>
          </div>
        }
      </dl>
    }
  `,
})
export class MacroSummary {
  readonly nutrients = input.required<Nutrients>();
  readonly expanded = model(false);
  readonly collapsible = input(true);

  protected readonly macros = computed(() => MACRO_KEYS.map((key) => tile(key, this.nutrients())));
  protected readonly valueFontSize = computed(() => tileFontSize(this.macros()));
  protected readonly extras = computed(() =>
    EXTRA_NUTRIENT_KEYS.map((key) => cell(key, this.nutrients())),
  );
}
