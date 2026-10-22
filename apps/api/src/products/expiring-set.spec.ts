import { ExpiringSet } from './expiring-set.js';

function clock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('ExpiringSet', () => {
  it('remembers keys until their time to live elapses', () => {
    const time = clock();
    const set = new ExpiringSet(100, 10, time.now);

    set.add('a');
    time.advance(99);
    expect(set.has('a')).toBe(true);
    time.advance(1);
    expect(set.has('a')).toBe(false);
    expect(set.size).toBe(0);
    expect(set.has('missing')).toBe(false);
  });

  it('restarts the time to live when a key is added again', () => {
    const time = clock();
    const set = new ExpiringSet(100, 10, time.now);

    set.add('a');
    time.advance(80);
    set.add('a');
    time.advance(80);

    expect(set.has('a')).toBe(true);
  });

  it('evicts the oldest keys beyond the maximum size', () => {
    const time = clock();
    const set = new ExpiringSet(100, 2, time.now);

    set.add('a');
    set.add('b');
    set.add('a');
    set.add('c');

    expect(set.size).toBe(2);
    expect(set.has('b')).toBe(false);
    expect(set.has('a')).toBe(true);
    expect(set.has('c')).toBe(true);
  });

  it('forgets deleted keys', () => {
    const set = new ExpiringSet(100, 2);

    set.add('a');
    set.delete('a');

    expect(set.has('a')).toBe(false);
  });
});
