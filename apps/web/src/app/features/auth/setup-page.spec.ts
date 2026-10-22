import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { SetupPage } from './setup-page';

@Component({ template: 'page' })
class Page {}

function typeInto(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input'));
  input.dispatchEvent(new Event('blur'));
}

describe('SetupPage', () => {
  let api: { setup: ReturnType<typeof vi.fn>; authStatus: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    api = {
      setup: vi.fn(async () => ({ id: 'u1', email: 'me@example.com', name: null, role: 'member' })),
      authStatus: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'onboarding', component: Page },
          { path: 'setup', component: SetupPage },
        ]),
        { provide: ApiService, useValue: api },
      ],
    });
  });

  async function fillAndSubmit() {
    const fixture = TestBed.createComponent(SetupPage);
    const el = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    typeInto(el.querySelector<HTMLInputElement>('#setup-email')!, ' me@example.com ');
    typeInto(el.querySelector<HTMLInputElement>('#setup-password')!, 'correct-horse');
    typeInto(el.querySelector<HTMLInputElement>('#setup-confirm')!, 'correct-horse');
    typeInto(el.querySelector<HTMLInputElement>('#setup-code')!, 'dev-setup-code');
    await fixture.whenStable();
    el.querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    await fixture.whenStable();
    return { fixture, el };
  }

  it('starts the setup wizard after creating the account', async () => {
    await fillAndSubmit();
    expect(api.setup).toHaveBeenCalledWith({
      email: 'me@example.com',
      password: 'correct-horse',
      setupCode: 'dev-setup-code',
    });
    expect(TestBed.inject(Router).url).toBe('/onboarding');
  });

  it('names both places the setup code can come from', async () => {
    const fixture = TestBed.createComponent(SetupPage);
    await fixture.whenStable();
    const hint = (fixture.nativeElement as HTMLElement).querySelector('#setup-code-hint');
    expect(hint?.textContent).toContain('SETUP_CODE');
    expect(hint?.textContent).toContain('server log');
    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('#setup-code')
        ?.getAttribute('aria-describedby'),
    ).toBe('setup-code-hint');
  });

  it('flags a wrong setup code on the field', async () => {
    api.setup.mockRejectedValueOnce(new HttpErrorResponse({ status: 403 }));
    const { el } = await fillAndSubmit();
    expect(el.textContent).toContain('That setup code is not correct.');
    expect(TestBed.inject(Router).url).toBe('/');
  });
});
