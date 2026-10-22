import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  type BeforeInstallPromptEvent,
  InstallPromptService,
  detectInstallPlatform,
  isStandaloneDisplay,
} from './install-prompt.service';

@Component({ template: '' })
class Blank {}

function fakePromptEvent(outcome: 'accepted' | 'dismissed'): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as BeforeInstallPromptEvent;
  Object.assign(event, {
    prompt: vi.fn(async () => undefined),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  return event;
}

describe('install platform detection', () => {
  it('recognises iPhones and iPadOS desktop-mode Safari', () => {
    expect(
      detectInstallPlatform({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) Safari',
      }),
    ).toBe('ios');
    expect(
      detectInstallPlatform({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe('ios');
  });

  it('treats desktop Macs and Android as other', () => {
    expect(
      detectInstallPlatform({ userAgent: 'Mac Safari', platform: 'MacIntel', maxTouchPoints: 0 }),
    ).toBe('other');
    expect(detectInstallPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 16)' })).toBe('other');
    expect(
      detectInstallPlatform({
        userAgent: 'Mozilla/5.0 (Linux; Android 16) Mobile',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      }),
    ).toBe('other');
  });

  it('is not standalone without matchMedia or navigator.standalone', () => {
    expect(isStandaloneDisplay(window)).toBe(false);
    expect(isStandaloneDisplay(null)).toBe(false);
  });
});

describe('InstallPromptService', () => {
  it('captures the install prompt and replays it once', async () => {
    const service = TestBed.inject(InstallPromptService);
    expect(service.canPrompt()).toBe(false);
    expect(await service.prompt()).toBe('unavailable');

    const event = fakePromptEvent('accepted');
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(service.canPrompt()).toBe(true);

    expect(await service.prompt()).toBe('accepted');
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(service.canPrompt()).toBe(false);
  });

  it('marks the app as installed after appinstalled', () => {
    const service = TestBed.inject(InstallPromptService);
    window.dispatchEvent(fakePromptEvent('dismissed'));
    window.dispatchEvent(new Event('appinstalled'));
    expect(service.standalone()).toBe(true);
    expect(service.canPrompt()).toBe(false);
  });

  it('drops a prompt that was offered for the other installable app', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'notes', component: Blank },
          { path: 'today', component: Blank },
        ]),
      ],
    });
    const service = TestBed.inject(InstallPromptService);
    const router = TestBed.inject(Router);
    window.dispatchEvent(fakePromptEvent('accepted'));
    await router.navigateByUrl('/today');
    TestBed.tick();
    expect(service.canPrompt()).toBe(true);

    await router.navigateByUrl('/notes');
    TestBed.tick();
    expect(service.canPrompt()).toBe(false);
    expect(await service.prompt()).toBe('unavailable');

    window.dispatchEvent(fakePromptEvent('accepted'));
    expect(service.canPrompt()).toBe(true);
  });
});
