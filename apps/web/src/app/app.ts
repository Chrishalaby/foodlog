import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AppIdentityService } from './core/app-identity.service';
import { AuthService } from './core/auth.service';
import { SwUpdateService } from './core/sw-update.service';
import { ThemeService } from './core/theme.service';
import { InstallPromptService } from './features/settings/install-prompt.service';
import { ToastOutlet } from './layout/toast-outlet';
import { ConfirmHost } from './shared/ui/confirm-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToastOutlet, ConfirmHost],
  template: `
    <div class="status-bar-scrim" aria-hidden="true" data-testid="status-bar-scrim"></div>
    <router-outlet />
    <app-toast-outlet />
    <app-confirm-host />
  `,
})
export class App {
  constructor() {
    inject(ThemeService);
    inject(AppIdentityService);
    inject(InstallPromptService);
    inject(SwUpdateService).init();
    inject(AuthService).watch();
  }
}
