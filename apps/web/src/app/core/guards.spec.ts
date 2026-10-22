import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  type ActivatedRouteSnapshot,
  Router,
  type RouterStateSnapshot,
  type UrlTree,
  provideRouter,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { ProfileDto, ProfileResponse } from '@food/shared';
import { AppIdentityService } from './app-identity.service';
import { AuthService } from './auth.service';
import {
  accountLinkGuard,
  adminGuard,
  AUTH_CHECK_TIMEOUT_MS,
  authGuard,
  guestGuard,
  notesEnabledGuard,
  notesHostGuard,
  ONBOARDING_CHECK_TIMEOUT_MS,
  onboardingGuard,
  safeRedirectPath,
  setupGuard,
} from './guards';
import { ProfileStore } from './profile.store';

@Component({ template: 'page' })
class Page {}

class FakeAuthService {
  readonly setupRequired = signal(false);
  readonly isAuthenticated = signal(false);
  readonly isAdmin = signal(false);
  readonly notesEnabled = signal(true);
  loadResult = true;
  ensureLoaded = vi.fn(async () => this.loadResult);
  recover = vi.fn();
}

function profileWith(onboarded: boolean | undefined): ProfileResponse {
  const profile = { onboarded } as ProfileDto;
  return { profile } as ProfileResponse;
}

class FakeProfileStore {
  result: ProfileResponse | null = profileWith(true);
  ensureLoaded = vi.fn(async (): Promise<ProfileResponse | null> => this.result);
}

describe('route guards', () => {
  let auth: FakeAuthService;
  let store: FakeProfileStore;
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    auth = new FakeAuthService();
    store = new FakeProfileStore();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ProfileStore, useValue: store },
        provideRouter([
          { path: 'login', component: Page, canActivate: [guestGuard] },
          { path: 'setup', component: Page, canActivate: [setupGuard] },
          { path: 'onboarding', component: Page, canActivate: [authGuard] },
          { path: 'request-access', component: Page, canActivate: [guestGuard] },
          { path: 'invite/:token', component: Page, canActivate: [accountLinkGuard] },
          { path: 'reset/:token', component: Page, canActivate: [accountLinkGuard] },
          {
            path: '',
            canActivate: [authGuard],
            canActivateChild: [onboardingGuard],
            children: [
              { path: 'today', component: Page },
              { path: 'history', component: Page },
              { path: 'admin', component: Page, canActivate: [adminGuard] },
            ],
          },
        ]),
      ],
    });
    harness = await RouterTestingHarness.create();
  });

  async function navigate(url: string): Promise<string> {
    await harness.navigateByUrl(url);
    return TestBed.inject(Router).url;
  }

  it('redirects anonymous users to login with the requested url as next', async () => {
    expect(await navigate('/history?day=2026-09-28')).toBe(
      '/login?next=%2Fhistory%3Fday%3D2026-09-28',
    );
    expect(auth.ensureLoaded).toHaveBeenCalled();
  });

  it('sends everyone to setup while setup is required', async () => {
    auth.setupRequired.set(true);
    expect(await navigate('/today')).toBe('/setup');
    expect(await navigate('/login')).toBe('/setup');
  });

  it('lets authenticated users into the app and keeps them away from login', async () => {
    auth.isAuthenticated.set(true);
    expect(await navigate('/history')).toBe('/history');
    expect(await navigate('/login')).toBe('/today');
  });

  it('only allows the setup page while setup is required', async () => {
    expect(await navigate('/setup')).toBe('/login');
    auth.isAuthenticated.set(true);
    expect(await navigate('/setup')).toBe('/today');
    auth.isAuthenticated.set(false);
    auth.setupRequired.set(true);
    expect(await navigate('/setup')).toBe('/setup');
  });

  it('lets navigation through when the auth status cannot be loaded', async () => {
    auth.loadResult = false;
    expect(await navigate('/today')).toBe('/today');
  });

  it('sends signed-in users who have not onboarded yet to the setup wizard', async () => {
    auth.isAuthenticated.set(true);
    store.result = profileWith(false);
    expect(await navigate('/history')).toBe('/onboarding');
    expect(await navigate('/onboarding')).toBe('/onboarding');
  });

  it('lets onboarded users and older servers without the flag into the app', async () => {
    auth.isAuthenticated.set(true);
    expect(await navigate('/history')).toBe('/history');
    store.result = profileWith(undefined);
    expect(await navigate('/today')).toBe('/today');
  });

  it('fails open when the profile cannot be loaded', async () => {
    auth.isAuthenticated.set(true);
    store.result = null;
    expect(await navigate('/today')).toBe('/today');
  });

  it('only lets admins into the admin panel', async () => {
    expect(await navigate('/admin')).toBe('/login?next=%2Fadmin');
    auth.isAuthenticated.set(true);
    expect(await navigate('/admin?tab=people')).toBe('/today');
    auth.isAdmin.set(true);
    expect(await navigate('/admin?tab=people')).toBe('/admin?tab=people');
  });

  it('keeps the admin panel closed when the auth status cannot be loaded', async () => {
    auth.loadResult = false;
    expect(await navigate('/admin')).toBe('/today');
  });

  it('keeps invite and reset links open whether or not someone is signed in', async () => {
    expect(await navigate('/invite/abc123')).toBe('/invite/abc123');
    expect(await navigate('/reset/xyz789')).toBe('/reset/xyz789');
    auth.isAuthenticated.set(true);
    expect(await navigate('/invite/abc123')).toBe('/invite/abc123');
    expect(auth.ensureLoaded).toHaveBeenCalled();
    auth.loadResult = false;
    expect(await navigate('/reset/xyz789')).toBe('/reset/xyz789');
  });

  it('shows the request access page to guests only', async () => {
    expect(await navigate('/request-access')).toBe('/request-access');
    auth.isAuthenticated.set(true);
    expect(await navigate('/history')).toBe('/history');
    expect(await navigate('/request-access')).toBe('/today');
  });

  it('applies the onboarding redirect once a failed launch check recovers', async () => {
    auth.loadResult = false;
    store.result = profileWith(false);
    expect(await navigate('/today')).toBe('/today');
    expect(auth.recover).toHaveBeenCalled();
    expect(store.ensureLoaded).not.toHaveBeenCalled();

    auth.loadResult = true;
    auth.isAuthenticated.set(true);
    expect(await navigate('/history')).toBe('/onboarding');
  });

  it('does not look at the profile before the user is signed in', async () => {
    expect(await navigate('/today')).toBe('/login?next=%2Ftoday');
    expect(store.ensureLoaded).not.toHaveBeenCalled();
  });
});

describe('on the Notes address', () => {
  let auth: FakeAuthService;
  let harness: RouterTestingHarness;

  async function start(notesHost: boolean): Promise<void> {
    auth = new FakeAuthService();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ProfileStore, useValue: new FakeProfileStore() },
        { provide: AppIdentityService, useValue: { notesHost } },
        provideRouter([
          { path: 'login', component: Page, canActivate: [guestGuard] },
          { path: 'onboarding', component: Page, canActivate: [notesHostGuard, authGuard] },
          { path: 'notes', component: Page, canActivate: [authGuard, notesEnabledGuard] },
          {
            path: '',
            canActivate: [notesHostGuard, authGuard],
            canActivateChild: [onboardingGuard],
            children: [
              { path: '', pathMatch: 'full', redirectTo: 'today' },
              { path: 'today', component: Page },
              { path: 'stats', component: Page },
              { path: '**', redirectTo: 'today' },
            ],
          },
        ]),
      ],
    });
    harness = await RouterTestingHarness.create();
  }

  async function navigate(url: string): Promise<string> {
    await harness.navigateByUrl(url);
    return TestBed.inject(Router).url;
  }

  it('is plain FoodLog when the server has Notes turned off', async () => {
    await start(true);
    auth.notesEnabled.set(false);
    auth.isAuthenticated.set(true);

    expect(await navigate('/')).toBe('/today');
    expect(await navigate('/stats')).toBe('/stats');
    expect(await navigate('/notes')).toBe('/today');
  });

  it('shows Notes instead of any FoodLog screen', async () => {
    await start(true);
    auth.isAuthenticated.set(true);

    expect(await navigate('/')).toBe('/notes');
    expect(await navigate('/today')).toBe('/notes');
    expect(await navigate('/stats?tab=week')).toBe('/notes');
    expect(await navigate('/onboarding')).toBe('/notes');
    expect(await navigate('/anything-else')).toBe('/notes');
  });

  it('sends a signed-out visitor to sign in, with Notes as the way back', async () => {
    await start(true);

    expect(await navigate('/')).toBe('/login?next=%2Fnotes');
    auth.isAuthenticated.set(true);
    expect(await navigate('/notes')).toBe('/notes');
  });

  it('takes someone already signed in from the sign-in page to Notes', async () => {
    await start(true);
    auth.isAuthenticated.set(true);

    expect(await navigate('/login')).toBe('/notes');
  });

  it('keeps shared text on its way into Notes', async () => {
    await start(true);
    auth.isAuthenticated.set(true);

    expect(await navigate('/notes?text=Buy%20mirror')).toBe('/notes?text=Buy%20mirror');
  });

  it('changes nothing on FoodLog’s own address', async () => {
    await start(false);
    auth.isAuthenticated.set(true);

    expect(await navigate('/')).toBe('/today');
    expect(await navigate('/stats')).toBe('/stats');
    expect(await navigate('/notes')).toBe('/notes');
  });
});

describe('onboardingGuard timeout', () => {
  afterEach(() => vi.useRealTimers());

  it('lets navigation through when the profile takes too long', async () => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { isAuthenticated: () => true } },
        {
          provide: ProfileStore,
          useValue: { ensureLoaded: () => new Promise<ProfileResponse | null>(() => undefined) },
        },
        provideRouter([]),
      ],
    });
    const result = TestBed.runInInjectionContext(() =>
      onboardingGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
    await vi.advanceTimersByTimeAsync(ONBOARDING_CHECK_TIMEOUT_MS);
    expect(await result).toBe(true);
  });
});

describe('auth check timeout', () => {
  afterEach(() => vi.useRealTimers());

  function hangingAuth() {
    return {
      setupRequired: () => false,
      isAuthenticated: () => false,
      isAdmin: () => false,
      ensureLoaded: () => new Promise<boolean>(() => undefined),
    };
  }

  function run(guard: typeof authGuard): Promise<boolean | UrlTree> {
    TestBed.configureTestingModule({
      providers: [{ provide: AuthService, useValue: hangingAuth() }, provideRouter([])],
    });
    return TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, { url: '/admin' } as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
  }

  it('lets the app open when the auth status hangs', async () => {
    vi.useFakeTimers();
    const result = run(authGuard);
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_TIMEOUT_MS - 1);
    let settled = false;
    void result.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe(true);
  });

  it('keeps guest pages and account links reachable when the auth status hangs', async () => {
    vi.useFakeTimers();
    const guest = run(guestGuard);
    const link = TestBed.runInInjectionContext(() =>
      accountLinkGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
    const setup = TestBed.runInInjectionContext(() =>
      setupGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    ) as Promise<boolean | UrlTree>;
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_TIMEOUT_MS);
    expect(await guest).toBe(true);
    expect(await link).toBe(true);
    expect(await setup).toBe(true);
  });

  it('keeps the admin panel closed when the auth status hangs', async () => {
    vi.useFakeTimers();
    const result = run(adminGuard);
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_TIMEOUT_MS);
    const tree = (await result) as UrlTree;
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe('/today');
  });
});

describe('safeRedirectPath', () => {
  it('rejects paths a browser would resolve to another origin', () => {
    for (const next of [
      '/\t/evil.example',
      '/\n/evil.example',
      '/\r/evil.example',
      '/\t\t/evil.example',
      '/\u0000/evil.example',
      '/today\\..\\evil',
      '/ /evil.example',
      '/\u007F/evil.example',
    ]) {
      expect(safeRedirectPath(next)).toBeNull();
    }
    expect(safeRedirectPath('/%09/evil.example')).toBe('/%09/evil.example');
    expect(safeRedirectPath('/history?day=2026-09-28')).toBe('/history?day=2026-09-28');
    expect(safeRedirectPath('/log?search=1#top')).toBe('/log?search=1#top');
  });

  it('accepts internal app paths only', () => {
    expect(safeRedirectPath('/history?day=2026-09-28')).toBe('/history?day=2026-09-28');
    expect(safeRedirectPath('https://evil.example')).toBeNull();
    expect(safeRedirectPath('//evil.example')).toBeNull();
    expect(safeRedirectPath('/\\evil.example')).toBeNull();
    expect(safeRedirectPath('/login?next=/x')).toBeNull();
    expect(safeRedirectPath(undefined)).toBeNull();
  });

  it('never returns to account pages after signing in', () => {
    expect(safeRedirectPath('/request-access')).toBeNull();
    expect(safeRedirectPath('/invite/abc')).toBeNull();
    expect(safeRedirectPath('/reset/abc')).toBeNull();
    expect(safeRedirectPath('/admin?tab=people')).toBe('/admin?tab=people');
  });
});
