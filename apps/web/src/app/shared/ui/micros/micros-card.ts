import { Component, computed, inject, input, model } from '@angular/core';
import type { Micros, MicrosCoverage } from '@food/shared';
import { ProfileStore } from '../../../core/profile.store';
import { Icon } from '../icon';
import {
  MICROS_TITLE,
  microGroups,
  microTargetsFor,
  microsSummary,
  type MicrosScope,
} from './micros-model';
import { MicrosPanel } from './micros-panel';

let nextCardId = 0;

@Component({
  selector: 'app-micros-card',
  imports: [Icon, MicrosPanel],
  host: { class: 'block' },
  template: `
    <section class="card" [attr.aria-labelledby]="ids.title">
      <h2>
        <button
          type="button"
          class="flex min-h-14 w-full items-center gap-3 rounded-card px-4 py-2.5 text-left transition active:bg-surface-2/60"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="expanded() ? ids.body : null"
          (click)="toggle()"
        >
          <span class="min-w-0 flex-1">
            <span class="block text-[15px] leading-5 font-semibold text-fg" [id]="ids.title">{{
              title()
            }}</span>
            <span
              class="mt-0.5 flex min-w-0 items-center gap-1 text-xs leading-4"
              [class]="summary().warn ? 'text-warn' : 'text-muted'"
              data-micros-summary
            >
              @if (summary().warn) {
                <app-icon class="shrink-0" name="alert" [size]="12" />
              }
              <span class="truncate">{{ summary().text }}</span>
            </span>
          </span>
          <app-icon
            class="shrink-0 text-muted transition-transform duration-200"
            name="chevron-down"
            [size]="20"
            [class.rotate-180]="expanded()"
          />
        </button>
      </h2>
      @if (expanded()) {
        <div class="animate-fade-in border-t border-line/60 px-4 pt-3 pb-4" [id]="ids.body">
          <app-micros-panel
            [micros]="micros()"
            [targets]="targets()"
            [coverage]="coverage()"
            [scope]="scope()"
          />
        </div>
      }
    </section>
  `,
})
export class MicrosCard {
  private readonly profiles = inject(ProfileStore);

  readonly micros = input<Micros | null>(null);
  readonly coverage = input<MicrosCoverage | null>(null);
  readonly scope = input<MicrosScope>('day');
  readonly title = input(MICROS_TITLE);
  readonly expanded = model(false);

  protected readonly ids = {
    title: `micros-card-${nextCardId}-title`,
    body: `micros-card-${nextCardId++}-body`,
  };
  protected readonly targets = computed(() => microTargetsFor(this.profiles.profile()));
  protected readonly summary = computed(() =>
    microsSummary(microGroups(this.micros(), this.targets()), this.coverage()),
  );

  protected toggle(): void {
    this.expanded.set(!this.expanded());
  }
}
