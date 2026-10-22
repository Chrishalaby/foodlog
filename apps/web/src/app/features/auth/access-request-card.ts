import { Component, DOCUMENT, DestroyRef, computed, inject, signal } from '@angular/core';
import { FormRoot, type TreeValidationResult, form } from '@angular/forms/signals';
import { AuthService } from '../../core/auth.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { ONBOARDING_PATH } from '../../core/guards';
import { ToastService } from '../../core/toast.service';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { timeAgo } from '../admin/admin-format';
import { AccessRequestStore, type AccessRequestView } from './access-request.store';
import { FormAlert } from './form-alert';
import { NewPasswordFields, newPasswordRules } from './new-password-fields';

export const ACCESS_POLL_MS = 30_000;
export const WELCOME_MESSAGE = 'Welcome to FoodLog!';

const VIEW_ANNOUNCEMENTS: Record<AccessRequestView, string> = {
  none: '',
  checking: '',
  error: 'Could not check your access request.',
  pending: 'Your access request is waiting for approval.',
  approved: 'Your access request was approved. Create your password.',
  ready: 'Your account is ready. Sign in with your password.',
  rejected: 'Your access request was not approved.',
};

interface PasswordModel {
  password: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-access-request-card',
  imports: [FormRoot, FormAlert, Icon, NewPasswordFields, Spinner],
  host: { class: 'block' },
  templateUrl: './access-request-card.html',
})
export class AccessRequestCard {
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly document = inject(DOCUMENT);

  protected readonly store = inject(AccessRequestStore);
  protected readonly view = this.store.view;
  protected readonly stored = this.store.stored;
  protected readonly now = signal(Date.now());
  protected readonly acceptError = signal<string | null>(null);
  protected readonly name = computed(() => this.store.status()?.name ?? this.stored()?.name ?? '');
  protected readonly email = computed(
    () => this.store.status()?.email ?? this.stored()?.email ?? '',
  );
  protected readonly checkedLabel = computed(() => {
    const checkedAt = this.store.checkedAt();
    return checkedAt === null
      ? ''
      : `Checked ${timeAgo(new Date(checkedAt).toISOString(), this.now())}`;
  });
  protected readonly announcement = computed(() => VIEW_ANNOUNCEMENTS[this.view()]);
  protected readonly passwords = signal<PasswordModel>({ password: '', confirmPassword: '' });
  protected readonly passwordForm = form(
    this.passwords,
    (path) => newPasswordRules(path.password, path.confirmPassword),
    { submission: { action: async () => this.createAccount() } },
  );

  constructor() {
    this.store.syncFromStorage();
    void this.store.check();
    const timer = setInterval(() => this.poll(), ACCESS_POLL_MS);
    const onVisibility = (): void => {
      if (this.document.visibilityState === 'visible') {
        this.now.set(Date.now());
        void this.store.check();
      }
    };
    this.document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      this.document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  protected checkNow(): void {
    this.now.set(Date.now());
    void this.store.check();
  }

  protected dismiss(): void {
    this.store.forget();
  }

  private poll(): void {
    this.now.set(Date.now());
    const view = this.view();
    if (this.document.visibilityState === 'visible' && (view === 'pending' || view === 'error')) {
      void this.store.check();
    }
  }

  private async createAccount(): Promise<TreeValidationResult> {
    this.acceptError.set(null);
    try {
      await this.store.accept(this.passwords().password);
      this.toast.success(WELCOME_MESSAGE);
      await this.auth.enterApp(ONBOARDING_PATH);
    } catch (err) {
      const status = httpStatus(err);
      if (status === 400 || status === 403 || status === 404 || status === 409 || status === 410) {
        await this.store.check();
      }
      if (this.view() === 'approved') {
        this.acceptError.set(errorMessage(err, 'Could not create your account.'));
      }
    }
    return undefined;
  }
}
