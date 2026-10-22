import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { AccessRequestStatusResponse, UserDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AppIdentityService } from '../../core/app-identity.service';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../core/toast.service';
import { ACCESS_POLL_MS, WELCOME_MESSAGE } from './access-request-card';
import { ACCESS_REQUEST_STORAGE_KEY } from './access-request.store';
import {
  FORGOT_PASSWORD_HINT,
  INVALID_LOGIN_MESSAGE,
  LOGIN_SUBTITLE,
  LoginPage,
  NOTES_LOGIN_SUBTITLE,
  NOTES_PRIVACY_NOTE,
  PRIVACY_NOTE,
  SIGNED_OUT_MESSAGE,
} from './login-page';

@Component({ template: 'page' })
class Page {}

const USER: UserDto = { id: 'u9', email: 'lina@example.com', name: 'Lina', role: 'member' };

function statusOf(
  status: AccessRequestStatusResponse['status'],
  canCreateAccount = false,
): AccessRequestStatusResponse {
  return {
    status,
    email: 'lina@example.com',
    name: 'Lina',
    createdAt: '2026-09-28T08:00:00.000Z',
    decidedAt: null,
    canCreateAccount,
  };
}

function storeRequest(): void {
  localStorage.setItem(
    ACCESS_REQUEST_STORAGE_KEY,
    JSON.stringify({
      statusToken: 'status-token',
      email: 'lina@example.com',
      name: 'Lina',
      createdAt: '2026-09-28T08:00:00.000Z',
    }),
  );
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

describe('LoginPage', () => {
  let api: {
    login: ReturnType<typeof vi.fn>;
    authStatus: ReturnType<typeof vi.fn>;
    accessRequestStatus: ReturnType<typeof vi.fn>;
    acceptAccessRequest: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    api = {
      login: vi.fn(async () => USER),
      authStatus: vi.fn(async () => ({ setupRequired: false, authenticated: true, user: USER })),
      accessRequestStatus: vi.fn(async () => statusOf('pending')),
      acceptAccessRequest: vi.fn(async () => USER),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: LoginPage },
          { path: 'today', component: Page },
          { path: 'onboarding', component: Page },
          { path: 'request-access', component: Page },
        ]),
        { provide: ApiService, useValue: api },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
  });

  async function render() {
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('speaks about the food log and shows the FoodLog logo on FoodLog’s address', async () => {
    const { el } = await render();
    expect(el.textContent).toContain(LOGIN_SUBTITLE);
    expect(el.textContent).toContain(PRIVACY_NOTE);
    expect(el.querySelector('app-logo')).not.toBeNull();
    expect(el.querySelector('img[alt="Notes"]')).toBeNull();
  });

  it('speaks about notes and shows the Notes icon on the Notes address', async () => {
    TestBed.overrideProvider(AppIdentityService, { useValue: { notesHost: true } });
    const { el } = await render();
    expect(el.textContent).toContain(NOTES_LOGIN_SUBTITLE);
    expect(el.textContent).toContain(NOTES_PRIVACY_NOTE);
    expect(el.textContent).not.toContain(PRIVACY_NOTE);
    expect(el.querySelector('img[alt="Notes"]')?.getAttribute('src')).toBe('icons/notes/icon.svg');
    expect(el.querySelector('app-logo')).toBeNull();
  });

  it('offers a clear way to request access', async () => {
    const { el } = await render();
    const link = Array.from(el.querySelectorAll('a')).find((a) =>
      a.textContent?.includes('Request access'),
    );
    expect(link?.getAttribute('href')).toBe('/request-access');
    expect(el.querySelector('app-access-request-card')).toBeNull();
    expect(api.accessRequestStatus).not.toHaveBeenCalled();
  });

  it('signs in and explains wrong credentials', async () => {
    api.login.mockRejectedValueOnce(new HttpErrorResponse({ status: 401 }));
    const { fixture, el } = await render();
    typeInto(el.querySelector<HTMLInputElement>('#login-email')!, ' lina@example.com ');
    typeInto(el.querySelector<HTMLInputElement>('#login-password')!, 'wrong-pass');
    await fixture.whenStable();
    buttonByText(el, 'Sign in').click();
    await fixture.whenStable();
    expect(el.textContent).toContain(INVALID_LOGIN_MESSAGE);

    buttonByText(el, 'Sign in').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.login).toHaveBeenLastCalledWith({
      email: 'lina@example.com',
      password: 'wrong-pass',
    });
    expect(TestBed.inject(Router).url).toBe('/today');
  });

  it('drops the request kept on this device once its owner signs in', async () => {
    storeRequest();
    const { fixture, el } = await render();
    typeInto(el.querySelector<HTMLInputElement>('#login-email')!, 'lina@example.com');
    typeInto(el.querySelector<HTMLInputElement>('#login-password')!, 'correct-horse');
    await fixture.whenStable();
    buttonByText(el, 'Sign in').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/today');
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
  });

  it('shows the live status of a pending request kept on this device', async () => {
    storeRequest();
    const { fixture, el } = await render();
    expect(api.accessRequestStatus).toHaveBeenCalledWith({ statusToken: 'status-token' });
    const card = el.querySelector('app-access-request-card')!;
    expect(card.textContent).toContain('Waiting for approval');
    expect(card.textContent).toContain('lina@example.com');
    expect(el.textContent).not.toContain('New to FoodLog?');

    api.accessRequestStatus.mockResolvedValueOnce(statusOf('approved', true));
    buttonByText(card as HTMLElement, 'Check status').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(card.textContent).toContain('You’re in! Create your password');
  });

  it('polls a pending request in the background', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    storeRequest();
    const { fixture } = await render();
    expect(api.accessRequestStatus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(ACCESS_POLL_MS);
    await fixture.whenStable();
    expect(api.accessRequestStatus).toHaveBeenCalledTimes(2);
  });

  it('creates the account inline once approved and starts onboarding', async () => {
    storeRequest();
    api.accessRequestStatus.mockResolvedValue(statusOf('approved', true));
    const { fixture, el } = await render();
    typeInto(el.querySelector<HTMLInputElement>('#access-password')!, 'correct-horse');
    typeInto(el.querySelector<HTMLInputElement>('#access-confirm')!, 'correct-hors');
    await fixture.whenStable();
    buttonByText(el, 'Create account').click();
    await fixture.whenStable();
    expect(api.acceptAccessRequest).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Passwords do not match.');

    typeInto(el.querySelector<HTMLInputElement>('#access-confirm')!, 'correct-horse');
    await fixture.whenStable();
    buttonByText(el, 'Create account').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(api.acceptAccessRequest).toHaveBeenCalledWith({
      statusToken: 'status-token',
      password: 'correct-horse',
    });
    expect(TestBed.inject(Router).url).toBe('/onboarding');
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .some((t) => t.message === WELCOME_MESSAGE),
    ).toBe(true);
  });

  it('switches to sign-in when the account already exists', async () => {
    storeRequest();
    api.accessRequestStatus
      .mockResolvedValueOnce(statusOf('approved', true))
      .mockResolvedValueOnce(statusOf('approved', false));
    api.acceptAccessRequest.mockRejectedValueOnce(
      new HttpErrorResponse({ status: 409, error: { statusCode: 409, message: 'Account exists' } }),
    );
    const { fixture, el } = await render();
    typeInto(el.querySelector<HTMLInputElement>('#access-password')!, 'correct-horse');
    typeInto(el.querySelector<HTMLInputElement>('#access-confirm')!, 'correct-horse');
    await fixture.whenStable();
    buttonByText(el, 'Create account').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.textContent).toContain('Your account is ready');
    buttonByText(el, 'Got it').click();
    await fixture.whenStable();
    expect(el.querySelector('app-access-request-card')).toBeNull();
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
  });

  it('explains a rejected request kindly and lets it be cleared', async () => {
    storeRequest();
    api.accessRequestStatus.mockResolvedValue(statusOf('rejected'));
    const { fixture, el } = await render();
    expect(el.textContent).toContain('Request not approved');
    const card = el.querySelector('app-access-request-card')?.textContent ?? '';
    expect(card).toContain('Already have an account? Sign in');
    expect(card).toContain('Ask the owner for a reset link');
    buttonByText(el, 'OK').click();
    await fixture.whenStable();
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
    expect(el.textContent).toContain('Request access');
  });

  it('tells people how to get back in when they forgot their password', async () => {
    const { el } = await render();
    const form = el.querySelector('form[aria-label="Sign in"]')!;
    expect(form.textContent).toContain(FORGOT_PASSWORD_HINT);
  });

  it('explains why the app went back to sign in after the session ended', async () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentRef.setInput('reason', 'signed-out');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const note = el.querySelector('[role="status"]');
    expect(note?.textContent).toContain(SIGNED_OUT_MESSAGE);
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows no signed-out note on a normal visit', async () => {
    const { el } = await render();
    expect(el.textContent).not.toContain(SIGNED_OUT_MESSAGE);
  });

  it('shows only the sign-in error once a sign-in attempt fails', async () => {
    api.login.mockRejectedValueOnce(new HttpErrorResponse({ status: 401 }));
    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentRef.setInput('reason', 'signed-out');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    typeInto(el.querySelector<HTMLInputElement>('#login-email')!, 'lina@example.com');
    typeInto(el.querySelector<HTMLInputElement>('#login-password')!, 'wrong-pass');
    await fixture.whenStable();
    buttonByText(el, 'Sign in').click();
    await fixture.whenStable();
    expect(el.textContent).toContain(INVALID_LOGIN_MESSAGE);
    expect(el.textContent).not.toContain(SIGNED_OUT_MESSAGE);
  });

  it('never forwards the sign-out reason and ignores unsafe return paths', async () => {
    const auth = TestBed.inject(AuthService);
    const enter = vi.spyOn(auth, 'enterApp').mockResolvedValue(undefined);
    const fixture = TestBed.createComponent(LoginPage);
    fixture.componentRef.setInput('reason', 'signed-out');
    fixture.componentRef.setInput('next', '/\t/evil.example');
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    typeInto(el.querySelector<HTMLInputElement>('#login-email')!, 'lina@example.com');
    typeInto(el.querySelector<HTMLInputElement>('#login-password')!, 'correct-horse');
    await fixture.whenStable();
    buttonByText(el, 'Sign in').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(enter).toHaveBeenCalledWith('/today');
  });
});
