import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { PORTION_UNIT_MAX, formatCount, type Portion } from '@food/shared';
import { Icon } from '../../shared/ui/icon';
import { MEAL_PORTION_FACTORS, portionFactorLabel } from '../../shared/ui/items-editor/items-math';
import { formatNumber, parseDecimal } from '../../shared/utils/format';
import {
  canStepCount,
  clampCount,
  countChips,
  countLabel,
  makePortion,
  renamePortion,
  sameCount,
  stepCount,
  unitLabel,
} from '../../shared/utils/portion';

interface PortionOption {
  factor: number;
  label: string;
  ariaLabel: string;
}

interface CountOption {
  count: number;
  label: string;
  ariaLabel: string;
}

function optionFor(factor: number): PortionOption {
  if (factor === 1) {
    return { factor, label: 'All', ariaLabel: 'All of it' };
  }
  const label = portionFactorLabel(factor);
  return factor > 1
    ? { factor, label: `${label}×`, ariaLabel: `${label} times the estimate` }
    : { factor, label, ariaLabel: `${label} of the estimate` };
}

function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

let nextPortionId = 0;

@Component({
  selector: 'app-meal-portion',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div class="mb-1.5 flex items-baseline justify-between gap-3">
      <span class="text-sm font-medium text-muted" [id]="labelId">{{ label() }}</span>
      @if (portion()) {
        @if (baseNote(); as note) {
          <span class="text-xs font-semibold text-brand tabular-nums">{{ note }}</span>
        }
      } @else if (factor() !== 1) {
        <span class="text-xs font-semibold text-brand tabular-nums">{{ summary() }}</span>
      }
    </div>
    @if (portion(); as current) {
      <div
        class="rounded-2xl border border-line/70 bg-surface-2 p-1"
        role="group"
        [attr.aria-labelledby]="labelId"
      >
        <div class="flex min-h-12 items-center gap-2 pl-2">
          @if (editingUnit()) {
            <input
              #unitInput
              type="text"
              class="input h-10 min-w-0 flex-1 px-2.5 text-[15px] font-semibold"
              autocomplete="off"
              enterkeyhint="done"
              aria-label="Unit"
              [attr.maxlength]="unitMax"
              [value]="unitText()"
              [disabled]="disabled()"
              (keydown.enter)="commitUnit($event)"
              (keydown.escape)="editingUnit.set(false)"
            />
            <button
              type="button"
              class="btn btn-secondary h-10 px-3 text-sm"
              [disabled]="disabled()"
              (click)="commitUnit()"
            >
              Done
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-icon text-muted hover:text-danger"
              aria-label="Remove the portion"
              [disabled]="disabled()"
              (click)="remove()"
            >
              <app-icon name="trash" [size]="18" />
            </button>
          } @else {
            <button
              type="button"
              class="flex min-h-11 min-w-0 flex-1 items-center gap-1.5 text-left text-[15px] font-semibold text-fg"
              [attr.aria-label]="'Change unit, ' + unitText()"
              [disabled]="disabled()"
              (click)="startUnitEdit()"
            >
              <span class="truncate">{{ title() }}</span>
              <app-icon class="shrink-0 text-muted" name="edit" [size]="14" />
            </button>
            <div class="flex shrink-0 items-center gap-1">
              <button
                type="button"
                class="btn btn-secondary btn-icon"
                [attr.aria-label]="'Fewer ' + current.unitPlural"
                [disabled]="disabled() || !canStep(-1)"
                (click)="step(-1)"
              >
                <app-icon name="minus" />
              </button>
              <input
                type="text"
                inputmode="decimal"
                class="input h-11 w-16 px-1 text-center text-lg font-bold tabular-nums"
                autocomplete="off"
                enterkeyhint="done"
                [attr.aria-label]="'How many ' + current.unitPlural"
                [value]="countText()"
                [disabled]="disabled()"
                (change)="commitCount($event)"
                (keydown.enter)="blurInput($event)"
              />
              <button
                type="button"
                class="btn btn-secondary btn-icon"
                [attr.aria-label]="'More ' + current.unitPlural"
                [disabled]="disabled() || !canStep(1)"
                (click)="step(1)"
              >
                <app-icon name="plus" />
              </button>
            </div>
          }
        </div>
        <div
          class="mt-1 grid gap-0.5"
          [style.grid-template-columns]="'repeat(' + countOptions().length + ', minmax(0, 1fr))'"
        >
          @for (option of countOptions(); track option.count) {
            <button
              type="button"
              class="flex min-h-11 min-w-0 items-center justify-center rounded-xl text-[15px] font-semibold tabular-nums transition duration-150 active:scale-95"
              [class]="
                isCount(option.count)
                  ? 'bg-brand text-brand-fg shadow-soft'
                  : 'text-muted hover:text-fg'
              "
              [attr.aria-pressed]="isCount(option.count)"
              [attr.aria-label]="option.ariaLabel"
              [disabled]="disabled()"
              (click)="pickCount(option.count)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </div>
    } @else {
      @if (showFactors()) {
        <div
          class="grid grid-cols-8 gap-0.5 rounded-2xl border border-line/70 bg-surface-2 p-1"
          role="group"
          [attr.aria-labelledby]="labelId"
        >
          @for (option of options; track option.factor) {
            <button
              type="button"
              class="flex min-h-11 min-w-0 items-center justify-center rounded-xl text-[13px] font-semibold tabular-nums transition duration-150 active:scale-95"
              [class]="
                isSelected(option.factor)
                  ? 'bg-brand text-brand-fg shadow-soft'
                  : 'text-muted hover:text-fg'
              "
              [attr.aria-pressed]="isSelected(option.factor)"
              [attr.aria-label]="option.ariaLabel"
              [disabled]="disabled()"
              (click)="pick(option.factor)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      }
      @if (adding()) {
        <form
          class="mt-2 rounded-2xl border border-line/70 bg-surface-2 p-2.5 text-sm text-fg"
          aria-label="Add a portion"
          (submit)="add($event)"
        >
          <div class="flex items-center gap-2">
            <span class="shrink-0 font-medium">{{ addLead() }}</span>
            <input
              #addCountInput
              type="text"
              inputmode="decimal"
              name="count"
              class="input h-10 w-14 shrink-0 px-1 text-center font-semibold tabular-nums"
              autocomplete="off"
              aria-label="How many"
              [value]="draftCount()"
              (input)="draftCount.set($any($event.target).value)"
            />
            <input
              type="text"
              name="unit"
              class="input h-10 min-w-0 flex-1 px-2.5"
              autocomplete="off"
              enterkeyhint="done"
              aria-label="Unit, for example burgers"
              [placeholder]="unitPlaceholder()"
              [attr.maxlength]="unitMax"
              [value]="draftUnit()"
              (input)="draftUnit.set($any($event.target).value)"
            />
          </div>
          <div class="mt-2 flex justify-end gap-2">
            <button
              type="button"
              class="btn btn-ghost h-10 px-3 text-muted"
              (click)="adding.set(false)"
            >
              Cancel
            </button>
            <button type="submit" class="btn btn-primary h-10 px-4" [disabled]="!draftPortion()">
              Add portion
            </button>
          </div>
        </form>
      } @else {
        <button
          type="button"
          class="mt-1 flex min-h-10 items-center gap-1 rounded-lg px-1 text-xs font-semibold text-brand disabled:opacity-50"
          [disabled]="disabled()"
          (click)="startAdd()"
        >
          <app-icon name="plus" [size]="14" [strokeWidth]="2.5" />
          Add portion, e.g. 2 burgers
        </button>
      }
    }
  `,
})
export class MealPortion {
  readonly factor = input(1);
  readonly label = input('How much did you eat?');
  readonly showFactors = input(true);
  readonly addLead = input('This meal is');
  readonly portion = input<Portion | null>(null);
  readonly baseCount = input<number | null>(null);
  readonly disabled = input(false);
  readonly picked = output<number>();
  readonly countPicked = output<number>();
  readonly portionAdded = output<Portion>();
  readonly portionRenamed = output<Portion>();
  readonly portionRemoved = output<void>();

  private readonly injector = inject(Injector);
  private readonly unitInput = viewChild<ElementRef<HTMLInputElement>>('unitInput');
  private readonly addCountInput = viewChild<ElementRef<HTMLInputElement>>('addCountInput');

  protected readonly labelId = `meal-portion-${nextPortionId++}`;
  protected readonly unitMax = PORTION_UNIT_MAX;
  protected readonly options = MEAL_PORTION_FACTORS.map(optionFor);
  protected readonly editingUnit = signal(false);
  protected readonly adding = signal(false);
  protected readonly draftCount = signal('1');
  protected readonly draftUnit = signal('');
  protected readonly draftPortion = computed(() =>
    makePortion(parseDecimal(this.draftCount()) ?? 0, this.draftUnit()),
  );
  protected readonly unitPlaceholder = computed(() =>
    (parseDecimal(this.draftCount()) ?? 1) > 1 ? 'e.g. burgers' : 'e.g. burger',
  );
  protected readonly unitText = computed(() => {
    const portion = this.portion();
    return portion ? unitLabel(portion, portion.count) : '';
  });
  protected readonly title = computed(() => capitalize(this.unitText()));
  protected readonly countText = computed(() => {
    const portion = this.portion();
    return portion ? formatNumber(portion.count, 2).replace(/,/g, '') : '';
  });
  protected readonly countOptions = computed<CountOption[]>(() => {
    const portion = this.portion();
    if (!portion) {
      return [];
    }
    return countChips(this.baseCount()).map((count) => ({
      count,
      label: formatCount(count),
      ariaLabel: countLabel(portion, count),
    }));
  });
  protected readonly baseNote = computed(() => {
    const portion = this.portion();
    const base = this.baseCount();
    return portion && base !== null && !sameCount(base, portion.count)
      ? `Was ${countLabel(portion, base)}`
      : null;
  });

  protected isSelected(factor: number): boolean {
    return Math.abs(this.factor() - factor) < 1e-6;
  }

  protected isCount(count: number): boolean {
    const portion = this.portion();
    return portion !== null && sameCount(portion.count, count);
  }

  protected summary(): string {
    const factor = this.factor();
    return factor > 1
      ? `${portionFactorLabel(factor)}× the estimate`
      : `${portionFactorLabel(factor)} of the estimate`;
  }

  protected pick(factor: number): void {
    if (!this.isSelected(factor)) {
      this.picked.emit(factor);
    }
  }

  protected pickCount(count: number): void {
    if (!this.isCount(count)) {
      this.countPicked.emit(clampCount(count));
    }
  }

  protected canStep(direction: 1 | -1): boolean {
    const portion = this.portion();
    return portion !== null && canStepCount(portion.count, direction);
  }

  protected step(direction: 1 | -1): void {
    const portion = this.portion();
    if (portion) {
      this.countPicked.emit(stepCount(portion.count, direction));
    }
  }

  protected commitCount(event: Event): void {
    const target = event.target as HTMLInputElement;
    const parsed = parseDecimal(target.value);
    if (parsed === null || parsed <= 0 || this.isCount(clampCount(parsed))) {
      target.value = this.countText();
      return;
    }
    this.pickCount(parsed);
  }

  protected blurInput(event: Event): void {
    (event.target as HTMLInputElement).blur();
  }

  protected startUnitEdit(): void {
    this.editingUnit.set(true);
    afterNextRender(() => this.unitInput()?.nativeElement.select(), { injector: this.injector });
  }

  protected commitUnit(event?: Event): void {
    event?.preventDefault();
    const portion = this.portion();
    const text = this.unitInput()?.nativeElement.value ?? '';
    const renamed = portion ? renamePortion(portion, text) : null;
    this.editingUnit.set(false);
    if (portion && renamed && renamed !== portion) {
      this.portionRenamed.emit(renamed);
    }
  }

  protected remove(): void {
    this.editingUnit.set(false);
    this.portionRemoved.emit();
  }

  protected startAdd(): void {
    this.draftCount.set('1');
    this.draftUnit.set('');
    this.adding.set(true);
    afterNextRender(() => this.addCountInput()?.nativeElement.select(), {
      injector: this.injector,
    });
  }

  protected add(event: Event): void {
    event.preventDefault();
    const portion = this.draftPortion();
    if (!portion) {
      return;
    }
    this.adding.set(false);
    this.portionAdded.emit(portion);
  }
}
