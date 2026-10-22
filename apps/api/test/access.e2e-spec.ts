import type {
  AccessRequestStatusResponse,
  AdminAccessRequestDto,
  AdminInviteDto,
  AuthStatusResponse,
  CreateAccessRequestResponse,
  InviteLinkResponse,
  UserDto,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { createOpaqueToken } from '../src/auth/opaque-tokens.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  createTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const FRIEND = {
  email: 'friend@example.com',
  name: 'Friendly Person',
  message: 'Hi! Can I use FoodLog?',
};
const PASSWORD = 'friend password 123';

function tokenFromUrl(url: string): string {
  return url.split('/').pop() ?? '';
}

describe('access requests (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await setupAndLogin(app);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  function publicApi() {
    return request(app.getHttpServer());
  }

  async function requestAccess(
    body: Record<string, unknown> = FRIEND,
  ): Promise<string> {
    const response = await publicApi()
      .post('/api/access-requests')
      .send(body)
      .expect(202);
    expect(Object.keys(response.body as object)).toEqual(['statusToken']);
    return (response.body as CreateAccessRequestResponse).statusToken;
  }

  async function status(
    statusToken: string,
  ): Promise<AccessRequestStatusResponse> {
    const response = await publicApi()
      .post('/api/access-requests/status')
      .send({ statusToken })
      .expect(200);
    return response.body as AccessRequestStatusResponse;
  }

  async function requestId(email = FRIEND.email): Promise<string> {
    const row = await prisma.accessRequest.findFirstOrThrow({
      where: { email },
      orderBy: { createdAt: 'desc' },
    });
    return row.id;
  }

  it('stores a request, reports its status and never stores the raw token', async () => {
    const statusToken = await requestAccess({
      ...FRIEND,
      email: '  Friend@Example.COM ',
      name: '  Friendly Person ',
    });

    expect(statusToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = await prisma.accessRequest.findFirstOrThrow();
    expect(row).toMatchObject({
      email: FRIEND.email,
      name: FRIEND.name,
      message: FRIEND.message,
      status: 'pending',
      decidedAt: null,
      acceptedAt: null,
    });
    expect(row.statusTokenHash).not.toContain(statusToken);
    expect(row.statusTokenHash).toMatch(/^[0-9a-f]{64}$/);

    const current = await status(statusToken);
    expect(current).toEqual({
      status: 'pending',
      email: FRIEND.email,
      name: FRIEND.name,
      createdAt: row.createdAt.toISOString(),
      decidedAt: null,
      canCreateAccount: false,
    });
  });

  it('answers identically whether or not the email already has an account', async () => {
    const existing = await createTestUser(app, { email: 'taken@example.com' });

    const forExisting = await publicApi()
      .post('/api/access-requests')
      .send({ email: existing.email, name: 'Someone' })
      .expect(202);
    const forNew = await publicApi()
      .post('/api/access-requests')
      .send({ email: 'new@example.com', name: 'Someone' })
      .expect(202);

    expect(Object.keys(forExisting.body as object)).toEqual(
      Object.keys(forNew.body as object),
    );
    expect(forExisting.headers['content-type']).toBe(
      forNew.headers['content-type'],
    );
    const list = await admin.get('/api/admin/access-requests').expect(200);
    expect(
      (list.body as AdminAccessRequestDto[]).map((r) => [
        r.email,
        r.hasAccount,
      ]),
    ).toEqual([
      ['new@example.com', false],
      ['taken@example.com', true],
    ]);
  });

  it('hands out a fresh token for a repeated pending request instead of duplicating it', async () => {
    const first = await requestAccess();
    const second = await requestAccess({
      email: FRIEND.email,
      name: 'Other name',
    });

    expect(second).not.toBe(first);
    await expect(prisma.accessRequest.count()).resolves.toBe(1);
    await expect(status(first)).resolves.toMatchObject({ status: 'unknown' });
    await expect(status(second)).resolves.toMatchObject({
      status: 'pending',
      name: FRIEND.name,
    });
  });

  it('reports unknown tokens without leaking anything', async () => {
    await requestAccess();
    const unknown: AccessRequestStatusResponse = {
      status: 'unknown',
      email: null,
      name: null,
      createdAt: null,
      decidedAt: null,
      canCreateAccount: false,
    };

    await expect(status(createOpaqueToken().token)).resolves.toEqual(unknown);
    await expect(status('garbage')).resolves.toEqual(unknown);
    await publicApi().post('/api/access-requests/status').send({}).expect(400);
    await publicApi()
      .post('/api/access-requests/status')
      .send({ statusToken: 'x'.repeat(500) })
      .expect(400);
  });

  it('validates new requests and silently drops honeypot submissions', async () => {
    const invalid: Record<string, unknown>[] = [
      { name: 'No email' },
      { email: 'not-an-email', name: 'Bad email' },
      { email: 'a@example.com' },
      { email: 'a@example.com', name: '   ' },
      { email: 'a@example.com', name: 'x'.repeat(81) },
      { email: 'a@example.com', name: 'Bell\u0007' },
      { email: 'a@example.com', name: 'Long', message: 'x'.repeat(501) },
      { email: 'a@example.com', name: 'Extra', role: 'admin' },
    ];
    for (const body of invalid) {
      await publicApi().post('/api/access-requests').send(body).expect(400);
    }

    const blank = await requestAccess({
      email: 'blank@example.com',
      name: 'Blank message',
      message: '   ',
    });
    await expect(
      prisma.accessRequest.findFirstOrThrow({
        where: { email: 'blank@example.com' },
      }),
    ).resolves.toMatchObject({ message: null });
    await expect(status(blank)).resolves.toMatchObject({ status: 'pending' });

    const bot = await requestAccess({
      email: 'bot@example.com',
      name: 'Bot',
      website: 'https://spam.example.com',
    });
    expect(bot).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(
      prisma.accessRequest.count({ where: { email: 'bot@example.com' } }),
    ).resolves.toBe(0);
    await expect(status(bot)).resolves.toMatchObject({ status: 'unknown' });
  });

  it('lets an approved requester create their account once and signs them in', async () => {
    const statusToken = await requestAccess();
    await publicApi()
      .post('/api/access-requests/accept')
      .send({ statusToken, password: PASSWORD })
      .expect(403);

    const approval = await admin
      .post(`/api/admin/access-requests/${await requestId()}/approve`)
      .send({})
      .expect(200);
    const invite = approval.body as InviteLinkResponse;
    const approved = await status(statusToken);
    expect(approved).toMatchObject({
      status: 'approved',
      canCreateAccount: true,
      decidedAt: expect.any(String) as string,
    });

    await publicApi()
      .post('/api/access-requests/accept')
      .send({ statusToken, password: 'short' })
      .expect(400);
    await publicApi()
      .post('/api/access-requests/accept')
      .send({ statusToken: createOpaqueToken().token, password: PASSWORD })
      .expect(404);

    const newcomer = request.agent(app.getHttpServer());
    const accepted = await newcomer
      .post('/api/access-requests/accept')
      .set('User-Agent', 'Newcomer phone')
      .send({ statusToken, password: PASSWORD })
      .expect(200);
    expect(accepted.body).toEqual<UserDto>({
      id: expect.any(String) as string,
      email: FRIEND.email,
      name: FRIEND.name,
      role: 'member',
    });
    const signedIn = await newcomer.get('/api/auth/status').expect(200);
    expect((signedIn.body as AuthStatusResponse).authenticated).toBe(true);
    await expect(
      prisma.profile.count({
        where: { userId: (accepted.body as UserDto).id },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.session.findFirstOrThrow({
        where: { userId: (accepted.body as UserDto).id },
      }),
    ).resolves.toMatchObject({ userAgent: 'Newcomer phone' });

    await expect(status(statusToken)).resolves.toMatchObject({
      status: 'approved',
      canCreateAccount: false,
    });
    await expect(
      prisma.accessRequest.findFirstOrThrow(),
    ).resolves.toMatchObject({ acceptedAt: expect.any(Date) as Date });
    await publicApi()
      .post('/api/access-requests/accept')
      .send({ statusToken, password: PASSWORD })
      .expect(409);

    const link = await publicApi()
      .get(`/api/auth/tokens/${tokenFromUrl(invite.url)}`)
      .expect(200);
    expect(link.body).toMatchObject({
      valid: false,
      reason: 'account_exists',
    });
    await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(invite.url)}/accept`)
      .send({ password: PASSWORD })
      .expect(409);
    const invites = (await admin.get('/api/admin/invites').expect(200))
      .body as AdminInviteDto[];
    expect(invites.find((row) => row.id === invite.invite.id)).toMatchObject({
      status: 'used',
      usedAt: expect.any(String) as string,
    });
    await publicApi()
      .post('/api/auth/login')
      .send({ email: FRIEND.email, password: PASSWORD })
      .expect(200);
  });

  it('refuses to create a second account for an email that already has one', async () => {
    const statusToken = await requestAccess();
    await admin
      .post(`/api/admin/access-requests/${await requestId()}/approve`)
      .send({})
      .expect(200);
    await createTestUser(app, { email: FRIEND.email });

    await expect(status(statusToken)).resolves.toMatchObject({
      status: 'approved',
      canCreateAccount: false,
    });
    await publicApi()
      .post('/api/access-requests/accept')
      .send({ statusToken, password: PASSWORD })
      .expect(409);
  });

  it('keeps rejected requesters out', async () => {
    const statusToken = await requestAccess();
    const rejected = await admin
      .post(`/api/admin/access-requests/${await requestId()}/reject`)
      .send({})
      .expect(200);
    expect(rejected.body).toMatchObject({ status: 'rejected' });

    await expect(status(statusToken)).resolves.toMatchObject({
      status: 'rejected',
      canCreateAccount: false,
      decidedAt: expect.any(String) as string,
    });
    await publicApi()
      .post('/api/access-requests/accept')
      .send({ statusToken, password: PASSWORD })
      .expect(403);

    const again = await requestAccess();
    expect(again).not.toBe(statusToken);
    await expect(prisma.accessRequest.count()).resolves.toBe(2);
    await expect(status(statusToken)).resolves.toMatchObject({
      status: 'rejected',
    });
  });

  it('keeps a single pending invite per email and revokes it once the requester joins', async () => {
    const statusToken = await requestAccess();
    const direct = (
      await admin
        .post('/api/admin/invites')
        .send({ email: FRIEND.email })
        .expect(201)
    ).body as InviteLinkResponse;

    const approvals = await Promise.all(
      [1, 2].map(async () =>
        admin
          .post(`/api/admin/access-requests/${await requestId()}/approve`)
          .send({}),
      ),
    );
    expect(approvals.map((r) => r.status)).toEqual([200, 200]);
    const pendingAfterApproval = await prisma.authToken.findMany({
      where: { email: FRIEND.email, usedAt: null, revokedAt: null },
    });
    expect(pendingAfterApproval).toHaveLength(1);
    const direct2 = (
      await admin
        .post('/api/admin/invites')
        .send({ email: FRIEND.email })
        .expect(201)
    ).body as InviteLinkResponse;

    await publicApi()
      .post('/api/access-requests/accept')
      .send({ statusToken, password: PASSWORD })
      .expect(200);

    for (const link of [direct, direct2]) {
      const info = await publicApi()
        .get(`/api/auth/tokens/${tokenFromUrl(link.url)}`)
        .expect(200);
      expect(info.body).toMatchObject({
        valid: false,
        reason: 'account_exists',
      });
    }
    await expect(
      prisma.authToken.findMany({
        where: { id: { in: [direct.invite.id, direct2.invite.id] } },
        select: { usedAt: true, revokedAt: true },
      }),
    ).resolves.toEqual([
      { usedAt: null, revokedAt: expect.any(Date) as Date },
      { usedAt: null, revokedAt: expect.any(Date) as Date },
    ]);
    await expect(
      prisma.authToken.count({
        where: { email: FRIEND.email, usedAt: null, revokedAt: null },
      }),
    ).resolves.toBe(0);
  });

  it('refuses an approved request that was rejected before the account was created', async () => {
    const statusToken = await requestAccess();
    const id = await requestId();
    await admin
      .post(`/api/admin/access-requests/${id}/approve`)
      .send({})
      .expect(200);
    await admin
      .post(`/api/admin/access-requests/${id}/reject`)
      .send({})
      .expect(200);

    await publicApi()
      .post('/api/access-requests/accept')
      .send({ statusToken, password: PASSWORD })
      .expect(403);
    await expect(
      prisma.user.count({ where: { email: FRIEND.email } }),
    ).resolves.toBe(0);
  });

  it('lets only one of two concurrent accepts create the account', async () => {
    const statusToken = await requestAccess();
    await admin
      .post(`/api/admin/access-requests/${await requestId()}/approve`)
      .send({})
      .expect(200);

    const responses = await Promise.all(
      [1, 2].map(() =>
        publicApi()
          .post('/api/access-requests/accept')
          .send({ statusToken, password: PASSWORD }),
      ),
    );

    expect(responses.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    await expect(
      prisma.user.count({ where: { email: FRIEND.email } }),
    ).resolves.toBe(1);
  });
});

describe('access request rate limit (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp({ throttling: true });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('accepts at most 5 requests per hour from one IP', async () => {
    const server = app.getHttpServer();
    for (let n = 0; n < 5; n += 1) {
      await request(server)
        .post('/api/access-requests')
        .send({ email: `person-${n}@example.com`, name: `Person ${n}` })
        .expect(202);
    }
    const limited = await request(server)
      .post('/api/access-requests')
      .send({ email: 'person-6@example.com', name: 'Person 6' })
      .expect(429);
    expect(limited.headers['retry-after-long']).toBeDefined();
    await expect(prisma.accessRequest.count()).resolves.toBe(5);
    await request(server)
      .post('/api/access-requests/status')
      .send({ statusToken: 'anything' })
      .expect(200);
  });
});
