import { Component, inject } from '@angular/core';
import { ToastService } from '../../../core/toast.service';
import { Icon } from '../../../shared/ui/icon';
import { InstallPromptService } from '../install-prompt.service';
import { SettingsSection } from './settings-section';

@Component({
  selector: 'app-install-section',
  imports: [SettingsSection, Icon],
  template: `
    @if (!install.standalone()) {
      <app-settings-section
        sectionId="settings-install"
        heading="Install app"
        icon="home"
        tone="brand"
        description="Add FoodLog to your home screen for a full-screen app with the camera one tap away."
      >
        @if (install.canPrompt()) {
          <button type="button" class="btn btn-primary w-full" (click)="installApp()">
            <app-icon name="download" [size]="18" />
            Install FoodLog
          </button>
        } @else if (install.platform === 'ios') {
          <ol
            class="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-snug text-fg marker:text-muted"
          >
            <li>Open FoodLog in Safari.</li>
            <li>
              Tap the <span class="font-semibold">Share</span> button (the square with an arrow).
            </li>
            <li>Choose <span class="font-semibold">Add to Home Screen</span>, then tap Add.</li>
          </ol>
        } @else {
          <p class="text-sm leading-relaxed text-muted">
            Open your browser menu and choose
            <span class="font-medium text-fg">Install app</span> or
            <span class="font-medium text-fg">Add to Home screen</span>.
          </p>
        }
      </app-settings-section>
    }
  `,
})
export class InstallSection {
  private readonly toast = inject(ToastService);

  protected readonly install = inject(InstallPromptService);

  protected async installApp(): Promise<void> {
    const outcome = await this.install.prompt();
    if (outcome === 'accepted') {
      this.toast.success('FoodLog is being added to your home screen.');
    }
  }
}
