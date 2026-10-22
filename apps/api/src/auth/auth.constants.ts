import { API_LIMITS } from '@food/shared';
import type { ThrottlerOptions } from '@nestjs/throttler';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const SESSION_COOKIE = 'ft_session';
export const SESSION_COOKIE_PATH = '/api';
export const SESSION_MAX_AGE_MS = API_LIMITS.sessionMaxAgeDays * DAY_MS;
export const SESSION_RENEW_AFTER_MS = DAY_MS;
export const LAST_SEEN_INTERVAL_MS = HOUR_MS;
export const SESSION_CACHE_TTL_MS = 30_000;
export const SESSION_CACHE_MAX_ENTRIES = 5_000;
export const USER_AGENT_MAX_LENGTH = 256;
export const SESSION_LIST_LIMIT = 100;
export const INVITE_TTL_MS = API_LIMITS.inviteTtlDays * DAY_MS;
export const RESET_TTL_MS = API_LIMITS.resetTtlDays * DAY_MS;
export const AUTH_ATTEMPTS_THROTTLE = { long: { limit: 5, ttl: MINUTE_MS } };
export const LOGIN_ACCOUNT_THROTTLER = {
  name: 'loginAccount',
  ttl: 15 * MINUTE_MS,
  limit: 10,
  blockDuration: 15 * MINUTE_MS,
} as const satisfies ThrottlerOptions;
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
export const ADMIN_LOCK_KEY = 462_011_731;
export const EMAIL_LOCK_NAMESPACE = 462_011_733;
