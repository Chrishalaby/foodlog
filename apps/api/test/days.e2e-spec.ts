import { randomUUID } from 'node:crypto';
import type { DayMetaDto } from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  getTestUser,
  resetDatabase,
  sessionCookieFor,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const DATE = '2026-09-28';

describe('days (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
  });

  beforeEach(async () => {
    await prisma.dayMeta.deleteMany();
    await prisma.user.deleteMany({ where: { id: { not: userId } } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function strangerCookie(): Promise<string> {
    const user = await prisma.user.create({
      data: {
        email: `stranger-${randomUUID()}@example.com`,
        passwordHash: 'not-a-real-hash',
      },
      select: { id: true, email: true },
    });
    return sessionCookieFor(app, user.id);
  }

  it('reports a rest day for dates without stored metadata', async () => {
    const response = await agent.get(`/api/days/${DATE}`).expect(200);

    expect(response.body).toEqual<DayMetaDto>({
      date: DATE,
      trainingDay: false,
    });
    await expect(prisma.dayMeta.count()).resolves.toBe(0);
  });

  it('upserts the training flag and reads it back', async () => {
    const created = await agent
      .put(`/api/days/${DATE}`)
      .send({ trainingDay: true })
      .expect(200);
    expect(created.body).toEqual<DayMetaDto>({ date: DATE, trainingDay: true });

    const read = await agent.get(`/api/days/${DATE}`).expect(200);
    expect(read.body).toEqual<DayMetaDto>({ date: DATE, trainingDay: true });

    const updated = await agent
      .put(`/api/days/${DATE}`)
      .send({ trainingDay: false })
      .expect(200);
    expect(updated.body).toEqual<DayMetaDto>({
      date: DATE,
      trainingDay: false,
    });

    await expect(prisma.dayMeta.findMany()).resolves.toEqual([
      expect.objectContaining({ userId, date: DATE, trainingDay: false }),
    ]);
    const other = await agent.get('/api/days/2026-09-29').expect(200);
    expect((other.body as DayMetaDto).trainingDay).toBe(false);
  });

  it('keeps the days of different users separate', async () => {
    const cookie = await strangerCookie();
    await agent
      .put(`/api/days/${DATE}`)
      .send({ trainingDay: true })
      .expect(200);

    const strangerView = await request(app.getHttpServer())
      .get(`/api/days/${DATE}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(strangerView.body).toEqual<DayMetaDto>({
      date: DATE,
      trainingDay: false,
    });

    await request(app.getHttpServer())
      .put(`/api/days/${DATE}`)
      .set('Cookie', cookie)
      .send({ trainingDay: false })
      .expect(200);
    const ownView = await agent.get(`/api/days/${DATE}`).expect(200);
    expect((ownView.body as DayMetaDto).trainingDay).toBe(true);
  });

  it.each(['2026-02-30', '2026-13-01', '2026-9-28', 'today', '20260928'])(
    'rejects the date %s with 400',
    async (date) => {
      await agent.get(`/api/days/${date}`).expect(400);
      await agent
        .put(`/api/days/${date}`)
        .send({ trainingDay: true })
        .expect(400);
    },
  );

  it.each<[string, Record<string, unknown>]>([
    ['a missing flag', {}],
    ['a string flag', { trainingDay: 'true' }],
    ['a numeric flag', { trainingDay: 1 }],
    ['a null flag', { trainingDay: null }],
    ['unknown properties', { trainingDay: true, date: '2026-09-29' }],
  ])('rejects %s with 400', async (_label, body) => {
    await agent.put(`/api/days/${DATE}`).send(body).expect(400);
    await expect(prisma.dayMeta.count()).resolves.toBe(0);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get(`/api/days/${DATE}`).expect(401);
    await request(app.getHttpServer())
      .put(`/api/days/${DATE}`)
      .send({ trainingDay: true })
      .expect(401);
  });
});
