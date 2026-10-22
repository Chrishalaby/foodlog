import { Component, computed, input } from '@angular/core';
import { Icon, type IconName } from '../../../shared/ui/icon';

export type SectionTone = 'brand' | 'accent' | 'warn' | 'calories' | 'protein' | 'fat' | 'sodium';

const TONE_CLASSES: Record<SectionTone, string> = {
  brand: 'bg-brand/15 text-brand',
  accent: 'bg-accent/15 text-accent',
  warn: 'bg-warn/15 text-warn',
  calories: 'bg-calories/15 text-calories',
  protein: 'bg-protein/15 text-protein',
  fat: 'bg-fat/15 text-fat',
  sodium: 'bg-sodium/15 text-sodium',
};

@Component({
  selector: 'app-settings-section',
  imports: [Icon],
  host: {
    class: 'block scroll-mt-[calc(env(safe-area-inset-top)+0.75rem)]',
    '[attr.id]': 'sectionId()',
  },
  template: `
    <section class="card" [attr.aria-labelledby]="headingId()">
      <header class="flex items-start gap-3 px-4 pt-4 pb-3">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-xl"
          [class]="toneClass()"
          aria-hidden="true"
        >
          <app-icon [name]="icon()" [size]="18" />
        </span>
        <div class="min-w-0 flex-1">
          <h2
            class="text-base leading-6 font-semibold text-fg outline-none"
            tabindex="-1"
            [id]="headingId()"
          >
            {{ heading() }}
          </h2>
          @if (description()) {
            <p class="mt-0.5 text-sm leading-snug text-muted">{{ description() }}</p>
          }
        </div>
        <ng-content select="[sectionAction]" />
      </header>
      <div class="px-4 pb-4">
        <ng-content />
      </div>
    </section>
  `,
})
export class SettingsSection {
  readonly sectionId = input.required<string>();
  readonly heading = input.required<string>();
  readonly description = input('');
  readonly icon = input<IconName>('settings');
  readonly tone = input<SectionTone>('brand');

  protected readonly headingId = computed(() => `${this.sectionId()}-heading`);
  protected readonly toneClass = computed(() => TONE_CLASSES[this.tone()]);
}
