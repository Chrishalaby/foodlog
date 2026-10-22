import { Component, computed, input } from '@angular/core';
import type { FoodResultKind, FoodSearchResult } from '@food/shared';
import { initialOf } from '../utils/food-library';
import { Icon, type IconName } from './icon';

export const FOOD_KIND_TONES: Record<FoodResultKind, string> = {
  favorite: 'bg-warn/15 text-warn',
  meal: 'bg-brand/12 text-brand',
  product: 'bg-fat/15 text-fat',
  food: 'bg-accent/15 text-accent',
};

const FOOD_KIND_ICONS: Partial<Record<FoodResultKind, IconName>> = {
  favorite: 'star-filled',
  meal: 'utensils',
  product: 'barcode',
};

export function foodKindIcon(kind: FoodResultKind, barcode?: string | null): IconName | null {
  if (kind === 'product' && barcode === null) {
    return 'link';
  }
  return FOOD_KIND_ICONS[kind] ?? null;
}

function thumbShape(size: number): string {
  if (size >= 52) {
    return 'size-14 rounded-2xl';
  }
  return size <= 32 ? 'size-8 rounded-full' : 'size-11 rounded-xl';
}

@Component({
  selector: 'app-food-thumb',
  imports: [Icon],
  host: { class: 'block shrink-0', 'aria-hidden': 'true' },
  template: `
    @if (result().photo; as photo) {
      <img
        class="bg-surface-2 object-cover"
        [class]="shapeClass()"
        alt=""
        loading="lazy"
        decoding="async"
        draggable="false"
        [attr.width]="size()"
        [attr.height]="size()"
        [src]="photo.thumbUrl"
      />
    } @else {
      <span class="flex items-center justify-center" [class]="shapeClass() + ' ' + tone()">
        @if (icon(); as name) {
          <app-icon [name]="name" [size]="iconSize()" />
        } @else {
          <span class="font-bold" [style.font-size.px]="iconSize()">{{ initial() }}</span>
        }
      </span>
    }
  `,
})
export class FoodThumb {
  readonly result = input.required<FoodSearchResult>();
  readonly size = input(44);

  protected readonly initial = computed(() => initialOf(this.result().name));
  protected readonly icon = computed(() => foodKindIcon(this.result().kind, this.result().barcode));
  protected readonly iconSize = computed(() => {
    const size = this.size();
    return Math.round(size * (size <= 32 ? 0.5 : 0.4));
  });
  protected readonly shapeClass = computed(() => thumbShape(this.size()));
  protected readonly tone = computed(() => FOOD_KIND_TONES[this.result().kind]);
}
