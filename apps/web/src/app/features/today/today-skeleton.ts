import { Component } from '@angular/core';
import { Skeleton } from '../../shared/ui/skeleton';

@Component({
  selector: 'app-today-skeleton',
  imports: [Skeleton],
  host: { class: 'block space-y-5', role: 'status', 'aria-label': 'Loading your day' },
  template: `
    <div class="card p-4">
      <div class="flex items-center gap-5">
        <app-skeleton shape="circle" class="size-[152px] shrink-0" />
        <div class="flex-1 space-y-3">
          <app-skeleton shape="text" class="w-12" />
          <app-skeleton class="h-7 w-28" />
          <app-skeleton shape="text" class="w-20" />
          <app-skeleton shape="text" class="w-16" />
        </div>
      </div>
      <div class="mt-4 grid grid-cols-3 gap-2">
        @for (ring of rings; track ring) {
          <div class="flex flex-col items-center gap-2 rounded-2xl bg-surface-2/60 py-3">
            <app-skeleton shape="circle" class="size-[86px]" />
            <app-skeleton shape="text" class="w-14" />
          </div>
        }
      </div>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <app-skeleton class="h-12" />
      <app-skeleton class="h-12" />
    </div>
    <div class="card space-y-4 p-4">
      @for (bar of bars; track bar) {
        <div class="space-y-2">
          <app-skeleton shape="text" class="w-1/3" />
          <app-skeleton class="h-2 w-full" />
        </div>
      }
    </div>
    <div class="space-y-2">
      @for (card of cards; track card) {
        <app-skeleton class="h-[82px] rounded-card" />
      }
    </div>
  `,
})
export class TodaySkeleton {
  protected readonly rings = [0, 1, 2];
  protected readonly bars = [0, 1, 2, 3];
  protected readonly cards = [0, 1, 2];
}
