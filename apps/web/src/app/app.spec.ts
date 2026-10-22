import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
      ],
    }).compileComponents();
  });

  it('creates the root component', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders the router outlet, toast outlet and confirm host', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('router-outlet')).not.toBeNull();
    expect(element.querySelector('app-toast-outlet')).not.toBeNull();
    expect(element.querySelector('app-confirm-host dialog')).not.toBeNull();
  });

  it('puts a status bar backdrop in front of every screen', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const scrims = element.querySelectorAll('.status-bar-scrim');
    expect(scrims.length).toBe(1);
    const scrim = scrims[0];
    expect(scrim.getAttribute('aria-hidden')).toBe('true');
    expect(element.firstElementChild).toBe(scrim);
    expect(scrim.nextElementSibling?.tagName.toLowerCase()).toBe('router-outlet');
    expect(scrim.textContent).toBe('');
  });

  it('re-checks an unknown sign-in state when the device comes back online', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const backend = TestBed.inject(HttpTestingController);
    window.dispatchEvent(new Event('online'));
    const request = await vi.waitFor(() => backend.expectOne('/api/auth/status'));
    request.flush({
      setupRequired: false,
      authenticated: false,
      user: null,
    });
    backend.verify();
  });

  it('applies the dark theme by default', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
