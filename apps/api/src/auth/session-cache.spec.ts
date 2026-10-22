import type { UserDto } from '@food/shared';
import { type CachedSession, SessionCache } from './session-cache.js';

function session(sessionId: string, userId = 'user-1'): CachedSession {
  const user: UserDto = {
    id: userId,
    email: `${userId}@example.com`,
    name: null,
    role: 'member',
  };
  return { sessionId, user, lastSeenAt: new Date(0) };
}

describe('SessionCache', () => {
  it('serves entries until their time-to-live runs out', () => {
    const cache = new SessionCache(30_000, 10);
    cache.set(session('a'), 1_000);

    expect(cache.get('a', 30_999)?.sessionId).toBe('a');
    expect(cache.get('a', 31_000)).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('evicts the oldest entries beyond its capacity', () => {
    const cache = new SessionCache(30_000, 2);
    cache.set(session('a'), 0);
    cache.set(session('b'), 0);
    cache.set(session('c'), 0);

    expect(cache.get('a', 1)).toBeNull();
    expect(cache.get('b', 1)?.sessionId).toBe('b');
    expect(cache.get('c', 1)?.sessionId).toBe('c');
  });

  it('forgets a single session or every session of a user', () => {
    const cache = new SessionCache();
    cache.set(session('a', 'user-1'), 0);
    cache.set(session('b', 'user-1'), 0);
    cache.set(session('c', 'user-2'), 0);

    cache.delete('a');
    expect(cache.get('a', 1)).toBeNull();
    cache.deleteUser('user-1');
    expect(cache.get('b', 1)).toBeNull();
    expect(cache.get('c', 1)?.sessionId).toBe('c');
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
