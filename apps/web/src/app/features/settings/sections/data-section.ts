import { Component, inject, signal } from '@angular/core';
import { ApiService } from '../../../core/api.service';
import { Icon } from '../../../shared/ui/icon';
import { ImportSheet } from '../import/import-sheet';
import { SettingsSection } from './settings-section';

@Component({
  selector: 'app-data-section',
  imports: [SettingsSection, Icon, ImportSheet],
  template: `
    <app-settings-section
      sectionId="settings-data"
      heading="Your data"
      icon="download"
      tone="sodium"
      description="Download everything you have logged, or bring your history from another app."
    >
      <div class="grid grid-cols-2 gap-2">
        <a class="btn btn-secondary" download [href]="csvUrl">
          <app-icon name="download" [size]="18" />
          Export CSV
        </a>
        <a class="btn btn-secondary" download [href]="jsonUrl">
          <app-icon name="download" [size]="18" />
          Export JSON
        </a>
      </div>
      <p class="mt-3 text-xs leading-relaxed text-muted">
        CSV has one row per food item, ready for a spreadsheet. JSON is a complete backup with
        entries, favorites, training days and your profile.
      </p>
      <button
        type="button"
        class="btn btn-secondary mt-3 w-full"
        data-testid="open-import"
        (click)="importOpen.set(true)"
      >
        <app-icon name="refresh" [size]="18" />
        Import from another app
      </button>
      <p class="mt-2 text-xs leading-relaxed text-muted">
        FoodLog backups, Cronometer, MyFitnessPal, or any CSV of weigh-ins.
      </p>
    </app-settings-section>
    <app-import-sheet [(open)]="importOpen" />
  `,
})
export class DataSection {
  private readonly api = inject(ApiService);

  protected readonly csvUrl = this.api.exportUrl('csv');
  protected readonly jsonUrl = this.api.exportUrl('json');
  protected readonly importOpen = signal(false);
}
