import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import {
  FormField,
  FormRoot,
  type TreeValidationResult,
  form,
  maxLength,
} from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { API_LIMITS, type AuthTokenInfoResponse, type AuthTokenType } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { HOME_PATH, LOGIN_PATH, ONBOARDING_PATH, REQUEST_ACCESS_PATH } from '../../core/guards';
import { ToastService } from '../../core/toast.service';
import { Icon, type IconName } from '../../shared/ui/icon';
import { Skeleton } from '../../shared/ui/skeleton';
import { Spinner } from '../../shared/ui/spinner';
import { expiryLabel } from '../admin/admin-format';
import { AccessRequestStore } from './access-request.store';
import { AuthLayout } from './auth-layout';
import { FormAlert } from './form-alert';
import { NewPasswordFields, newPasswordRules } from './new-password-fields';

export type TokenReason = NonNullable<AuthTokenInfoResponse['reason']>;
export type TokenPageState = 'loading' | 'error' | 'invalid' | 'signed-in' | 'form';

export const INVITE_WELCOME_MESSAGE = 'Welcome to FoodLog! Let’s set up your targets.';
export const RESET_DONE_MESSAGE = 'Password updated. You’re signed in.';

interface ReasonCopy {
  title: string;
  text: string;
  icon: IconName;
}

export function reasonCopy(
  reason: TokenReason,
  type: AuthTokenType,
  email: string | null,
): ReasonCopy {
  const invite = type === 'invite';
  switch (reason) {
    case 'expired':
      return {
        title: 'This link has expired',
        text: invite
          ? `Invite links work for ${API_LIMITS.inviteTtlDays} days. Ask the owner for a fresh one.`
          : `Reset links work for ${API_LIMITS.resetTtlDays} days. Ask the owner for a new one.`,
        icon: 'clock',
      };
    case 'used':
      return {
        title: 'This link was already used',
        text: invite
          ? 'Each invite works once. If you already set your password, just sign in.'
          : 'Each reset link works once. If you already changed your password, just sign in.',
        icon: 'check',
      };
    case 'revoked':
      return {
        title: 'This link was cancelled',
        text: 'The owner replaced or cancelled it. Ask them to send you a new link.',
        icon: 'close',
      };
    case 'account_exists':
      return {
        title: 'You already have an account',
        text: `${email ? `${email} is already` : 'This email is already'} set up. Sign in with your password instead.`,
        icon: 'lock',
      };
    default:
      return {
        title: 'This link doesn’t work',
        text: 'Check that you opened the whole link, or ask the owner to send it again.',
        icon: 'alert',
      };
  }
}

interface TokenModel {
  name: string;
  password: string;
  confirmPassword: string;
}

@Component({
  selector: 'app-auth-token-page',
  imports: [
    AuthLayout,
    FormAlert,
    FormField,
    FormRoot,
    Icon,
    NewPasswordFields,
    RouterLink,
    Skeleton,
    Spinner,
  ],
  templateUrl: './auth-token-page.html',
})
export class AuthTokenPage {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly access = inject(AccessRequestStore);
  private loadVersion = 0;

  readonly token = input.required<string>();
  readonly mode = input<AuthTokenType>('invite');

  protected readonly loginPath = LOGIN_PATH;
  protected readonly homePath = HOME_PATH;
  protected readonly requestAccessPath = REQUEST_ACCESS_PATH;
  protected readonly info = signal<AuthTokenInfoResponse | null>(null);
  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly submitError = signal<string | null>(null);
  protected readonly signingOut = signal(false);
  protected readonly signedIn = this.auth.isAuthenticated;
  protected readonly currentEmail = computed(() => this.auth.user()?.email ?? '');
  protected readonly type = computed<AuthTokenType>(() => this.info()?.type ?? this.mode());
  protected readonly isInvite = computed(() => this.type() === 'invite');
  protected readonly email = computed(() => this.info()?.email ?? '');
  protected readonly state = computed<TokenPageState>(() => {
    const info = this.info();
    if (this.loading() && !info) {
      return 'loading';
    }
    if (!info) {
      return 'error';
    }
    if (!info.valid) {
      return 'invalid';
    }
    return this.signedIn() ? 'signed-in' : 'form';
  });
  protected readonly reason = computed(() => {
    const info = this.info();
    return reasonCopy(info?.reason ?? 'not_found', this.type(), info?.email ?? null);
  });
  protected readonly signedInMessage = computed(
    () =>
      `You’re signed in as ${this.currentEmail()}. Sign out first to use this ${this.isInvite() ? 'invite' : 'reset link'} for ${this.email()}.`,
  );
  protected readonly expiry = computed(() => expiryLabel(this.info()?.expiresAt));
  protected readonly title = computed(() => {
    switch (this.state()) {
      case 'loading':
        return 'Opening your link';
      case 'error':
        return 'Link didn’t load';
      case 'invalid':
        return this.reason().title;
      default:
        return this.isInvite() ? 'Join FoodLog' : 'Choose a new password';
    }
  });
  protected readonly subtitle = computed(() => {
    const info = this.info();
    switch (this.state()) {
      case 'form':
      case 'signed-in':
        if (this.isInvite()) {
          return info?.name
            ? `Hi ${info.name}! Set a password to create your account.`
            : 'You’re invited. Set a password to create your account.';
        }
        return 'Pick a new password. Other devices will be signed out.';
      default:
        return '';
    }
  });
  protected readonly model = signal<TokenModel>({ name: '', password: '', confirmPassword: '' });
  protected readonly tokenForm = form(
    this.model,
    (path) => {
      maxLength(path.name, API_LIMITS.personNameMax, {
        message: `Use at most ${API_LIMITS.personNameMax} characters.`,
      });
      newPasswordRules(path.password, path.confirmPassword);
    },
    { submission: { action: async () => this.accept() } },
  );

  constructor() {
    effect(() => {
      const token = this.token();
      untracked(() => void this.load(token));
    });
  }

  protected retry(): void {
    void this.load(this.token());
  }

  protected async signOutFirst(): Promise<void> {
    this.signingOut.set(true);
    this.submitError.set(null);
    try {
      await this.auth.signOut();
    } catch (err) {
      this.toast.error(errorMessage(err, 'Could not sign out. Check your connection.'));
    } finally {
      this.signingOut.set(false);
    }
  }

  private async load(token: string): Promise<void> {
    const version = ++this.loadVersion;
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const info = await this.api.authTokenInfo(token);
      if (version !== this.loadVersion) {
        return;
      }
      this.info.set(info);
      if (info.valid) {
        this.model.update((model) => ({ ...model, name: model.name || (info.name ?? '') }));
      }
    } catch (err) {
      if (version !== this.loadVersion) {
        return;
      }
      if (httpStatus(err) === 404) {
        this.info.set(notFoundInfo(this.mode()));
      } else {
        this.info.set(null);
        this.loadError.set(errorMessage(err, 'Could not open this link.'));
      }
    } finally {
      if (version === this.loadVersion) {
        this.loading.set(false);
      }
    }
  }

  private async accept(): Promise<TreeValidationResult> {
    this.submitError.set(null);
    const value = this.model();
    const invite = this.isInvite();
    const name = value.name.trim();
    try {
      const user = await this.auth.acceptAuthToken(
        this.token(),
        invite
          ? { password: value.password, name: name.length > 0 ? name : null }
          : { password: value.password },
      );
      this.access.forgetIfFor(user.email);
      this.toast.success(invite ? INVITE_WELCOME_MESSAGE : RESET_DONE_MESSAGE);
      await this.auth.enterApp(invite ? ONBOARDING_PATH : HOME_PATH);
    } catch (err) {
      const status = httpStatus(err);
      if (status === 403 || status === 404 || status === 409 || status === 410) {
        await this.load(this.token());
      }
      if (this.state() === 'form') {
        this.submitError.set(errorMessage(err, 'Could not save your password.'));
      }
    }
    return undefined;
  }
}

function notFoundInfo(type: AuthTokenType): AuthTokenInfoResponse {
  return { type, email: null, name: null, valid: false, reason: 'not_found', expiresAt: null };
}
