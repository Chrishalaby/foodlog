import { HttpErrorResponse } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, withNavigationErrorHandler } from '@angular/router';
import {
  CHUNK_OFFLINE_MESSAGE,
  CHUNK_RELOAD_KEY,
  CHUNK_RELOAD_NAVIGATE,
  CHUNK_RELOAD_WINDOW_MS,
  CHUNK_STALE_MESSAGE,
  isChunkLoadError,
  recoverFromChunkLoadError,
} from './chunk-load-recovery';
import { NetworkService } from './network.service';
import { ToastService } from './toast.service';

@Component({ template: 'page' })
class Page {}

const CHROME_CHUNK_ERROR =
  'Failed to fetch dynamically imported module: https://foodlog.example/chunk-AB12CD34.js';

describe('isChunkLoadError', () => {
  it('recognises failed lazy chunk loads in every browser', () => {
    expect(isChunkLoadError(new TypeError(CHROME_CHUNK_ERROR))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(
      isChunkLoadError(
        new TypeError('error loading dynamically imported module: https://x/chunk-A.js'),
      ),
    ).toBe(true);
    expect(
      isChunkLoadError(
        new Error(
          'Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of "text/html"',
        ),
      ),
    ).toBe(true);
  });

  it('ignores every other error', () => {
    expect(isChunkLoadError(new Error('boom'))).toBe(false);
    expect(isChunkLoadError(new HttpErrorResponse({ status: 502 }))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('recoverFromChunkLoadError', () => {
  let navigate: ReturnType<typeof vi.fn<(url: string) => void>>;
  let online: ReturnType<typeof signal<boolean>>;
  let router: Router;
  let toast: ToastService;

  beforeEach(() => {
    sessionStorage.clear();
    navigate = vi.fn<(url: string) => void>();
    online = signal(true);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            { path: '', component: Page },
            {
              path: 'stats',
              loadComponent: () => Promise.reject(new TypeError(CHROME_CHUNK_ERROR)),
            },
            { path: 'boom', loadComponent: () => Promise.reject(new Error('boom')) },
          ],
          withNavigationErrorHandler(recoverFromChunkLoadError),
        ),
        { provide: CHUNK_RELOAD_NAVIGATE, useValue: navigate },
        { provide: NetworkService, useValue: { online } },
      ],
    });
    router = TestBed.inject(Router);
    toast = TestBed.inject(ToastService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  function messages(): string[] {
    return toast.toasts().map((t) => t.message);
  }

  it('reloads into the page once when its code is gone after a deploy', async () => {
    await expect(router.navigateByUrl('/stats?range=week')).rejects.toThrow(
      'dynamically imported module',
    );
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/stats?range=week');
    expect(Number(sessionStorage.getItem(CHUNK_RELOAD_KEY))).toBeGreaterThan(0);
    expect(messages()).toEqual([]);
  });

  it('offers a manual reload instead of looping when it fails again right away', async () => {
    await expect(router.navigateByUrl('/stats')).rejects.toThrow();
    await expect(router.navigateByUrl('/stats')).rejects.toThrow();
    expect(navigate).toHaveBeenCalledTimes(1);
    const stale = toast.toasts().find((t) => t.message === CHUNK_STALE_MESSAGE);
    expect(stale?.action?.label).toBe('Reload');

    toast.runAction(stale!.id);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(navigate).toHaveBeenLastCalledWith('/stats');
  });

  it('reloads again once the loop window has passed', async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    await expect(router.navigateByUrl('/stats')).rejects.toThrow();
    now.mockReturnValue(start + CHUNK_RELOAD_WINDOW_MS);
    await expect(router.navigateByUrl('/stats')).rejects.toThrow();
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('leaves other navigation errors alone', async () => {
    await expect(router.navigateByUrl('/boom')).rejects.toThrow('boom');
    expect(navigate).not.toHaveBeenCalled();
    expect(messages()).toEqual([]);
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
  });

  it('explains instead of reloading while offline', async () => {
    online.set(false);
    await expect(router.navigateByUrl('/stats')).rejects.toThrow();
    expect(navigate).not.toHaveBeenCalled();
    expect(messages()).toContain(CHUNK_OFFLINE_MESSAGE);
  });

  it('never reloads blindly when session storage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    await expect(router.navigateByUrl('/stats')).rejects.toThrow();
    expect(navigate).not.toHaveBeenCalled();
    expect(messages()).toContain(CHUNK_STALE_MESSAGE);
  });
});
