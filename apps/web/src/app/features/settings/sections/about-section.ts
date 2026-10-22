import { Component, computed, inject, resource } from '@angular/core';
import { ApiService } from '../../../core/api.service';
import { SettingsSection } from './settings-section';

@Component({
  selector: 'app-about-section',
  imports: [SettingsSection],
  template: `
    <app-settings-section
      sectionId="settings-about"
      heading="About"
      icon="info"
      tone="fat"
      description="How FoodLog estimates your food."
    >
      <dl
        class="flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-3.5 py-3 text-sm"
      >
        <dt class="text-muted">Version</dt>
        <dd class="font-semibold text-fg tabular-nums">{{ version() }}</dd>
      </dl>
      <div class="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-muted">
        <p>
          The AI identifies each food, estimates its weight from visual cues such as plate size and
          packaging, then calculates nutrients from typical values per 100 g. Photo estimates are
          usually within about ±20–30 %.
        </p>
        <p>
          For better accuracy, mention weights, brands and how it was prepared (fried, oil, butter,
          sauces), and scan nutrition labels when you can. Always review the items before saving.
        </p>
      </div>
    </app-settings-section>
  `,
})
export class AboutSection {
  private readonly api = inject(ApiService);

  private readonly health = resource({ loader: () => this.api.health() });

  protected readonly version = computed(() => {
    if (this.health.hasValue()) {
      return this.health.value()?.version ?? 'Unknown';
    }
    return this.health.isLoading() ? '…' : 'Unavailable';
  });
}
