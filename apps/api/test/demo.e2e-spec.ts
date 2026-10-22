import type {
  AuthStatusResponse,
  DayDashboardResponse,
  FavoriteDto,
  ProfileResponse,
  UserDto,
  WeightSummaryResponse,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { readCatalogFile } from '../src/catalog/catalog-file.js';
import { CatalogLoaderService } from '../src/catalog/catalog-loader.service.js';
import { DEFAULT_CATALOG_FILE, parseSettings } from '../src/config/settings.js';
import { DemoCleanupService } from '../src/demo/demo-cleanup.service.js';
import { DEMO_FOOD_NAMES } from '../src/demo/demo-seed.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  resetDatabase,
  sessionCookieFromResponse,
  withSettings,
} from './helpers.js';

const TODAY = new Date().toISOString().slice(0, 10);

function demoSettings(enabled: boolean) {
  const base = parseSettings(process.env);
  return withSettings({
    demo: { enabled, ttlHours: 24 },
    ai: { ...base.ai, provider: 'mock' },
  });
}

describe('demo mode (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp({ configure: demoSettings(true) });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function loadDemoFoods(): Promise<void> {
    const file = await readCatalogFile(DEFAULT_CATALOG_FILE);
    const names = new Set(DEMO_FOOD_NAMES);
    await app.get(CatalogLoaderService).load({
      ...file,
      version: 'demo-foods',
      foods: file.foods.filter((food) => names.has(food.name)),
    });
  }

  async function startDemo(): Promise<{
    agent: ReturnType<typeof request.agent>;
    user: UserDto;
  }> {
    const agent = request.agent(app.getHttpServer());
    const response = await agent
      .post('/api/demo/start')
      .send({ localDate: TODAY, utcOffsetMinutes: 0 })
      .expect(201);
    expect(sessionCookieFromResponse(response)).toBeTruthy();
    return { agent, user: response.body as UserDto };
  }

  it('offers the demo instead of first-account setup', async () => {
    const status = (
      await request(app.getHttpServer()).get('/api/auth/status').expect(200)
    ).body as AuthStatusResponse;
    expect(status).toMatchObject({
      setupRequired: false,
      authenticated: false,
      user: null,
      demo: { enabled: true, expiresAt: null },
    });
  });

  it('asks visitors to wait while the food database is still loading', async () => {
    await request(app.getHttpServer())
      .post('/api/demo/start')
      .send({ localDate: TODAY, utcOffsetMinutes: 0 })
      .expect(503);
  });

  it('rejects a date that is not today', async () => {
    await loadDemoFoods();
    await request(app.getHttpServer())
      .post('/api/demo/start')
      .send({ localDate: '2020-01-01', utcOffsetMinutes: 0 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/demo/start')
      .send({ localDate: TODAY, utcOffsetMinutes: 2000 })
      .expect(400);
  });

  it('creates a signed-in sandbox with two months of history', async () => {
    const { agent, user } = await startDemo();
    expect(user).toMatchObject({ name: 'Demo', role: 'member' });
    expect(user.email).toMatch(/^demo-.+@demo\.invalid$/);

    const status = (await agent.get('/api/auth/status').expect(200))
      .body as AuthStatusResponse;
    expect(status.authenticated).toBe(true);
    const expiresAt = Date.parse(status.demo?.expiresAt ?? '');
    expect(expiresAt - Date.now()).toBeGreaterThan(23 * 3_600_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(24 * 3_600_000);

    const profile = (await agent.get('/api/profile').expect(200))
      .body as ProfileResponse;
    expect(profile.profile).toMatchObject({
      onboarded: true,
      sex: 'male',
      goal: 'cut',
      heightCm: 180,
    });
    expect(profile.ai.provider).toBe('mock');

    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    const day = (
      await agent
        .get('/api/dashboard/day')
        .query({ date: yesterday })
        .expect(200)
    ).body as DayDashboardResponse;
    expect(day.entries.length).toBeGreaterThanOrEqual(3);
    expect(day.day.totals.calories).toBeGreaterThan(800);
    expect(day.entries.every((entry) => entry.source === 'database')).toBe(
      true,
    );

    const from = new Date(Date.now() - 59 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const weights = (
      await agent.get('/api/weights').query({ from, to: TODAY }).expect(200)
    ).body as WeightSummaryResponse;
    expect(weights.logs.length).toBeGreaterThan(30);
    expect(weights.weeklyChangeKg).toBeLessThan(0);

    const favorites = (await agent.get('/api/favorites').expect(200))
      .body as FavoriteDto[];
    expect(favorites).toHaveLength(2);

    const search = await agent
      .get('/api/foods')
      .query({ q: 'chicken' })
      .expect(200);
    expect(search.body.results.length).toBeGreaterThan(0);
  });

  it('keeps sandboxes apart and protects the account', async () => {
    const first = await startDemo();
    const second = await startDemo();
    expect(first.user.id).not.toBe(second.user.id);
    await first.agent
      .post('/api/auth/change-password')
      .send({
        currentPassword: 'whatever password',
        newPassword: 'another password 1',
      })
      .expect(403);
    await first.agent.get('/api/admin/users').expect(403);
  });

  it('deletes sandboxes once they expire', async () => {
    const { agent, user } = await startDemo();
    const cleanup = app.get(DemoCleanupService);
    expect(
      await cleanup.removeExpired(new Date(Date.now() + 23 * 3_600_000)),
    ).toBe(0);
    const removed = await cleanup.removeExpired(
      new Date(Date.now() + 25 * 3_600_000),
    );
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.entry.count({ where: { userId: user.id } })).toBe(0);
    await agent.get('/api/profile').expect(401);
  });
});

describe('demo mode turned off (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ configure: demoSettings(false) });
    await resetDatabase(app.get(PrismaService));
  });

  afterAll(async () => {
    await app.close();
  });

  it('has no demo endpoint and no demo status', async () => {
    await request(app.getHttpServer())
      .post('/api/demo/start')
      .send({ localDate: TODAY, utcOffsetMinutes: 0 })
      .expect(404);
    const status = (
      await request(app.getHttpServer()).get('/api/auth/status').expect(200)
    ).body as AuthStatusResponse;
    expect(status).not.toHaveProperty('demo');
    expect(status.setupRequired).toBe(true);
  });
});
