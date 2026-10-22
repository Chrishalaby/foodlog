import { inject } from '@angular/core';
import { type CanActivateChildFn, type CanActivateFn, Router, type UrlTree } from '@angular/router';
import { AppIdentityService, NOTES_ROOT } from './app-identity.service';
import { AuthService } from './auth.service';
import { ProfileStore } from './profile.store';

export const HOME_PATH = '/today';
export const ONBOARDING_PATH = '/onboarding';
export const LOGIN_PATH = '/login';
export const ADMIN_PATH = '/admin';
export const REQUEST_ACCESS_PATH = '/request-access';
export const ONBOARDING_CHECK_TIMEOUT_MS = 5000;
export const AUTH_CHECK_TIMEOUT_MS = 5000;

const NON_RETURN_PREFIXES = ['/login', '/setup', '/request-access', '/invite/', '/reset/'];
const UNSAFE_REDIRECT_CHARS = /[\u0000- \u007F\\]/;
const REDIRECT_CHECK_ORIGIN = 'https://app.invalid';

function staysOnOrigin(path: string): boolean {
  try {
    return new URL(path, REDIRECT_CHECK_ORIGIN).origin === REDIRECT_CHECK_ORIGIN;
  } catch {
    return false;
  }
}

export function safeRedirectPath(next: string | null | undefined): string | null {
  if (
    !next ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    UNSAFE_REDIRECT_CHARS.test(next) ||
    !staysOnOrigin(next)
  ) {
    return null;
  }
  if (NON_RETURN_PREFIXES.some((prefix) => next.startsWith(prefix))) {
    return null;
  }
  return next;
}

function settleWithin<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function authLoaded(auth: AuthService): Promise<boolean> {
  return settleWithin(auth.ensureLoaded(), AUTH_CHECK_TIMEOUT_MS, false);
}

function loginTree(router: Router, returnUrl: string): UrlTree {
  const next = safeRedirectPath(returnUrl);
  return router.createUrlTree([LOGIN_PATH], {
    queryParams: next && next !== '/' ? { next } : {},
  });
}

export const notesHostGuard: CanActivateFn = async () => {
  if (!inject(AppIdentityService).notesHost) {
    return true;
  }
  const auth = inject(AuthService);
  const router = inject(Router);
  await authLoaded(auth);
  return auth.notesEnabled() ? router.createUrlTree([NOTES_ROOT]) : true;
};

export const notesEnabledGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await authLoaded(auth);
  return auth.notesEnabled() ? true : router.createUrlTree([HOME_PATH]);
};

export const authGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!(await authLoaded(auth))) {
    return true;
  }
  if (auth.setupRequired()) {
    return router.createUrlTree(['/setup']);
  }
  return auth.isAuthenticated() ? true : loginTree(router, state.url);
};

export const guestGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!(await authLoaded(auth))) {
    return true;
  }
  if (auth.setupRequired()) {
    return router.createUrlTree(['/setup']);
  }
  return auth.isAuthenticated() ? router.createUrlTree([HOME_PATH]) : true;
};

export const setupGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!(await authLoaded(auth))) {
    return true;
  }
  if (auth.setupRequired()) {
    return true;
  }
  return router.createUrlTree([auth.isAuthenticated() ? HOME_PATH : LOGIN_PATH]);
};

export const accountLinkGuard: CanActivateFn = async () => {
  await authLoaded(inject(AuthService));
  return true;
};

export const adminGuard: CanActivateFn = async (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!(await authLoaded(auth))) {
    return router.createUrlTree([HOME_PATH]);
  }
  if (!auth.isAuthenticated()) {
    return loginTree(router, state.url);
  }
  return auth.isAdmin() ? true : router.createUrlTree([HOME_PATH]);
};

export const onboardingGuard: CanActivateChildFn = async () => {
  const auth = inject(AuthService);
  const store = inject(ProfileStore);
  const router = inject(Router);
  if (!auth.isAuthenticated()) {
    auth.recover();
    return true;
  }
  const response = await settleWithin(store.ensureLoaded(), ONBOARDING_CHECK_TIMEOUT_MS, null);
  return response?.profile.onboarded === false ? router.createUrlTree([ONBOARDING_PATH]) : true;
};
