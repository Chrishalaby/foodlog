import { DOCUMENT, InjectionToken, inject } from '@angular/core';
import type { NavigationError } from '@angular/router';
import { NetworkService } from './network.service';
import { ToastService } from './toast.service';

export const CHUNK_LOAD_ERROR_PATTERN =
  /dynamically imported module|Importing a module script failed|Failed to load module script/i;
export const CHUNK_RELOAD_KEY = 'foodlog.chunkReloadAt';
export const CHUNK_RELOAD_WINDOW_MS = 60_000;
export const CHUNK_OFFLINE_MESSAGE =
  'This page can’t open while you’re offline. Reconnect and try again.';
export const CHUNK_STALE_MESSAGE =
  'Could not load this page. Reload the app to get the latest version.';

export const CHUNK_RELOAD_NAVIGATE = new InjectionToken<(url: string) => void>(
  'CHUNK_RELOAD_NAVIGATE',
  {
    providedIn: 'root',
    factory: () => {
      const location = inject(DOCUMENT).location;
      return (url: string) => location.assign(url);
    },
  },
);

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_LOAD_ERROR_PATTERN.test(error.message);
}

function claimReload(doc: Document, now: number): boolean {
  try {
    const storage = doc.defaultView?.sessionStorage;
    if (!storage) {
      return false;
    }
    const last = Number(storage.getItem(CHUNK_RELOAD_KEY));
    if (last > 0 && now - last < CHUNK_RELOAD_WINDOW_MS) {
      return false;
    }
    storage.setItem(CHUNK_RELOAD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}

export function recoverFromChunkLoadError(event: NavigationError): void {
  if (!isChunkLoadError(event.error)) {
    return;
  }
  const toast = inject(ToastService);
  const online = inject(NetworkService).online();
  const doc = inject(DOCUMENT);
  const navigate = inject(CHUNK_RELOAD_NAVIGATE);
  if (!online) {
    toast.error(CHUNK_OFFLINE_MESSAGE);
    return;
  }
  if (!claimReload(doc, Date.now())) {
    toast.error(CHUNK_STALE_MESSAGE, {
      durationMs: 0,
      action: { label: 'Reload', run: () => navigate(event.url) },
    });
    return;
  }
  navigate(event.url);
}
