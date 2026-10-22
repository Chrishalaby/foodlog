import { randomUUID } from 'node:crypto';
import {
  type CreateEntryRequest,
  type CreateFluidLogRequest,
  type DayDashboardResponse,
  type EntryItemInput,
  type FluidDayResponse,
  type FluidLogDto,
  type ProfileDto,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const DATE = '2026-10-01';
const NEXT_DATE = '2026-10-02';

const PROFILE: ProfileDto = {
  weightKg: 80,
  heightCm: 180,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  goal: 'maintain',
  trainingDaysPerWeek: 4,
  targetOverrides: {},
  location: 'Beirut',
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'high',
  theme: 'dark',
};

function fluid(
  overrides: Partial<CreateFluidLogRequest> = {},
): CreateFluidLogRequest {
  return {
    ml: 250,
    kind: 'water',
    timestamp: '2026-10-01T09:00:00.000+03:00',
    localDate: DATE,
    ...overrides,
  };
}

function item(
  name: string,
  grams: number,
  calories: number,
  fluidMl: number | null = null,
): EntryItemInput {
  return {
    name,
    grams,
    nutrients: { ...zeroNutrients(), calories },
    confidence: 'medium',
    fluidMl,
  };
}

function meal(
  name: string,
  items: EntryItemInput[],
  timestamp: string,
  localDate = DATE,
): CreateEntryRequest {
  return {
    name,
    mealType: 'lunch',
    source: 'text',
    timestamp,
    localDate,
    items,
  };
}

describe('fluids (e2e)', () => {
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
    await prisma.entry.deleteMany();
    await prisma.fluidLog.deleteMany();
    await prisma.dayMeta.deleteMany();
    await prisma.profile.deleteMany();
    await prisma.user.deleteMany({ where: { id: { not: userId } } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function addFluid(
    body: CreateFluidLogRequest,
    as: TestAgent = agent,
  ): Promise<FluidLogDto> {
    return (await as.post('/api/fluids').send(body).expect(201))
      .body as FluidLogDto;
  }

  async function fluidDay(
    date: string,
    as: TestAgent = agent,
  ): Promise<FluidDayResponse> {
    return (await as.get('/api/fluids').query({ date }).expect(200))
      .body as FluidDayResponse;
  }

  async function logMeal(body: CreateEntryRequest): Promise<string> {
    const response = await agent.post('/api/entries').send(body).expect(201);
    return (response.body as { id: string }).id;
  }

  it('requires authentication', async () => {
    const server = app.getHttpServer();
    const id = randomUUID();
    await request(server).get('/api/fluids').query({ date: DATE }).expect(401);
    await request(server).post('/api/fluids').send(fluid()).expect(401);
    await request(server)
      .put(`/api/fluids/${id}`)
      .send({ ml: 500 })
      .expect(401);
    await request(server).delete(`/api/fluids/${id}`).expect(401);
  });

  it('returns an empty day with the automatic target', async () => {
    await expect(fluidDay(DATE)).resolves.toEqual({
      date: DATE,
      targetMl: 2500,
      totalMl: 0,
      logsMl: 0,
      foodMl: 0,
      caffeineMg: 0,
      logs: [],
      drinks: [],
    });
  });

  it('adds water logs to a Diet Pepsi inside a meal and counts caffeine from coffee', async () => {
    await agent.put('/api/profile').send(PROFILE).expect(200);
    const burger = await logMeal(
      meal(
        'Chicken burger meal',
        [item('Chicken burger', 250, 560), item('Diet Pepsi', 330, 1, 330)],
        '2026-10-01T13:30:00.000+03:00',
      ),
    );
    await logMeal(
      meal(
        'Lentil soup',
        [item('Lentil soup', 300, 270)],
        '2026-10-01T19:00:00.000+03:00',
      ),
    );
    const morning = await addFluid(
      fluid({ timestamp: '2026-10-01T08:00:00.000+03:00' }),
    );
    const afternoon = await addFluid(
      fluid({ timestamp: '2026-10-01T16:00:00.000+03:00' }),
    );

    const day = await fluidDay(DATE);

    expect(day).toMatchObject({
      date: DATE,
      targetMl: 2800,
      logsMl: 500,
      foodMl: 330,
      totalMl: 830,
      caffeineMg: 0,
    });
    expect(day.logs).toEqual([morning, afternoon]);
    expect(day.drinks).toEqual([
      {
        entryId: burger,
        itemId: expect.any(String) as string,
        entryName: 'Chicken burger meal',
        name: 'Diet Pepsi',
        ml: 330,
        timestamp: '2026-10-01T10:30:00.000Z',
      },
    ]);

    await addFluid(
      fluid({
        ml: 200,
        kind: 'coffee',
        timestamp: '2026-10-01T07:00:00.000+03:00',
      }),
    );
    const withCoffee = await fluidDay(DATE);
    expect(withCoffee).toMatchObject({
      totalMl: 1030,
      logsMl: 700,
      caffeineMg: 80,
    });
    expect(withCoffee.logs.map(({ kind }) => kind)).toEqual([
      'coffee',
      'water',
      'water',
    ]);

    const dashboard = (
      await agent.get('/api/dashboard/day').query({ date: DATE }).expect(200)
    ).body as DayDashboardResponse;
    expect(dashboard.day).toMatchObject({
      fluidsMl: 1030,
      fluidTargetMl: 2800,
      micros: { caffeine: 80 },
    });
  });

  it('uses the training-day bonus and a custom target', async () => {
    await agent.put('/api/profile').send(PROFILE).expect(200);
    await agent
      .put(`/api/days/${DATE}`)
      .send({ trainingDay: true })
      .expect(200);

    await expect(fluidDay(DATE)).resolves.toMatchObject({ targetMl: 3300 });

    await agent
      .put('/api/profile')
      .send({ ...PROFILE, fluidTargetMl: 3000 })
      .expect(200);
    await expect(fluidDay(DATE)).resolves.toMatchObject({ targetMl: 3000 });
  });

  it('keeps a late-night drink and apple on the day the client chose', async () => {
    await addFluid(
      fluid({ ml: 330, timestamp: '2026-10-02T00:56:00.000+03:00' }),
    );
    await logMeal(
      meal(
        'Red apple',
        [item('Red apple', 182, 95)],
        '2026-10-02T00:56:00.000+03:00',
        DATE,
      ),
    );

    const evening = await fluidDay(DATE);
    expect(evening).toMatchObject({ totalMl: 330 });
    expect(evening.logs[0]).toMatchObject({
      localDate: DATE,
      timestamp: '2026-10-01T21:56:00.000Z',
    });
    await expect(fluidDay(NEXT_DATE)).resolves.toMatchObject({
      totalMl: 0,
      logs: [],
    });
    const dashboard = (
      await agent.get('/api/dashboard/day').query({ date: DATE }).expect(200)
    ).body as DayDashboardResponse;
    expect(dashboard.day).toMatchObject({
      entryCount: 1,
      fluidsMl: 330,
      totals: { calories: 95 },
    });
  });

  it('rounds to whole millilitres and returns the stored log', async () => {
    const created = await addFluid(fluid({ ml: 330.4, kind: 'other' }));

    expect(created).toEqual({
      id: expect.any(String) as string,
      localDate: DATE,
      timestamp: '2026-10-01T06:00:00.000Z',
      ml: 330,
      kind: 'other',
      createdAt: expect.any(String) as string,
    });
    await expect(
      prisma.fluidLog.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({ userId, ml: 330, kind: 'other' });
  });

  it('changes only the fields that are sent', async () => {
    const created = await addFluid(fluid());

    const updated = (
      await agent
        .put(`/api/fluids/${created.id}`)
        .send({ ml: 500, kind: 'tea' })
        .expect(200)
    ).body as FluidLogDto;
    expect(updated).toEqual({ ...created, ml: 500, kind: 'tea' });

    const moved = (
      await agent
        .put(`/api/fluids/${created.id}`)
        .send({
          timestamp: '2026-10-02T09:00:00.000+03:00',
          localDate: NEXT_DATE,
        })
        .expect(200)
    ).body as FluidLogDto;
    expect(moved).toMatchObject({
      ml: 500,
      kind: 'tea',
      localDate: NEXT_DATE,
      timestamp: '2026-10-02T06:00:00.000Z',
    });

    const unchanged = (
      await agent.put(`/api/fluids/${created.id}`).send({}).expect(200)
    ).body as FluidLogDto;
    expect(unchanged).toEqual(moved);
    await expect(fluidDay(DATE)).resolves.toMatchObject({ logs: [] });
    await expect(fluidDay(NEXT_DATE)).resolves.toMatchObject({
      totalMl: 500,
      caffeineMg: 100,
    });
  });

  it('deletes a log once', async () => {
    const created = await addFluid(fluid());

    await agent.delete(`/api/fluids/${created.id}`).expect(204);
    await agent.delete(`/api/fluids/${created.id}`).expect(404);
    await agent.put(`/api/fluids/${created.id}`).send({ ml: 300 }).expect(404);
    await expect(prisma.fluidLog.count()).resolves.toBe(0);
  });

  it('keeps every user’s fluids private', async () => {
    const mine = await addFluid(fluid());
    await logMeal(
      meal(
        'Lunch',
        [item('Diet Pepsi', 330, 1, 330)],
        '2026-10-01T13:00:00.000+03:00',
      ),
    );
    const stranger = await createSignedInUser(app);
    const theirs = await addFluid(fluid({ ml: 750 }), stranger.agent);

    await expect(fluidDay(DATE, stranger.agent)).resolves.toMatchObject({
      totalMl: 750,
      foodMl: 0,
      logs: [theirs],
      drinks: [],
    });
    await stranger.agent
      .put(`/api/fluids/${mine.id}`)
      .send({ ml: 3000 })
      .expect(404);
    await stranger.agent.delete(`/api/fluids/${mine.id}`).expect(404);
    await expect(fluidDay(DATE)).resolves.toMatchObject({
      totalMl: 580,
      logs: [mine],
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ['too little', { ml: 9 }],
    ['too much', { ml: 3001 }],
    ['a text amount', { ml: '250' }],
    ['an unknown kind', { kind: 'juice' }],
    ['a timestamp without a zone', { timestamp: '2026-10-01T09:00:00' }],
    ['an impossible local date', { localDate: '2026-02-30' }],
    ['an unknown property', { userId: randomUUID() }],
  ])('rejects a log with %s', async (_label, patch) => {
    await agent
      .post('/api/fluids')
      .send({ ...fluid(), ...patch })
      .expect(400);
    await expect(prisma.fluidLog.count()).resolves.toBe(0);
  });

  it('rejects incomplete logs and invalid changes', async () => {
    const { localDate: _localDate, ...withoutDate } = fluid();
    await agent.post('/api/fluids').send(withoutDate).expect(400);
    const created = await addFluid(fluid());

    for (const body of [
      { ml: null },
      { ml: 5000 },
      { kind: 'beer' },
      { localDate: 'yesterday' },
      { id: randomUUID() },
    ]) {
      await agent.put(`/api/fluids/${created.id}`).send(body).expect(400);
    }
    await agent.put('/api/fluids/not-a-uuid').send({ ml: 300 }).expect(400);
    await agent.delete('/api/fluids/not-a-uuid').expect(400);
    await agent
      .put(`/api/fluids/${randomUUID()}`)
      .send({ ml: 300 })
      .expect(404);
    await expect(
      prisma.fluidLog.findUniqueOrThrow({ where: { id: created.id } }),
    ).resolves.toMatchObject({ ml: 250, kind: 'water' });
  });

  it.each([
    ['a missing date', {}],
    ['an impossible date', { date: '2026-02-30' }],
    ['a malformed date', { date: '1.10.2026' }],
    ['an unexpected parameter', { date: DATE, userId: 'x' }],
  ])('rejects a day request with %s', async (_label, query) => {
    await agent.get('/api/fluids').query(query).expect(400);
  });
});
