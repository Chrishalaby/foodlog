import { DOCUMENT, Injectable, computed, inject, signal } from '@angular/core';
import type { AccessRequestStatusResponse, UserDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/errors';

export const ACCESS_REQUEST_STORAGE_KEY = 'foodlog.accessRequest';
export const ACCESS_CHECK_FAILED_MESSAGE = 'Could not check your request right now.';

export interface StoredAccessRequest {
  statusToken: string;
  email: string;
  name: string;
  createdAt: string;
}

export type AccessRequestView =
  'none' | 'checking' | 'error' | 'pending' | 'approved' | 'ready' | 'rejected';

function isStoredRequest(value: unknown): value is StoredAccessRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record['statusToken'] === 'string' &&
    record['statusToken'].length > 0 &&
    typeof record['email'] === 'string' &&
    typeof record['name'] === 'string' &&
    typeof record['createdAt'] === 'string'
  );
}

export function parseStoredRequest(raw: string | null): StoredAccessRequest | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredRequest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function accessRequestView(
  stored: StoredAccessRequest | null,
  status: AccessRequestStatusResponse | null,
  checking: boolean,
  failed: boolean,
): AccessRequestView {
  if (!stored) {
    return 'none';
  }
  if (!status || status.status === 'unknown') {
    if (checking) {
      return 'checking';
    }
    return failed ? 'error' : 'checking';
  }
  switch (status.status) {
    case 'approved':
      return status.canCreateAccount ? 'approved' : 'ready';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending';
  }
}

@Injectable({ providedIn: 'root' })
export class AccessRequestStore {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly storage = resolveStorage(inject(DOCUMENT));
  private readonly storedState = signal<StoredAccessRequest | null>(this.read());
  private readonly statusState = signal<AccessRequestStatusResponse | null>(null);
  private readonly checkingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly checkedAtState = signal<number | null>(null);
  private inflight: Promise<AccessRequestStatusResponse | null> | null = null;

  readonly stored = this.storedState.asReadonly();
  readonly status = this.statusState.asReadonly();
  readonly checking = this.checkingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly checkedAt = this.checkedAtState.asReadonly();
  readonly view = computed(() =>
    accessRequestView(
      this.storedState(),
      this.statusState(),
      this.checkingState(),
      this.errorState() !== null,
    ),
  );

  remember(statusToken: string, details: { email: string; name: string }): void {
    const record: StoredAccessRequest = {
      statusToken,
      email: details.email,
      name: details.name,
      createdAt: new Date().toISOString(),
    };
    this.write(record);
    this.storedState.set(record);
    this.statusState.set({
      status: 'pending',
      email: details.email,
      name: details.name,
      createdAt: record.createdAt,
      decidedAt: null,
      canCreateAccount: false,
    });
    this.errorState.set(null);
    this.checkedAtState.set(Date.now());
  }

  forget(): void {
    attempt(() => this.storage?.removeItem(ACCESS_REQUEST_STORAGE_KEY));
    this.reset();
  }

  forgetIfFor(email: string): void {
    const stored = this.read() ?? this.storedState();
    if (stored && sameEmail(stored.email, email)) {
      this.forget();
    }
  }

  syncFromStorage(): void {
    const current = this.read();
    if (current?.statusToken !== this.storedState()?.statusToken) {
      this.storedState.set(current);
      this.statusState.set(null);
      this.errorState.set(null);
    }
  }

  check(): Promise<AccessRequestStatusResponse | null> {
    this.inflight ??= this.fetchStatus().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  async accept(password: string): Promise<UserDto> {
    const stored = this.storedState();
    if (!stored) {
      throw new Error('There is no access request on this device.');
    }
    const user = await this.auth.acceptAccessRequest({ statusToken: stored.statusToken, password });
    this.forget();
    return user;
  }

  private async fetchStatus(): Promise<AccessRequestStatusResponse | null> {
    const stored = this.storedState();
    if (!stored) {
      return null;
    }
    this.checkingState.set(true);
    try {
      const status = await this.api.accessRequestStatus({ statusToken: stored.statusToken });
      if (this.storedState()?.statusToken !== stored.statusToken) {
        return null;
      }
      if (status.status === 'unknown') {
        this.forget();
        return status;
      }
      this.statusState.set(status);
      this.errorState.set(null);
      this.checkedAtState.set(Date.now());
      return status;
    } catch (err) {
      if (this.storedState()?.statusToken === stored.statusToken) {
        this.errorState.set(errorMessage(err, ACCESS_CHECK_FAILED_MESSAGE));
      }
      return null;
    } finally {
      this.checkingState.set(false);
    }
  }

  private reset(): void {
    this.storedState.set(null);
    this.statusState.set(null);
    this.errorState.set(null);
    this.checkedAtState.set(null);
  }

  private read(): StoredAccessRequest | null {
    try {
      return parseStoredRequest(this.storage?.getItem(ACCESS_REQUEST_STORAGE_KEY) ?? null);
    } catch {
      return null;
    }
  }

  private write(record: StoredAccessRequest): void {
    attempt(() => this.storage?.setItem(ACCESS_REQUEST_STORAGE_KEY, JSON.stringify(record)));
  }
}

function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function attempt(action: () => void): void {
  try {
    action();
  } catch {
    return;
  }
}

function resolveStorage(document: Document): Storage | null {
  try {
    return document.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}
