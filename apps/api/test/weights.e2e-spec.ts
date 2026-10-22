import { randomUUID } from 'node:crypto';
import {
  addDays,
  type CreateEntryRequest,
  eachDate,
  type ProfileDto,
  type ProfileResponse,
  type WeightLogDto,
  type WeightSummaryResponse,
  weightTrendSeries,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const TO = '2026-09-28';

const PROFILE: ProfileDto = {
  weightKg: 90,
  heightCm: 180,
  age: 35,
  sex: 'male',
  bodyFatPct: 22,
  tdeeOverride: null,
  onboarded: true,
  activityLevel: 'moderate',
  goal: 'cut',
  trainingDaysPerWeek: 3,
  targetOverrides: {},
  location: null,
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'dark',
};

function messages(body: unknown): string[] {
  const message = (body as { message?: unknown }).message;
  return Array.isArray(message) ? message.map(String) : [String(message)];
}

function entryBody(localDate: string, calories: number): CreateEntryRequest {
  return {
    name: 'Day total',
    mealType: 'dinner',
    source: 'manual',
    timestamp: `${localDate}T18:00:00.000Z`,
    localDate,
    items: [
      {
        name: 'Everything',
        grams: 1000,
        nutrients: { ...zeroNutrients(), calories },
      },
    ],
  };
}

describe('weights (e2e)', () => {
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
    await prisma.weightLog.deleteMany();
    await prisma.entry.deleteMany();
    await prisma.profile.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function putWeight(
    date: string,
    body: object,
    status = 200,
  ): Promise<request.Response> {
    return agent.put(`/api/weights/${date}`).send(body).expect(status);
  }

  async function getSummary(from: string, to: string) {
    const response = await agent
      .get('/api/weights')
      .query({ from, to })
      .expect(200);
    return response.body as WeightSummaryResponse;
  }

  async function storedProfile(): Promise<ProfileDto> {
    const response = await agent.get('/api/profile').expect(200);
    return (response.body as ProfileResponse).profile;
  }

  async function seedStrangerWeight(
    date: string,
    weightKg = 55,
  ): Promise<void> {
    await prisma.weightLog.create({
      data: { userId: strangerId, date, weightKg },
    });
  }

  it('requires authentication', async () => {
    const server = app.getHttpServer();
    await request(server)
      .get('/api/weights')
      .query({ from: TO, to: TO })
      .expect(401);
    await request(server)
      .put(`/api/weights/${TO}`)
      .send({ weightKg: 80 })
      .expect(401);
    await request(server).delete(`/api/weights/${TO}`).expect(401);
    await expect(prisma.weightLog.count()).resolves.toBe(0);
  });

  describe('PUT /api/weights/:date', () => {
    it('creates one weigh-in per date and updates it on the next PUT', async () => {
      const created = await putWeight(TO, { weightKg: 80.4, bodyFatPct: 18 });
      expect(created.body).toEqual<WeightLogDto>({
        date: TO,
        weightKg: 80.4,
        bodyFatPct: 18,
      });

      const reweighed = await putWeight(TO, { weightKg: 80.1 });
      expect(reweighed.body).toEqual<WeightLogDto>({
        date: TO,
        weightKg: 80.1,
        bodyFatPct: 18,
      });

      const cleared = await putWeight(TO, { weightKg: 80, bodyFatPct: null });
      expect(cleared.body).toEqual<WeightLogDto>({
        date: TO,
        weightKg: 80,
        bodyFatPct: null,
      });

      const rows = await prisma.weightLog.findMany({ where: { userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        date: TO,
        weightKg: 80,
        bodyFatPct: null,
      });
    });

    it('syncs the profile body fat only when the request carries one', async () => {
      await putWeight(TO, { weightKg: 80, bodyFatPct: 18 });
      const profile = await storedProfile();
      expect(profile).toMatchObject({ weightKg: 80, bodyFatPct: 18 });

      await agent
        .put('/api/profile')
        .send({ ...profile, bodyFatPct: 16 })
        .expect(200);
      await putWeight(TO, { weightKg: 79.8 });
      expect(await storedProfile()).toMatchObject({
        weightKg: 79.8,
        bodyFatPct: 16,
      });

      await putWeight(TO, { weightKg: 79.8, bodyFatPct: null });
      expect((await storedProfile()).bodyFatPct).toBe(16);
      const row = await prisma.weightLog.findUniqueOrThrow({
        where: { userId_date: { userId, date: TO } },
      });
      expect(row.bodyFatPct).toBeNull();
    });

    it('rejects weigh-ins dated after the latest local date on Earth', async () => {
      const latest = addDays(new Date().toISOString().slice(0, 10), 1);

      await putWeight(latest, { weightKg: 80 });
      const response = await putWeight(
        addDays(latest, 1),
        { weightKg: 79 },
        400,
      );

      expect(messages(response.body)).toContain(
        'date must not be in the future',
      );
      expect((await storedProfile()).weightKg).toBe(80);
      await expect(prisma.weightLog.count()).resolves.toBe(1);
    });

    it('rounds weight and body fat to 0.1', async () => {
      const response = await putWeight(TO, {
        weightKg: 80.26,
        bodyFatPct: 18.44,
      });
      expect(response.body).toEqual<WeightLogDto>({
        date: TO,
        weightKg: 80.3,
        bodyFatPct: 18.4,
      });
      const row = await prisma.weightLog.findUniqueOrThrow({
        where: { userId_date: { userId, date: TO } },
      });
      expect(row.weightKg).toBe(80.3);
      expect(row.bodyFatPct).toBe(18.4);
      expect((await storedProfile()).weightKg).toBe(80.3);
    });

    it('accepts the body bounds', async () => {
      await putWeight('2026-09-01', { weightKg: 25, bodyFatPct: 3 });
      await putWeight('2026-09-02', { weightKg: 400, bodyFatPct: 70 });
      await putWeight('2026-09-03', { weightKg: 80, bodyFatPct: null });
      await expect(prisma.weightLog.count()).resolves.toBe(3);
    });

    it.each([
      ['a weight below the bounds', { weightKg: 24.9 }],
      ['a weight above the bounds', { weightKg: 400.1 }],
      ['a numeric string', { weightKg: '80' }],
      ['a missing weight', {}],
      ['a null weight', { weightKg: null }],
      ['body fat below the bounds', { weightKg: 80, bodyFatPct: 2.9 }],
      ['body fat above the bounds', { weightKg: 80, bodyFatPct: 70.1 }],
      ['an unknown property', { weightKg: 80, note: 'after gym' }],
    ])('rejects %s with 400', async (_label, body) => {
      await putWeight(TO, body, 400);
      await expect(prisma.weightLog.count()).resolves.toBe(0);
    });

    it.each(['2026-02-30', '2026-9-28', 'today'])(
      'rejects the date %j with 400',
      async (date) => {
        const response = await putWeight(date, { weightKg: 80 }, 400);
        expect(messages(response.body)).toContain(
          'date must be a valid date formatted as YYYY-MM-DD',
        );
      },
    );

    it('creates the profile row when it is missing and syncs weight and body fat', async () => {
      await putWeight(TO, { weightKg: 81.2, bodyFatPct: 19.5 });

      const row = await prisma.profile.findUniqueOrThrow({
        where: { userId },
      });
      expect(row).toMatchObject({ weightKg: 81.2, bodyFatPct: 19.5 });
      expect(row.onboardedAt).toBeNull();
    });

    it('syncs the profile only for the latest weigh-in', async () => {
      await agent.put('/api/profile').send(PROFILE).expect(200);

      await putWeight('2026-09-20', { weightKg: 85 });
      expect(await storedProfile()).toMatchObject({
        weightKg: 85,
        bodyFatPct: 22,
      });

      await putWeight('2026-09-10', { weightKg: 88, bodyFatPct: 25 });
      expect(await storedProfile()).toMatchObject({
        weightKg: 85,
        bodyFatPct: 22,
      });

      await putWeight('2026-09-25', { weightKg: 84.5, bodyFatPct: 21 });
      await putWeight('2026-09-25', { weightKg: 84.2 });
      const profile = await storedProfile();
      expect(profile).toMatchObject({ weightKg: 84.2, bodyFatPct: 21 });
      expect(profile.goal).toBe('cut');
      expect(profile.onboarded).toBe(true);
    });

    it('ends with the latest weigh-in in the profile when weigh-ins are saved concurrently', async () => {
      const dates = eachDate('2026-09-21', TO);
      const shuffled = [3, 7, 0, 5, 1, 6, 2, 4].map((index) => dates[index]!);

      await Promise.all(
        shuffled.map((date) =>
          putWeight(date, { weightKg: 70 + dates.indexOf(date) }),
        ),
      );

      expect((await storedProfile()).weightKg).toBe(77);
      await expect(prisma.weightLog.count()).resolves.toBe(8);
    });

    it('updates targets through the synced weight', async () => {
      await agent
        .put('/api/profile')
        .send({ ...PROFILE, bodyFatPct: null })
        .expect(200);
      const before = (await agent.get('/api/profile').expect(200))
        .body as ProfileResponse;

      await putWeight(TO, { weightKg: 80 });

      const after = (await agent.get('/api/profile').expect(200))
        .body as ProfileResponse;
      expect(after.targets.bmr).toBe((before.targets.bmr ?? 0) - 100);
      expect(after.body.bmi).toBe(24.7);
    });

    it('keeps other users weigh-ins separate', async () => {
      await seedStrangerWeight(TO, 55);

      await putWeight(TO, { weightKg: 80 });

      const stranger = await prisma.weightLog.findUniqueOrThrow({
        where: { userId_date: { userId: strangerId, date: TO } },
      });
      expect(stranger.weightKg).toBe(55);
      await expect(
        prisma.profile.findUnique({ where: { userId: strangerId } }),
      ).resolves.toBeNull();
    });
  });

  describe('DELETE /api/weights/:date', () => {
    it('falls back to the previous weigh-in when the latest one is deleted', async () => {
      await agent.put('/api/profile').send(PROFILE).expect(200);
      await putWeight('2026-09-20', { weightKg: 86, bodyFatPct: 21 });
      await putWeight('2026-09-25', { weightKg: 85, bodyFatPct: 20 });

      await agent.delete('/api/weights/2026-09-25').expect(204);

      expect(await storedProfile()).toMatchObject({
        weightKg: 86,
        bodyFatPct: 21,
      });
      await expect(prisma.weightLog.count({ where: { userId } })).resolves.toBe(
        1,
      );
    });

    it('leaves the profile unchanged when an older weigh-in is deleted', async () => {
      await putWeight('2026-09-20', { weightKg: 86 });
      await putWeight('2026-09-25', { weightKg: 85 });

      await agent.delete('/api/weights/2026-09-20').expect(204);

      expect((await storedProfile()).weightKg).toBe(85);
    });

    it('leaves the profile unchanged when the last weigh-in is deleted', async () => {
      await putWeight(TO, { weightKg: 85 });

      await agent.delete(`/api/weights/${TO}`).expect(204);

      expect((await storedProfile()).weightKg).toBe(85);
      await expect(prisma.weightLog.count()).resolves.toBe(0);
    });

    it('returns 404 for a date without a weigh-in, including another user’s', async () => {
      await seedStrangerWeight(TO);

      await agent.delete('/api/weights/2026-09-01').expect(404);
      await agent.delete(`/api/weights/${TO}`).expect(404);

      await expect(
        prisma.weightLog.count({ where: { userId: strangerId } }),
      ).resolves.toBe(1);
    });

    it('rejects an invalid date with 400', async () => {
      await agent.delete('/api/weights/2026-13-01').expect(400);
    });
  });

  describe('GET /api/weights', () => {
    it('returns an empty summary without weigh-ins', async () => {
      const summary = await getSummary('2026-09-26', TO);
      expect(summary).toEqual<WeightSummaryResponse>({
        from: '2026-09-26',
        to: TO,
        logs: [],
        trend: eachDate('2026-09-26', TO).map((date) => ({
          date,
          weightKg: null,
          trendKg: null,
        })),
        latest: null,
        weeklyChangeKg: null,
        adaptiveTdee: null,
      });
    });

    it('returns the logs, trend and weekly change of a three-week series', async () => {
      const start = addDays(TO, -20);
      const series = eachDate(start, TO).map((date, index) => ({
        date,
        weightKg: Math.round((84 - index * 0.05 + (index % 2) * 0.2) * 10) / 10,
      }));
      await prisma.weightLog.createMany({
        data: [
          ...series.map((log) => ({ userId, ...log })),
          { userId, date: addDays(start, -70), weightKg: 120 },
          { userId, date: addDays(TO, 1), weightKg: 60 },
        ],
      });
      await seedStrangerWeight(TO, 40);
      const from = addDays(TO, -6);

      const summary = await getSummary(from, TO);

      expect(summary.from).toBe(from);
      expect(summary.to).toBe(TO);
      expect(summary.logs).toEqual(
        series
          .filter((log) => log.date >= from)
          .map((log) => ({ ...log, bodyFatPct: null })),
      );
      expect(summary.trend).toEqual(weightTrendSeries(series, from, TO));
      expect(summary.trend).toHaveLength(7);
      expect(summary.trend[0]?.trendKg).not.toBe(summary.trend[0]?.weightKg);
      expect(summary.latest).toEqual({
        date: TO,
        weightKg: series.at(-1)?.weightKg,
        bodyFatPct: null,
      });
      expect(summary.weeklyChangeKg).toBe(-0.35);
      expect(summary.adaptiveTdee).toBeNull();
    });

    it('reports the latest weigh-in before the range and no weekly change for sparse data', async () => {
      await putWeight('2026-08-01', { weightKg: 82, bodyFatPct: 20 });
      await putWeight('2026-09-20', { weightKg: 81 });

      const summary = await getSummary('2026-09-21', TO);

      expect(summary.logs).toEqual([]);
      expect(summary.latest).toEqual({
        date: '2026-09-20',
        weightKg: 81,
        bodyFatPct: null,
      });
      expect(summary.trend[0]?.trendKg).toBe(81.9);
      expect(summary.weeklyChangeKg).toBeNull();
    });

    it('measures the adaptive TDEE from 28 days of entries and weigh-ins', async () => {
      const window = eachDate(addDays(TO, -28), addDays(TO, -1));
      for (const [index, date] of window.entries()) {
        await agent
          .post('/api/entries')
          .send(entryBody(date, index % 2 === 0 ? 2300 : 2510))
          .expect(201);
        if (index % 2 === 0) {
          await putWeight(date, { weightKg: 85 - index * 0.05 });
        }
      }
      await agent.post('/api/entries').send(entryBody(TO, 5000)).expect(201);

      const summary = await getSummary(addDays(TO, -27), TO);

      expect(summary.adaptiveTdee).toEqual({
        kcal: 2790,
        windowDays: 28,
        loggedDays: 28,
        weighIns: 14,
        avgIntakeKcal: 2405,
        weightChangeKg: -1.35,
        confidence: 'high',
      });
    });

    it('leaves the adaptive TDEE null when too few days have entries', async () => {
      const window = eachDate(addDays(TO, -28), addDays(TO, -1));
      for (const [index, date] of window.entries()) {
        if (index < 14) {
          await agent
            .post('/api/entries')
            .send(entryBody(date, 2400))
            .expect(201);
        }
        await putWeight(date, { weightKg: 85 - index * 0.1 });
      }

      const summary = await getSummary(addDays(TO, -27), TO);

      expect(summary.weeklyChangeKg).toBe(-0.7);
      expect(summary.adaptiveTdee).toBeNull();
    });

    it('leaves the adaptive TDEE null without weigh-ins', async () => {
      for (const date of eachDate(addDays(TO, -28), addDays(TO, -1))) {
        await agent
          .post('/api/entries')
          .send(entryBody(date, 2400))
          .expect(201);
      }

      const summary = await getSummary(addDays(TO, -27), TO);

      expect(summary.adaptiveTdee).toBeNull();
    });

    it('accepts a 400-day range', async () => {
      const summary = await getSummary(addDays(TO, -399), TO);
      expect(summary.trend).toHaveLength(400);
    });

    it.each([
      ['a missing from', { to: TO }],
      ['a missing to', { from: TO }],
      ['an invalid date', { from: '2026-02-30', to: TO }],
      ['a reversed range', { from: TO, to: '2026-09-27' }],
      ['a range over 400 days', { from: addDays(TO, -400), to: TO }],
      ['an unexpected parameter', { from: TO, to: TO, limit: 5 }],
    ])('rejects %s with 400', async (_label, query) => {
      await agent.get('/api/weights').query(query).expect(400);
    });

    it('explains an overly long range', async () => {
      const response = await agent
        .get('/api/weights')
        .query({ from: addDays(TO, -400), to: TO })
        .expect(400);
      expect(messages(response.body)).toContain(
        'the range from..to must span at most 400 days',
      );
    });
  });
});
