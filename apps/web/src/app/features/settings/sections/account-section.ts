import { Component, computed, inject, input, output, signal } from '@angular/core';
import {
  FormField,
  FormRoot,
  type TreeValidationResult,
  form,
  maxLength,
  minLength,
  required,
  validate,
} from '@angular/forms/signals';
import { API_LIMITS } from '@food/shared';
import { AuthService } from '../../../core/auth.service';
import { errorMessage, httpStatus } from '../../../core/errors';
import { ToastService } from '../../../core/toast.service';
import { ConfirmService } from '../../../shared/ui/confirm.service';
import { Icon } from '../../../shared/ui/icon';
import { Spinner } from '../../../shared/ui/spinner';
import { FieldError } from '../controls/field-error';
import { SettingsSection } from './settings-section';

interface PasswordModel {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

const EMPTY_PASSWORDS: PasswordModel = {
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
};

export const WRONG_PASSWORD_MESSAGE = 'Your current password is not correct.';
export const NAME_SAVED_MESSAGE = 'Name saved.';
export const NAME_TOO_LONG_MESSAGE = `Use at most ${API_LIMITS.personNameMax} characters.`;
export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Log out and sign in again.';
export const PASSWORD_CHANGED_MESSAGE = 'Password changed. Your other devices were signed out.';

@Component({
  selector: 'app-account-section',
  imports: [SettingsSection, FormField, FormRoot, FieldError, Icon, Spinner],
  templateUrl: './account-section.html',
})
export class AccountSection {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  readonly hasUnsavedChanges = input(false);
  readonly passwordChanged = output<void>();

  protected readonly user = this.auth.user;
  protected readonly displayName = computed(() => this.auth.name());
  protected readonly passwordMin = API_LIMITS.passwordMin;
  protected readonly nameMax = API_LIMITS.personNameMax;
  protected readonly editingName = signal(false);
  protected readonly nameDraft = signal('');
  protected readonly nameSaving = signal(false);
  protected readonly nameError = signal<string | null>(null);
  protected readonly editing = signal(false);
  protected readonly showPasswords = signal(false);
  protected readonly loggingOut = signal(false);
  protected readonly passwordError = signal<string | null>(null);
  protected readonly passwords = signal<PasswordModel>({ ...EMPTY_PASSWORDS });
  protected readonly passwordForm = form(
    this.passwords,
    (path) => {
      required(path.currentPassword, { message: 'Enter your current password.' });
      required(path.newPassword, { message: 'Choose a new password.' });
      minLength(path.newPassword, API_LIMITS.passwordMin, {
        message: `Use at least ${API_LIMITS.passwordMin} characters.`,
      });
      maxLength(path.newPassword, API_LIMITS.passwordMax, {
        message: `Use at most ${API_LIMITS.passwordMax} characters.`,
      });
      validate(path.newPassword, ({ value, valueOf }) =>
        value() !== '' && value() === valueOf(path.currentPassword)
          ? { kind: 'unchanged', message: 'Choose a password different from the current one.' }
          : undefined,
      );
      required(path.confirmPassword, { message: 'Repeat the new password.' });
      validate(path.confirmPassword, ({ value, valueOf }) =>
        value() !== '' && value() !== valueOf(path.newPassword)
          ? { kind: 'mismatch', message: 'Passwords do not match.' }
          : undefined,
      );
    },
    { submission: { action: async () => this.changePassword() } },
  );

  protected startNameEdit(): void {
    this.nameDraft.set(this.auth.name() ?? '');
    this.nameError.set(null);
    this.editingName.set(true);
  }

  protected cancelNameEdit(): void {
    this.editingName.set(false);
    this.nameError.set(null);
  }

  protected onNameInput(event: Event): void {
    this.nameDraft.set((event.target as HTMLInputElement).value);
    this.nameError.set(null);
  }

  protected async saveName(): Promise<void> {
    if (this.nameSaving()) {
      return;
    }
    const name = this.nameDraft().trim();
    if (name.length > API_LIMITS.personNameMax) {
      this.nameError.set(NAME_TOO_LONG_MESSAGE);
      return;
    }
    if (name === (this.auth.name() ?? '')) {
      this.editingName.set(false);
      return;
    }
    this.nameSaving.set(true);
    try {
      await this.auth.updateAccount({ name: name.length > 0 ? name : null });
      this.editingName.set(false);
      this.toast.success(NAME_SAVED_MESSAGE);
    } catch (err) {
      this.nameError.set(errorMessage(err, 'Could not save your name.'));
    } finally {
      this.nameSaving.set(false);
    }
  }

  protected toggleEditing(): void {
    if (this.editing()) {
      this.closeEditor();
    } else {
      this.editing.set(true);
    }
  }

  protected togglePasswords(): void {
    this.showPasswords.update((visible) => !visible);
  }

  protected closeEditor(): void {
    this.editing.set(false);
    this.showPasswords.set(false);
    this.passwordError.set(null);
    this.passwords.set({ ...EMPTY_PASSWORDS });
    this.passwordForm().reset();
  }

  protected async logOut(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: 'Log out?',
      message: this.hasUnsavedChanges()
        ? 'Your unsaved settings changes will be lost.'
        : 'You will need your email and password to sign in again.',
      confirmLabel: 'Log out',
      tone: 'danger',
    });
    if (!confirmed) {
      return;
    }
    this.loggingOut.set(true);
    try {
      await this.auth.logout();
    } finally {
      this.loggingOut.set(false);
    }
  }

  private async changePassword(): Promise<TreeValidationResult> {
    this.passwordError.set(null);
    const { currentPassword, newPassword } = this.passwords();
    try {
      await this.auth.changePassword({ currentPassword, newPassword });
      this.toast.success(PASSWORD_CHANGED_MESSAGE);
      this.closeEditor();
      this.passwordChanged.emit();
      return undefined;
    } catch (err) {
      const status = httpStatus(err);
      if (status === 401) {
        this.passwordError.set(SESSION_EXPIRED_MESSAGE);
        return undefined;
      }
      if (status === 400 && /current password/i.test(errorMessage(err))) {
        return [
          {
            fieldTree: this.passwordForm.currentPassword,
            kind: 'server',
            message: WRONG_PASSWORD_MESSAGE,
          },
        ];
      }
      this.passwordError.set(errorMessage(err, 'Could not change your password.'));
      return undefined;
    }
  }
}
