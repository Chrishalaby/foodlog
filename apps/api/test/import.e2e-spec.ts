import {
  type ImportBatchRequest,
  type ImportBatchResponse,
  type ImportEntryInput,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

function entry(overrides: Partial<ImportEntryInput> = {}): ImportEntryInput {
  return {
    name: 'Oatmeal and banana',
    mealType: 'breakfast',
    timestamp: '2025-03-01T07:30:00.000Z',
    localDate: '2025-03-01',
    items: [
      {
        name: 'Oatmeal',
        grams: 240,
        nutrients: {
          ...zeroNutrients(),
          calories: 154,
          protein: 5.4,
          carbs: 27,
          fat: 2.6,
        },
      },
      {
        name: 'Banana',
        grams: 0,
        count: 1,
        unit: 'medium',
        unitPlural: 'mediums',
        nutrients: { ...zeroNutrients(), calories: 105, carbs: 27, sugar: 14 },
      },
    ],
    ...overrides,
  };
}

describe('import (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function send(
    body: ImportBatchRequest,
    status = 200,
  ): Promise<ImportBatchResponse> {
    return (await agent.post('/api/import').send(body).expect(status))
      .body as ImportBatchResponse;
  }

  it('requires a signed-in user', async () => {
    await request(app.getHttpServer())
      .post('/api/import')
      .send({ source: 'csv' })
      .expect(401);
  });

  it('imports meals, weigh-ins, water and training days', async () => {
    const result = await send({
      source: 'cronometer',
      entries: [
        entry(),
        entry({
          name: 'Lunch',
          mealType: 'lunch',
          timestamp: '2025-03-01T12:30:00.000Z',
          items: [
            {
              name: 'Salad',
              grams: 200,
              nutrients: { ...zeroNutrients(), calories: 180 },
            },
          ],
        }),
      ],
      weights: [
        { date: '2025-03-01', weightKg: 82.4 },
        { date: '2025-03-02', weightKg: 82.1, bodyFatPct: 21 },
      ],
      fluids: [
        {
          localDate: '2025-03-01',
          timestamp: '2025-03-01T09:00:00.000Z',
          ml: 500,
          kind: 'water',
        },
      ],
      trainingDays: ['2025-03-01', '2025-03-01'],
    });
    expect(result).toEqual({
      entriesCreated: 2,
      entriesSkipped: 0,
      weightsCreated: 2,
      weightsSkipped: 0,
      fluidsCreated: 1,
      fluidsSkipped: 0,
      trainingDaysSet: 1,
    });

    const list = await agent
      .get('/api/entries')
      .query({ from: '2025-03-01', to: '2025-03-01' })
      .expect(200);
    const imported = list.body.items.find(
      (item: { name: string }) => item.name === 'Oatmeal and banana',
    );
    expect(imported).toMatchObject({
      source: 'import',
      mealType: 'breakfast',
      localDate: '2025-03-01',
    });
    expect(imported.totals.calories).toBe(259);
    expect(imported.items[1]).toMatchObject({
      name: 'Banana',
      count: 1,
      unit: 'medium',
    });

    const profile = await agent.get('/api/profile').expect(200);
    expect(profile.body.profile).toMatchObject({
      weightKg: 82.1,
      bodyFatPct: 21,
    });
    const day = await agent.get('/api/days/2025-03-01').expect(200);
    expect(day.body.trainingDay).toBe(true);
  });

  it('skips what is already in the log when the same file is imported again', async () => {
    const result = await send({
      source: 'cronometer',
      entries: [entry(), entry()],
      weights: [{ date: '2025-03-01', weightKg: 90 }],
      fluids: [
        {
          localDate: '2025-03-01',
          timestamp: '2025-03-01T09:00:00.000Z',
          ml: 500,
          kind: 'water',
        },
      ],
    });
    expect(result).toMatchObject({
      entriesCreated: 0,
      entriesSkipped: 2,
      weightsCreated: 0,
      weightsSkipped: 1,
      fluidsCreated: 0,
      fluidsSkipped: 1,
    });
    const weight = await prisma.weightLog.findFirstOrThrow({
      where: { date: '2025-03-01' },
    });
    expect(weight.weightKg).toBe(82.4);
  });

  it('validates every row', async () => {
    await send({ source: 'excel' as never }, 400);
    await send({ source: 'csv', entries: [entry({ items: [] })] }, 400);
    await send(
      { source: 'csv', entries: [entry({ localDate: '2025-02-30' })] },
      400,
    );
    await send(
      { source: 'csv', weights: [{ date: '2025-03-03', weightKg: 1000 }] },
      400,
    );
    await send(
      {
        source: 'csv',
        fluids: [
          {
            localDate: '2025-03-01',
            timestamp: 'nope',
            ml: 100,
            kind: 'water',
          },
        ],
      },
      400,
    );
    await send({ source: 'csv', trainingDays: ['tomorrow'] }, 400);
    await send(
      { source: 'csv', entries: Array.from({ length: 201 }, () => entry()) },
      400,
    );
  });

  it('accepts an empty batch', async () => {
    expect(await send({ source: 'foodlog' })).toEqual({
      entriesCreated: 0,
      entriesSkipped: 0,
      weightsCreated: 0,
      weightsSkipped: 0,
      fluidsCreated: 0,
      fluidsSkipped: 0,
      trainingDaysSet: 0,
    });
  });
});
