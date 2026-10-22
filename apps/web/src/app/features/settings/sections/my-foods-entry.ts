import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MyFoodsStore } from '../../../core/my-foods.store';
import { Icon } from '../../../shared/ui/icon';

export const MY_FOODS_PATH = '/settings/my-foods';

@Component({
  selector: 'app-my-foods-entry',
  imports: [RouterLink, Icon],
  host: { class: 'block' },
  template: `
    <a
      class="card flex min-h-16 items-center gap-3 px-4 py-3 transition active:scale-[0.99]"
      [routerLink]="path"
    >
      <span
        class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-brand"
        aria-hidden="true"
      >
        <app-icon name="link" [size]="20" />
      </span>
      <span class="min-w-0 flex-1">
        <span class="block font-semibold text-fg">My foods</span>
        <span class="block truncate text-sm text-muted">{{ summary() }}</span>
      </span>
      @if (pending() > 0) {
        <span
          class="min-w-6 rounded-full bg-warn px-2 text-center text-xs leading-6 font-bold text-bg tabular-nums"
        >
          {{ pending() }}
          <span class="sr-only">{{ pending() === 1 ? 'food' : 'foods' }} to review</span>
        </span>
      }
      <app-icon class="text-muted" name="chevron-right" [size]="18" />
    </a>
  `,
})
export class MyFoodsEntry {
  private readonly store = inject(MyFoodsStore);

  protected readonly path = MY_FOODS_PATH;
  protected readonly pending = computed(() => this.store.suggestions().length);
  protected readonly summary = computed(() => {
    const count = this.store.foods().length;
    if (this.store.status() !== 'ready' || count === 0) {
      return 'Same food, same values, every time';
    }
    const saved = count === 1 ? '1 saved food' : `${count} saved foods`;
    const pending = this.pending();
    return pending > 0 ? `${saved} · ${pending} to review` : saved;
  });

  constructor() {
    void this.store.ensureLoaded();
    void this.store.ensureSuggestions();
  }
}
