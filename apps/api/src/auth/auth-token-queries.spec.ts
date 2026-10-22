import { pendingTokens, sameRecipientTokens } from './auth-token-queries.js';

describe('auth token queries', () => {
  it('matches only unused, unrevoked tokens', () => {
    expect(pendingTokens({ type: 'invite', email: 'a@example.com' })).toEqual({
      type: 'invite',
      email: 'a@example.com',
      usedAt: null,
      revokedAt: null,
    });
  });

  it('groups invites by email and reset links by person', () => {
    expect(
      sameRecipientTokens({
        id: 'token-1',
        type: 'invite',
        email: 'a@example.com',
        userId: null,
      }),
    ).toEqual({ type: 'invite', email: 'a@example.com' });
    expect(
      sameRecipientTokens({
        id: 'token-2',
        type: 'reset',
        email: 'a@example.com',
        userId: 'user-1',
      }),
    ).toEqual({ type: 'reset', userId: 'user-1' });
    expect(
      sameRecipientTokens({
        id: 'token-3',
        type: 'reset',
        email: 'a@example.com',
        userId: null,
      }),
    ).toEqual({ id: 'token-3' });
  });
});
