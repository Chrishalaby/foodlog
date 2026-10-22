import { randomUUID } from 'node:crypto';
import type { AuthStatusResponse, SessionDto, UserDto } from '@food/shared';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { E2E_SETUP_CODE } from './e2e-environment.js';
import {
  createSignedInUser,
  createTestApp,
  createTestUser,
  getTestUser,
  resetDatabase,
  sessionCookieFor,
  sessionCookieFromResponse,
  setupAndLogin,
  signInAgent,
  TEST_CREDENTIALS,
  withSettings,
} from './helpers.js';

const PROTECTED_ROUTE = `/api/photos/${randomUUID()}`;
const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
const HOUR_MS = 60 * 60 * 1000;

function setCookieHeader(response: request.Response): string {
  const header = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  return header?.find((cookie) => cookie.startsWith('ft_session=')) ?? '';
}

describe('auth (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('walks through setup, logout, login and password change', async () => {
    const agent = request.agent(app.getHttpServer());

    const initial = await agent.get('/api/auth/status').expect(200);
    expect(initial.body).toEqual<AuthStatusResponse>({
      setupRequired: true,
      authenticated: false,
      user: null,
    });

    await agent
      .post('/api/auth/setup')
      .send({ ...TEST_CREDENTIALS, setupCode: 'wrong-code' })
      .expect(403);
    await agent
      .post('/api/auth/setup')
      .send({
        email: 'not-an-email',
        password: 'short',
        setupCode: E2E_SETUP_CODE,
      })
      .expect(400);

    const setup = await agent
      .post('/api/auth/setup')
      .send({
        email: `  ${TEST_CREDENTIALS.email.toUpperCase()} `,
        password: TEST_CREDENTIALS.password,
        setupCode: E2E_SETUP_CODE,
      })
      .expect(201);
    const user = setup.body as UserDto;
    expect(user).toEqual({
      id: expect.any(String) as string,
      email: TEST_CREDENTIALS.email,
      name: null,
      role: 'admin',
    });
    const cookie = setCookieHeader(setup);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api');
    expect(cookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(cookie).not.toContain('Secure');
    const setupCookie = sessionCookieFromResponse(setup);
    await expect(
      prisma.profile.count({ where: { userId: user.id } }),
    ).resolves.toBe(1);

    await agent
      .post('/api/auth/setup')
      .send({
        email: 'second@example.com',
        password: 'another password',
        setupCode: E2E_SETUP_CODE,
      })
      .expect(409);

    const authenticated = await agent.get('/api/auth/status').expect(200);
    expect(authenticated.body).toEqual<AuthStatusResponse>({
      setupRequired: false,
      authenticated: true,
      user,
    });
    await agent.get(PROTECTED_ROUTE).expect(404);

    const logout = await agent.post('/api/auth/logout').expect(204);
    expect(setCookieHeader(logout)).toMatch(/^ft_session=;/);
    await agent.get(PROTECTED_ROUTE).expect(401);
    await request(app.getHttpServer())
      .get(PROTECTED_ROUTE)
      .set('Cookie', setupCookie)
      .expect(401);
    const loggedOut = await agent.get('/api/auth/status').expect(200);
    expect(loggedOut.body).toMatchObject({
      setupRequired: false,
      authenticated: false,
      user: null,
    });

    const wrongPassword = await agent
      .post('/api/auth/login')
      .send({ email: TEST_CREDENTIALS.email, password: 'wrong password' })
      .expect(401);
    const unknownEmail = await agent
      .post('/api/auth/login')
      .send({
        email: 'nobody@example.com',
        password: TEST_CREDENTIALS.password,
      })
      .expect(401);
    expect(unknownEmail.body).toEqual(wrongPassword.body);
    const login = await agent
      .post('/api/auth/login')
      .send({
        email: ' Owner@Example.com ',
        password: TEST_CREDENTIALS.password,
      })
      .expect(200);
    expect(login.body).toEqual(user);
    await agent.get(PROTECTED_ROUTE).expect(404);

    const { agent: otherDevice } = await signInAgent(app, TEST_CREDENTIALS);
    await otherDevice.get(PROTECTED_ROUTE).expect(404);

    await agent
      .post('/api/auth/change-password')
      .send({
        currentPassword: 'wrong password',
        newPassword: 'a whole new password',
      })
      .expect(400);
    await agent
      .post('/api/auth/change-password')
      .send({
        currentPassword: TEST_CREDENTIALS.password,
        newPassword: 'short',
      })
      .expect(400);
    await agent
      .post('/api/auth/change-password')
      .send({
        currentPassword: TEST_CREDENTIALS.password,
        newPassword: 'a whole new password',
      })
      .expect(204);

    await agent.get(PROTECTED_ROUTE).expect(404);
    await otherDevice.get(PROTECTED_ROUTE).expect(401);
    await agent.post('/api/auth/login').send(TEST_CREDENTIALS).expect(401);
    await agent
      .post('/api/auth/login')
      .send({ email: TEST_CREDENTIALS.email, password: 'a whole new password' })
      .expect(200);
  });

  it('rejects forged, tampered, legacy and orphaned session cookies', async () => {
    await resetDatabase(prisma);
    const agent = await setupAndLogin(app);
    const status = await agent.get('/api/auth/status').expect(200);
    expect(status.body).toMatchObject({ authenticated: true });
    const owner = await getTestUser(app);
    const jwt = app.get(JwtService);
    const server = app.getHttpServer();

    await request(server)
      .get(PROTECTED_ROUTE)
      .set('Cookie', 'ft_session=not-a-jwt')
      .expect(401);
    const legacy = await jwt.signAsync({ sub: owner.id, email: owner.email });
    await request(server)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `ft_session=${legacy}`)
      .expect(401);
    const unknownSession = await jwt.signAsync({
      sub: owner.id,
      sid: randomUUID(),
    });
    await request(server)
      .get(PROTECTED_ROUTE)
      .set('Cookie', `ft_session=${unknownSession}`)
      .expect(401);

    const cleared = await request(server)
      .get('/api/auth/status')
      .set('Cookie', `ft_session=${legacy}`)
      .expect(200);
    expect(cleared.body).toMatchObject({ authenticated: false });
    expect(setCookieHeader(cleared)).toMatch(/^ft_session=;/);

    await resetDatabase(prisma);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31_000);
    const orphaned = await agent.get('/api/auth/status').expect(200);
    expect(orphaned.body).toEqual({
      setupRequired: true,
      authenticated: false,
      user: null,
    });
  });

  it('allows only one of several concurrent setups to succeed', async () => {
    await resetDatabase(prisma);
    const server = app.getHttpServer();

    const responses = await Promise.all(
      [1, 2, 3].map((n) =>
        request(server)
          .post('/api/auth/setup')
          .send({
            email: `racer-${n}@example.com`,
            password: TEST_CREDENTIALS.password,
            setupCode: E2E_SETUP_CODE,
          }),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.sort((a, b) => a - b)).toEqual([201, 409, 409]);
    await expect(prisma.user.count()).resolves.toBe(1);
    await expect(prisma.profile.count()).resolves.toBe(1);
    await expect(prisma.user.findFirstOrThrow()).resolves.toMatchObject({
      role: 'admin',
    });
  });

  it('keeps sessions alive forever by re-issuing the cookie after 24 hours', async () => {
    await resetDatabase(prisma);
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-09-28T08:00:00.000Z');
    vi.setSystemTime(start);
    const agent = await setupAndLogin(app);
    const owner = await getTestUser(app);

    vi.setSystemTime(new Date(start.getTime() + 30 * 60 * 1000));
    const early = await agent.get('/api/auth/sessions').expect(200);
    expect(setCookieHeader(early)).toBe('');
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
    ).resolves.toMatchObject({ lastSeenAt: start });

    const later = new Date(start.getTime() + 25 * HOUR_MS);
    vi.setSystemTime(later);
    const renewed = await agent.get('/api/auth/sessions').expect(200);
    const renewedCookie = setCookieHeader(renewed);
    expect(renewedCookie).toMatch(/^ft_session=ey/);
    expect(renewedCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    const [session] = renewed.body as SessionDto[];
    expect(session).toMatchObject({
      current: true,
      lastSeenAt: later.toISOString(),
    });
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: owner.id } }),
    ).resolves.toMatchObject({ lastSeenAt: later });

    vi.setSystemTime(new Date(later.getTime() + 10 * 60 * 1000));
    const settled = await agent.get('/api/auth/sessions').expect(200);
    expect(setCookieHeader(settled)).toBe('');

    vi.setSystemTime(new Date(later.getTime() + 300 * 24 * HOUR_MS));
    const status = await agent.get('/api/auth/status').expect(200);
    expect(status.body).toMatchObject({ authenticated: true });
    expect(setCookieHeader(status)).toMatch(/^ft_session=ey/);
  });

  it('lists signed-in devices and revokes them one by one', async () => {
    await resetDatabase(prisma);
    const agent = await setupAndLogin(app);
    const phone = request.agent(app.getHttpServer());
    await phone
      .post('/api/auth/login')
      .set('User-Agent', '  FoodLog iPhone Safari ')
      .send(TEST_CREDENTIALS)
      .expect(200);

    const listed = (await agent.get('/api/auth/sessions').expect(200))
      .body as SessionDto[];
    expect(listed).toHaveLength(2);
    const current = listed.find((session) => session.current);
    const other = listed.find((session) => !session.current);
    expect(current).toBeDefined();
    expect(other).toMatchObject({
      userAgent: 'FoodLog iPhone Safari',
      current: false,
    });
    expect(Object.keys(other!).sort()).toEqual(
      ['createdAt', 'current', 'id', 'lastSeenAt', 'userAgent'].sort(),
    );

    await agent.delete(`/api/auth/sessions/${randomUUID()}`).expect(404);
    await agent.delete('/api/auth/sessions/not-a-uuid').expect(400);
    const stranger = await createSignedInUser(app);
    await stranger.agent.delete(`/api/auth/sessions/${other!.id}`).expect(404);
    await phone.get(PROTECTED_ROUTE).expect(404);

    await agent.delete(`/api/auth/sessions/${other!.id}`).expect(204);
    await phone.get(PROTECTED_ROUTE).expect(401);
    await agent.get(PROTECTED_ROUTE).expect(404);

    const self = await agent
      .delete(`/api/auth/sessions/${current!.id}`)
      .expect(204);
    expect(setCookieHeader(self)).toMatch(/^ft_session=;/);
    await agent.get(PROTECTED_ROUTE).expect(401);
    await request(app.getHttpServer()).get('/api/auth/sessions').expect(401);
  });

  it('revokes the session a device replaces when it signs in again', async () => {
    await resetDatabase(prisma);
    const agent = await setupAndLogin(app);
    const [before] = (await agent.get('/api/auth/sessions').expect(200))
      .body as SessionDto[];
    const owner = await getTestUser(app);
    const oldCookie = await sessionCookieFor(app, owner.id);

    await agent.post('/api/auth/login').send(TEST_CREDENTIALS).expect(200);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Cookie', oldCookie)
      .send({ ...TEST_CREDENTIALS, password: 'wrong password' })
      .expect(401);

    const after = (await agent.get('/api/auth/sessions').expect(200))
      .body as SessionDto[];
    expect(after).toHaveLength(2);
    expect(after.map((session) => session.id)).not.toContain(before!.id);
    await expect(
      prisma.session.findUniqueOrThrow({ where: { id: before!.id } }),
    ).resolves.toMatchObject({ revokedAt: expect.any(Date) as Date });
    await request(app.getHttpServer())
      .get(PROTECTED_ROUTE)
      .set('Cookie', oldCookie)
      .expect(404);
  });

  it('updates the display name shown in the status', async () => {
    await resetDatabase(prisma);
    const agent = await setupAndLogin(app);

    const named = await agent
      .put('/api/auth/account')
      .send({ name: '  Chris  ' })
      .expect(200);
    expect(named.body).toMatchObject({ name: 'Chris', role: 'admin' });
    const status = await agent.get('/api/auth/status').expect(200);
    expect((status.body as AuthStatusResponse).user?.name).toBe('Chris');

    const cleared = await agent
      .put('/api/auth/account')
      .send({ name: '   ' })
      .expect(200);
    expect((cleared.body as UserDto).name).toBeNull();
    await agent.put('/api/auth/account').send({ name: null }).expect(200);

    await agent.put('/api/auth/account').send({}).expect(400);
    await agent
      .put('/api/auth/account')
      .send({ name: 'x'.repeat(81) })
      .expect(400);
    await agent
      .put('/api/auth/account')
      .send({ name: 'Bad\u0007name' })
      .expect(400);
    await agent
      .put('/api/auth/account')
      .send({ name: 'Chris', role: 'admin' })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/auth/account')
      .send({ name: 'x' })
      .expect(401);
  });

  it('locks disabled people out everywhere with the generic login error', async () => {
    await resetDatabase(prisma);
    const admin = await setupAndLogin(app);
    const member = await createSignedInUser(app, { name: 'Sam' });
    await member.agent.get(PROTECTED_ROUTE).expect(404);

    await admin
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ status: 'disabled' })
      .expect(200);

    await member.agent.get(PROTECTED_ROUTE).expect(401);
    const status = await member.agent.get('/api/auth/status').expect(200);
    expect(status.body).toMatchObject({ authenticated: false });
    const disabledLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: member.user.email, password: member.user.password })
      .expect(401);
    const wrongLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: member.user.email, password: 'not the password' })
      .expect(401);
    expect(disabledLogin.body).toEqual(wrongLogin.body);
    expect(disabledLogin.body).toMatchObject({
      message: 'Invalid email or password',
    });

    await admin
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ status: 'active' })
      .expect(200);
    await member.agent.get(PROTECTED_ROUTE).expect(401);
    await signInAgent(app, {
      email: member.user.email,
      password: member.user.password,
    });
  });

  it('requires authentication for account routes', async () => {
    const server = app.getHttpServer();
    await request(server)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'whatever', newPassword: 'whatever else' })
      .expect(401);
    await request(server).get('/api/auth/sessions').expect(401);
    await request(server)
      .delete(`/api/auth/sessions/${randomUUID()}`)
      .expect(401);
  });

  it('serves health publicly with security headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(response.body).toEqual({
      status: 'ok',
      version: expect.any(String) as string,
    });
    expect(response.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin',
      'x-frame-options': 'DENY',
      'permissions-policy': 'camera=(self), microphone=(self), geolocation=()',
      'cross-origin-opener-policy': 'same-origin',
    });
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects JSON bodies above 1 MB', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(
        JSON.stringify({
          email: 'a@example.com',
          password: 'x'.repeat(1_100_000),
        }),
      )
      .expect(413);
    expect(response.body).toMatchObject({ statusCode: 413 });
  });

  it('never signs anyone in from a form post', async () => {
    const member = await createTestUser(app);

    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .type('form')
      .send({ email: member.email, password: member.password })
      .expect(400);

    expect(setCookieHeader(response)).toBe('');
  });

  it.each(['cross-site', 'same-site'])(
    'refuses %s sign-ins and sign-outs without touching the session cookie',
    async (site) => {
      const member = await createTestUser(app);
      const server = app.getHttpServer();

      const login = await request(server)
        .post('/api/auth/login')
        .set('Sec-Fetch-Site', site)
        .send({ email: member.email, password: member.password })
        .expect(403);
      expect(login.body).toMatchObject({
        statusCode: 403,
        message: 'Cross-site requests are not allowed',
      });
      expect(setCookieHeader(login)).toBe('');

      const { agent } = await signInAgent(app, {
        email: member.email,
        password: member.password,
      });
      const logout = await agent
        .post('/api/auth/logout')
        .set('Sec-Fetch-Site', site)
        .expect(403);
      expect(setCookieHeader(logout)).toBe('');
      const status = await agent.get('/api/auth/status').expect(200);
      expect((status.body as AuthStatusResponse).authenticated).toBe(true);
    },
  );

  it('accepts same-origin writes and cross-site reads', async () => {
    const member = await createTestUser(app);
    const server = app.getHttpServer();

    const login = await request(server)
      .post('/api/auth/login')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({ email: member.email, password: member.password })
      .expect(200);
    expect(setCookieHeader(login)).not.toBe('');
    await request(server)
      .get('/api/auth/status')
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(200);
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);
    expect(response.body).toMatchObject({ statusCode: 400 });
  });
});

describe('ADMIN_EMAILS promotion (e2e)', () => {
  const LISTED = 'admin@example.com';
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp({
      configure: withSettings({ adminEmails: [LISTED] }),
    });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('promotes a listed member when they sign in and keeps them an admin', async () => {
    const admin = await setupAndLogin(app);
    const listed = await createTestUser(app, { email: LISTED });
    expect(listed.role).toBe('member');

    const { agent } = await signInAgent(app, {
      email: 'Admin@Example.com',
      password: listed.password,
    });
    const status = await agent.get('/api/auth/status').expect(200);
    expect((status.body as AuthStatusResponse).user).toMatchObject({
      email: LISTED,
      role: 'admin',
    });
    await agent.get('/api/admin/overview').expect(200);

    const demote = await admin
      .patch(`/api/admin/users/${listed.id}`)
      .send({ role: 'member' })
      .expect(409);
    expect(demote.body).toMatchObject({
      message:
        'This person is listed in ADMIN_EMAILS and always stays an admin',
    });
  });

  it('promotes a listed person who is still signed in from before without a new login', async () => {
    await resetDatabase(prisma);
    await setupAndLogin(app);
    const listed = await createTestUser(app, { email: LISTED });
    const cookie = await sessionCookieFor(app, listed.id);

    const status = await request(app.getHttpServer())
      .get('/api/auth/status')
      .set('Cookie', cookie)
      .expect(200);

    expect((status.body as AuthStatusResponse).user).toMatchObject({
      id: listed.id,
      role: 'admin',
    });
    await request(app.getHttpServer())
      .get('/api/admin/users')
      .set('Cookie', cookie)
      .expect(200);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: listed.id } }),
    ).resolves.toMatchObject({ role: 'admin' });
  });

  it('creates listed people as admins when they accept an invite', async () => {
    await resetDatabase(prisma);
    const admin = await setupAndLogin(app);
    const invite = await admin
      .post('/api/admin/invites')
      .send({ email: LISTED, role: 'member' })
      .expect(201);
    const token = (invite.body as { url: string }).url.split('/').pop()!;

    const accepted = await request(app.getHttpServer())
      .post(`/api/auth/tokens/${token}/accept`)
      .send({ password: 'listed password 1', name: 'Chris' })
      .expect(200);

    expect(accepted.body).toMatchObject({
      email: LISTED,
      name: 'Chris',
      role: 'admin',
    });
  });
});

describe('auth throttling (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ throttling: true });
    await resetDatabase(app.get(PrismaService));
  });

  afterAll(async () => {
    await resetDatabase(app.get(PrismaService));
    await app.close();
  });

  it('limits login attempts to 5 per minute', async () => {
    const server = app.getHttpServer();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server)
        .post('/api/auth/login')
        .send(TEST_CREDENTIALS)
        .expect(401);
    }
    await request(server)
      .post('/api/auth/login')
      .send(TEST_CREDENTIALS)
      .expect(429);
  });

  it('limits login attempts per account across many addresses', async () => {
    const server = app.getHttpServer();
    const attempt = (email: string, ip: string): request.Test =>
      request(server)
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email, password: 'not the password' });

    for (let index = 0; index < 10; index += 1) {
      const email =
        index % 2 === 0 ? 'Target@Example.com' : 'target@example.com ';
      await attempt(email, `203.0.113.${10 + (index % 3)}`).expect(401);
    }

    const blocked = await attempt('target@example.com', '203.0.113.20').expect(
      429,
    );
    expect(blocked.headers['retry-after-loginaccount']).toBeDefined();
    await attempt('someone.else@example.com', '203.0.113.21').expect(401);
  });

  it('limits password change attempts to 5 per minute', async () => {
    const agent = await setupAndLogin(app);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await agent
        .post('/api/auth/change-password')
        .send({
          currentPassword: 'wrong password',
          newPassword: 'another new password',
        })
        .expect(400);
    }
    await agent
      .post('/api/auth/change-password')
      .send({
        currentPassword: TEST_CREDENTIALS.password,
        newPassword: 'another new password',
      })
      .expect(429);
  });

  it('throttles before authenticating and never throttles health', async () => {
    const server = app.getHttpServer();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      statuses.push((await request(server).get(PROTECTED_ROUTE)).status);
    }
    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses[20]).toBe(429);

    for (let attempt = 0; attempt < 30; attempt += 1) {
      await request(server).get('/api/health').expect(200);
    }
  });
});
