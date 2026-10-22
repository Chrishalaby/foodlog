import {
  LAST_SEEN_INTERVAL_MS,
  SESSION_MAX_AGE_MS,
  SESSION_RENEW_AFTER_MS,
  USER_AGENT_MAX_LENGTH,
} from './auth.constants.js';

const CONTROL_CHARACTERS = /\p{Cc}+/gu;

export function shouldRenewToken(issuedAtMs: number, now: Date): boolean {
  return now.getTime() - issuedAtMs >= SESSION_RENEW_AFTER_MS;
}

export function shouldRecordActivity(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= LAST_SEEN_INTERVAL_MS;
}

export function staleSessionCutoff(now: Date): Date {
  return new Date(now.getTime() - SESSION_MAX_AGE_MS);
}

export function isSessionStale(lastSeenAt: Date, now: Date): boolean {
  return lastSeenAt.getTime() < staleSessionCutoff(now).getTime();
}

export function normalizeUserAgent(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const cleaned = value.replace(CONTROL_CHARACTERS, ' ').trim();
  return cleaned === '' ? null : cleaned.slice(0, USER_AGENT_MAX_LENGTH);
}
