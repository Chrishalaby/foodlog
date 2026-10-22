import { HttpErrorResponse, type HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { inject, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, tap, throwError } from 'rxjs';
import { API_BASE } from './api.service';
import { AuthService } from './auth.service';
import { SessionScope } from './session-scope';

export const SW_BYPASS_HEADER = 'ngsw-bypass';
export const LOGIN_PATH = '/login';
export const SIGNED_OUT_REASON = 'signed-out';

const SAFE_METHODS = new Set(['GET', 'HEAD']);

const SIGNED_OUT_PATHS = new Set(
  ['auth/login', 'auth/setup', 'auth/status', 'auth/logout'].map((path) => `${API_BASE}/${path}`),
);
const SIGNED_OUT_PREFIXES = ['auth/tokens/', 'access-requests'].map(
  (path) => `${API_BASE}/${path}`,
);

function isApiRequest(url: string): boolean {
  return url === API_BASE || url.startsWith(`${API_BASE}/`);
}

export function endsSessionOn401(url: string): boolean {
  const path = url.split(/[?#]/)[0];
  return (
    !SIGNED_OUT_PATHS.has(path) && !SIGNED_OUT_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

export const apiInterceptor: HttpInterceptorFn = (req, next) => {
  if (!isApiRequest(req.url)) {
    return next(req);
  }
  const auth = inject(AuthService);
  const router = inject(Router);
  const scope = inject(SessionScope);
  const epoch = untracked(scope.epoch);
  const request = SAFE_METHODS.has(req.method)
    ? req
    : req.clone({ headers: req.headers.set(SW_BYPASS_HEADER, '1') });

  return next(request).pipe(
    tap((event) => {
      if (
        event instanceof HttpResponse &&
        endsSessionOn401(req.url) &&
        untracked(auth.status) === 'unknown'
      ) {
        auth.load().catch(() => undefined);
      }
    }),
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        endsSessionOn401(req.url) &&
        untracked(scope.epoch) === epoch
      ) {
        const wasSignedIn = untracked(auth.isAuthenticated);
        auth.markLoggedOut();
        const current = router.url;
        if (!current.startsWith(LOGIN_PATH)) {
          void router.navigate([LOGIN_PATH], {
            queryParams: {
              ...(current && current !== '/' ? { next: current } : {}),
              ...(wasSignedIn ? { reason: SIGNED_OUT_REASON } : {}),
            },
          });
        }
      }
      return throwError(() => error);
    }),
  );
};
