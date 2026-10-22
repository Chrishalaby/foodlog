import { Component, computed, input } from '@angular/core';
import type { MicroTargets, Micros, MicrosCoverage } from '@food/shared';
import { Icon } from '../icon';
import {
  MICROS_DISCLAIMER,
  microGroups,
  microsCoverageText,
  type MicroTone,
  type MicrosScope,
} from './micros-model';

const BAR_CLASSES: Record<MicroTone, string> = {
  unknown: '',
  progress: 'bg-accent',
  met: 'bg-ok',
  limit: 'bg-muted',
  warn: 'bg-warn',
};

let nextPanelId = 0;

@Component({
  selector: 'app-micros-panel',
  imports: [Icon],
  host: { class: 'block' },
  template: `
    <div class="flex flex-col gap-4">
      @for (group of groups(); track group.group) {
        <section [attr.aria-labelledby]="prefix + group.group">
          <h3 class="section-title" [id]="prefix + group.group">{{ group.title }}</h3>
          <ul class="mt-2 flex flex-col gap-3">
            @for (row of group.rows; track row.key) {
              <li [attr.data-micro]="row.key" [attr.data-tone]="row.tone">
                <div aria-hidden="true">
                  <div class="flex items-baseline justify-between gap-3 text-sm">
                    <span
                      class="min-w-0 truncate font-medium"
                      [class]="row.known ? 'text-fg' : 'text-muted'"
                    >
                      {{ row.label }}
                      @if (row.limit) {
                        <span class="text-xs font-normal text-muted"
                          >· limit {{ row.targetText }}</span
                        >
                      }
                    </span>
                    <span class="flex shrink-0 items-baseline whitespace-nowrap tabular-nums">
                      <span
                        class="font-semibold"
                        [class]="
                          row.tone === 'warn' ? 'text-warn' : row.known ? 'text-fg' : 'text-muted'
                        "
                        >{{ row.amountText }}</span
                      >
                      <span class="w-12 text-right text-xs text-muted">{{ row.percentText }}</span>
                    </span>
                  </div>
                  <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    @if (row.fill > 0) {
                      <div
                        class="h-full rounded-full"
                        [class]="barClass(row.tone)"
                        [style.width.%]="row.fill"
                      ></div>
                    }
                  </div>
                  @if (row.note; as note) {
                    <p class="mt-1 flex items-center gap-1 text-xs leading-4 text-warn">
                      <app-icon class="shrink-0" name="alert" [size]="12" />
                      {{ note }}
                    </p>
                  }
                </div>
                <span class="sr-only">{{ row.srText }}</span>
              </li>
            }
          </ul>
        </section>
      }
      <div class="flex flex-col gap-1 border-t border-line/60 pt-3 text-xs leading-snug text-muted">
        @if (coverageText(); as text) {
          <p data-micros-coverage>{{ text }}</p>
        }
        <p class="flex items-start gap-1.5" data-micros-disclaimer>
          <app-icon class="mt-px shrink-0" name="info" [size]="14" />
          <span>{{ disclaimer }}</span>
        </p>
      </div>
    </div>
  `,
})
export class MicrosPanel {
  readonly micros = input<Micros | null>(null);
  readonly targets = input.required<MicroTargets>();
  readonly coverage = input<MicrosCoverage | null>(null);
  readonly scope = input<MicrosScope>('day');

  protected readonly prefix = `micros-panel-${nextPanelId++}-`;
  protected readonly disclaimer = MICROS_DISCLAIMER;
  protected readonly groups = computed(() => microGroups(this.micros(), this.targets()));
  protected readonly coverageText = computed(() =>
    microsCoverageText(this.coverage(), this.scope()),
  );

  protected barClass(tone: MicroTone): string {
    return BAR_CLASSES[tone];
  }
}
