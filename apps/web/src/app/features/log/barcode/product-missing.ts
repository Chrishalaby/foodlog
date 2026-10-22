import { Component, ElementRef, computed, inject, input, output, viewChild } from '@angular/core';
import { AiAvailability } from '../../../core/ai-availability.service';
import { Icon } from '../../../shared/ui/icon';
import { Spinner } from '../../../shared/ui/spinner';
import { firstImage } from './barcode-image';
import { formatBarcode } from './gs1';

export interface LookupProblem {
  message: string;
  offline: boolean;
}

@Component({
  selector: 'app-product-missing',
  imports: [Icon, Spinner],
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-4">
      <header class="flex flex-col items-center gap-2 px-2 pt-1 text-center">
        <span
          class="flex size-14 items-center justify-center rounded-2xl"
          [class]="problem() ? 'bg-warn/15 text-warn' : 'bg-accent/15 text-accent'"
          aria-hidden="true"
        >
          <app-icon [name]="icon()" [size]="28" />
        </span>
        <h2 class="text-lg leading-6 font-semibold tracking-tight">{{ title() }}</h2>
        <p class="text-sm leading-snug text-muted">
          @if (problem(); as current) {
            {{ current.message }}
          } @else {
            Scan its nutrition label once and the barcode is instant next time.
          }
        </p>
        <p class="chip tabular-nums">
          <app-icon name="barcode" [size]="14" />
          {{ code() }}
        </p>
      </header>

      <div class="flex flex-col gap-2">
        @if (problem()) {
          <button
            type="button"
            class="btn btn-primary min-h-13 w-full text-base"
            (click)="retry.emit()"
          >
            <app-icon name="refresh" />
            Try again
          </button>
        }
        @if (ai.enabled()) {
          <button
            type="button"
            class="flex min-h-16 w-full items-center gap-3 rounded-2xl p-3.5 text-left transition active:scale-[0.99]"
            [class]="
              problem()
                ? 'border border-line/70 bg-surface hover:bg-surface-2'
                : 'bg-brand text-brand-fg shadow-soft hover:bg-brand-strong'
            "
            (click)="scanLabel.emit()"
          >
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-xl"
              [class]="problem() ? 'bg-carbs/15 text-carbs' : 'bg-brand-fg/12'"
            >
              <app-icon name="label" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[15px] leading-5 font-semibold"
                >Scan the nutrition label</span
              >
              <span
                class="block text-xs leading-4"
                [class]="problem() ? 'text-muted' : 'opacity-80'"
                >AI reads it and remembers this barcode</span
              >
            </span>
            <app-icon name="chevron-right" [size]="18" />
          </button>
          <button
            type="button"
            class="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line/70 bg-surface p-3.5 text-left transition hover:bg-surface-2 active:scale-[0.99]"
            (click)="describe.emit()"
          >
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-fat/15 text-fat"
            >
              <app-icon name="text" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block text-[15px] leading-5 font-semibold text-fg"
                >Describe it instead</span
              >
              <span class="block text-xs leading-4 text-muted">Type the name and how much</span>
            </span>
            <app-icon class="text-muted" name="chevron-right" [size]="18" />
          </button>
        }
        <button
          type="button"
          class="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-line/70 bg-surface p-3.5 text-left transition hover:bg-surface-2 active:scale-[0.99]"
          (click)="manual.emit()"
        >
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted"
          >
            <app-icon name="edit" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block text-[15px] leading-5 font-semibold text-fg"
              >Enter values manually</span
            >
            <span class="block text-xs leading-4 text-muted"
              >Copy the numbers from the package</span
            >
          </span>
          <app-icon class="text-muted" name="chevron-right" [size]="18" />
        </button>
        @if (galleryMessage(); as message) {
          <p
            class="flex animate-fade-in items-start gap-2 rounded-2xl bg-warn/10 px-3.5 py-2.5 text-sm leading-snug text-fg/90"
            role="alert"
          >
            <app-icon class="mt-0.5 text-warn" name="alert" [size]="16" />
            {{ message }}
          </p>
        }
        <div class="flex flex-col">
          <button
            type="button"
            class="btn btn-ghost min-h-11 w-full text-sm text-muted"
            (click)="scanAgain.emit()"
          >
            <app-icon name="barcode" [size]="16" />
            Scan a different barcode
          </button>
          <button
            type="button"
            class="btn btn-ghost min-h-11 w-full text-sm text-muted"
            [disabled]="galleryBusy()"
            (click)="chooseImage()"
          >
            @if (galleryBusy()) {
              <app-spinner [size]="16" label="Reading the image" />
            } @else {
              <app-icon name="image" [size]="16" />
            }
            Choose from gallery
          </button>
        </div>
      </div>
      <input
        #galleryInput
        type="file"
        accept="image/*"
        class="sr-only"
        tabindex="-1"
        aria-hidden="true"
        (change)="onImage(galleryInput)"
      />
    </div>
  `,
})
export class ProductMissing {
  protected readonly ai = inject(AiAvailability);
  private readonly galleryRef = viewChild.required<ElementRef<HTMLInputElement>>('galleryInput');

  readonly barcode = input.required<string>();
  readonly problem = input<LookupProblem | null>(null);
  readonly galleryBusy = input(false);
  readonly galleryMessage = input<string | null>(null);
  readonly retry = output<void>();
  readonly scanLabel = output<void>();
  readonly describe = output<void>();
  readonly manual = output<void>();
  readonly scanAgain = output<void>();
  readonly galleryImage = output<File>();

  protected readonly code = computed(() => formatBarcode(this.barcode()));
  protected readonly title = computed(() => {
    const problem = this.problem();
    if (!problem) {
      return "We don't know this product yet";
    }
    return problem.offline ? "You're offline" : "Couldn't look it up";
  });
  protected readonly icon = computed(() => {
    const problem = this.problem();
    if (!problem) {
      return 'barcode' as const;
    }
    return problem.offline ? ('wifi-off' as const) : ('alert' as const);
  });

  protected chooseImage(): void {
    const input = this.galleryRef().nativeElement;
    input.value = '';
    input.click();
  }

  protected onImage(input: HTMLInputElement): void {
    const file = firstImage(input);
    if (file) {
      this.galleryImage.emit(file);
    }
  }
}
