import type { AuthTokenType } from '@food/shared';
import { appLink } from '../config/app-url.js';

const LINK_PATHS: Record<AuthTokenType, string> = {
  invite: 'invite',
  reset: 'reset',
};

export function authTokenLink(
  baseUrl: string,
  type: AuthTokenType,
  token: string,
): string {
  return appLink(baseUrl, `${LINK_PATHS[type]}/${token}`);
}
