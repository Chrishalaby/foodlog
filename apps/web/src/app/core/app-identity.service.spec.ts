import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import {
  AppIdentityService,
  FOODLOG_IDENTITY,
  NOTES_APP_IDENTITY,
  NOTES_IDENTITY,
  identityFor,
  identityForUrl,
  isNotesHost,
  isNotesUrl,
} from './app-identity.service';

@Component({ template: '' })
class Blank {}

const HEAD_MARKUP = `
  <link rel="manifest" href="manifest.webmanifest" />
  <link rel="icon" type="image/svg+xml" href="favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="favicon-32x32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon-180x180.png" />
  <meta name="apple-mobile-web-app-title" content="FoodLog" />
`;

function attribute(selector: string, name: string): string | null {
  return document.head.querySelector(selector)?.getAttribute(name) ?? null;
}

function shownIdentity(): Record<string, string | null> {
  return {
    manifest: attribute('link[rel="manifest"]', 'href'),
    icon: attribute('link[rel="icon"][type="image/svg+xml"]', 'href'),
    iconPng: attribute('link[rel="icon"][type="image/png"]', 'href'),
    appleTouchIcon: attribute('link[rel="apple-touch-icon"]', 'href'),
    name: attribute('meta[name="apple-mobile-web-app-title"]', 'content'),
  };
}

function expected(identity: typeof NOTES_IDENTITY): Record<string, string | null> {
  return {
    manifest: identity.manifest,
    icon: identity.icon,
    iconPng: identity.iconPng,
    appleTouchIcon: identity.appleTouchIcon,
    name: identity.name,
  };
}

describe('app identity', () => {
  it('recognises Notes addresses, with or without a query', () => {
    expect(isNotesUrl('/notes')).toBe(true);
    expect(isNotesUrl('/notes?text=Buy%20mirror&url=https%3A%2F%2Fshop.test%2Fa.b')).toBe(true);
    expect(isNotesUrl('/notes/anything#top')).toBe(true);
    expect(isNotesUrl('/notes-archive')).toBe(false);
    expect(isNotesUrl('/settings?next=/notes')).toBe(false);
    expect(isNotesUrl('/')).toBe(false);
  });

  it('gives Notes its own manifest and icons', () => {
    expect(identityForUrl('/notes')).toBe(NOTES_IDENTITY);
    expect(identityForUrl('/today')).toBe(FOODLOG_IDENTITY);
    expect(NOTES_IDENTITY.manifest).toBe('notes.webmanifest');
    expect(NOTES_IDENTITY.manifest).not.toBe(FOODLOG_IDENTITY.manifest);
    expect(NOTES_IDENTITY.appleTouchIcon).toContain('icons/notes/');
  });
});

describe('the Notes address', () => {
  it('is any host whose first name has "notes" as a word', () => {
    expect(isNotesHost('foodlog-notes.example.com')).toBe(true);
    expect(isNotesHost('notes-production-1a2b.up.railway.app')).toBe(true);
    expect(isNotesHost('notes.example.com')).toBe(true);
    expect(isNotesHost('NOTES.localhost')).toBe(true);
  });

  it('is not FoodLog’s own address or a lookalike', () => {
    expect(isNotesHost('foodlog.example.com')).toBe(false);
    expect(isNotesHost('localhost')).toBe(false);
    expect(isNotesHost('keynotes.example.com')).toBe(false);
    expect(isNotesHost('app.notes.example.com')).toBe(false);
    expect(isNotesHost('192.168.1.20')).toBe(false);
    expect(isNotesHost('')).toBe(false);
    expect(isNotesHost(null)).toBe(false);
  });

  it('is Notes on every page, installable for the whole address', () => {
    for (const url of ['/notes', '/login', '/today', '/']) {
      expect(identityFor('foodlog-notes.example.com', url)).toBe(NOTES_APP_IDENTITY);
    }
    expect(NOTES_APP_IDENTITY.manifest).toBe('notes-app.webmanifest');
    expect(NOTES_APP_IDENTITY.key).toBe('notes');
    expect(NOTES_APP_IDENTITY.icon).toBe(NOTES_IDENTITY.icon);
  });

  it('leaves FoodLog’s address to decide by page', () => {
    expect(identityFor('foodlog.example.com', '/notes')).toBe(NOTES_IDENTITY);
    expect(identityFor('foodlog.example.com', '/today')).toBe(FOODLOG_IDENTITY);
  });
});

describe('AppIdentityService', () => {
  let added: Element[];
  let router: Router;
  let service: AppIdentityService;

  beforeEach(() => {
    const holder = document.createElement('template');
    holder.innerHTML = HEAD_MARKUP;
    added = Array.from(holder.content.children);
    document.head.append(...added);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'notes', component: Blank },
          { path: 'today', component: Blank },
          { path: 'old-notes', redirectTo: 'notes' },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    service = TestBed.inject(AppIdentityService);
  });

  afterEach(() => {
    added.forEach((element) => element.remove());
  });

  it('starts as FoodLog and leaves the page head alone', () => {
    expect(service.notesHost).toBe(false);
    expect(service.identity()).toBe(FOODLOG_IDENTITY);
    expect(shownIdentity()).toEqual(expected(FOODLOG_IDENTITY));
  });

  it('points the manifest, icons and app title at Notes on a Notes route', async () => {
    await router.navigateByUrl('/notes?text=Buy%20mirror');
    expect(service.identity()).toBe(NOTES_IDENTITY);
    expect(shownIdentity()).toEqual(expected(NOTES_IDENTITY));
  });

  it('switches back to FoodLog without a page reload', async () => {
    await router.navigateByUrl('/notes');
    await router.navigateByUrl('/today');
    expect(service.identity()).toBe(FOODLOG_IDENTITY);
    expect(shownIdentity()).toEqual(expected(FOODLOG_IDENTITY));
  });

  it('follows redirects to the address the user ends up on', async () => {
    await router.navigateByUrl('/old-notes');
    expect(router.url).toBe('/notes');
    expect(shownIdentity()).toEqual(expected(NOTES_IDENTITY));
  });
});
