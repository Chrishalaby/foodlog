import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { AuthStatusResponse, UserDto } from '@food/shared';
import { ApiService } from './api.service';
import {
  AUTH_REFRESH_INTERVAL_MS,
  AuthService,
  HARD_NAVIGATE,
  displayNameOf,
} from './auth.service';
import { SessionScope } from './session-scope';

@Component({ template: '' })
class Page {}

const MEMBER: UserDto = { id: 'u1', email: 'maya@example.com', name: 'Maya', role: 'member' };
const ADMIN: UserDto = { id: 'u2', email: 'owner@example.com', name: null, role: 'admin' };

function status(user: UserDto | null, setupRequired = false): AuthStatusResponse {
  return { setupRequired, authenticated: user !== null, user };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createApi() {
  return {
    authStatus: vi.fn(async (): Promise<AuthStatusResponse> => status(null)),
    login: vi.fn(async (): Promise<UserDto> => MEMBER),
    setup: vi.fn(async (): Promise<UserDto> => ADMIN),
    logout: vi.fn(async (): Promise<void> => undefined),
    changePassword: vi.fn(async (): Promise<void> => undefined),
    acceptAccessRequest: vi.fn(async (): Promise<UserDto> => MEMBER),
    acceptAuthToken: vi.fn(async (): Promise<UserDto> => MEMBER),
    updateAccount: vi.fn(async (body: { name: string | null }): Promise<UserDto> => ({
      ...MEMBER,
      name: body.name,
    })),
  };
}

describe('AuthService', () => {
  let api: ReturnType<typeof createApi>;
  let auth: AuthService;
  let hardNavigate: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    api = createApi();
    hardNavigate = vi.fn<(url: string) => void>();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Page },
          { path: 'today', component: Page },
        ]),
        { provide: ApiService, useValue: api },
        { provide: HARD_NAVIGATE, useValue: hardNavigate },
      ],
    });
    auth = TestBed.inject(AuthService);
  });

  it('exposes the role, admin flag and name from the signed-in user', async () => {
    api.authStatus.mockResolvedValueOnce(status(ADMIN));
    expect(auth.role()).toBeNull();
    expect(auth.isAdmin()).toBe(false);
    await auth.load();
    expect(auth.status()).toBe('authenticated');
    expect(auth.role()).toBe('admin');
    expect(auth.isAdmin()).toBe(true);
    expect(auth.name()).toBeNull();
    expect(auth.displayName()).toBe('owner');
  });

  it('treats members as non-admins and trims their name', async () => {
    api.authStatus.mockResolvedValueOnce(status({ ...MEMBER, name: '  Maya  ' }));
    await auth.load();
    expect(auth.role()).toBe('member');
    expect(auth.isAdmin()).toBe(false);
    expect(auth.name()).toBe('Maya');
  });

  it('drops the role as soon as the session ends', async () => {
    api.authStatus.mockResolvedValueOnce(status(ADMIN));
    await auth.load();
    auth.markLoggedOut();
    expect(auth.isAdmin()).toBe(false);
    expect(auth.role()).toBeNull();
    expect(auth.user()).toBeNull();
  });

  it('refreshes the status after signing in so server-side promotions show up', async () => {
    api.authStatus.mockResolvedValue(status(ADMIN));
    api.login.mockResolvedValueOnce({ ...ADMIN, role: 'member' });
    await auth.login({ email: ADMIN.email, password: 'secret-pass' });
    expect(auth.isAuthenticated()).toBe(true);
    await vi.waitFor(() => expect(auth.isAdmin()).toBe(true));
    expect(api.authStatus).toHaveBeenCalledTimes(1);
  });

  it('ignores a status response that was requested before signing in', async () => {
    const stale = deferred<AuthStatusResponse>();
    api.authStatus.mockReturnValueOnce(stale.promise).mockResolvedValue(status(MEMBER));
    const loading = auth.load();
    await auth.login({ email: MEMBER.email, password: 'secret-pass' });
    stale.resolve(status(null));
    await loading;
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.user()?.id).toBe(MEMBER.id);
  });

  it('signs in after accepting an access request or an invite link', async () => {
    api.authStatus.mockResolvedValue(status(MEMBER));
    await auth.acceptAccessRequest({ statusToken: 'tok', password: 'secret-pass' });
    expect(api.acceptAccessRequest).toHaveBeenCalledWith({
      statusToken: 'tok',
      password: 'secret-pass',
    });
    expect(auth.isAuthenticated()).toBe(true);

    auth.markLoggedOut();
    await auth.acceptAuthToken('link-token', { password: 'secret-pass', name: 'Maya' });
    expect(api.acceptAuthToken).toHaveBeenCalledWith('link-token', {
      password: 'secret-pass',
      name: 'Maya',
    });
    expect(auth.user()).toEqual(MEMBER);
  });

  it('updates the signed-in user after renaming the account', async () => {
    api.authStatus.mockResolvedValueOnce(status(MEMBER));
    await auth.load();
    await auth.updateAccount({ name: 'Maya H.' });
    expect(auth.name()).toBe('Maya H.');
  });

  it('signs out without navigating away', async () => {
    api.authStatus.mockResolvedValueOnce(status(MEMBER));
    await auth.load();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    await auth.signOut();
    expect(api.logout).toHaveBeenCalled();
    expect(auth.status()).toBe('anonymous');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('stays signed in when signing out fails', async () => {
    api.authStatus.mockResolvedValueOnce(status(MEMBER));
    await auth.load();
    api.logout.mockRejectedValueOnce(new Error('offline'));
    await expect(auth.signOut()).rejects.toThrow('offline');
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('keeps logout behaviour: clears the session and goes to the login page', async () => {
    api.authStatus.mockResolvedValueOnce(status(MEMBER));
    await auth.load();
    await auth.logout();
    expect(auth.status()).toBe('anonymous');
    expect(TestBed.inject(Router).url).toBe('/login');
  });

  it('enters the app in place when the same account signs back in', async () => {
    api.authStatus.mockResolvedValue(status(MEMBER));
    await auth.load();
    auth.markLoggedOut();
    await auth.login({ email: MEMBER.email, password: 'secret-pass' });
    await auth.enterApp('/today');
    expect(TestBed.inject(Router).url).toBe('/today');
    expect(hardNavigate).not.toHaveBeenCalled();
  });

  it('reloads into the app when another account signs in on this device', async () => {
    api.authStatus.mockResolvedValueOnce(status(ADMIN)).mockResolvedValue(status(MEMBER));
    await auth.load();
    auth.markLoggedOut();
    await auth.login({ email: MEMBER.email, password: 'secret-pass' });
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigateByUrl');
    await auth.enterApp('/today');
    expect(hardNavigate).toHaveBeenCalledWith('/today');
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('session scope', () => {
    let resets: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
      resets = vi.fn<() => void>();
      TestBed.inject(SessionScope).onReset(resets);
    });

    it('does not reset when the first status check finds a session', async () => {
      api.authStatus.mockResolvedValue(status(MEMBER));
      await auth.load();
      await auth.load();
      expect(resets).not.toHaveBeenCalled();
    });

    it('resets once when the session ends, with the user already gone', async () => {
      api.authStatus.mockResolvedValueOnce(status(MEMBER));
      await auth.load();
      const seen: (string | null)[] = [];
      resets.mockImplementation(() => seen.push(auth.user()?.id ?? auth.status()));
      auth.markLoggedOut();
      auth.markLoggedOut();
      expect(resets).toHaveBeenCalledTimes(1);
      expect(seen).toEqual(['anonymous']);
    });

    it('resets on logout and sign-out', async () => {
      api.authStatus.mockResolvedValue(status(MEMBER));
      await auth.load();
      await auth.logout();
      expect(resets).toHaveBeenCalledTimes(1);

      await auth.login({ email: MEMBER.email, password: 'secret-pass' });
      resets.mockClear();
      await auth.signOut();
      expect(resets).toHaveBeenCalledTimes(1);
    });

    it('resets on every sign-in, after the new user is set', async () => {
      api.authStatus.mockResolvedValue(status(MEMBER));
      const seen: (string | undefined)[] = [];
      resets.mockImplementation(() => seen.push(auth.user()?.id));
      await auth.login({ email: MEMBER.email, password: 'secret-pass' });
      expect(seen).toEqual([MEMBER.id]);
      await vi.waitFor(() => expect(api.authStatus).toHaveBeenCalled());
      expect(resets).toHaveBeenCalledTimes(1);
    });

    it('resets when a status check finds another account or no session', async () => {
      api.authStatus
        .mockResolvedValueOnce(status(MEMBER))
        .mockResolvedValueOnce(status(ADMIN))
        .mockResolvedValueOnce(status(null));
      await auth.load();
      await auth.load();
      expect(resets).toHaveBeenCalledTimes(1);
      expect(auth.user()?.id).toBe(ADMIN.id);
      await auth.load();
      expect(resets).toHaveBeenCalledTimes(2);
      expect(auth.status()).toBe('anonymous');
    });
  });

  it('reports a failed status load to guards and shares one request', async () => {
    api.authStatus.mockRejectedValueOnce(new Error('down'));
    expect(await auth.ensureLoaded()).toBe(false);
    expect(auth.status()).toBe('unknown');

    const pending = deferred<AuthStatusResponse>();
    api.authStatus.mockReturnValueOnce(pending.promise);
    const first = auth.ensureLoaded();
    const second = auth.ensureLoaded();
    pending.resolve(status(null, true));
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(api.authStatus).toHaveBeenCalledTimes(2);
    expect(auth.setupRequired()).toBe(true);
  });
});

describe('AuthService recovery and refresh', () => {
  let api: ReturnType<typeof createApi>;
  let auth: AuthService;
  let resets: ReturnType<typeof vi.fn<() => void>>;
  let now: number;

  beforeEach(() => {
    api = createApi();
    now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: HARD_NAVIGATE, useValue: vi.fn() },
      ],
    });
    auth = TestBed.inject(AuthService);
    resets = vi.fn<() => void>();
    TestBed.inject(SessionScope).onReset(resets);
  });

  afterEach(() => vi.restoreAllMocks());

  async function signedInAs(user: UserDto): Promise<void> {
    api.authStatus.mockResolvedValueOnce(status(user));
    await auth.load();
    now += AUTH_REFRESH_INTERVAL_MS;
  }

  function setVisibility(state: DocumentVisibilityState): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  }

  it('recovers the signed-in user after a failed launch check', async () => {
    api.authStatus.mockRejectedValueOnce(new Error('502'));
    expect(await auth.ensureLoaded()).toBe(false);
    expect(auth.status()).toBe('unknown');

    api.authStatus.mockResolvedValueOnce(status(ADMIN));
    auth.recover();
    await vi.waitFor(() => expect(auth.status()).toBe('authenticated'));
    expect(auth.isAdmin()).toBe(true);
    expect(auth.user()?.id).toBe(ADMIN.id);
    expect(resets).not.toHaveBeenCalled();
  });

  it('only re-checks the status while it is unknown', async () => {
    await signedInAs(MEMBER);
    api.authStatus.mockClear();
    auth.recover();
    expect(api.authStatus).not.toHaveBeenCalled();
  });

  it('picks up a promotion to admin without a reload', async () => {
    await signedInAs(MEMBER);
    api.authStatus.mockResolvedValueOnce(status({ ...MEMBER, role: 'admin', name: 'Maya H.' }));
    await auth.refresh();
    expect(auth.isAdmin()).toBe(true);
    expect(auth.name()).toBe('Maya H.');
    expect(auth.status()).toBe('authenticated');
    expect(resets).not.toHaveBeenCalled();
  });

  it('never ends the session from a background refresh', async () => {
    await signedInAs(MEMBER);
    api.authStatus.mockResolvedValueOnce(status(null));
    await auth.refresh();
    expect(auth.status()).toBe('authenticated');
    expect(auth.user()).toEqual(MEMBER);
    expect(resets).not.toHaveBeenCalled();
  });

  it('ignores a refresh that answers for another account', async () => {
    await signedInAs(MEMBER);
    api.authStatus.mockResolvedValueOnce(status(ADMIN));
    await auth.refresh();
    expect(auth.user()).toEqual(MEMBER);
    expect(resets).not.toHaveBeenCalled();
  });

  it('refreshes at most once per interval', async () => {
    await signedInAs(MEMBER);
    api.authStatus.mockClear();
    api.authStatus.mockResolvedValue(status(MEMBER));
    await auth.refresh();
    await auth.refresh();
    expect(api.authStatus).toHaveBeenCalledTimes(1);
    now += AUTH_REFRESH_INTERVAL_MS;
    await auth.refresh();
    expect(api.authStatus).toHaveBeenCalledTimes(2);
  });

  it('discards a refresh that lands after signing out', async () => {
    await signedInAs(MEMBER);
    const late = deferred<AuthStatusResponse>();
    api.authStatus.mockReturnValueOnce(late.promise);
    const refreshing = auth.refresh();
    auth.markLoggedOut();
    late.resolve(status({ ...MEMBER, role: 'admin' }));
    await refreshing;
    expect(auth.user()).toBeNull();
    expect(auth.isAdmin()).toBe(false);
  });

  it('keeps the current state when a refresh fails', async () => {
    await signedInAs(MEMBER);
    api.authStatus.mockRejectedValueOnce(new Error('offline'));
    await expect(auth.refresh()).resolves.toBeUndefined();
    expect(auth.user()).toEqual(MEMBER);
  });

  it('does nothing for signed-out users', async () => {
    api.authStatus.mockResolvedValueOnce(status(null));
    await auth.load();
    now += AUTH_REFRESH_INTERVAL_MS;
    api.authStatus.mockClear();
    await auth.refresh();
    expect(api.authStatus).not.toHaveBeenCalled();
  });

  describe('watch', () => {
    afterEach(() => setVisibility('visible'));

    it('refreshes the user when the app comes back to the foreground', async () => {
      await signedInAs(MEMBER);
      auth.watch();
      auth.watch();
      api.authStatus.mockClear();
      api.authStatus.mockResolvedValue(status({ ...MEMBER, role: 'admin' }));

      setVisibility('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      expect(api.authStatus).not.toHaveBeenCalled();

      setVisibility('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.waitFor(() => expect(auth.isAdmin()).toBe(true));
      expect(api.authStatus).toHaveBeenCalledTimes(1);
    });

    it('retries a failed launch check when the device comes back online', async () => {
      api.authStatus.mockRejectedValueOnce(new Error('offline'));
      await auth.ensureLoaded();
      auth.watch();
      api.authStatus.mockResolvedValueOnce(status(MEMBER));
      window.dispatchEvent(new Event('online'));
      await vi.waitFor(() => expect(auth.status()).toBe('authenticated'));
      expect(auth.user()).toEqual(MEMBER);
    });
  });
});

describe('displayNameOf', () => {
  it('prefers the name and falls back to the email user part', () => {
    expect(displayNameOf({ name: ' Maya ', email: 'm@example.com' })).toBe('Maya');
    expect(displayNameOf({ name: null, email: 'maya.h@example.com' })).toBe('maya.h');
    expect(displayNameOf(null)).toBe('');
  });
});
