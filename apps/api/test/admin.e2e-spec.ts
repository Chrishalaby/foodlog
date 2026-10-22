import { randomUUID } from 'node:crypto';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AdminAccessRequestDto,
  AdminInviteDto,
  AdminOverviewResponse,
  AdminUserDto,
  AuthTokenInfoResponse,
  CreateEntryRequest,
  InviteLinkResponse,
  UserDto,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { AppConfig } from '../src/config/app-config.js';
import { PhotosService } from '../src/photos/photos.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  createSignedInUser,
  createTestApp,
  createTestUser,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  signInAgent,
  type SignedInTestUser,
  type TestAgent,
  withSettings,
} from './helpers.js';

const ADMIN_USER_KEYS = [
  'activeSessions',
  'aiBudgetUnlimited',
  'aiCostMonthUsd',
  'aiMonthlyBudgetUsd',
  'aiRequestsMonth',
  'createdAt',
  'effectiveBudgetUsd',
  'email',
  'entryCount',
  'id',
  'isSelf',
  'lastSeenAt',
  'name',
  'role',
  'status',
];
const TOKEN_URL =
  /^http:\/\/127\.0\.0\.1:\d+\/(invite|reset)\/[A-Za-z0-9_-]{43}$/;

function tokenFromUrl(url: string): string {
  return url.split('/').pop() ?? '';
}

function entryBody(photoId: string | null = null): CreateEntryRequest {
  return {
    name: 'Chicken salad',
    description: null,
    mealType: 'lunch',
    source: 'manual',
    timestamp: new Date().toISOString(),
    localDate: new Date().toISOString().slice(0, 10),
    items: [
      {
        name: 'Chicken',
        grams: 150,
        nutrients: {
          calories: 250,
          protein: 40,
          carbs: 0,
          fat: 8,
          satFat: 2,
          fiber: 0,
          sugar: 0,
          sodium: 90,
          alcohol: 0,
        },
      },
    ],
    photoId,
  };
}

function testImage(): Promise<Buffer> {
  return sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 20, g: 160, b: 90 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('admin (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let admin: TestAgent;
  let adminUser: UserDto;
  let member: SignedInTestUser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    admin = await setupAndLogin(app);
    adminUser = await getTestUser(app);
    member = await createSignedInUser(app, { name: 'Sam Member' });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  function publicApi() {
    return request(app.getHttpServer());
  }

  function memberDefault(): number | null {
    return app.get(AppConfig).ai.memberMonthlyBudgetUsd;
  }

  async function users(): Promise<AdminUserDto[]> {
    return (await admin.get('/api/admin/users').expect(200))
      .body as AdminUserDto[];
  }

  async function userById(id: string): Promise<AdminUserDto> {
    const found = (await users()).find((user) => user.id === id);
    expect(found).toBeDefined();
    return found!;
  }

  async function tokenInfo(url: string): Promise<AuthTokenInfoResponse> {
    return (
      await publicApi()
        .get(`/api/auth/tokens/${tokenFromUrl(url)}`)
        .expect(200)
    ).body as AuthTokenInfoResponse;
  }

  async function createAccessRequest(email: string, name: string) {
    await publicApi()
      .post('/api/access-requests')
      .send({ email, name, message: `Please let ${name} in` })
      .expect(202);
    return prisma.accessRequest.findFirstOrThrow({ where: { email } });
  }

  it('allows only admins on every admin route', async () => {
    const id = randomUUID();
    const routes: ['get' | 'post' | 'patch' | 'delete', string][] = [
      ['get', '/api/admin/overview'],
      ['get', '/api/admin/users'],
      ['patch', `/api/admin/users/${id}`],
      ['post', `/api/admin/users/${id}/reset-link`],
      ['post', `/api/admin/users/${id}/revoke-sessions`],
      ['delete', `/api/admin/users/${id}`],
      ['get', '/api/admin/access-requests'],
      ['post', `/api/admin/access-requests/${id}/approve`],
      ['post', `/api/admin/access-requests/${id}/reject`],
      ['get', '/api/admin/invites'],
      ['post', '/api/admin/invites'],
      ['post', `/api/admin/invites/${id}/regenerate`],
      ['delete', `/api/admin/invites/${id}`],
    ];
    for (const [method, path] of routes) {
      await publicApi()[method](path).send({}).expect(401);
      const denied = await member.agent[method](path).send({}).expect(403);
      expect(denied.body).toMatchObject({ message: 'Only admins can do this' });
    }
    await expect(prisma.authToken.count()).resolves.toBe(0);
    await expect(prisma.user.count()).resolves.toBe(2);
  });

  it('summarizes people, requests, invites and AI spend', async () => {
    await createAccessRequest('pending@example.com', 'Pending');
    await admin
      .post('/api/admin/invites')
      .send({ email: 'invited@example.com' })
      .expect(201);
    await prisma.user.update({
      where: { id: member.user.id },
      data: { lastSeenAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000) },
    });
    await prisma.aiUsage.createMany({
      data: [
        {
          userId: member.user.id,
          model: 'gpt-5.6-sol',
          mode: 'text',
          costUsd: 0.25,
          success: true,
        },
        {
          userId: adminUser.id,
          model: 'gpt-5.6-sol',
          mode: 'text',
          costUsd: 0.5,
          success: false,
        },
        {
          userId: adminUser.id,
          model: 'gpt-5.6-sol',
          mode: 'text',
          costUsd: 9,
          success: true,
          createdAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    });

    const overview = (await admin.get('/api/admin/overview').expect(200))
      .body as AdminOverviewResponse;

    expect(overview).toEqual<AdminOverviewResponse>({
      users: 2,
      activeUsers30d: 1,
      pendingRequests: 1,
      pendingInvites: 1,
      aiCostMonthUsd: 0.75,
      aiRequestsMonth: 2,
      globalBudgetUsd: app.get(AppConfig).ai.monthlyBudgetUsd,
      memberDefaultBudgetUsd: memberDefault(),
    });
  });

  it('lists people with aggregates only, never their data', async () => {
    await member.agent.post('/api/entries').send(entryBody()).expect(201);
    await member.agent.post('/api/entries').send(entryBody()).expect(201);
    await signInAgent(app, {
      email: member.user.email,
      password: member.user.password,
    });
    await prisma.aiUsage.createMany({
      data: [
        {
          userId: member.user.id,
          model: 'gpt-5.6-sol',
          mode: 'food_photo',
          costUsd: 0.1234567,
          success: true,
        },
        {
          userId: member.user.id,
          model: 'gpt-5.6-sol',
          mode: 'food_photo',
          costUsd: 0.2,
          success: false,
        },
        {
          userId: member.user.id,
          model: 'gpt-5.6-sol',
          mode: 'food_photo',
          costUsd: 3,
          success: true,
          createdAt: new Date('2020-01-01T00:00:00Z'),
        },
      ],
    });

    const list = await users();

    expect(list.map((user) => user.email)).toEqual([
      adminUser.email,
      member.user.email,
    ]);
    for (const user of list) {
      expect(Object.keys(user).sort()).toEqual(ADMIN_USER_KEYS);
    }
    expect(list[0]).toMatchObject({
      role: 'admin',
      status: 'active',
      isSelf: true,
      entryCount: 0,
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: false,
      effectiveBudgetUsd: null,
      activeSessions: 1,
    });
    expect(list[1]).toMatchObject({
      id: member.user.id,
      name: 'Sam Member',
      role: 'member',
      isSelf: false,
      entryCount: 2,
      aiRequestsMonth: 2,
      aiCostMonthUsd: 0.323457,
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: false,
      effectiveBudgetUsd: memberDefault(),
      activeSessions: 2,
      lastSeenAt: expect.any(String) as string,
    });
  });

  it('changes roles, status, budgets and names within the safety rules', async () => {
    const updated = await admin
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ aiMonthlyBudgetUsd: 12.5, name: '  Sammy  ' })
      .expect(200);
    expect(updated.body).toMatchObject({
      name: 'Sammy',
      aiMonthlyBudgetUsd: 12.5,
      effectiveBudgetUsd: 12.5,
    });
    const status = await member.agent.get('/api/auth/status').expect(200);
    expect(status.body).toMatchObject({ user: { name: 'Sammy' } });

    const reset = await admin
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ aiMonthlyBudgetUsd: null, name: null })
      .expect(200);
    expect(reset.body).toMatchObject({
      name: null,
      aiMonthlyBudgetUsd: null,
      effectiveBudgetUsd: memberDefault(),
    });

    const selfDemote = await admin
      .patch(`/api/admin/users/${adminUser.id}`)
      .send({ role: 'member' })
      .expect(403);
    expect(selfDemote.body).toMatchObject({
      message: 'You cannot change your own role or status',
    });
    await admin
      .patch(`/api/admin/users/${adminUser.id}`)
      .send({ status: 'disabled' })
      .expect(403);
    await admin
      .patch(`/api/admin/users/${adminUser.id}`)
      .send({ role: 'admin', status: 'active', aiMonthlyBudgetUsd: 50 })
      .expect(200);

    await admin
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ role: 'admin' })
      .expect(200);
    await member.agent.get('/api/admin/users').expect(200);
    await member.agent
      .patch(`/api/admin/users/${adminUser.id}`)
      .send({ role: 'member' })
      .expect(200);
    await admin.get('/api/admin/users').expect(403);
    await member.agent
      .patch(`/api/admin/users/${adminUser.id}`)
      .send({ role: 'admin' })
      .expect(200);

    await admin.get('/api/admin/users').expect(200);
    await prisma.user.update({
      where: { id: adminUser.id },
      data: { role: 'member' },
    });
    const lastAdmin = await admin
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ status: 'disabled' })
      .expect(409);
    expect(lastAdmin.body).toMatchObject({
      message: 'There must always be at least one active admin',
    });
    await admin.delete(`/api/admin/users/${member.user.id}`).expect(409);
    await expect(
      prisma.user.findUniqueOrThrow({ where: { id: member.user.id } }),
    ).resolves.toMatchObject({ role: 'admin', status: 'active' });

    await admin
      .patch(`/api/admin/users/${randomUUID()}`)
      .send({ name: 'Ghost' })
      .expect(404);
  });

  it('switches a budget between default, custom amount and unlimited', async () => {
    const patch = async (body: object): Promise<AdminUserDto> =>
      (
        await admin
          .patch(`/api/admin/users/${member.user.id}`)
          .send(body)
          .expect(200)
      ).body as AdminUserDto;
    const budget = (user: AdminUserDto) => ({
      aiMonthlyBudgetUsd: user.aiMonthlyBudgetUsd,
      aiBudgetUnlimited: user.aiBudgetUnlimited,
      effectiveBudgetUsd: user.effectiveBudgetUsd,
    });

    expect(budget(await patch({ aiMonthlyBudgetUsd: 12.5 }))).toEqual({
      aiMonthlyBudgetUsd: 12.5,
      aiBudgetUnlimited: false,
      effectiveBudgetUsd: 12.5,
    });
    expect(budget(await patch({ aiBudgetUnlimited: true }))).toEqual({
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: true,
      effectiveBudgetUsd: null,
    });
    expect(budget(await patch({ name: 'Still unlimited' }))).toEqual({
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: true,
      effectiveBudgetUsd: null,
    });
    expect(budget(await patch({ aiMonthlyBudgetUsd: 3 }))).toEqual({
      aiMonthlyBudgetUsd: 3,
      aiBudgetUnlimited: false,
      effectiveBudgetUsd: 3,
    });
    expect(
      budget(
        await patch({ aiMonthlyBudgetUsd: null, aiBudgetUnlimited: true }),
      ),
    ).toEqual({
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: true,
      effectiveBudgetUsd: null,
    });
    expect(
      budget(
        await patch({ aiMonthlyBudgetUsd: null, aiBudgetUnlimited: false }),
      ),
    ).toEqual({
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: false,
      effectiveBudgetUsd: memberDefault(),
    });
    await patch({ aiBudgetUnlimited: true });
    expect(budget(await patch({ aiBudgetUnlimited: false }))).toEqual({
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: false,
      effectiveBudgetUsd: memberDefault(),
    });

    await patch({ aiBudgetUnlimited: true });
    expect(
      (await users()).find((user) => user.id === member.user.id),
    ).toMatchObject({ aiBudgetUnlimited: true, effectiveBudgetUsd: null });
    await expect(
      prisma.user.findUniqueOrThrow({
        where: { id: member.user.id },
        select: { aiMonthlyBudgetUsd: true, aiBudgetUnlimited: true },
      }),
    ).resolves.toEqual({ aiMonthlyBudgetUsd: null, aiBudgetUnlimited: true });
  });

  it('validates admin updates', async () => {
    const invalid: Record<string, unknown>[] = [
      { role: 'owner' },
      { role: null },
      { status: 'banned' },
      { aiMonthlyBudgetUsd: -1 },
      { aiMonthlyBudgetUsd: 10_001 },
      { aiMonthlyBudgetUsd: 1.234 },
      { aiMonthlyBudgetUsd: '5' },
      { aiBudgetUnlimited: null },
      { aiBudgetUnlimited: 'true' },
      { aiBudgetUnlimited: 1 },
      { aiBudgetUnlimited: true, aiMonthlyBudgetUsd: 5 },
      { aiBudgetUnlimited: true, aiMonthlyBudgetUsd: 0 },
      { name: 'x'.repeat(81) },
      { email: 'new@example.com' },
    ];
    for (const body of invalid) {
      await admin
        .patch(`/api/admin/users/${member.user.id}`)
        .send(body)
        .expect(400);
    }
    await admin.patch('/api/admin/users/not-a-uuid').send({}).expect(400);
  });

  it('creates single-use password reset links that sign out every device', async () => {
    const link = (
      await admin
        .post(`/api/admin/users/${member.user.id}/reset-link`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;

    expect(link.url).toMatch(TOKEN_URL);
    expect(link.url).toContain('/reset/');
    expect(link.invite).toMatchObject({
      type: 'reset',
      email: member.user.email,
      name: 'Sam Member',
      role: 'member',
      status: 'pending',
      usedAt: null,
      createdByEmail: adminUser.email,
    });
    const expiresInMs = Date.parse(link.invite.expiresAt) - Date.now();
    expect(expiresInMs).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(expiresInMs).toBeLessThanOrEqual(48 * 60 * 60 * 1000);
    await expect(tokenInfo(link.url)).resolves.toEqual({
      type: 'reset',
      email: member.user.email,
      name: 'Sam Member',
      valid: true,
      reason: null,
      expiresAt: link.invite.expiresAt,
    });
    const stored = await prisma.authToken.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(tokenFromUrl(link.url));

    const second = (
      await admin
        .post(`/api/admin/users/${member.user.id}/reset-link`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;
    await expect(tokenInfo(link.url)).resolves.toMatchObject({
      valid: false,
      reason: 'revoked',
    });

    const device = request.agent(app.getHttpServer());
    const accepted = await device
      .post(`/api/auth/tokens/${tokenFromUrl(second.url)}/accept`)
      .send({ password: 'brand new member password' })
      .expect(200);
    expect(accepted.body).toEqual({
      id: member.user.id,
      email: member.user.email,
      name: 'Sam Member',
      role: 'member',
    });
    await device.get('/api/auth/sessions').expect(200);
    await member.agent.get('/api/auth/sessions').expect(401);
    await publicApi()
      .post('/api/auth/login')
      .send({ email: member.user.email, password: member.user.password })
      .expect(401);
    await signInAgent(app, {
      email: member.user.email,
      password: 'brand new member password',
    });

    await expect(tokenInfo(second.url)).resolves.toMatchObject({
      valid: false,
      reason: 'used',
    });
    const reused = await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(second.url)}/accept`)
      .send({ password: 'yet another password' })
      .expect(410);
    expect(reused.body).toMatchObject({
      message: 'This link was already used',
    });

    await admin
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ status: 'disabled' })
      .expect(200);
    await admin
      .post(`/api/admin/users/${member.user.id}/reset-link`)
      .send({})
      .expect(409);
    await admin
      .post(`/api/admin/users/${randomUUID()}/reset-link`)
      .send({})
      .expect(404);
  });

  it('revokes the reset link when the person is disabled', async () => {
    const link = (
      await admin
        .post(`/api/admin/users/${member.user.id}/reset-link`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;

    await admin
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ status: 'disabled' })
      .expect(200);

    await expect(tokenInfo(link.url)).resolves.toMatchObject({
      valid: false,
      reason: 'revoked',
    });
    await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(link.url)}/accept`)
      .send({ password: 'brand new member password' })
      .expect(410);
    const user = await userById(member.user.id);
    expect(user).toMatchObject({ status: 'disabled', activeSessions: 0 });
  });

  it('signs a person out everywhere', async () => {
    const second = await signInAgent(app, {
      email: member.user.email,
      password: member.user.password,
    });
    expect((await userById(member.user.id)).activeSessions).toBe(2);

    await admin
      .post(`/api/admin/users/${member.user.id}/revoke-sessions`)
      .send({})
      .expect(204);

    await member.agent.get('/api/auth/sessions').expect(401);
    await second.agent.get('/api/auth/sessions').expect(401);
    expect((await userById(member.user.id)).activeSessions).toBe(0);
    await admin
      .post(`/api/admin/users/${randomUUID()}/revoke-sessions`)
      .send({})
      .expect(404);

    const self = await admin
      .post(`/api/admin/users/${adminUser.id}/revoke-sessions`)
      .send({})
      .expect(204);
    expect(String(self.headers['set-cookie'])).toMatch(/^ft_session=;/);
    await admin.get('/api/admin/users').expect(401);
  });

  it('deletes a person with all their data and photo files', async () => {
    const photos = app.get(PhotosService);
    const photo = await photos.createFromUpload(
      member.user.id,
      await testImage(),
      { maxDimension: 1024 },
    );
    const spare = await photos.createFromUpload(
      member.user.id,
      await testImage(),
      { maxDimension: 1024 },
    );
    await member.agent
      .post('/api/entries')
      .send(entryBody(photo.id))
      .expect(201);
    await member.agent
      .put('/api/weights/2026-09-20')
      .send({ weightKg: 80 })
      .expect(200);
    await prisma.aiUsage.create({
      data: {
        userId: member.user.id,
        model: 'mock',
        mode: 'text',
        success: true,
      },
    });
    const photosDir = app.get(AppConfig).storage.photosDir;
    const files = [photo, spare].flatMap((p) => [
      join(photosDir, p.storageKey),
      join(photosDir, p.thumbKey),
    ]);
    for (const file of files) {
      await expect(fileExists(file)).resolves.toBe(true);
    }

    await admin.delete(`/api/admin/users/${adminUser.id}`).expect(403);
    await admin.delete(`/api/admin/users/${member.user.id}`).expect(204);

    for (const file of files) {
      await expect(fileExists(file)).resolves.toBe(false);
    }
    await expect(
      prisma.user.count({ where: { id: member.user.id } }),
    ).resolves.toBe(0);
    for (const count of [
      prisma.entry.count(),
      prisma.entryItem.count(),
      prisma.photo.count(),
      prisma.aiUsage.count(),
      prisma.weightLog.count(),
      prisma.session.count({ where: { userId: member.user.id } }),
      prisma.profile.count({ where: { userId: member.user.id } }),
    ]) {
      await expect(count).resolves.toBe(0);
    }
    await member.agent.get('/api/auth/sessions').expect(401);
    await admin.delete(`/api/admin/users/${member.user.id}`).expect(404);
    expect((await users()).map((user) => user.id)).toEqual([adminUser.id]);
  });

  it('keeps a person when their photo files cannot be deleted and finishes on retry', async () => {
    const photos = app.get(PhotosService);
    const photo = await photos.createFromUpload(
      member.user.id,
      await testImage(),
      { maxDimension: 1024 },
    );
    await member.agent
      .post('/api/entries')
      .send(entryBody(photo.id))
      .expect(201);
    const photosDir = app.get(AppConfig).storage.photosDir;
    const files = [photo.storageKey, photo.thumbKey].map((key) =>
      join(photosDir, key),
    );
    const storage = app.get(StorageService);
    const failOnce = vi
      .spyOn(storage, 'delete')
      .mockRejectedValueOnce(new Error('R2 unavailable'));

    try {
      const failed = await admin
        .delete(`/api/admin/users/${member.user.id}`)
        .expect(503);
      expect(failed.body).toMatchObject({
        message: 'Could not delete all photos. Please try again.',
      });
    } finally {
      failOnce.mockRestore();
    }

    await expect(
      prisma.user.count({ where: { id: member.user.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.photo.count({ where: { userId: member.user.id } }),
    ).resolves.toBe(1);
    await expect(
      prisma.entry.count({ where: { userId: member.user.id } }),
    ).resolves.toBe(1);

    await admin.delete(`/api/admin/users/${member.user.id}`).expect(204);

    for (const file of files) {
      await expect(fileExists(file)).resolves.toBe(false);
    }
    await expect(
      prisma.user.count({ where: { id: member.user.id } }),
    ).resolves.toBe(0);
    await expect(prisma.photo.count()).resolves.toBe(0);
  });

  it('approves and rejects access requests', async () => {
    const first = await createAccessRequest('first@example.com', 'First');
    const second = await createAccessRequest('second@example.com', 'Second');
    const existing = await createTestUser(app, { email: 'exists@example.com' });
    const taken = await createAccessRequest(existing.email, 'Existing');

    const all = (await admin.get('/api/admin/access-requests').expect(200))
      .body as AdminAccessRequestDto[];
    expect(all.map((r) => r.email)).toEqual([
      taken.email,
      second.email,
      first.email,
    ]);
    expect(all[0]).toEqual<AdminAccessRequestDto>({
      id: taken.id,
      email: existing.email,
      name: 'Existing',
      message: 'Please let Existing in',
      status: 'pending',
      createdAt: taken.createdAt.toISOString(),
      decidedAt: null,
      decidedByEmail: null,
      acceptedAt: null,
      hasAccount: true,
    });

    const approved = (
      await admin
        .post(`/api/admin/access-requests/${first.id}/approve`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;
    expect(approved.url).toMatch(TOKEN_URL);
    expect(approved.invite).toMatchObject({
      type: 'invite',
      email: first.email,
      name: 'First',
      role: 'member',
      status: 'pending',
    });
    const again = (
      await admin
        .post(`/api/admin/access-requests/${first.id}/approve`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;
    expect(again.url).not.toBe(approved.url);
    await expect(tokenInfo(approved.url)).resolves.toMatchObject({
      reason: 'revoked',
    });
    await expect(tokenInfo(again.url)).resolves.toMatchObject({
      valid: true,
      type: 'invite',
      email: first.email,
    });

    const rejected = (
      await admin
        .post(`/api/admin/access-requests/${second.id}/reject`)
        .send({})
        .expect(200)
    ).body as AdminAccessRequestDto;
    expect(rejected).toMatchObject({
      status: 'rejected',
      decidedByEmail: adminUser.email,
      decidedAt: expect.any(String) as string,
    });
    await admin
      .post(`/api/admin/access-requests/${second.id}/reject`)
      .send({})
      .expect(200);
    await admin
      .post(`/api/admin/access-requests/${taken.id}/approve`)
      .send({})
      .expect(409);

    const pending = (
      await admin.get('/api/admin/access-requests?status=pending').expect(200)
    ).body as AdminAccessRequestDto[];
    expect(pending.map((r) => r.id)).toEqual([taken.id]);
    const approvedList = (
      await admin.get('/api/admin/access-requests?status=approved').expect(200)
    ).body as AdminAccessRequestDto[];
    expect(approvedList).toMatchObject([
      { id: first.id, decidedByEmail: adminUser.email, hasAccount: false },
    ]);
    await admin.get('/api/admin/access-requests?status=maybe').expect(400);

    const joined = await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(again.url)}/accept`)
      .send({ password: 'first person password' })
      .expect(200);
    expect(joined.body).toMatchObject({ email: first.email, name: 'First' });
    const accepted = (
      await admin.get('/api/admin/access-requests?status=approved').expect(200)
    ).body as AdminAccessRequestDto[];
    expect(accepted[0]).toMatchObject({
      acceptedAt: expect.any(String) as string,
      hasAccount: true,
    });
    await admin
      .post(`/api/admin/access-requests/${first.id}/approve`)
      .send({})
      .expect(409);
    await admin
      .post(`/api/admin/access-requests/${first.id}/reject`)
      .send({})
      .expect(409);
    await admin
      .post(`/api/admin/access-requests/${randomUUID()}/approve`)
      .send({})
      .expect(404);
  });

  it('invites people with single-use links that can be regenerated and revoked', async () => {
    const created = await admin
      .post('/api/admin/invites')
      .send({ email: '  New.Person@Example.com ', name: ' New Person ' })
      .expect(201);
    const invite = created.body as InviteLinkResponse;
    expect(invite.url).toMatch(TOKEN_URL);
    expect(invite.url).toContain('/invite/');
    expect(invite.invite).toMatchObject({
      type: 'invite',
      email: 'new.person@example.com',
      name: 'New Person',
      role: 'member',
      status: 'pending',
      createdByEmail: adminUser.email,
    });
    const ttlDays =
      (Date.parse(invite.invite.expiresAt) - Date.now()) / 86_400_000;
    expect(ttlDays).toBeGreaterThan(13.9);
    expect(ttlDays).toBeLessThanOrEqual(14);

    await admin
      .post('/api/admin/invites')
      .send({ email: member.user.email })
      .expect(409);
    await admin
      .post('/api/admin/invites')
      .send({ email: 'x@example.com', role: 'owner' })
      .expect(400);

    const regenerated = (
      await admin
        .post(`/api/admin/invites/${invite.invite.id}/regenerate`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;
    expect(regenerated.invite.id).not.toBe(invite.invite.id);
    await expect(tokenInfo(invite.url)).resolves.toMatchObject({
      reason: 'revoked',
    });
    await expect(tokenInfo(regenerated.url)).resolves.toMatchObject({
      valid: true,
      name: 'New Person',
    });

    const listed = (await admin.get('/api/admin/invites').expect(200))
      .body as AdminInviteDto[];
    expect(listed.map((i) => [i.id, i.status])).toEqual([
      [regenerated.invite.id, 'pending'],
      [invite.invite.id, 'revoked'],
    ]);

    await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(regenerated.url)}/accept`)
      .send({ password: 'short' })
      .expect(400);
    const joiner = request.agent(app.getHttpServer());
    const joined = await joiner
      .post(`/api/auth/tokens/${tokenFromUrl(regenerated.url)}/accept`)
      .send({ password: 'new person password' })
      .expect(200);
    expect(joined.body).toMatchObject({
      email: 'new.person@example.com',
      name: 'New Person',
      role: 'member',
    });
    await joiner.get('/api/auth/sessions').expect(200);
    await expect(tokenInfo(regenerated.url)).resolves.toMatchObject({
      valid: false,
      reason: 'account_exists',
    });
    await expect(tokenInfo(invite.url)).resolves.toMatchObject({
      valid: false,
      reason: 'account_exists',
    });
    await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(regenerated.url)}/accept`)
      .send({ password: 'new person password' })
      .expect(409);
    const afterJoin = (await admin.get('/api/admin/invites').expect(200))
      .body as AdminInviteDto[];
    expect(afterJoin.map((i) => [i.id, i.status])).toEqual([
      [regenerated.invite.id, 'used'],
      [invite.invite.id, 'revoked'],
    ]);
    await admin
      .post(`/api/admin/invites/${regenerated.invite.id}/regenerate`)
      .send({})
      .expect(409);
    await admin
      .delete(`/api/admin/invites/${regenerated.invite.id}`)
      .expect(409);

    const adminInvite = (
      await admin
        .post('/api/admin/invites')
        .send({ email: 'helper@example.com', role: 'admin' })
        .expect(201)
    ).body as InviteLinkResponse;
    const helper = await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(adminInvite.url)}/accept`)
      .send({ password: 'helper password 1', name: 'Helper' })
      .expect(200);
    expect(helper.body).toMatchObject({ name: 'Helper', role: 'admin' });

    const revokable = (
      await admin
        .post('/api/admin/invites')
        .send({ email: 'maybe@example.com' })
        .expect(201)
    ).body as InviteLinkResponse;
    await admin.delete(`/api/admin/invites/${revokable.invite.id}`).expect(204);
    await admin.delete(`/api/admin/invites/${revokable.invite.id}`).expect(204);
    const revoked = await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(revokable.url)}/accept`)
      .send({ password: 'maybe password 1' })
      .expect(410);
    expect(revoked.body).toMatchObject({ message: 'This link was revoked' });
    await admin.delete(`/api/admin/invites/${randomUUID()}`).expect(404);
  });

  it('keeps only the newest link pending when links are regenerated, even concurrently', async () => {
    const first = (
      await admin
        .post('/api/admin/invites')
        .send({ email: 'twice@example.com' })
        .expect(201)
    ).body as InviteLinkResponse;
    await admin.delete(`/api/admin/invites/${first.invite.id}`).expect(204);
    const second = (
      await admin
        .post('/api/admin/invites')
        .send({ email: 'twice@example.com' })
        .expect(201)
    ).body as InviteLinkResponse;

    const revived = (
      await admin
        .post(`/api/admin/invites/${first.invite.id}/regenerate`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;
    await expect(tokenInfo(second.url)).resolves.toMatchObject({
      reason: 'revoked',
    });
    await expect(tokenInfo(revived.url)).resolves.toMatchObject({
      valid: true,
    });

    const taps = await Promise.all(
      [1, 2].map(() =>
        admin
          .post(`/api/admin/invites/${revived.invite.id}/regenerate`)
          .send({}),
      ),
    );
    expect(taps.map((tap) => tap.status)).toEqual([200, 200]);
    const pending = (
      (await admin.get('/api/admin/invites').expect(200))
        .body as AdminInviteDto[]
    ).filter(
      (invite) =>
        invite.email === 'twice@example.com' && invite.status === 'pending',
    );
    expect(pending).toHaveLength(1);

    const reset = (
      await admin
        .post(`/api/admin/users/${member.user.id}/reset-link`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;
    const resetTaps = await Promise.all(
      [1, 2].map(() =>
        admin.post(`/api/admin/invites/${reset.invite.id}/regenerate`).send({}),
      ),
    );
    expect(resetTaps.map((tap) => tap.status)).toEqual([200, 200]);
    await expect(
      prisma.authToken.count({
        where: {
          type: 'reset',
          userId: member.user.id,
          usedAt: null,
          revokedAt: null,
        },
      }),
    ).resolves.toBe(1);
  });

  it('reports expired, unknown and superseded invite links', async () => {
    const expiring = (
      await admin
        .post('/api/admin/invites')
        .send({ email: 'late@example.com' })
        .expect(201)
    ).body as InviteLinkResponse;
    await prisma.authToken.update({
      where: { id: expiring.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(tokenInfo(expiring.url)).resolves.toMatchObject({
      valid: false,
      reason: 'expired',
    });
    const expired = await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(expiring.url)}/accept`)
      .send({ password: 'late password 12' })
      .expect(410);
    expect(expired.body).toMatchObject({ message: 'This link has expired' });
    const listed = (await admin.get('/api/admin/invites').expect(200))
      .body as AdminInviteDto[];
    expect(listed[0]).toMatchObject({ status: 'expired' });
    const renewed = (
      await admin
        .post(`/api/admin/invites/${expiring.invite.id}/regenerate`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;
    await expect(tokenInfo(renewed.url)).resolves.toMatchObject({
      valid: true,
    });

    await expect(tokenInfo(expiring.url)).resolves.toMatchObject({
      valid: false,
      reason: 'revoked',
    });

    await createTestUser(app, { email: 'late@example.com' });
    await expect(tokenInfo(renewed.url)).resolves.toMatchObject({
      valid: false,
      reason: 'account_exists',
      email: 'late@example.com',
    });
    await expect(tokenInfo(expiring.url)).resolves.toMatchObject({
      valid: false,
      reason: 'account_exists',
    });
    await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(renewed.url)}/accept`)
      .send({ password: 'late password 12' })
      .expect(409);

    await expect(tokenInfo('http://x/invite/unknown-token')).resolves.toEqual({
      type: null,
      email: null,
      name: null,
      valid: false,
      reason: 'not_found',
      expiresAt: null,
    });
    await publicApi()
      .post('/api/auth/tokens/unknown-token/accept')
      .send({ password: 'whatever password' })
      .expect(404);
  });

  it('tells people who joined another way to sign in when they open an old invite', async () => {
    const stale = (
      await admin
        .post('/api/admin/invites')
        .send({ email: 'joined@example.com' })
        .expect(201)
    ).body as InviteLinkResponse;
    await prisma.authToken.update({
      where: { id: stale.invite.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(tokenInfo(stale.url)).resolves.toMatchObject({
      reason: 'expired',
    });

    await createTestUser(app, { email: 'joined@example.com' });

    await expect(tokenInfo(stale.url)).resolves.toMatchObject({
      valid: false,
      reason: 'account_exists',
    });
    await publicApi()
      .post(`/api/auth/tokens/${tokenFromUrl(stale.url)}/accept`)
      .send({ password: 'joined password 1' })
      .expect(409);
  });
});

describe('admin links with APP_URL (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp({
      configure: withSettings({ appUrl: 'https://foodlog.example.com' }),
    });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('builds invite and reset links from APP_URL', async () => {
    const admin = await setupAndLogin(app);
    const invite = (
      await admin
        .post('/api/admin/invites')
        .send({ email: 'guest@example.com' })
        .set('X-Forwarded-Host', 'evil.example.net')
        .expect(201)
    ).body as InviteLinkResponse;
    expect(invite.url).toMatch(
      /^https:\/\/foodlog\.example\.com\/invite\/[A-Za-z0-9_-]{43}$/,
    );

    const owner = await getTestUser(app);
    const reset = (
      await admin
        .post(`/api/admin/users/${owner.id}/reset-link`)
        .send({})
        .expect(200)
    ).body as InviteLinkResponse;
    expect(reset.url).toMatch(
      /^https:\/\/foodlog\.example\.com\/reset\/[A-Za-z0-9_-]{43}$/,
    );
  });
});
