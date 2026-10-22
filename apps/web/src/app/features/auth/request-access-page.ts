import { Component, computed, inject, signal } from '@angular/core';
import {
  FormField,
  FormRoot,
  email,
  form,
  maxLength,
  required,
  validate,
} from '@angular/forms/signals';
import { RouterLink } from '@angular/router';
import { API_LIMITS } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage, httpStatus } from '../../core/errors';
import { LOGIN_PATH } from '../../core/guards';
import { Icon } from '../../shared/ui/icon';
import { Spinner } from '../../shared/ui/spinner';
import { AccessRequestCard } from './access-request-card';
import { AccessRequestStore } from './access-request.store';
import { AuthLayout } from './auth-layout';
import { FormAlert } from './form-alert';

export const REQUEST_RATE_LIMIT_MESSAGE =
  'Too many requests from this network. Please try again in a little while.';

interface RequestModel {
  name: string;
  email: string;
  message: string;
}

const EMPTY_REQUEST: RequestModel = { name: '', email: '', message: '' };

@Component({
  selector: 'app-request-access-page',
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
  templateUrl: './request-access-page.html',
})
export class RequestAccessPage {
  private readonly api = inject(ApiService);
  private readonly access = inject(AccessRequestStore);

  protected readonly loginPath = LOGIN_PATH;
  protected readonly messageMax = API_LIMITS.accessMessageMax;
  protected readonly justSent = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly hasRequest = computed(() => this.access.stored() !== null);
  protected readonly showSent = computed(() => this.justSent() && this.access.view() === 'pending');
  protected readonly title = computed(() => {
    if (this.showSent()) {
      return 'Request sent';
    }
    return this.hasRequest() ? 'Your request' : 'Request access';
  });
  protected readonly subtitle = computed(() => {
    if (this.showSent()) {
      return 'The owner will review it. You don’t need to wait here.';
    }
    return this.hasRequest()
      ? 'Here’s the latest on the request from this device.'
      : 'FoodLog is invite-only. Tell the owner who you are and they’ll let you in.';
  });
  protected readonly model = signal<RequestModel>({ ...EMPTY_REQUEST });
  protected readonly messageLength = computed(() => this.model().message.length);
  protected readonly requestForm = form(
    this.model,
    (path) => {
      required(path.name, { message: 'Enter your name.' });
      validate(path.name, ({ value }) =>
        value().length > 0 && value().trim().length === 0
          ? { kind: 'blank', message: 'Enter your name.' }
          : undefined,
      );
      maxLength(path.name, API_LIMITS.personNameMax, {
        message: `Use at most ${API_LIMITS.personNameMax} characters.`,
      });
      required(path.email, { message: 'Enter your email address.' });
      email(path.email, { message: 'Enter a valid email address.' });
      maxLength(path.message, API_LIMITS.accessMessageMax, {
        message: `Keep the note under ${API_LIMITS.accessMessageMax} characters.`,
      });
    },
    { submission: { action: async () => this.send() } },
  );

  constructor() {
    this.access.syncFromStorage();
  }

  protected startOver(): void {
    this.access.forget();
    this.justSent.set(false);
    this.error.set(null);
  }

  private async send(): Promise<undefined> {
    this.error.set(null);
    const value = this.model();
    const details = { name: value.name.trim(), email: value.email.trim() };
    const message = value.message.trim();
    try {
      const response = await this.api.requestAccess({
        ...details,
        message: message.length > 0 ? message : null,
      });
      this.access.remember(response.statusToken, details);
      this.justSent.set(true);
      this.model.set({ ...EMPTY_REQUEST });
      this.requestForm().reset();
    } catch (err) {
      this.error.set(
        httpStatus(err) === 429
          ? REQUEST_RATE_LIMIT_MESSAGE
          : errorMessage(err, 'Could not send your request.'),
      );
    }
    return undefined;
  }
}
