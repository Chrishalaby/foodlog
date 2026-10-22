import { Component, computed, input, output } from '@angular/core';
import { API_LIMITS, type AnalysisPhotoRef } from '@food/shared';
import { Icon } from '../../shared/ui/icon';

let nextLabelCardId = 0;

@Component({
  selector: 'app-label-photo-card',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <section
      class="rounded-2xl border bg-surface px-3.5 py-2.5 transition-colors"
      [class]="hint() ? 'border-carbs/45' : 'border-line/70'"
      [attr.aria-labelledby]="ids.title"
    >
      <div class="flex items-center gap-3">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-carbs/15 text-carbs"
          aria-hidden="true"
        >
          <app-icon name="label" [size]="18" />
        </span>
        <div class="min-w-0 flex-1">
          <h2 class="text-[15px] leading-5 font-semibold text-fg" [id]="ids.title">
            Add a label photo
          </h2>
          @if (hint(); as text) {
            <p class="flex items-start gap-1 text-xs leading-4 text-fg/85" [id]="ids.detail">
              <app-icon class="mt-px shrink-0 text-carbs" name="sparkles" [size]="12" />
              <span>{{ text }}</span>
            </p>
          } @else {
            <p class="text-xs leading-4 text-muted" [id]="ids.detail">
              @if (full()) {
                Replaces the oldest extra photo and re-runs the estimate
              } @else {
                Re-runs the estimate with the exact values from the pack
              }
            </p>
          }
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-icon shrink-0 text-fg"
          aria-label="Take a label photo"
          [attr.aria-describedby]="ids.detail"
          [disabled]="disabled()"
          (click)="camera.emit()"
        >
          <app-icon name="camera" [size]="20" />
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-icon -mr-2 shrink-0 text-fg"
          aria-label="Choose a label photo from the library"
          [attr.aria-describedby]="ids.detail"
          [disabled]="disabled()"
          (click)="library.emit()"
        >
          <app-icon name="image" [size]="20" />
        </button>
      </div>
    </section>
  `,
})
export class LabelPhotoCard {
  readonly photos = input<readonly AnalysisPhotoRef[]>([]);
  readonly hint = input<string | null>(null);
  readonly disabled = input(false);
  readonly camera = output<void>();
  readonly library = output<void>();

  protected readonly full = computed(() => this.photos().length >= API_LIMITS.analyzeImagesMax);
  protected readonly ids = {
    title: `label-photo-${nextLabelCardId}-title`,
    detail: `label-photo-${nextLabelCardId++}-detail`,
  };
}
