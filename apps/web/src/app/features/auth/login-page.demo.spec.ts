import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { UserDto } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { DEMO_BUSY_MESSAGE, LoginPage } from './login-page';

@Component({ template: '' })
class Page {}

const DEMO_USER: UserDto = {
  id: 'demo-1',
  email: 'demo-1@demo.invalid',
  name: 'Demo',
  role: 'member',
};

describe('LoginPage in demo mode', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    localStorage.clear();
    let started = false;
    api = {
      authStatus: vi.fn(async () => ({
        setupRequired: false,
        authenticated: started,
        user: started ? DEMO_USER : null,
        demo: { enabled: true, expiresAt: started ? '2026-10-23T12:00:00.000Z' : null },
      })),
      startDemo: vi.fn(async () => {
        started = true;
        return DEMO_USER;
      }),
      login: vi.fn(),
      accessRequestStatus: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: LoginPage },
          { path: 'today', component: Page },
          { path: 'onboarding', component: Page },
        ]),
        { provide: ApiService, useValue: api },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  async function render() {
    await TestBed.inject(AuthService).load();
    const fixture = TestBed.createComponent(LoginPage);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('offers the demo first and leaves out access requests', async () => {
    const { el } = await render();
    expect(el.querySelector('#demo-title')?.textContent).toContain('Try FoodLog now');
    expect(el.textContent).toContain('it is deleted after a day');
    expect(el.textContent).not.toContain('Request access');
  });

  it('starts a sandbox for today in this time zone and opens the app', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('[data-testid="start-demo"]')!.click();
    await fixture.whenStable();

    const now = new Date();
    expect(api['startDemo']).toHaveBeenCalledWith({
      localDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      utcOffsetMinutes: -now.getTimezoneOffset(),
    });
    await fixture.whenStable();
    expect(TestBed.inject(AuthService).user()?.id).toBe('demo-1');
    expect(TestBed.inject(AuthService).demo()?.expiresAt).toBe('2026-10-23T12:00:00.000Z');
    expect(navigate).toHaveBeenCalled();
  });

  it('explains when too many demos were started', async () => {
    api['startDemo']?.mockRejectedValueOnce(new HttpErrorResponse({ status: 429 }));
    const { fixture, el } = await render();
    el.querySelector<HTMLButtonElement>('[data-testid="start-demo"]')!.click();
    await fixture.whenStable();
    expect(el.textContent).toContain(DEMO_BUSY_MESSAGE);
    expect(el.querySelector<HTMLButtonElement>('[data-testid="start-demo"]')?.disabled).toBe(false);
  });
});
