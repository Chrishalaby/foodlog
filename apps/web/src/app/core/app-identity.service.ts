import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

export type AppIdentityKey = 'foodlog' | 'notes';

export interface AppIdentity {
  readonly key: AppIdentityKey;
  readonly name: string;
  readonly manifest: string;
  readonly icon: string;
  readonly iconPng: string;
  readonly appleTouchIcon: string;
}

export const NOTES_ROOT = '/notes';
export const NOTES_HOST_WORD = 'notes';

export const FOODLOG_IDENTITY: AppIdentity = {
  key: 'foodlog',
  name: 'FoodLog',
  manifest: 'manifest.webmanifest',
  icon: 'favicon.svg',
  iconPng: 'favicon-32x32.png',
  appleTouchIcon: 'icons/apple-touch-icon-180x180.png',
};

export const NOTES_IDENTITY: AppIdentity = {
  key: 'notes',
  name: 'Notes',
  manifest: 'notes.webmanifest',
  icon: 'icons/notes/icon.svg',
  iconPng: 'icons/notes/favicon-32x32.png',
  appleTouchIcon: 'icons/notes/apple-touch-icon-180x180.png',
};

export const NOTES_APP_IDENTITY: AppIdentity = {
  ...NOTES_IDENTITY,
  manifest: 'notes-app.webmanifest',
};

const IDENTITY_SELECTORS = {
  manifest: 'link[rel="manifest"]',
  icon: 'link[rel="icon"][type="image/svg+xml"]',
  iconPng: 'link[rel="icon"][type="image/png"]',
  appleTouchIcon: 'link[rel="apple-touch-icon"]',
  appleTitle: 'meta[name="apple-mobile-web-app-title"]',
} as const;

export function isNotesUrl(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return path === NOTES_ROOT || path.startsWith(`${NOTES_ROOT}/`);
}

export function identityForUrl(url: string): AppIdentity {
  return isNotesUrl(url) ? NOTES_IDENTITY : FOODLOG_IDENTITY;
}

export function isNotesHost(hostname: string | null | undefined): boolean {
  const label = (hostname ?? '').toLowerCase().split('.', 1)[0] ?? '';
  return label.split('-').includes(NOTES_HOST_WORD);
}

export function identityFor(hostname: string | null | undefined, url: string): AppIdentity {
  return isNotesHost(hostname) ? NOTES_APP_IDENTITY : identityForUrl(url);
}

@Injectable({ providedIn: 'root' })
export class AppIdentityService {
  private readonly document = inject(DOCUMENT);
  private readonly hostname = this.document.location?.hostname ?? '';
  private readonly state = signal(
    identityFor(this.hostname, this.document.location?.pathname ?? '/'),
  );

  readonly notesHost = isNotesHost(this.hostname);
  readonly identity = this.state.asReadonly();

  constructor() {
    inject(Router)
      .events.pipe(
        filter((event): event is NavigationEnd => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe((event) => this.apply(identityFor(this.hostname, event.urlAfterRedirects)));
  }

  private apply(identity: AppIdentity): void {
    this.set(IDENTITY_SELECTORS.manifest, 'href', identity.manifest);
    this.set(IDENTITY_SELECTORS.icon, 'href', identity.icon);
    this.set(IDENTITY_SELECTORS.iconPng, 'href', identity.iconPng);
    this.set(IDENTITY_SELECTORS.appleTouchIcon, 'href', identity.appleTouchIcon);
    this.set(IDENTITY_SELECTORS.appleTitle, 'content', identity.name);
    this.state.set(identity);
  }

  private set(selector: string, attribute: string, value: string): void {
    const element = this.document.head.querySelector(selector);
    if (element && element.getAttribute(attribute) !== value) {
      element.setAttribute(attribute, value);
    }
  }
}
