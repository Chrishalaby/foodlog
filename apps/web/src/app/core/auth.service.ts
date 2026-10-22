import {
  DOCUMENT,
  DestroyRef,
  Injectable,
  InjectionToken,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import {
  toLocalDate,
  type AcceptAccessRequest,
  type AcceptAuthTokenRequest,
  type AuthStatusResponse,
  type ChangePasswordRequest,
  type DemoStatusDto,
  type LoginRequest,
  type SetupRequest,
  type UpdateAccountRequest,
  type UserDto,
  type UserRole,
} from '@food/shared';
import { ApiService } from './api.service';
import { SessionScope } from './session-scope';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

export const AUTH_REFRESH_INTERVAL_MS = 60_000;

export const HARD_NAVIGATE = new InjectionToken<(url: string) => void>('HARD_NAVIGATE', {
  providedIn: 'root',
  factory: () => {
    const location = inject(DOCUMENT).location;
    return (url: string) => location.replace(url);
  },
});

interface InflightStatus {
  revision: number;
  promise: Promise<AuthStatusResponse>;
}

function isStatusResponse(value: unknown): value is AuthStatusResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AuthStatusResponse).authenticated === 'boolean'
  );
}

export function displayNameOf(user: Pick<UserDto, 'name' | 'email'> | null): string {
  if (!user) {
    return '';
  }
  const name = user.name?.trim();
  return name ? name : user.email.split('@')[0] || user.email;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly hardNavigate = inject(HARD_NAVIGATE);
  private readonly scope = inject(SessionScope);
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly statusState = signal<AuthStatus>('unknown');
  private readonly userState = signal<UserDto | null>(null);
  private readonly setupRequiredState = signal(false);
  private readonly demoState = signal<DemoStatusDto | null>(null);
  private readonly notesState = signal(false);
  private inflight: InflightStatus | null = null;
  private revision = 0;
  private lastUserId: string | null = null;
  private scopeUserId: string | null = null;
  private accountSwitched = false;
  private lastRefreshAt = 0;
  private watching = false;

  readonly status = this.statusState.asReadonly();
  readonly user = this.userState.asReadonly();
  readonly setupRequired = this.setupRequiredState.asReadonly();
  readonly demo = this.demoState.asReadonly();
  readonly notesEnabled = this.notesState.asReadonly();
  readonly isAuthenticated = computed(() => this.statusState() === 'authenticated');
  readonly role = computed<UserRole | null>(() =>
    this.isAuthenticated() ? (this.userState()?.role ?? null) : null,
  );
  readonly isAdmin = computed(() => this.role() === 'admin');
  readonly name = computed(() => this.userState()?.name?.trim() || null);
  readonly displayName = computed(() => displayNameOf(this.userState()));

  load(): Promise<AuthStatusResponse> {
    if (this.inflight?.revision === this.revision) {
      return this.inflight.promise;
    }
    const revision = this.revision;
    const promise = Promise.resolve()
      .then(() => this.api.authStatus())
      .then((response) => {
        if (revision === this.revision && isStatusResponse(response)) {
          this.applyStatus(response);
        }
        return response;
      });
    const entry: InflightStatus = { revision, promise };
    this.inflight = entry;
    const release = (): void => {
      if (this.inflight === entry) {
        this.inflight = null;
      }
    };
    promise.then(release, release);
    return promise;
  }

  async ensureLoaded(): Promise<boolean> {
    if (this.statusState() !== 'unknown') {
      return true;
    }
    try {
      await this.load();
      return this.statusState() !== 'unknown';
    } catch {
      return false;
    }
  }

  recover(): void {
    if (this.statusState() === 'unknown') {
      this.load().catch(() => undefined);
    }
  }

  async refresh(): Promise<void> {
    if (
      !this.isAuthenticated() ||
      this.inflight !== null ||
      Date.now() - this.lastRefreshAt < AUTH_REFRESH_INTERVAL_MS
    ) {
      return;
    }
    this.lastRefreshAt = Date.now();
    const revision = this.revision;
    const userId = this.userState()?.id;
    try {
      const response = await this.api.authStatus();
      if (
        revision === this.revision &&
        isStatusResponse(response) &&
        response.authenticated &&
        response.user !== null &&
        response.user.id === userId
      ) {
        this.userState.set(response.user);
      }
    } catch {
      return;
    }
  }

  watch(): void {
    if (this.watching) {
      return;
    }
    this.watching = true;
    const doc = this.document;
    const view = doc.defaultView;
    const onVisibilityChange = (): void => {
      if (doc.visibilityState === 'visible') {
        this.wake();
      }
    };
    const onOnline = (): void => this.wake();
    doc.addEventListener('visibilitychange', onVisibilityChange);
    view?.addEventListener('online', onOnline);
    this.destroyRef.onDestroy(() => {
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      view?.removeEventListener('online', onOnline);
    });
  }

  async login(body: LoginRequest): Promise<UserDto> {
    return this.signedIn(await this.api.login(body));
  }

  async startDemo(now: Date = new Date()): Promise<UserDto> {
    return this.signedIn(
      await this.api.startDemo({
        localDate: toLocalDate(now),
        utcOffsetMinutes: -now.getTimezoneOffset(),
      }),
    );
  }

  async setup(body: SetupRequest): Promise<UserDto> {
    return this.signedIn(await this.api.setup(body));
  }

  async acceptAccessRequest(body: AcceptAccessRequest): Promise<UserDto> {
    return this.signedIn(await this.api.acceptAccessRequest(body));
  }

  async acceptAuthToken(token: string, body: AcceptAuthTokenRequest): Promise<UserDto> {
    return this.signedIn(await this.api.acceptAuthToken(token, body));
  }

  async updateAccount(body: UpdateAccountRequest): Promise<UserDto> {
    const userId = this.userState()?.id;
    const user = await this.api.updateAccount(body);
    if (userId && user.id === userId && this.isAuthenticated()) {
      this.userState.set(user);
    }
    return user;
  }

  async enterApp(url: string): Promise<void> {
    if (this.accountSwitched) {
      this.hardNavigate(url);
      return;
    }
    await this.router.navigateByUrl(url, { replaceUrl: true });
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } finally {
      this.markLoggedOut();
      await this.router.navigateByUrl('/login');
    }
  }

  async signOut(): Promise<void> {
    await this.api.logout();
    this.markLoggedOut();
  }

  changePassword(body: ChangePasswordRequest): Promise<void> {
    return this.api.changePassword(body);
  }

  markLoggedOut(): void {
    this.revision++;
    this.userState.set(null);
    this.statusState.set('anonymous');
    this.moveScope(null);
  }

  private wake(): void {
    if (this.statusState() === 'unknown') {
      this.recover();
      return;
    }
    void this.refresh();
  }

  private signedIn(user: UserDto): UserDto {
    this.revision++;
    this.lastRefreshAt = Date.now();
    this.rememberUser(user);
    this.userState.set(user);
    this.setupRequiredState.set(false);
    this.statusState.set('authenticated');
    this.moveScope(user.id, true);
    this.load().catch(() => undefined);
    return user;
  }

  private applyStatus(response: AuthStatusResponse): void {
    const user = response.authenticated ? response.user : null;
    this.lastRefreshAt = Date.now();
    this.rememberUser(user);
    this.setupRequiredState.set(response.setupRequired === true);
    this.demoState.set(response.demo ?? null);
    this.notesState.set(response.notes === true);
    this.userState.set(user);
    this.statusState.set(user ? 'authenticated' : 'anonymous');
    this.moveScope(user?.id ?? null);
  }

  private rememberUser(user: UserDto | null): void {
    if (!user) {
      return;
    }
    if (this.lastUserId !== null && this.lastUserId !== user.id) {
      this.accountSwitched = true;
    }
    this.lastUserId = user.id;
  }

  private moveScope(userId: string | null, always = false): void {
    const previous = this.scopeUserId;
    this.scopeUserId = userId;
    if (always || (previous !== null && previous !== userId)) {
      this.scope.reset();
    }
  }
}
