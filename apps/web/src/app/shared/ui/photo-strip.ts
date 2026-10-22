import { Component, input, output } from '@angular/core';
import type { AnalysisPhotoRef } from '@food/shared';
import { IMAGE_ROLE_LABELS } from '../utils/entry-photos';

let nextStripId = 0;

@Component({
  selector: 'app-photo-strip',
  host: { class: 'block' },
  template: `
    <section [attr.aria-labelledby]="ids.title">
      <div class="flex items-baseline justify-between gap-3">
        <h2 class="section-title" [id]="ids.title">Photos</h2>
        @if (hint(); as text) {
          <p class="min-w-0 truncate text-xs text-muted" [id]="ids.hint">{{ text }}</p>
        }
      </div>
      <ul class="-mx-1 mt-2 flex gap-2.5 overflow-x-auto px-1 pt-1 pb-0.5">
        @for (item of photos(); track item.photo.id; let index = $index) {
          <li class="shrink-0">
            <button
              type="button"
              class="flex w-16 flex-col items-center gap-1 rounded-xl transition active:scale-95"
              [attr.aria-label]="itemLabel(item, index)"
              [attr.aria-describedby]="hint() ? ids.hint : null"
              (click)="viewed.emit(index)"
            >
              <span class="relative block">
                <img
                  class="size-16 rounded-xl bg-surface-2 object-cover"
                  alt=""
                  width="64"
                  height="64"
                  loading="lazy"
                  decoding="async"
                  [class]="
                    item.photo.id === coverId() ? 'ring-2 ring-brand' : 'ring-1 ring-line/70'
                  "
                  [src]="item.photo.thumbUrl"
                />
                @if (item.photo.id === coverId()) {
                  <span
                    class="absolute inset-x-1 bottom-1 rounded-md bg-black/65 py-px text-center text-[10px] leading-3.5 font-bold text-white backdrop-blur"
                    aria-hidden="true"
                  >
                    Cover
                  </span>
                }
              </span>
              <span class="text-[11px] leading-3 font-semibold text-muted">
                {{ labels[item.role] }}
              </span>
            </button>
          </li>
        }
      </ul>
    </section>
  `,
})
export class PhotoStrip {
  readonly photos = input.required<readonly AnalysisPhotoRef[]>();
  readonly coverId = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly viewed = output<number>();

  protected readonly labels = IMAGE_ROLE_LABELS;
  protected readonly ids = {
    title: `photo-strip-${nextStripId}-title`,
    hint: `photo-strip-${nextStripId++}-hint`,
  };

  protected itemLabel(item: AnalysisPhotoRef, index: number): string {
    const parts = [
      `View photo ${index + 1} of ${this.photos().length}`,
      IMAGE_ROLE_LABELS[item.role].toLowerCase(),
    ];
    if (item.photo.id === this.coverId()) {
      parts.push('cover');
    }
    return parts.join(', ');
  }
}
