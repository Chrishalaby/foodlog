import {
  canCreateAccount,
  toAccessStatus,
  UNKNOWN_ACCESS_STATUS,
} from './access-status.js';

const CREATED = new Date('2026-09-20T08:00:00.000Z');
const DECIDED = new Date('2026-09-21T08:00:00.000Z');

describe('access request status', () => {
  it('allows creating an account only for approved, unaccepted requests without an account', () => {
    expect(
      canCreateAccount({ status: 'approved', acceptedAt: null }, false),
    ).toBe(true);
    expect(
      canCreateAccount({ status: 'approved', acceptedAt: null }, true),
    ).toBe(false);
    expect(
      canCreateAccount({ status: 'approved', acceptedAt: DECIDED }, false),
    ).toBe(false);
    expect(
      canCreateAccount({ status: 'pending', acceptedAt: null }, false),
    ).toBe(false);
    expect(
      canCreateAccount({ status: 'rejected', acceptedAt: null }, false),
    ).toBe(false);
  });

  it('maps a stored request to the public status response', () => {
    expect(
      toAccessStatus(
        {
          email: 'friend@example.com',
          name: 'Friend',
          status: 'approved',
          createdAt: CREATED,
          decidedAt: DECIDED,
          acceptedAt: null,
        },
        false,
      ),
    ).toEqual({
      status: 'approved',
      email: 'friend@example.com',
      name: 'Friend',
      createdAt: CREATED.toISOString(),
      decidedAt: DECIDED.toISOString(),
      canCreateAccount: true,
    });
  });

  it('describes unknown tokens without leaking anything', () => {
    expect(UNKNOWN_ACCESS_STATUS).toEqual({
      status: 'unknown',
      email: null,
      name: null,
      createdAt: null,
      decidedAt: null,
      canCreateAccount: false,
    });
  });
});
