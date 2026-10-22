import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  SIGNED_OUT_REASON,
  SW_BYPASS_HEADER,
  apiInterceptor,
  endsSessionOn401,
} from './api.interceptor';
import { type AuthStatus, AuthService } from './auth.service';
import { SessionScope } from './session-scope';

describe('apiInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let router: Router;
  let markLoggedOut: ReturnType<typeof vi.fn>;
  let load: ReturnType<typeof vi.fn>;
  let status: ReturnType<typeof signal<AuthStatus>>;
  let isAuthenticated: ReturnType<typeof signal<boolean>>;
  let scope: SessionScope;

  beforeEach(() => {
    status = signal<AuthStatus>('authenticated');
    isAuthenticated = signal(true);
    markLoggedOut = vi.fn(() => {
      isAuthenticated.set(false);
      status.set('anonymous');
      scope.reset();
    });
    load = vi.fn(async () => ({ setupRequired: false, authenticated: false, user: null }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([apiInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { markLoggedOut, load, status, isAuthenticated } },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    scope = TestBed.inject(SessionScope);
  });

  function unauthorized(url: string): void {
    backend
      .expectOne(url)
      .flush(
        { statusCode: 401, message: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' },
      );
  }

  afterEach(() => backend.verify());

  it('adds the service worker bypass header to non-GET api requests only', async () => {
    const post = firstValueFrom(http.post('/api/entries', {}));
    const get = firstValueFrom(http.get('/api/entries'));
    const other = firstValueFrom(http.post('/assets/x', {}));
    const postReq = backend.expectOne((r) => r.method === 'POST' && r.url === '/api/entries');
    const getReq = backend.expectOne((r) => r.method === 'GET' && r.url === '/api/entries');
    const otherReq = backend.expectOne('/assets/x');
    expect(postReq.request.headers.get(SW_BYPASS_HEADER)).toBe('1');
    expect(getReq.request.headers.has(SW_BYPASS_HEADER)).toBe(false);
    expect(otherReq.request.headers.has(SW_BYPASS_HEADER)).toBe(false);
    postReq.flush({});
    getReq.flush({});
    otherReq.flush({});
    await Promise.all([post, get, other]);
  });

  it('logs out and redirects to login on 401 from app endpoints', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const request = firstValueFrom(http.get('/api/entries'));
    backend
      .expectOne('/api/entries')
      .flush(
        { statusCode: 401, message: 'Unauthorized' },
        { status: 401, statusText: 'Unauthorized' },
      );
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(markLoggedOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { reason: SIGNED_OUT_REASON },
    });
  });

  it('keeps the page to return to and says why the session ended', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/today');
    const request = firstValueFrom(http.get('/api/entries'));
    unauthorized('/api/entries');
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(navigate).toHaveBeenCalledWith(['/login'], {
      queryParams: { next: '/today', reason: 'signed-out' },
    });
  });

  it('gives no sign-out reason when nobody was signed in', async () => {
    isAuthenticated.set(false);
    status.set('unknown');
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const request = firstValueFrom(http.get('/api/entries'));
    unauthorized('/api/entries');
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(markLoggedOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: {} });
  });

  it('does not navigate again while already on the sign-in page', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    vi.spyOn(router, 'url', 'get').mockReturnValue('/login?next=%2Ftoday');
    const request = firstValueFrom(http.get('/api/entries'));
    unauthorized('/api/entries');
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(markLoggedOut).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('auth status recovery', () => {
    it('re-checks the auth status after the first successful api response', async () => {
      status.set('unknown');
      const request = firstValueFrom(http.get('/api/entries'));
      backend.expectOne('/api/entries').flush({ items: [] });
      await request;
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('does not re-check after a failed response', async () => {
      status.set('unknown');
      const request = firstValueFrom(http.get('/api/entries'));
      backend
        .expectOne('/api/entries')
        .flush({ message: 'down' }, { status: 503, statusText: 'Service Unavailable' });
      await expect(request).rejects.toMatchObject({ status: 503 });
      expect(load).not.toHaveBeenCalled();
    });

    it('never re-checks because of the status request itself', async () => {
      status.set('unknown');
      const request = firstValueFrom(http.get('/api/auth/status?x=1'));
      backend.expectOne('/api/auth/status?x=1').flush({ unexpected: true });
      await request;
      expect(load).not.toHaveBeenCalled();
    });

    it('leaves sign-in and public account endpoints to their own flows', async () => {
      status.set('unknown');
      const login = firstValueFrom(http.post('/api/auth/login', {}));
      const access = firstValueFrom(http.post('/api/access-requests/status', {}));
      const token = firstValueFrom(http.get('/api/auth/tokens/abc'));
      backend.expectOne('/api/auth/login').flush({});
      backend.expectOne('/api/access-requests/status').flush({});
      backend.expectOne('/api/auth/tokens/abc').flush({});
      await Promise.all([login, access, token]);
      expect(load).not.toHaveBeenCalled();
    });

    it('does not re-check once the status is known', async () => {
      for (const known of ['authenticated', 'anonymous'] as const) {
        status.set(known);
        const request = firstValueFrom(http.get('/api/entries'));
        backend.expectOne('/api/entries').flush({});
        await request;
      }
      expect(load).not.toHaveBeenCalled();
    });

    it('ignores a failing re-check', async () => {
      status.set('unknown');
      load.mockRejectedValueOnce(new Error('offline'));
      const request = firstValueFrom(http.get('/api/entries'));
      backend.expectOne('/api/entries').flush({});
      await expect(request).resolves.toEqual({});
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  it('ends the session once when several requests fail with 401 together', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const entries = firstValueFrom(http.get('/api/entries'));
    const profile = firstValueFrom(http.get('/api/profile'));
    unauthorized('/api/entries');
    unauthorized('/api/profile');
    await expect(entries).rejects.toMatchObject({ status: 401 });
    await expect(profile).rejects.toMatchObject({ status: 401 });
    expect(markLoggedOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('ignores a 401 for a request sent before the session changed', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const stale = firstValueFrom(http.get('/api/entries'));
    scope.reset();
    unauthorized('/api/entries');
    await expect(stale).rejects.toMatchObject({ status: 401 });
    expect(markLoggedOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('ends the session on 401 from signed-in account endpoints', async () => {
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const sessions = firstValueFrom(http.get('/api/auth/sessions'));
    unauthorized('/api/auth/sessions');
    await expect(sessions).rejects.toMatchObject({ status: 401 });
    expect(markLoggedOut).toHaveBeenCalledTimes(1);
  });

  it('knows which endpoints answer 401 without a session ending', () => {
    for (const url of [
      '/api/auth/login',
      '/api/auth/setup',
      '/api/auth/status',
      '/api/auth/logout',
      '/api/auth/tokens/abc',
      '/api/auth/tokens/abc/accept',
      '/api/access-requests',
      '/api/access-requests/status',
    ]) {
      expect(endsSessionOn401(url)).toBe(false);
    }
    for (const url of [
      '/api/entries',
      '/api/auth/sessions',
      '/api/auth/sessions/s1',
      '/api/auth/account',
      '/api/auth/change-password',
      '/api/auth/login-history',
      '/api/admin/users?x=1',
    ]) {
      expect(endsSessionOn401(url)).toBe(true);
    }
  });

  it('does not redirect on 401 from auth endpoints', async () => {
    const navigate = vi.spyOn(router, 'navigate');
    const request = firstValueFrom(http.post('/api/auth/login', {}));
    backend
      .expectOne('/api/auth/login')
      .flush({ statusCode: 401, message: 'Invalid' }, { status: 401, statusText: 'Unauthorized' });
    await expect(request).rejects.toMatchObject({ status: 401 });
    expect(markLoggedOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
