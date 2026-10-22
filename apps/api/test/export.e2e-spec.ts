import { randomUUID } from 'node:crypto';
import {
  type EntryDto,
  type EntryItemInput,
  type FavoriteDto,
  type FluidLogDto,
  type MealType,
  type NoteDto,
  type Nutrients,
  type ProfileDto,
  type WeightLogDto,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  entryItemData,
  favoriteItemsJson,
  normalizeItems,
} from '../src/common/items.js';
import { nutrientColumns } from '../src/common/mappers.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const CSV_HEADER =
  'date,time,meal_type,entry_name,item_name,grams,calories,protein_g,carbs_g,fat_g,sat_fat_g,fiber_g,sugar_g,sodium_mg,alcohol_g,confidence,source,description,entry_id';

const PROFILE: ProfileDto = {
  weightKg: 70,
  heightCm: 172,
  age: 41,
  sex: 'female',
  bodyFatPct: 27.5,
  tdeeOverride: 2100,
  onboarded: true,
  activityLevel: 'light',
  goal: 'cut',
  trainingDaysPerWeek: 2,
  targetOverrides: { protein: 140 },
  location: 'Vienna',
  aiModel: null,
  aiDetailFood: 'high',
  aiDetailLabel: 'low',
  theme: 'dark',
  dayStartHour: 2,
  fluidTargetMl: 3000,
};

interface ExportDocumentBody {
  exportedAt: string;
  profile: ProfileDto;
  entries: EntryDto[];
  favorites: FavoriteDto[];
  days: { date: string; trainingDay: boolean }[];
  weights: WeightLogDto[];
  fluids: FluidLogDto[];
  notes: NoteDto[];
}

function item(
  name: string,
  grams: number,
  nutrients: Partial<Nutrients>,
): EntryItemInput {
  return {
    name,
    grams,
    nutrients: { ...zeroNutrients(), ...nutrients },
    confidence: 'high',
  };
}

function binaryParser(
  response: request.Response,
  callback: (error: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
}

function exportDates(before: Date, after: Date): string[] {
  return [before, after].map((date) => date.toISOString().slice(0, 10));
}

describe('export (e2e)', () => {
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
    await prisma.entry.deleteMany();
    await prisma.favorite.deleteMany();
    await prisma.dayMeta.deleteMany();
    await prisma.weightLog.deleteMany();
    await prisma.fluidLog.deleteMany();
    await prisma.note.deleteMany();
    await prisma.photo.deleteMany();
    await prisma.profile.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function createEntry(options: {
    name: string;
    localDate: string;
    timestamp: string;
    mealType?: MealType;
    description?: string | null;
    items: EntryItemInput[];
    owner?: string;
    photoId?: string;
  }): Promise<string> {
    const { items, totals } = normalizeItems(options.items);
    const entry = await prisma.entry.create({
      data: {
        userId: options.owner ?? userId,
        name: options.name,
        description: options.description ?? null,
        mealType: options.mealType ?? 'lunch',
        source: 'food_photo',
        timestamp: new Date(options.timestamp),
        localDate: options.localDate,
        photoId: options.photoId ?? null,
        ...nutrientColumns(totals),
        items: { createMany: { data: items.map(entryItemData) } },
      },
    });
    return entry.id;
  }

  async function createFavorite(
    name: string,
    items: EntryItemInput[],
    owner = userId,
  ): Promise<string> {
    const normalized = normalizeItems(items);
    const favorite = await prisma.favorite.create({
      data: {
        userId: owner,
        name,
        mealType: 'breakfast',
        items: favoriteItemsJson(normalized.items),
        ...nutrientColumns(normalized.totals),
        useCount: 3,
      },
    });
    return favorite.id;
  }

  async function seed(): Promise<{ lunchId: string; breakfastId: string }> {
    await agent.put('/api/profile').send(PROFILE).expect(200);
    const photo = await prisma.photo.create({
      data: {
        userId,
        storageKey: 'photos/export-test.jpg',
        thumbKey: 'photos/export-test_thumb.webp',
        width: 1024,
        height: 768,
        bytes: 1000,
      },
    });
    const lunchId = await createEntry({
      name: 'Chili, "extra hot"',
      localDate: '2026-09-27',
      timestamp: '2026-09-27T12:30:00.000Z',
      description: 'Leftovers\nfrom Sunday',
      photoId: photo.id,
      items: [
        item('Beans, kidney', 150, { calories: 190.5, protein: 12.9 }),
        item('=HYPERLINK("http://evil")', 10, { calories: 5 }),
      ],
    });
    const breakfastId = await createEntry({
      name: 'Porridge',
      localDate: '2026-09-27',
      timestamp: '2026-09-27T07:05:00.000Z',
      mealType: 'breakfast',
      items: [item('Oats', 60, { calories: 233, fiber: 6, sodium: 2 })],
    });
    await createEntry({
      name: 'Not mine',
      localDate: '2026-09-27',
      timestamp: '2026-09-27T08:00:00.000Z',
      owner: strangerId,
      items: [item('Secret', 1, { calories: 1 })],
    });
    await createFavorite('Usual breakfast', [
      item('Oats', 60, { calories: 233 }),
      item('Blueberries', 80, { calories: 46, sugar: 8 }),
    ]);
    await createFavorite('Stranger fav', [item('X', 1, {})], strangerId);
    await prisma.dayMeta.createMany({
      data: [
        { userId, date: '2026-09-27', trainingDay: true },
        { userId, date: '2026-09-26', trainingDay: false },
        { userId: strangerId, date: '2026-09-25', trainingDay: true },
      ],
    });
    await prisma.weightLog.createMany({
      data: [
        { userId, date: '2026-09-27', weightKg: 69.4, bodyFatPct: 27.1 },
        { userId, date: '2026-09-20', weightKg: 70.2 },
        { userId: strangerId, date: '2026-09-24', weightKg: 99 },
      ],
    });
    await prisma.fluidLog.createMany({
      data: [
        {
          userId,
          localDate: '2026-09-27',
          timestamp: new Date('2026-09-27T21:56:00.000Z'),
          ml: 330,
          kind: 'other',
        },
        {
          userId,
          localDate: '2026-09-27',
          timestamp: new Date('2026-09-27T06:30:00.000Z'),
          ml: 200,
          kind: 'coffee',
        },
        {
          userId: strangerId,
          localDate: '2026-09-27',
          timestamp: new Date('2026-09-27T10:00:00.000Z'),
          ml: 999,
          kind: 'water',
        },
      ],
    });
    await prisma.note.create({
      data: {
        userId,
        text: 'Buy mirror',
        done: true,
        doneAt: new Date('2026-09-27T18:00:00.000Z'),
        createdAt: new Date('2026-09-26T09:00:00.000Z'),
      },
    });
    await prisma.note.create({
      data: {
        userId,
        text: 'Install this for the bathroom',
        createdAt: new Date('2026-09-25T09:00:00.000Z'),
        photos: { create: { photoId: photo.id, position: 0 } },
      },
    });
    await prisma.note.create({
      data: { userId: strangerId, text: 'Not my note' },
    });
    return { lunchId, breakfastId };
  }

  it('requires authentication', async () => {
    await request(app.getHttpServer()).get('/api/export').expect(401);
  });

  it('exports everything as a JSON attachment', async () => {
    const { lunchId, breakfastId } = await seed();
    const before = new Date();
    const response = await agent
      .get('/api/export')
      .query({ format: 'json' })
      .expect(200);
    const after = new Date();

    expect(response.headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(response.headers['cache-control']).toBe('no-store');
    const disposition = response.headers['content-disposition'];
    expect(
      exportDates(before, after).map(
        (date) => `attachment; filename="foodlog-export-${date}.json"`,
      ),
    ).toContain(disposition);

    const body = response.body as ExportDocumentBody;
    const exportedAt = Date.parse(body.exportedAt);
    expect(exportedAt).toBeGreaterThanOrEqual(before.getTime());
    expect(exportedAt).toBeLessThanOrEqual(after.getTime());
    expect(body.profile).toEqual(PROFILE);
    expect(body.entries.map((entry) => entry.id)).toEqual([
      breakfastId,
      lunchId,
    ]);
    const lunch = body.entries[1]!;
    expect(lunch).toMatchObject({
      name: 'Chili, "extra hot"',
      description: 'Leftovers\nfrom Sunday',
      localDate: '2026-09-27',
      timestamp: '2026-09-27T12:30:00.000Z',
      totals: { calories: 196, protein: 12.9 },
      photo: { width: 1024, height: 768 },
    });
    expect(lunch.photo?.url).toBe(`/api/photos/${lunch.photo?.id}`);
    expect(lunch.items.map((entryItem) => entryItem.name)).toEqual([
      'Beans, kidney',
      '=HYPERLINK("http://evil")',
    ]);
    expect(body.favorites).toHaveLength(1);
    expect(body.favorites[0]).toMatchObject({
      name: 'Usual breakfast',
      useCount: 3,
      totals: { calories: 279, sugar: 8 },
    });
    expect(body.favorites[0]?.items).toHaveLength(2);
    expect(body.days).toEqual([
      { date: '2026-09-26', trainingDay: false },
      { date: '2026-09-27', trainingDay: true },
    ]);
    expect(body.weights).toEqual([
      { date: '2026-09-20', weightKg: 70.2, bodyFatPct: null },
      { date: '2026-09-27', weightKg: 69.4, bodyFatPct: 27.1 },
    ]);
    expect(body.fluids).toEqual([
      {
        id: expect.any(String) as string,
        localDate: '2026-09-27',
        timestamp: '2026-09-27T06:30:00.000Z',
        ml: 200,
        kind: 'coffee',
        createdAt: expect.any(String) as string,
      },
      {
        id: expect.any(String) as string,
        localDate: '2026-09-27',
        timestamp: '2026-09-27T21:56:00.000Z',
        ml: 330,
        kind: 'other',
        createdAt: expect.any(String) as string,
      },
    ]);
    expect(body.notes).toEqual([
      {
        id: expect.any(String) as string,
        text: 'Install this for the bathroom',
        photos: [lunch.photo],
        done: false,
        doneAt: null,
        createdAt: '2026-09-25T09:00:00.000Z',
        updatedAt: expect.any(String) as string,
      },
      {
        id: expect.any(String) as string,
        text: 'Buy mirror',
        photos: [],
        done: true,
        doneAt: '2026-09-27T18:00:00.000Z',
        createdAt: '2026-09-26T09:00:00.000Z',
        updatedAt: expect.any(String) as string,
      },
    ]);
  });

  it('defaults to JSON and exports an empty account', async () => {
    const response = await agent.get('/api/export').expect(200);
    expect(response.headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    const body = response.body as ExportDocumentBody;
    expect(body.entries).toEqual([]);
    expect(body.favorites).toEqual([]);
    expect(body.days).toEqual([]);
    expect(body.weights).toEqual([]);
    expect(body.fluids).toEqual([]);
    expect(body.notes).toEqual([]);
    expect(body.profile).toMatchObject({
      activityLevel: 'moderate',
      bodyFatPct: null,
      tdeeOverride: null,
      onboarded: false,
      dayStartHour: 3,
      fluidTargetMl: null,
    });
  });

  it('exports one CSV row per item with BOM, CRLF, quoting and formula guards', async () => {
    const { lunchId, breakfastId } = await seed();
    const before = new Date();
    const response = await agent
      .get('/api/export')
      .query({ format: 'csv' })
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const after = new Date();

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      exportDates(before, after).map(
        (date) => `attachment; filename="foodlog-export-${date}.csv"`,
      ),
    ).toContain(response.headers['content-disposition']);

    const bytes = response.body as Buffer;
    expect(bytes.subarray(0, 3).equals(UTF8_BOM)).toBe(true);
    const text = bytes.subarray(3).toString('utf8');
    expect(text.endsWith('\r\n')).toBe(true);

    expect(text).toBe(
      [
        CSV_HEADER,
        `2026-09-27,2026-09-27T07:05:00.000Z,breakfast,Porridge,Oats,60,233,0,0,0,0,6,0,2,0,high,food_photo,,${breakfastId}`,
        `2026-09-27,2026-09-27T12:30:00.000Z,lunch,"Chili, ""extra hot""","Beans, kidney",150,191,12.9,0,0,0,0,0,0,0,high,food_photo,"Leftovers\nfrom Sunday",${lunchId}`,
        `2026-09-27,2026-09-27T12:30:00.000Z,lunch,"Chili, ""extra hot""","'=HYPERLINK(""http://evil"")",10,5,0,0,0,0,0,0,0,0,high,food_photo,"Leftovers\nfrom Sunday",${lunchId}`,
        '',
      ].join('\r\n'),
    );
    expect(text).not.toContain('Buy mirror');
  });

  it('exports only the header for an empty account', async () => {
    const response = await agent
      .get('/api/export?format=csv')
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    const bytes = response.body as Buffer;
    expect(bytes.subarray(3).toString('utf8')).toBe(`${CSV_HEADER}\r\n`);
  });

  it.each(['xml', 'CSV', ''])('rejects format=%j with 400', async (format) => {
    await agent.get('/api/export').query({ format }).expect(400);
  });
});
