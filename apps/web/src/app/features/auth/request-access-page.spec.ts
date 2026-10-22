import { HttpErrorResponse } from '@angular/common/http';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AccessRequestStatusResponse } from '@food/shared';
import { ApiService } from '../../core/api.service';
import { ACCESS_REQUEST_STORAGE_KEY, parseStoredRequest } from './access-request.store';
import { REQUEST_RATE_LIMIT_MESSAGE, RequestAccessPage } from './request-access-page';

@Component({ template: 'page' })
class Page {}

function statusOf(status: AccessRequestStatusResponse['status']): AccessRequestStatusResponse {
  return {
    status,
    email: 'lina@example.com',
    name: 'Lina',
    createdAt: '2026-09-28T08:00:00.000Z',
    decidedAt: null,
    canCreateAccount: status === 'approved',
  };
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
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

describe('RequestAccessPage', () => {
  let api: {
    requestAccess: ReturnType<typeof vi.fn>;
    accessRequestStatus: ReturnType<typeof vi.fn>;
    acceptAccessRequest: ReturnType<typeof vi.fn>;
    authStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    api = {
      requestAccess: vi.fn(async () => ({ statusToken: 'fresh-token' })),
      accessRequestStatus: vi.fn(async () => statusOf('pending')),
      acceptAccessRequest: vi.fn(),
      authStatus: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'login', component: Page },
          { path: 'onboarding', component: Page },
        ]),
        { provide: ApiService, useValue: api },
      ],
    });
  });

  afterEach(() => localStorage.clear());

  async function render() {
    const fixture = TestBed.createComponent(RequestAccessPage);
    await fixture.whenStable();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  async function fill(el: HTMLElement, fixture: { whenStable(): Promise<unknown> }) {
    typeInto(el.querySelector<HTMLInputElement>('#request-name')!, '  Lina Saab ');
    typeInto(el.querySelector<HTMLInputElement>('#request-email')!, ' lina@example.com ');
    typeInto(el.querySelector<HTMLTextAreaElement>('#request-message')!, '  From the gym  ');
    await fixture.whenStable();
  }

  it('validates the form before sending', async () => {
    const { fixture, el } = await render();
    buttonByText(el, 'Send request').click();
    await fixture.whenStable();
    expect(api.requestAccess).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Enter your name.');
    expect(el.textContent).toContain('Enter your email address.');

    typeInto(el.querySelector<HTMLTextAreaElement>('#request-message')!, 'x'.repeat(501));
    await fixture.whenStable();
    expect(el.textContent).toContain('501/500');
    expect(el.textContent).toContain('Keep the note under 500 characters.');
  });

  it('sends the request, keeps the status token on this device and shows the status', async () => {
    const { fixture, el } = await render();
    await fill(el, fixture);
    buttonByText(el, 'Send request').click();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(api.requestAccess).toHaveBeenCalledWith({
      name: 'Lina Saab',
      email: 'lina@example.com',
      message: 'From the gym',
    });
    const stored = parseStoredRequest(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY));
    expect(stored).toMatchObject({
      statusToken: 'fresh-token',
      email: 'lina@example.com',
      name: 'Lina Saab',
    });
    expect(el.querySelector('h1')?.textContent).toContain('Request sent');
    expect(el.textContent).toContain('Come back to FoodLog on this device');
    expect(el.querySelector('app-access-request-card')?.textContent).toContain(
      'Waiting for approval',
    );

    buttonByText(el, 'Check status').click();
    await fixture.whenStable();
    expect(api.accessRequestStatus).toHaveBeenCalledWith({ statusToken: 'fresh-token' });
  });

  it('drops the sent header once the request is rejected and after it is cleared', async () => {
    const { fixture, el } = await render();
    await fill(el, fixture);
    buttonByText(el, 'Send request').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Request sent');
    expect(el.textContent).toContain('Sent!');

    api.accessRequestStatus.mockResolvedValue(statusOf('rejected'));
    buttonByText(el, 'Check status').click();
    await fixture.whenStable();
    await fixture.whenStable();
    const heading = el.querySelector('h1')?.textContent ?? '';
    expect(heading).toContain('Your request');
    expect(heading).not.toContain('Request sent');
    expect(el.textContent).not.toContain('Sent!');
    expect(el.textContent).not.toContain('You don’t need to wait here');
    expect(el.querySelector('app-access-request-card')?.textContent).toContain(
      'Request not approved',
    );

    buttonByText(el, 'OK').click();
    await fixture.whenStable();
    expect(el.querySelector('#request-name')).not.toBeNull();
    expect(el.querySelector('h1')?.textContent).toContain('Request access');
    expect(el.querySelector('h1')?.textContent).not.toContain('Request sent');
  });

  it('drops the sent header once the request is approved', async () => {
    const { fixture, el } = await render();
    await fill(el, fixture);
    buttonByText(el, 'Send request').click();
    await fixture.whenStable();
    await fixture.whenStable();

    api.accessRequestStatus.mockResolvedValue(statusOf('approved'));
    buttonByText(el, 'Check status').click();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Your request');
    expect(el.textContent).not.toContain('Sent!');
    expect(el.querySelector('app-access-request-card')?.textContent).toContain(
      'Create your password',
    );
  });

  it('sends an empty note as null', async () => {
    const { fixture, el } = await render();
    typeInto(el.querySelector<HTMLInputElement>('#request-name')!, 'Omar');
    typeInto(el.querySelector<HTMLInputElement>('#request-email')!, 'omar@example.com');
    await fixture.whenStable();
    buttonByText(el, 'Send request').click();
    await fixture.whenStable();
    expect(api.requestAccess).toHaveBeenCalledWith({
      name: 'Omar',
      email: 'omar@example.com',
      message: null,
    });
  });

  it('explains the hourly limit', async () => {
    api.requestAccess.mockRejectedValueOnce(new HttpErrorResponse({ status: 429 }));
    const { fixture, el } = await render();
    await fill(el, fixture);
    buttonByText(el, 'Send request').click();
    await fixture.whenStable();
    expect(el.textContent).toContain(REQUEST_RATE_LIMIT_MESSAGE);
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
  });

  it('shows an existing request instead of the form and allows starting over', async () => {
    localStorage.setItem(
      ACCESS_REQUEST_STORAGE_KEY,
      JSON.stringify({
        statusToken: 'old-token',
        email: 'lina@example.com',
        name: 'Lina',
        createdAt: '2026-09-27T08:00:00.000Z',
      }),
    );
    const { fixture, el } = await render();
    await fixture.whenStable();
    expect(el.querySelector('h1')?.textContent).toContain('Your request');
    expect(el.querySelector('#request-name')).toBeNull();
    expect(api.accessRequestStatus).toHaveBeenCalledWith({ statusToken: 'old-token' });

    buttonByText(el, 'Send a new request instead').click();
    await fixture.whenStable();
    expect(localStorage.getItem(ACCESS_REQUEST_STORAGE_KEY)).toBeNull();
    expect(el.querySelector('#request-name')).not.toBeNull();
  });
});
