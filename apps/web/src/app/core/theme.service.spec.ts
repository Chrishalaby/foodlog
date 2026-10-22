import { TestBed } from '@angular/core/testing';
import { THEME_BACKGROUND, THEME_STORAGE_KEY, ThemeService } from './theme.service';

describe('ThemeService without matchMedia', () => {
  let meta: HTMLMetaElement;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
    expect(typeof window.matchMedia).not.toBe('function');
  });

  afterEach(() => {
    meta.remove();
    localStorage.clear();
  });

  it('defaults to the dark theme', () => {
    const theme = TestBed.inject(ThemeService);
    expect(theme.preference()).toBe('dark');
    expect(theme.isDark()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(meta.getAttribute('content')).toBe(THEME_BACKGROUND.dark);
  });

  it('restores a stored light preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    const theme = TestBed.inject(ThemeService);
    expect(theme.isDark()).toBe(false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('ignores invalid stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(TestBed.inject(ThemeService).preference()).toBe('dark');
  });

  it('persists and applies preference changes', () => {
    const theme = TestBed.inject(ThemeService);
    theme.setPreference('light');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(meta.getAttribute('content')).toBe(THEME_BACKGROUND.light);
    theme.toggle();
    expect(theme.preference()).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('treats system as dark when the media query is unavailable', () => {
    const theme = TestBed.inject(ThemeService);
    theme.setPreference('system');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(theme.isDark()).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
});
