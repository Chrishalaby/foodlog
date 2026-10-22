import { Component, computed, inject, input, signal } from '@angular/core';
import { FormField, FormRoot, email, form, required } from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { SIGNED_OUT_REASON } from '../../core/api.interceptor';
import { AppIdentityService } from '../../core/app-identity.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { HOME_PATH, REQUEST_ACCESS_PATH, safeRedirectPath } from '../../core/guards';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { AccessRequestCard } from './access-request-card';
import { AccessRequestStore } from './access-request.store';
import { AuthLayout } from './auth-layout';
import { FormAlert } from './form-alert';

export const INVALID_LOGIN_MESSAGE = 'That email and password do not match.';
export const DISABLED_LOGIN_MESSAGE =
  'This account is disabled. Ask the owner of this FoodLog to turn it back on.';
export const SIGNED_OUT_MESSAGE = 'You were signed out on this device. Sign in again to continue.';
export const FORGOT_PASSWORD_HINT = 'Forgot your password? Ask the owner for a reset link.';
export const LOGIN_SUBTITLE = 'Sign in to keep your food log up to date.';
export const NOTES_LOGIN_SUBTITLE = 'Sign in with your FoodLog account to see your notes.';
export const PRIVACY_NOTE = 'Only you can see your food log.';
export const NOTES_PRIVACY_NOTE = 'Only you can see your notes.';

interface LoginModel {
  email: string;
  password: string;
}

@Component({
  selector: 'app-login-page',
  imports: [
    AuthLayout,
    AccessRequestCard,
    FormAlert,
    FormField,
    FormRoot,
    Icon,
    RouterLink,
    Spinner,
  ],
  templateUrl: './login-page.html',
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly access = inject(AccessRequestStore);
  private readonly notesHost = inject(AppIdentityService).notesHost;

  readonly next = input<string>();
  readonly reason = input<string>();

  protected readonly requestAccessPath = REQUEST_ACCESS_PATH;
  protected readonly signedOutMessage = SIGNED_OUT_MESSAGE;
  protected readonly forgotPasswordHint = FORGOT_PASSWORD_HINT;
  protected readonly signedOut = computed(() => this.reason() === SIGNED_OUT_REASON);
  protected readonly hasRequest = computed(() => this.access.stored() !== null);
  protected readonly title = computed(() => (this.hasRequest() ? 'Welcome' : 'Welcome back'));
  protected readonly subtitle = computed(() =>
    this.hasRequest()
      ? 'Here’s where your access request stands.'
      : this.notesHost
        ? NOTES_LOGIN_SUBTITLE
        : LOGIN_SUBTITLE,
  );
  protected readonly privacyNote = this.notesHost ? NOTES_PRIVACY_NOTE : PRIVACY_NOTE;
  protected readonly model = signal<LoginModel>({ email: '', password: '' });
  protected readonly showPassword = signal(false);
  protected readonly demoEnabled = computed(() => this.auth.demo()?.enabled === true);
  protected readonly demoBusy = signal(false);
  protected readonly demoError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly loginForm = form(
    this.model,
    (path) => {
      required(path.email, { message: 'Enter your email address.' });
      email(path.email, { message: 'Enter a valid email address.' });
      required(path.password, { message: 'Enter your password.' });
    },
    { submission: { action: async () => this.signIn() } },
  );

  constructor() {
    this.access.syncFromStorage();
  }

  protected togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  protected async startDemo(): Promise<void> {
    if (this.demoBusy()) {
      return;
    }
    this.demoBusy.set(true);
    this.demoError.set(null);
    try {
      await this.auth.startDemo();
      await this.auth.enterApp(HOME_PATH);
    } catch (err) {
      this.demoError.set(demoErrorMessage(err));
    } finally {
      this.demoBusy.set(false);
    }
  }

  private async signIn(): Promise<undefined> {
    this.error.set(null);
    const { email: address, password } = this.model();
    try {
      const user = await this.auth.login({ email: address.trim(), password });
      this.access.forgetIfFor(user.email);
      await this.auth.enterApp(safeRedirectPath(this.next()) ?? HOME_PATH);
    } catch (err) {
      this.error.set(loginErrorMessage(err));
    }
    return undefined;
  }
}

export const DEMO_BUSY_MESSAGE =
  'Lots of people are trying the demo right now. Please try again in a few minutes.';

export function demoErrorMessage(err: unknown): string {
  return httpStatus(err) === 429 ? DEMO_BUSY_MESSAGE : errorMessage(err);
}

export function loginErrorMessage(err: unknown): string {
  switch (httpStatus(err)) {
    case 401:
      return INVALID_LOGIN_MESSAGE;
    case 403:
      return DISABLED_LOGIN_MESSAGE;
    default:
      return errorMessage(err);
  }
}
