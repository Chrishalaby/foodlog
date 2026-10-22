import { Component, computed, input } from '@angular/core';

export type SkeletonShape = 'block' | 'text' | 'circle';

@Component({
  selector: 'app-skeleton',
  host: {
    'aria-hidden': 'true',
    '[class]': 'hostClass()',
  },
  template: '',
})
export class Skeleton {
  readonly shape = input<SkeletonShape>('block');

  protected readonly hostClass = computed(() => {
    const base = 'block animate-pulse bg-line/70';
    switch (this.shape()) {
      case 'circle':
        return `${base} rounded-full`;
      case 'text':
        return `${base} h-3.5 rounded-md`;
      default:
        return `${base} rounded-xl`;
    }
  });
}
