import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, TitleStrategy, provideRouter } from '@angular/router';
import { APP_NAME, AppTitleStrategy, documentTitle } from './title-strategy';

@Component({ template: '' })
class Blank {}

describe('documentTitle', () => {
  it('adds the app name to FoodLog pages', () => {
    expect(documentTitle('/today', 'Today')).toBe('Today · FoodLog');
    expect(documentTitle('/today?date=2026-10-07', 'Today')).toBe('Today · FoodLog');
    expect(documentTitle('/', undefined)).toBe(APP_NAME);
  });

  it('titles Notes as its own app', () => {
    expect(documentTitle('/notes', 'Notes')).toBe('Notes');
    expect(documentTitle('/notes?text=Buy%20mirror', 'Notes')).toBe('Notes');
    expect(documentTitle('/notes', undefined)).toBe('Notes');
  });

  it('names the other pages after Notes on the Notes address', () => {
    expect(documentTitle('/login', 'Sign in', 'Notes')).toBe('Sign in · Notes');
    expect(documentTitle('/login', undefined, 'Notes')).toBe('Notes');
    expect(documentTitle('/notes', 'Notes', 'Notes')).toBe('Notes');
  });
});

describe('AppTitleStrategy', () => {
  let router: Router;
  let previousTitle: string;

  beforeEach(() => {
    previousTitle = document.title;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'notes', title: 'Notes', component: Blank },
          { path: 'settings', title: 'Settings', component: Blank },
          { path: 'plain', component: Blank },
        ]),
        { provide: TitleStrategy, useClass: AppTitleStrategy },
      ],
    });
    router = TestBed.inject(Router);
  });

  afterEach(() => {
    document.title = previousTitle;
  });

  it('shows the page and the app name on FoodLog routes', async () => {
    await router.navigateByUrl('/settings');
    expect(document.title).toBe('Settings · FoodLog');
    await router.navigateByUrl('/plain');
    expect(document.title).toBe('FoodLog');
  });

  it('shows just Notes on the Notes route', async () => {
    await router.navigateByUrl('/notes?title=Shared&text=Hello');
    expect(document.title).toBe('Notes');
    await router.navigateByUrl('/settings');
    expect(document.title).toBe('Settings · FoodLog');
  });
});
