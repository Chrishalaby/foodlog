import { randomUUID } from 'node:crypto';
import type {
  AnalyzeResponse,
  MenuScanResponse,
  UsageSummaryResponse,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { AppConfig } from '../src/config/app-config.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function currentUtcMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function menuPhoto(): Promise<Buffer> {
  return sharp({
    create: {
      width: 600,
      height: 800,
      channels: 3,
      background: { r: 245, g: 240, b: 225 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('usage (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;
  let userId: string;
  let strangerId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
    strangerId = (
      await prisma.user.create({
        data: {
          email: `stranger-${randomUUID()}@example.com`,
          passwordHash: 'x',
        },
      })
    ).id;
  });

  beforeEach(async () => {
    await prisma.aiUsage.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  function usageRow(
    overrides: Partial<Prisma.AiUsageUncheckedCreateInput>,
  ): Prisma.AiUsageUncheckedCreateInput {
    return {
      userId,
      model: 'gpt-5.6-sol',
      mode: 'food_photo',
      inputTokens: 2800,
      outputTokens: 1500,
      reasoningTokens: 600,
      costUsd: 0.04,
      durationMs: 12_000,
      success: true,
      ...overrides,
    };
  }

  async function summary(query = ''): Promise<UsageSummaryResponse> {
    const response = await agent.get(`/api/usage${query}`).expect(200);
    return response.body as UsageSummaryResponse;
  }

  it('summarizes a selected month per model with failures, averages and recent attempts', async () => {
    await prisma.aiUsage.createMany({
      data: [
        usageRow({
          createdAt: new Date('2025-03-02T10:00:00Z'),
          costUsd: 0.04,
        }),
        usageRow({
          createdAt: new Date('2025-03-05T10:00:00Z'),
          costUsd: 0.01,
          success: false,
          errorKind: 'invalid_output',
          attempt: 1,
        }),
        usageRow({
          createdAt: new Date('2025-03-05T10:00:02Z'),
          model: 'gpt-6-astra',
          mode: 'nutrition_label',
          costUsd: 0.1,
          attempt: 2,
        }),
        usageRow({ createdAt: new Date('2025-02-28T23:59:59Z'), costUsd: 1 }),
        usageRow({ createdAt: new Date('2025-04-01T00:00:00Z'), costUsd: 2 }),
        usageRow({
          userId: strangerId,
          createdAt: new Date('2025-03-10T10:00:00Z'),
          costUsd: 50,
        }),
      ],
    });

    const body = await summary('?month=2025-03');

    expect(body).toMatchObject({
      month: '2025-03',
      monthToDateUsd: 0.15,
      monthRequests: 3,
      monthFailedRequests: 1,
      last30DaysUsd: 0,
      allTimeUsd: 3.15,
      avgCostPerRequestUsd: 0.075,
      byModel: [
        { model: 'gpt-6-astra', requests: 1, costUsd: 0.1 },
        { model: 'gpt-5.6-sol', requests: 2, costUsd: 0.05 },
      ],
      budgetUsd: null,
    });
    expect(
      body.recent.map((r) => [r.model, r.costUsd, r.success, r.errorKind]),
    ).toEqual([
      ['gpt-6-astra', 0.1, true, null],
      ['gpt-5.6-sol', 0.01, false, 'invalid_output'],
      ['gpt-5.6-sol', 0.04, true, null],
    ]);
    expect(body.recent[0]).toEqual({
      id: expect.any(String) as string,
      createdAt: '2025-03-05T10:00:02.000Z',
      model: 'gpt-6-astra',
      mode: 'nutrition_label',
      inputTokens: 2800,
      outputTokens: 1500,
      reasoningTokens: 600,
      costUsd: 0.1,
      durationMs: 12_000,
      success: true,
      errorKind: null,
    });
  });

  it('defaults to the current UTC month and adds up the trailing 30 days', async () => {
    const now = Date.now();
    await prisma.aiUsage.createMany({
      data: [
        usageRow({ createdAt: new Date(now - 1000), costUsd: 0.02 }),
        usageRow({ createdAt: new Date(now - 2000), costUsd: 0.03 }),
        usageRow({ createdAt: new Date(now - 40 * DAY_MS), costUsd: 0.5 }),
      ],
    });

    const body = await summary();

    expect(body.month).toBe(currentUtcMonth());
    expect(body.monthToDateUsd).toBe(0.05);
    expect(body.monthRequests).toBe(2);
    expect(body.last30DaysUsd).toBe(0.05);
    expect(body.allTimeUsd).toBe(0.55);
  });

  it('returns an empty month without dividing by zero', async () => {
    await expect(summary('?month=2020-01')).resolves.toMatchObject({
      month: '2020-01',
      monthToDateUsd: 0,
      monthRequests: 0,
      monthFailedRequests: 0,
      avgCostPerRequestUsd: 0,
      byModel: [],
      recent: [],
    });
  });

  it('lists only the 20 most recent attempts', async () => {
    const start = Date.now() - 60_000;
    await prisma.aiUsage.createMany({
      data: Array.from({ length: 25 }, (_, i) =>
        usageRow({ createdAt: new Date(start + i * 100), costUsd: 0.001 }),
      ),
    });
    const body = await summary();
    expect(body.monthRequests).toBe(25);
    expect(body.recent).toHaveLength(20);
    expect(body.recent[0]!.createdAt > body.recent[19]!.createdAt).toBe(true);
  });

  it('includes attempts made through /api/analyze', async () => {
    const analysis = await agent
      .post('/api/analyze')
      .send({ mode: 'text', description: 'banana' })
      .expect(200);
    const body = await summary();
    expect(body.monthRequests).toBe(1);
    expect(body.byModel).toEqual([{ model: 'mock', requests: 1, costUsd: 0 }]);
    expect(body.recent[0]).toMatchObject({
      model: 'mock',
      mode: 'text',
      success: true,
      costUsd: 0,
      outputTokens: (analysis.body as AnalyzeResponse).usage.outputTokens,
    });
  });

  it('includes menu scans as their own mode without an analysis', async () => {
    const menu = await agent
      .post('/api/compare/menu')
      .attach('images', await menuPhoto(), 'menu.jpg')
      .expect(200);
    await agent
      .post('/api/analyze')
      .send({ mode: 'text', description: 'banana' })
      .expect(200);

    const body = await summary();

    expect(body.monthRequests).toBe(2);
    expect(body.byModel).toEqual([{ model: 'mock', requests: 2, costUsd: 0 }]);
    expect(body.recent.map((r) => r.mode).sort()).toEqual(['menu', 'text']);
    expect(body.recent.find((r) => r.mode === 'menu')).toMatchObject({
      model: 'mock',
      success: true,
      costUsd: 0,
      outputTokens: (menu.body as MenuScanResponse).usage.outputTokens,
    });
  });

  it('lists menu attempts stored with the menu mode', async () => {
    await prisma.aiUsage.createMany({
      data: [
        usageRow({ mode: 'menu', costUsd: 0.02 }),
        usageRow({ mode: 'food_photo', costUsd: 0.03 }),
      ],
    });

    const body = await summary();

    expect(body.monthToDateUsd).toBe(0.05);
    expect(body.recent.map((r) => r.mode).sort()).toEqual([
      'food_photo',
      'menu',
    ]);
  });

  it('reports each person’s own effective monthly budget', async () => {
    const member = await createSignedInUser(app);
    const memberSummary = async (): Promise<UsageSummaryResponse> =>
      (await member.agent.get('/api/usage').expect(200))
        .body as UsageSummaryResponse;

    await expect(summary()).resolves.toMatchObject({ budgetUsd: null });
    await expect(memberSummary()).resolves.toMatchObject({
      budgetUsd: app.get(AppConfig).ai.memberMonthlyBudgetUsd,
    });

    await agent
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ aiMonthlyBudgetUsd: 2.5 })
      .expect(200);
    await agent
      .patch(`/api/admin/users/${userId}`)
      .send({ aiMonthlyBudgetUsd: 40 })
      .expect(200);

    await expect(memberSummary()).resolves.toMatchObject({ budgetUsd: 2.5 });
    await expect(summary()).resolves.toMatchObject({ budgetUsd: 40 });

    await agent
      .patch(`/api/admin/users/${member.user.id}`)
      .send({ aiBudgetUnlimited: true })
      .expect(200);
    await expect(memberSummary()).resolves.toMatchObject({ budgetUsd: null });
    await agent
      .patch(`/api/admin/users/${userId}`)
      .send({ aiMonthlyBudgetUsd: null })
      .expect(200);
  });

  it('validates the month', async () => {
    await agent.get('/api/usage?month=2025-13').expect(400);
    await agent.get('/api/usage?month=march').expect(400);
    await agent.get('/api/usage?month=2025-03&extra=1').expect(400);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/usage').expect(401);
  });
});
