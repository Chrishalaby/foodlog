import { API_LIMITS } from '@food/shared';
import {
  isSessionStale,
  normalizeUserAgent,
  shouldRecordActivity,
  shouldRenewToken,
} from './session-policy.js';

const HOUR_MS = 60 * 60 * 1000;
const NOW = new Date('2026-09-28T12:00:00.000Z');

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

describe('session policy', () => {
  it('re-issues the cookie once the token is at least 24 hours old', () => {
    expect(shouldRenewToken(hoursAgo(23.9).getTime(), NOW)).toBe(false);
    expect(shouldRenewToken(hoursAgo(24).getTime(), NOW)).toBe(true);
    expect(shouldRenewToken(0, NOW)).toBe(true);
    expect(shouldRenewToken(hoursAgo(-1).getTime(), NOW)).toBe(false);
  });

  it('records activity at most once per hour', () => {
    expect(shouldRecordActivity(hoursAgo(0.5), NOW)).toBe(false);
    expect(shouldRecordActivity(hoursAgo(1), NOW)).toBe(true);
  });

  it('treats sessions unused for longer than the cookie lifetime as stale', () => {
    const maxAgeHours = API_LIMITS.sessionMaxAgeDays * 24;
    expect(isSessionStale(hoursAgo(maxAgeHours - 1), NOW)).toBe(false);
    expect(isSessionStale(hoursAgo(maxAgeHours + 1), NOW)).toBe(true);
  });

  it('cleans and truncates user agents', () => {
    expect(normalizeUserAgent('  Mozilla/5.0 (iPhone)  ')).toBe(
      'Mozilla/5.0 (iPhone)',
    );
    expect(normalizeUserAgent('a\u0000b\r\nc')).toBe('a b c');
    expect(normalizeUserAgent('x'.repeat(1000))).toHaveLength(256);
    expect(normalizeUserAgent('   ')).toBeNull();
    expect(normalizeUserAgent(undefined)).toBeNull();
    expect(normalizeUserAgent(['a'])).toBeNull();
  });
});
