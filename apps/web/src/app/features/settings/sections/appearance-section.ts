import { Component, input, model } from '@angular/core';
import type { ThemePreference } from '@food/shared';
import { ChoiceField, type ChoiceOption } from '../controls/choice-field';
import { SettingsSection } from './settings-section';

export const THEME_OPTIONS: readonly ChoiceOption<ThemePreference>[] = [
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'system', label: 'System', icon: 'settings' },
];

@Component({
  selector: 'app-appearance-section',
  imports: [SettingsSection, ChoiceField],
  template: `
    <app-settings-section
      sectionId="settings-appearance"
      heading="Appearance"
      icon="moon"
      tone="accent"
      description="Dark is easiest on the eyes at the table. System follows your device."
    >
      <span class="sr-only" id="appearance-theme-label">Theme</span>
      <app-choice-field labelledBy="appearance-theme-label" [options]="options" [(value)]="theme" />
      <p class="mt-2 text-xs text-muted">
        {{
          synced()
            ? 'Applies right away on this device and is saved to your profile with Save.'
            : 'Applies right away on this device.'
        }}
      </p>
    </app-settings-section>
  `,
})
export class AppearanceSection {
  readonly theme = model.required<ThemePreference>();
  readonly synced = input(true);

  protected readonly options = THEME_OPTIONS;
}
