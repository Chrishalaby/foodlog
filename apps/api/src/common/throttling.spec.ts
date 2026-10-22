import {
  aiThrottleKey,
  aiThrottlers,
  loginAccountTrackerKey,
  userTrackerKey,
  voiceThrottleKey,
  voiceThrottlers,
} from './throttling.js';

describe('throttling', () => {
  it('keys AI limits by the signed-in user and falls back to the IP', () => {
    expect(
      userTrackerKey(
        {
          user: {
            id: 'user-1',
            email: 'a@b.co',
            name: null,
            role: 'member',
            sessionId: 's',
          },
        },
        '10.0.0.1',
      ),
    ).toBe('user:user-1');
    expect(userTrackerKey({}, '10.0.0.1')).toBe('ip:10.0.0.1');
  });

  it('builds per-minute and per-hour AI throttlers from the configured limits', () => {
    expect(aiThrottlers({ perMinute: 6, perHour: 60 })).toEqual([
      { name: 'aiMinute', ttl: 60_000, limit: 6 },
      { name: 'aiHour', ttl: 3_600_000, limit: 60 },
    ]);
  });

  it('shares one AI rate-limit counter per user across every AI route', () => {
    expect(aiThrottleKey('aiMinute', 'user:user-1')).toBe(
      'ai:aiMinute:user:user-1',
    );
    expect(aiThrottleKey('aiHour', 'user:user-1')).not.toBe(
      aiThrottleKey('aiMinute', 'user:user-1'),
    );
    expect(aiThrottleKey('aiMinute', 'user:user-2')).not.toBe(
      aiThrottleKey('aiMinute', 'user:user-1'),
    );
  });

  it('allows voice dictation twice the AI limits on its own counters', () => {
    expect(voiceThrottlers({ perMinute: 6, perHour: 60 })).toEqual([
      { name: 'voiceMinute', ttl: 60_000, limit: 12 },
      { name: 'voiceHour', ttl: 3_600_000, limit: 120 },
    ]);
    expect(voiceThrottleKey('voiceMinute', 'user:user-1')).toBe(
      'voice:voiceMinute:user:user-1',
    );
    expect(voiceThrottleKey('voiceMinute', 'user:user-1')).not.toBe(
      aiThrottleKey('voiceMinute', 'user:user-1'),
    );
  });

  it('keys login attempts by the normalized email', () => {
    expect(
      loginAccountTrackerKey({ email: '  Owner@Example.COM ' }, '1.2.3.4'),
    ).toBe('email:owner@example.com');
    expect(
      loginAccountTrackerKey(
        { email: 'owner@example.com', password: 'x' },
        '5.6.7.8',
      ),
    ).toBe('email:owner@example.com');
  });

  it.each([
    ['no body', undefined],
    ['a null body', null],
    ['a body without email', { password: 'x' }],
    ['a numeric email', { email: 42 }],
    ['a blank email', { email: '   ' }],
    ['a text body', 'email=owner@example.com'],
  ])('falls back to the IP for %s', (_label, body) => {
    expect(loginAccountTrackerKey(body, '1.2.3.4')).toBe('ip:1.2.3.4');
  });
});
