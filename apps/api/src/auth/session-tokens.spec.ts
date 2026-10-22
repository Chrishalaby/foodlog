import { JwtService } from '@nestjs/jwt';
import { SessionTokens } from './session-tokens.service.js';

const SECRET = 's'.repeat(48);

function createTokens(secret = SECRET): {
  jwt: JwtService;
  tokens: SessionTokens;
} {
  const jwt = new JwtService({
    secret,
    signOptions: { algorithm: 'HS256' },
    verifyOptions: { algorithms: ['HS256'] },
  });
  return { jwt, tokens: new SessionTokens(jwt) };
}

describe('SessionTokens', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs { sub, sid } without an expiry and reads it back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T10:00:00.000Z'));
    const { jwt, tokens } = createTokens();

    const token = await tokens.sign('user-1', 'session-1');

    expect(jwt.decode(token)).toEqual({
      sub: 'user-1',
      sid: 'session-1',
      iat: Date.parse('2026-09-28T10:00:00.000Z') / 1000,
    });
    await expect(tokens.verify(token)).resolves.toEqual({
      userId: 'user-1',
      sessionId: 'session-1',
      issuedAt: Date.parse('2026-09-28T10:00:00.000Z'),
    });
  });

  it('stays valid years later because it never expires', async () => {
    const { tokens } = createTokens();
    const token = await tokens.sign('user-1', 'session-1');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000);

    await expect(tokens.verify(token)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
  });

  it('rejects legacy tokens without a session id', async () => {
    const { jwt, tokens } = createTokens();
    const legacy = await jwt.signAsync({ sub: 'user-1', email: 'a@b.co' });

    await expect(tokens.verify(legacy)).resolves.toBeNull();
  });

  it('rejects garbage, tampered, foreign and unsigned tokens', async () => {
    const { tokens } = createTokens();
    const token = await tokens.sign('user-1', 'session-1');
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({ sub: 'admin', sid: 'session-1' }),
    ).toString('base64url');
    const foreign = await createTokens('x'.repeat(48)).tokens.sign(
      'user-1',
      'session-1',
    );
    const unsigned = `${Buffer.from(
      JSON.stringify({ alg: 'none', typ: 'JWT' }),
    ).toString('base64url')}.${forgedPayload}.`;

    await expect(tokens.verify(null)).resolves.toBeNull();
    await expect(tokens.verify('')).resolves.toBeNull();
    await expect(tokens.verify('not-a-jwt')).resolves.toBeNull();
    await expect(
      tokens.verify(`${header}.${forgedPayload}.${signature}`),
    ).resolves.toBeNull();
    await expect(tokens.verify(foreign)).resolves.toBeNull();
    await expect(tokens.verify(unsigned)).resolves.toBeNull();
  });
});
