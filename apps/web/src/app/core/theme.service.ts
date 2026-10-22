import { DOCUMENT, DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { THEMES, type ThemePreference } from '@food/shared';

export const THEME_STORAGE_KEY = 'theme';
export const DEFAULT_THEME: ThemePreference = 'dark';
export const THEME_BACKGROUND: Record<'dark' | 'light', string> = {
  dark: '#0a0d12',
  light: '#f4f6f9',
};

const DARK_QUERY = '(prefers-color-scheme: dark)';

function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly storage = this.resolveStorage();
  private readonly media = this.resolveMediaQuery();
  private readonly systemDark = signal(this.media?.matches ?? true);
  private readonly preferenceState = signal<ThemePreference>(this.readStoredPreference());

  readonly preference = this.preferenceState.asReadonly();
  readonly isDark = computed(() => {
    const preference = this.preferenceState();
    return preference === 'system' ? this.systemDark() : preference === 'dark';
  });

  constructor() {
    const media = this.media;
    if (media) {
      const onChange = (event: MediaQueryListEvent): void => {
        this.systemDark.set(event.matches);
        this.apply();
      };
      media.addEventListener('change', onChange);
      inject(DestroyRef).onDestroy(() => media.removeEventListener('change', onChange));
    }
    this.apply();
  }

  setPreference(preference: ThemePreference): void {
    this.preferenceState.set(preference);
    this.persist(preference);
    this.apply();
  }

  toggle(): void {
    this.setPreference(this.isDark() ? 'light' : 'dark');
  }

  private apply(): void {
    const theme = this.isDark() ? 'dark' : 'light';
    const root = this.document.documentElement;
    root.setAttribute('data-theme', theme);
    this.document
      .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
      .forEach((meta) => meta.setAttribute('content', THEME_BACKGROUND[theme]));
  }

  private readStoredPreference(): ThemePreference {
    try {
      const stored = this.storage?.getItem(THEME_STORAGE_KEY);
      return isThemePreference(stored) ? stored : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  private persist(preference: ThemePreference): void {
    try {
      this.storage?.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      return;
    }
  }

  private resolveStorage(): Storage | null {
    try {
      return this.document.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private resolveMediaQuery(): MediaQueryList | null {
    const view = this.document.defaultView;
    return view && typeof view.matchMedia === 'function' ? view.matchMedia(DARK_QUERY) : null;
  }
}
