import { Component, inject, signal } from '@angular/core';
import {
  FormField,
  FormRoot,
  type TreeValidationResult,
  email,
  form,
  maxLength,
  minLength,
  required,
  validate,
} from '@angular/forms/signals';
import { Router } from '@angular/router';
import { API_LIMITS } from '@food/shared';
import { AuthService } from '../../core/auth.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { ONBOARDING_PATH } from '../../core/guards';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { AuthLayout } from './auth-layout';

interface SetupModel {
  email: string;
  password: string;
  confirmPassword: string;
  setupCode: string;
}

@Component({
  selector: 'app-setup-page',
  imports: [AuthLayout, FormField, FormRoot, Icon, Spinner],
  templateUrl: './setup-page.html',
})
export class SetupPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly passwordMin = API_LIMITS.passwordMin;
  protected readonly model = signal<SetupModel>({
    email: '',
    password: '',
    confirmPassword: '',
    setupCode: '',
  });
  protected readonly showPassword = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly setupForm = form(
    this.model,
    (path) => {
      required(path.email, { message: 'Enter your email address.' });
      email(path.email, { message: 'Enter a valid email address.' });
      required(path.password, { message: 'Choose a password.' });
      minLength(path.password, API_LIMITS.passwordMin, {
        message: `Use at least ${API_LIMITS.passwordMin} characters.`,
      });
      maxLength(path.password, API_LIMITS.passwordMax, {
        message: `Use at most ${API_LIMITS.passwordMax} characters.`,
      });
      required(path.confirmPassword, { message: 'Repeat your password.' });
      validate(path.confirmPassword, ({ value, valueOf }) =>
        value() !== '' && value() !== valueOf(path.password)
          ? { kind: 'mismatch', message: 'Passwords do not match.' }
          : undefined,
      );
      required(path.setupCode, { message: 'Enter the setup code.' });
    },
    { submission: { action: async () => this.createAccount() } },
  );

  protected togglePassword(): void {
    this.showPassword.update((visible) => !visible);
  }

  private async createAccount(): Promise<TreeValidationResult> {
    this.error.set(null);
    const value = this.model();
    try {
      await this.auth.setup({
        email: value.email.trim(),
        password: value.password,
        setupCode: value.setupCode.trim(),
      });
      await this.auth.enterApp(ONBOARDING_PATH);
      return undefined;
    } catch (err) {
      return this.handleError(err);
    }
  }

  private async handleError(err: unknown): Promise<TreeValidationResult> {
    const status = httpStatus(err);
    if (status === 403) {
      return [
        {
          fieldTree: this.setupForm.setupCode,
          kind: 'server',
          message: 'That setup code is not correct.',
        },
      ];
    }
    if (status === 409) {
      this.toast.info('An account already exists. Please sign in.');
      await this.auth.load().catch(() => undefined);
      await this.router.navigateByUrl('/login', { replaceUrl: true });
      return undefined;
    }
    this.error.set(errorMessage(err));
    return undefined;
  }
}
