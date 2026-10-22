import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { AuthTokenInfoResponse, AuthTokenType, UserDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { ACCESS_REQUEST_STORAGE_KEY } from './access-request.store';
import { AuthTokenPage, reasonCopy, type TokenReason } from './auth-token-page';

@Component({ template: 'page' })
class Page {}

const NEW_USER: UserDto = { id: 'u5', email: 'nour@example.com', name: 'Nour', role: 'member' };
const OTHER_USER: UserDto = { id: 'u1', email: 'owner@example.com', name: null, role: 'admin' };

function validInfo(type: AuthTokenType): AuthTokenInfoResponse {
  return {
    type,
    email: 'nour@example.com',
    name: type === 'invite' ? 'Nour' : null,
    valid: true,
    reason: null,
    expiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  };
}

function invalidInfo(reason: TokenReason, type: AuthTokenType = 'invite'): AuthTokenInfoResponse {
  return { type, email: 'nour@example.com', name: null, valid: false, reason, expiresAt: null };
}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

function buttonByText(root: HTMLElement, text: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll('button')).find(
    (button) => button.textContent?.replace(/\s+/g, ' ').trim() === text,
  );
  if (!match) {
    throw new Error(`No button "${text}"`);
  }
  return match;
}

function linkByText(root: HTMLElement, text: string): HTMLAnchorElement | undefined {
  return Array.from(root.querySelectorAll('a')).find((a) => a.textContent?.trim() === text);
}

describe('AuthTokenPage', () => {
  let api: {
    authTokenInfo: ReturnType<typeof vi.fn>;
    acceptAuthToken: ReturnType<typeof vi.fn>;
    authStatus: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      authTokenInfo: vi.fn(async () => validInfo('invite')),
      acceptAuthToken: vi.fn(async () => NEW_USER),
      authStatus: vi.fn(async () => ({
        setupRequired: false,
        authenticated: true,
        user: NEW_USER,
      })),
      logout: vi.fn(async () => undefined),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Page },
          { path: 'today', component: Page },
          { path: 'onboarding', component: Page },
          { path: 'request-access', component: Page },
        ]),
        { provide: ApiService, useValue: api },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  async function render(mode: AuthTokenType, token = 'secret-token') {
    const fixture = TestBed.createComponent(AuthTokenPage);
    fixture.componentRef.setInput('token', token);
    fixture.componentRef.setInput('mode', mode);
    await fixture.whenStable();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function setPasswords(
    el: HTMLElement,
    fixture: { whenStable(): Promise<unknown> },
    password = 'correct-horse',
  ) {
    typeInto(el.querySelector<HTMLInputElement>('#token-password')!, password);
    typeInto(el.querySelector<HTMLInputElement>('#token-confirm')!, password);
    await fixture.whenStable();
  }

  it('creates the invited account with an optional name and starts onboarding', async () => {
    localStorage.setItem(
      ACCESS_REQUEST_STORAGE_KEY,
      JSON.stringify({
        statusToken: 'status-token',
        email: 'nour@example.com',
        name: 'Nour',
        createdAt: '2026-09-28T08:00:00.000Z',
      }),
    );
    const { fixture, el } = await render('invite');
    expect(api.authTokenInfo).toHaveBeenCalledWith('secret-token');
    expect(el.querySelector('h1')?.textContent).toContain('Join FoodLog');
    expect(el.textContent).toContain('Hi Nour!');
    expect(el.textContent).toContain('nour@example.com');
    expect(el.textContent).toContain('Expires in 5 days');
    const name = el.querySelector<HTMLInputElement>('#token-name')!;
    expect(name.value).toBe('Nour');

    typeInto(name, '  Nour K. ');
    await setPasswords(el, fixture);
    buttonByText(el, 'Create account').click();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(api.acceptAuthToken).toHaveBeenCalledWith('secret-token', {
      password: 'correct-horse',
      name: 'Nour K.',
    });
    expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
    expect(TestBed.inject(Router).url).toBe('/onboarding');
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
  });

  it('sets a new password from a reset link and opens Today', async () => {
    api.authTokenInfo.mockResolvedValueOnce(validInfo('reset'));
    const { fixture, el } = await render('reset');
    expect(el.querySelector('h1')?.textContent).toContain('Choose a new password');
    expect(el.querySelector('#token-name')).toBeNull();
    await setPasswords(el, fixture);
    buttonByText(el, 'Set new password').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.acceptAuthToken).toHaveBeenCalledWith('secret-token', { password: 'correct-horse' });
    expect(TestBed.inject(Router).url).toBe('/today');
  });

  it('checks the password before sending it', async () => {
    const { fixture, el } = await render('invite');
    await setPasswords(el, fixture, 'short');
    buttonByText(el, 'Create account').click();
    await fixture.whenStable();
    expect(api.acceptAuthToken).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Use at least 8 characters.');
  });

  it.each<[TokenReason, string]>([
    ['expired', 'This link has expired'],
    ['used', 'This link was already used'],
    ['revoked', 'This link was cancelled'],
    ['not_found', 'This link doesn’t work'],
    ['account_exists', 'You already have an account'],
  ])('explains a %s link and links to sign in', async (reason, title) => {
    api.authTokenInfo.mockResolvedValueOnce(invalidInfo(reason));
    const { el } = await render('invite');
    expect(el.querySelector('h1')?.textContent).toContain(title);
    expect(el.querySelector('form')).toBeNull();
    expect(linkByText(el, 'Go to sign in')?.getAttribute('href')).toBe('/login');
    expect(Boolean(linkByText(el, 'Request access instead'))).toBe(reason !== 'account_exists');
  });

  it('treats an unknown token response as an invalid link', async () => {
    api.authTokenInfo.mockRejectedValueOnce(new HttpErrorResponse({ status: 404 }));
    const { el } = await render('reset');
    expect(el.querySelector('h1')?.textContent).toContain('This link doesn’t work');
  });

  it('offers a retry when the link cannot be checked', async () => {
    api.authTokenInfo.mockRejectedValueOnce(new HttpErrorResponse({ status: 0 }));
    const { fixture, el } = await render('invite');
    expect(el.textContent).toContain('offline');
    buttonByText(el, 'Try again').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('#token-password')).not.toBeNull();
  });

  it('shows why the link stopped working when accepting fails', async () => {
    api.acceptAuthToken.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 410, error: { statusCode: 410, message: 'Link expired' } }),
    );
    api.authTokenInfo
      .mockResolvedValueOnce(validInfo('invite'))
      .mockResolvedValueOnce(invalidInfo('expired'));
    const { fixture, el } = await render('invite');
    await setPasswords(el, fixture);
    buttonByText(el, 'Create account').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.authTokenInfo).toHaveBeenCalledTimes(2);
    expect(el.querySelector('h1')?.textContent).toContain('This link has expired');
    expect(TestBed.inject(Router).url).toBe('/');
  });

  it('asks a signed-in person to sign out first', async () => {
    api.authStatus.mockResolvedValueOnce({
      setupRequired: false,
      authenticated: true,
      user: OTHER_USER,
    });
    await TestBed.inject(AuthService).load();
    const { fixture, el } = await render('invite');
    expect(el.textContent).toContain('You’re signed in as owner@example.com');
    expect(el.querySelector('#token-password')).toBeNull();
    expect(linkByText(el, 'Stay signed in')?.getAttribute('href')).toBe('/today');

    buttonByText(el, 'Sign out and continue').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.logout).toHaveBeenCalled();
    expect(el.querySelector('#token-password')).not.toBeNull();
  });
});

describe('reasonCopy', () => {
  it('mentions how long each link type lasts', () => {
    expect(reasonCopy('expired', 'invite', null).text).toContain('14 days');
    expect(reasonCopy('expired', 'reset', null).text).toContain('2 days');
    expect(reasonCopy('account_exists', 'invite', 'a@b.co').text).toContain('a@b.co');
  });
});
