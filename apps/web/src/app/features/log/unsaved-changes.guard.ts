import type { CanDeactivateFn } from '@angular/router';
import { LOGIN_PATH } from '../../core/api.interceptor';

export interface UnsavedChangesAware {
  canDeactivate(): boolean | Promise<boolean>;
}

export const unsavedChangesGuard: CanDeactivateFn<UnsavedChangesAware> = (
  component,
  _route,
  _state,
  next,
) => (next.url.startsWith(LOGIN_PATH) ? true : (component?.canDeactivate() ?? true));
