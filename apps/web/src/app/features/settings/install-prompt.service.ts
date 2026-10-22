import { DOCUMENT, DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { AppIdentityService } from '../../core/app-identity.service';

export type InstallPlatform = 'ios' | 'other';
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export interface NavigatorInfo {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
}

const STANDALONE_QUERY = '(display-mode: standalone)';

export function detectInstallPlatform(nav: NavigatorInfo): InstallPlatform {
  if (/Android/i.test(nav.userAgent)) {
    return 'other';
  }
  if (/iPad|iPhone|iPod/.test(nav.userAgent)) {
    return 'ios';
  }
  const touchMac = nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1;
  return touchMac ? 'ios' : 'other';
}

export function isStandaloneDisplay(view: Window | null): boolean {
  if (!view) {
    return false;
  }
  const iosStandalone =
    (view.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const media = typeof view.matchMedia === 'function' ? view.matchMedia(STANDALONE_QUERY) : null;
  return iosStandalone || media?.matches === true;
}

@Injectable({ providedIn: 'root' })
export class InstallPromptService {
  private readonly view = inject(DOCUMENT).defaultView;
  private readonly deferred = signal<BeforeInstallPromptEvent | null>(null);
  private readonly standaloneState = signal(isStandaloneDisplay(this.view));

  readonly platform: InstallPlatform = this.view
    ? detectInstallPlatform(this.view.navigator)
    : 'other';
  readonly standalone = this.standaloneState.asReadonly();
  readonly canPrompt = computed(() => this.deferred() !== null && !this.standaloneState());

  constructor() {
    const identity = inject(AppIdentityService).identity;
    let offered = identity().key;
    effect(() => {
      const key = identity().key;
      if (key !== offered) {
        offered = key;
        this.deferred.set(null);
      }
    });
    const view = this.view;
    if (!view) {
      return;
    }
    const onBeforeInstall = (event: Event): void => {
      event.preventDefault();
      this.deferred.set(event as BeforeInstallPromptEvent);
    };
    const onInstalled = (): void => {
      this.deferred.set(null);
      this.standaloneState.set(true);
    };
    view.addEventListener('beforeinstallprompt', onBeforeInstall);
    view.addEventListener('appinstalled', onInstalled);
    const media = typeof view.matchMedia === 'function' ? view.matchMedia(STANDALONE_QUERY) : null;
    const onDisplayChange = (event: MediaQueryListEvent): void =>
      this.standaloneState.set(event.matches || isStandaloneDisplay(view));
    media?.addEventListener('change', onDisplayChange);
    inject(DestroyRef).onDestroy(() => {
      view.removeEventListener('beforeinstallprompt', onBeforeInstall);
      view.removeEventListener('appinstalled', onInstalled);
      media?.removeEventListener('change', onDisplayChange);
    });
  }

  async prompt(): Promise<InstallOutcome> {
    const event = this.deferred();
    if (!event) {
      return 'unavailable';
    }
    this.deferred.set(null);
    try {
      await event.prompt();
      const choice = await event.userChoice;
      return choice.outcome;
    } catch {
      return 'unavailable';
    }
  }
}
