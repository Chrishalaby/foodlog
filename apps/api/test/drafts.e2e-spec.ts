import { randomUUID } from 'node:crypto';
import {
  type AnalyzeResponse,
  API_LIMITS,
  type ApiError,
  type DraftDto,
  type EntryDto,
  type EntryItemInput,
  type EntryListResponse,
  type EntryRawAiResponse,
  type LogDraftRequest,
  type Nutrients,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import request from 'supertest';
import { DRAFT_UPLOAD_THROTTLE } from '../src/drafts/drafts.controller.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const TIMESTAMP = '2026-09-30T12:15:00.000Z';
const LOCAL_DATE = '2026-09-30';

type Role = 'food' | 'label';

interface DraftImage {
  buffer: Buffer;
  role?: Role;
}

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function item(overrides: Partial<EntryItemInput> = {}): EntryItemInput {
  return {
    name: 'Chicken breast',
    grams: 150,
    nutrients: nutrients({ calories: 248, protein: 46.5, fat: 5.4 }),
    confidence: 'high',
    count: null,
    unit: null,
    unitPlural: null,
    productId: null,
    micros: null,
    fluidMl: null,
    ...overrides,
  };
}

function logBody(overrides: Partial<LogDraftRequest> = {}): LogDraftRequest {
  return {
    name: 'Office lunch',
    description: 'chicken and rice',
    mealType: 'lunch',
    timestamp: TIMESTAMP,
    localDate: LOCAL_DATE,
    items: [item()],
    ...overrides,
  };
}

function image(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 120, b: 40 },
    },
  })
    .jpeg()
    .toBuffer();
}

describe('drafts (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let agent: TestAgent;
  let userId: string;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
  });

  beforeEach(async () => {
    await prisma.draft.deleteMany();
    await prisma.entry.deleteMany();
    await prisma.analysis.deleteMany();
    await prisma.photo.deleteMany();
    await prisma.user.deleteMany({ where: { id: { not: userId } } });
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  function postDraft(
    fields: Record<string, string>,
    images: DraftImage[] = [],
    as: TestAgent = agent,
  ): request.Test {
    let call = as.post('/api/drafts');
    const withTime = { timestamp: TIMESTAMP, localDate: LOCAL_DATE, ...fields };
    for (const [key, value] of Object.entries(withTime)) {
      call = call.field(key, value);
    }
    const roles = images.map(({ role }) => role);
    if (roles.length > 0 && roles.every((role) => role !== undefined)) {
      call = call.field('imageRoles', roles.join(','));
    }
    images.forEach(({ buffer }, index) => {
      call = call.attach('images', buffer, {
        filename: `photo-${index}.jpg`,
        contentType: 'image/jpeg',
      });
    });
    return call;
  }

  async function createDraft(
    fields: Record<string, string>,
    images: DraftImage[] = [],
    as: TestAgent = agent,
  ): Promise<DraftDto> {
    return (await postDraft(fields, images, as).expect(201)).body as DraftDto;
  }

  async function listDrafts(as: TestAgent = agent): Promise<DraftDto[]> {
    return (await as.get('/api/drafts').expect(200)).body as DraftDto[];
  }

  async function analyzeDraft(
    draftId: string,
    fields: Record<string, string> = {},
    images: Buffer[] = [],
  ): Promise<AnalyzeResponse> {
    let call = agent
      .post('/api/analyze')
      .field('mode', 'food_photo')
      .field('draftId', draftId);
    for (const [key, value] of Object.entries(fields)) {
      call = call.field(key, value);
    }
    images.forEach((buffer, index) => {
      call = call.attach('images', buffer, `extra-${index}.jpg`);
    });
    return (await call.expect(200)).body as AnalyzeResponse;
  }

  async function photoExists(id: string | undefined): Promise<boolean> {
    return (
      (await prisma.photo.findUnique({ where: { id: id ?? randomUUID() } })) !==
      null
    );
  }

  describe('create', () => {
    it('saves photos with their roles, sized to the vision patch budget', async () => {
      const response = await postDraft(
        {
          mode: 'food_photo',
          name: '  Office lunch ',
          description: 'rice, chicken and a yogurt',
          mealType: 'lunch',
        },
        [
          { buffer: await image(3024, 4032), role: 'food' },
          { buffer: await image(4032, 3024), role: 'label' },
        ],
      ).expect(201);
      const draft = response.body as DraftDto;

      expect(draft).toEqual({
        id: expect.any(String) as string,
        mode: 'food_photo',
        name: 'Office lunch',
        description: 'rice, chicken and a yogurt',
        mealType: 'lunch',
        timestamp: TIMESTAMP,
        localDate: LOCAL_DATE,
        items: null,
        portion: null,
        analysisId: null,
        photos: [
          {
            role: 'food',
            photo: expect.objectContaining({ width: 1344, height: 1792 }),
          },
          {
            role: 'label',
            photo: expect.objectContaining({ width: 1792, height: 1344 }),
          },
        ],
        createdAt: expect.any(String) as string,
        updatedAt: expect.any(String) as string,
      });
      await agent.get(draft.photos[0]!.photo.url).expect(200);
      await agent.get(draft.photos[1]!.photo.thumbUrl).expect(200);
      await expect(
        prisma.draftPhoto.findMany({
          where: { draftId: draft.id },
          orderBy: { position: 'asc' },
          select: { photoId: true, role: true, position: true },
        }),
      ).resolves.toEqual([
        { photoId: draft.photos[0]?.photo.id, role: 'food', position: 0 },
        { photoId: draft.photos[1]?.photo.id, role: 'label', position: 1 },
      ]);
      const label = await prisma.photo.findUniqueOrThrow({
        where: { id: draft.photos[1]!.photo.id },
      });
      const meta = await sharp(await storage.get(label.storageKey)).metadata();
      expect(meta.chromaSubsampling).toBe('4:4:4');
    });

    it('saves a description with items and no photos', async () => {
      const draft = await createDraft({
        mode: 'text',
        description: '  two eggs and toast ',
        mealType: 'breakfast',
        items: JSON.stringify([
          item({
            name: '  Eggs ',
            grams: 100.04,
            nutrients: nutrients({ calories: 143.4, protein: 12.56 }),
            micros: { vitaminD: 2.24, cholesterol: 373.4 },
          }),
          item({
            name: 'Soy milk',
            grams: 250,
            micros: { calcium: 300 },
            fluidMl: 250.2,
          }),
        ]),
      });

      expect(draft).toMatchObject({
        mode: 'text',
        name: null,
        description: 'two eggs and toast',
        mealType: 'breakfast',
        photos: [],
        items: [
          {
            name: 'Eggs',
            grams: 100,
            nutrients: nutrients({ calories: 143, protein: 12.6 }),
            confidence: 'high',
            micros: { vitaminD: 2.2, cholesterol: 373 },
            fluidMl: null,
          },
          {
            name: 'Soy milk',
            micros: { calcium: 300 },
            fluidMl: 250,
          },
        ],
      });
    });

    it('gives photos the default roles of the mode', async () => {
      const food = await createDraft({ mode: 'food_photo' }, [
        { buffer: await image(800, 600) },
        { buffer: await image(800, 600) },
      ]);
      const label = await createDraft({ mode: 'nutrition_label' }, [
        { buffer: await image(800, 600) },
        { buffer: await image(800, 600) },
      ]);
      const text = await createDraft({ mode: 'text' }, [
        { buffer: await image(800, 600) },
      ]);

      expect(food.photos.map(({ role }) => role)).toEqual(['food', 'label']);
      expect(label.photos.map(({ role }) => role)).toEqual(['label', 'label']);
      expect(text).toMatchObject({ mode: 'text', photos: [{ role: 'food' }] });
    });

    it("saves an analysed result with the analysis' photos", async () => {
      const analysis = (
        await agent
          .post('/api/analyze')
          .field('mode', 'food_photo')
          .field('imageRoles', 'food,label')
          .attach('images', await image(1200, 900), 'meal.jpg')
          .attach('images', await image(900, 1200), 'label.jpg')
          .expect(200)
      ).body as AnalyzeResponse;
      const photoCount = await prisma.photo.count();

      const draft = await createDraft({
        mode: 'food_photo',
        name: analysis.result.mealName,
        analysisId: analysis.analysisId,
        items: JSON.stringify(
          analysis.result.items.map(({ name, grams, nutrients: n }) => ({
            name,
            grams,
            nutrients: n,
          })),
        ),
      });

      expect(draft.analysisId).toBe(analysis.analysisId);
      expect(draft.photos).toEqual(analysis.photos);
      expect(draft.items).toHaveLength(analysis.result.items.length);
      expect(await prisma.photo.count()).toBe(photoCount);
    });

    it('rejects an unknown or foreign analysis without storing photos', async () => {
      const stranger = await createSignedInUser(app);
      const foreign = (
        await stranger.agent
          .post('/api/analyze')
          .send({ mode: 'text', description: 'apple' })
          .expect(200)
      ).body as AnalyzeResponse;
      const photoCount = await prisma.photo.count();

      for (const analysisId of [foreign.analysisId, randomUUID()]) {
        const response = await postDraft({ mode: 'food_photo', analysisId }, [
          { buffer: await image(400, 300), role: 'food' },
        ]).expect(404);
        expect((response.body as ApiError).message).toBe('Analysis not found');
      }
      expect(await prisma.photo.count()).toBe(photoCount);
      expect(await prisma.draft.count()).toBe(0);
    });

    it('validates fields and photos without storing anything', async () => {
      const photo = await image(400, 300);
      const cases: [Record<string, string>, DraftImage[], unknown][] = [
        [
          { mode: 'food_photo' },
          [],
          'Add a photo, a name or a description to save a draft',
        ],
        [{ mode: 'menu', description: 'x' }, [], undefined],
        [{ mode: 'text', description: 'x', timestamp: 'today' }, [], undefined],
        [
          { mode: 'text', description: 'x', localDate: '2026-13-01' },
          [],
          undefined,
        ],
        [{ mode: 'text', description: 'x', mealType: 'brunch' }, [], undefined],
        [{ mode: 'text', description: 'x', items: 'not json' }, [], undefined],
        [{ mode: 'text', description: 'x', items: '[]' }, [], undefined],
        [
          {
            mode: 'text',
            description: 'x',
            items: JSON.stringify([{ ...item(), grams: -5 }]),
          },
          [],
          undefined,
        ],
        [{ mode: 'text', description: 'x', extra: '1' }, [], undefined],
        [
          { mode: 'food_photo', imageRoles: 'food,drink' },
          [{ buffer: photo }, { buffer: photo }],
          undefined,
        ],
        [
          { mode: 'food_photo', imageRoles: 'food,label' },
          [{ buffer: photo }],
          undefined,
        ],
        [
          { mode: 'food_photo' },
          [{ buffer: photo }, { buffer: Buffer.from('GIF89a-nope') }],
          'Unsupported image type — upload a JPEG, PNG or WebP photo',
        ],
        [
          { mode: 'food_photo' },
          [
            { buffer: photo },
            { buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00]) },
          ],
          'The uploaded file is not a supported image',
        ],
        [
          { mode: 'food_photo' },
          [photo, photo, photo, photo].map((buffer) => ({ buffer })),
          'Too many files',
        ],
      ];

      for (const [fields, images, message] of cases) {
        const response = await postDraft(fields, images).expect(400);
        if (message !== undefined) {
          expect((response.body as ApiError).message).toBe(message);
        }
      }
      expect(await prisma.photo.count()).toBe(0);
      expect(await prisma.draft.count()).toBe(0);
    });

    it(`keeps at most ${API_LIMITS.draftsMax} drafts per person`, async () => {
      await prisma.draft.createMany({
        data: Array.from({ length: API_LIMITS.draftsMax }, (_, index) => ({
          userId,
          mode: 'text' as const,
          description: `draft ${index}`,
          timestamp: new Date(TIMESTAMP),
          localDate: LOCAL_DATE,
        })),
      });

      const response = await postDraft({ mode: 'food_photo' }, [
        { buffer: await image(400, 300), role: 'food' },
      ]).expect(409);
      expect((response.body as ApiError).message).toBe(
        `You already have ${API_LIMITS.draftsMax} drafts — log or delete some to save a new one`,
      );
      expect(await prisma.photo.count()).toBe(0);

      const stranger = await createSignedInUser(app);
      await createDraft(
        { mode: 'text', description: 'soup' },
        [],
        stranger.agent,
      );
      const [oldest] = await prisma.draft.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        take: 1,
      });
      await agent.delete(`/api/drafts/${oldest?.id}`).expect(204);
      await createDraft({ mode: 'text', description: 'soup' });
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/api/drafts')
        .field('mode', 'text')
        .field('description', 'soup')
        .field('timestamp', TIMESTAMP)
        .field('localDate', LOCAL_DATE)
        .expect(401);
      await request(app.getHttpServer()).get('/api/drafts').expect(401);
    });
  });

  describe('list and update', () => {
    it('lists own drafts, most recently changed first', async () => {
      const first = await createDraft({ mode: 'text', description: 'first' });
      const second = await createDraft({ mode: 'text', description: 'second' });
      const stranger = await createSignedInUser(app);
      await createDraft(
        { mode: 'text', description: 'theirs' },
        [],
        stranger.agent,
      );

      expect((await listDrafts()).map(({ id }) => id)).toEqual([
        second.id,
        first.id,
      ]);

      await agent
        .put(`/api/drafts/${first.id}`)
        .send({ mealType: 'dinner' })
        .expect(200);
      expect((await listDrafts()).map(({ id }) => id)).toEqual([
        first.id,
        second.id,
      ]);
      expect(
        (await listDrafts(stranger.agent)).map(
          ({ description }) => description,
        ),
      ).toEqual(['theirs']);
    });

    it('changes only the fields that are sent and clears nulls', async () => {
      const draft = await createDraft(
        {
          mode: 'food_photo',
          name: 'Lunch',
          description: 'rice',
          mealType: 'lunch',
          items: JSON.stringify([item()]),
        },
        [{ buffer: await image(800, 600), role: 'food' }],
      );

      const renamed = (
        await agent
          .put(`/api/drafts/${draft.id}`)
          .send({
            name: '  Late lunch ',
            timestamp: '2026-09-30T15:40:00+02:00',
          })
          .expect(200)
      ).body as DraftDto;
      expect(renamed).toMatchObject({
        name: 'Late lunch',
        description: 'rice',
        mealType: 'lunch',
        timestamp: '2026-09-30T13:40:00.000Z',
        localDate: LOCAL_DATE,
        items: draft.items,
        photos: draft.photos,
      });

      const cleared = (
        await agent
          .put(`/api/drafts/${draft.id}`)
          .send({ name: '', description: null, mealType: null, items: null })
          .expect(200)
      ).body as DraftDto;
      expect(cleared).toMatchObject({
        name: null,
        description: null,
        mealType: null,
        items: null,
        photos: draft.photos,
      });

      const withItems = (
        await agent
          .put(`/api/drafts/${draft.id}`)
          .send({
            localDate: '2026-10-01',
            items: [item({ name: 'Rice', grams: 180.04 })],
          })
          .expect(200)
      ).body as DraftDto;
      expect(withItems.localDate).toBe('2026-10-01');
      expect(withItems.items).toEqual([item({ name: 'Rice', grams: 180 })]);
    });

    it('rejects invalid updates', async () => {
      const draft = await createDraft({ mode: 'text', description: 'soup' });

      for (const body of [
        { timestamp: null },
        { localDate: null },
        { localDate: '2026-02-30' },
        { mealType: 'brunch' },
        { items: [] },
        { items: [{ name: 'x' }] },
        { analysisId: 'nope' },
        { mode: 'food_photo' },
        { name: 'x'.repeat(API_LIMITS.nameMax + 1) },
      ]) {
        await agent.put(`/api/drafts/${draft.id}`).send(body).expect(400);
      }
      await agent
        .put(`/api/drafts/${draft.id}`)
        .send({ analysisId: randomUUID() })
        .expect(404);
      expect(await listDrafts()).toEqual([draft]);
    });

    it("links an analysis of the draft and adopts the analysis' photos", async () => {
      const draft = await createDraft(
        { mode: 'food_photo', description: 'yogurt bowl' },
        [{ buffer: await image(800, 600), role: 'food' }],
      );
      const analysis = await analyzeDraft(draft.id, { imageRoles: 'label' }, [
        await image(600, 800),
      ]);

      const linked = (
        await agent
          .put(`/api/drafts/${draft.id}`)
          .send({
            analysisId: analysis.analysisId,
            name: analysis.result.mealName,
            items: analysis.result.items.map(
              ({ name, grams, nutrients: n }) => ({
                name,
                grams,
                nutrients: n,
              }),
            ),
          })
          .expect(200)
      ).body as DraftDto;

      expect(linked.analysisId).toBe(analysis.analysisId);
      expect(linked.photos).toEqual(analysis.photos);
      expect(linked.photos[0]).toEqual(draft.photos[0]);
      expect(linked.items).toHaveLength(analysis.result.items.length);

      const unlinked = (
        await agent
          .put(`/api/drafts/${draft.id}`)
          .send({ analysisId: null })
          .expect(200)
      ).body as DraftDto;
      expect(unlinked.analysisId).toBeNull();
      expect(unlinked.photos).toEqual(analysis.photos);
    });

    it('releases draft photos replaced by those of a new analysis', async () => {
      const draft = await createDraft({ mode: 'food_photo' }, [
        { buffer: await image(800, 600), role: 'food' },
      ]);
      const fresh = (
        await agent
          .post('/api/analyze')
          .field('mode', 'food_photo')
          .attach('images', await image(800, 600), 'again.jpg')
          .expect(200)
      ).body as AnalyzeResponse;

      const updated = (
        await agent
          .put(`/api/drafts/${draft.id}`)
          .send({ analysisId: fresh.analysisId })
          .expect(200)
      ).body as DraftDto;

      expect(updated.photos).toEqual(fresh.photos);
      await expect(photoExists(draft.photos[0]?.photo.id)).resolves.toBe(false);
      await expect(photoExists(fresh.photo?.id)).resolves.toBe(true);
    });
  });

  describe('delete', () => {
    it('deletes the draft and the photos nothing else uses', async () => {
      const draft = await createDraft({ mode: 'food_photo' }, [
        { buffer: await image(800, 600), role: 'food' },
        { buffer: await image(800, 600), role: 'label' },
      ]);
      const [food, label] = draft.photos.map(({ photo }) => photo.id);
      const entry = (
        await agent
          .post('/api/entries')
          .send({
            name: 'Kept photo',
            mealType: 'lunch',
            source: 'manual',
            timestamp: TIMESTAMP,
            localDate: LOCAL_DATE,
            items: [item()],
            photoId: food,
          })
          .expect(201)
      ).body as EntryDto;

      await agent.delete(`/api/drafts/${draft.id}`).expect(204);

      expect(await listDrafts()).toEqual([]);
      await expect(photoExists(food)).resolves.toBe(true);
      await expect(photoExists(label)).resolves.toBe(false);
      expect(
        (
          (await agent.get(`/api/entries/${entry.id}`).expect(200))
            .body as EntryDto
        ).photo?.id,
      ).toBe(food);
      await agent.delete(`/api/drafts/${draft.id}`).expect(404);
      await agent.delete('/api/drafts/not-a-uuid').expect(400);
    });
  });

  describe('log', () => {
    it('logs an analysed draft as an entry and deletes the draft', async () => {
      const draft = await createDraft(
        { mode: 'food_photo', description: 'Khoury labneh' },
        [
          { buffer: await image(1200, 900), role: 'food' },
          { buffer: await image(900, 1200), role: 'label' },
        ],
      );
      const analysis = await analyzeDraft(draft.id);
      await agent
        .put(`/api/drafts/${draft.id}`)
        .send({ analysisId: analysis.analysisId })
        .expect(200);
      const before = (
        await agent
          .get('/api/entries')
          .query({ from: LOCAL_DATE, to: LOCAL_DATE })
          .expect(200)
      ).body as EntryListResponse;
      expect(before.items).toEqual([]);

      const response = await agent
        .post(`/api/drafts/${draft.id}/log`)
        .send(
          logBody({
            name: ' Labneh plate ',
            items: [
              item({
                name: 'Labneh',
                grams: 120.06,
                nutrients: nutrients({ calories: 180.4, fat: 14.26 }),
                micros: { calcium: 132, vitaminA: 120 },
              }),
              item({
                name: 'Olive oil',
                grams: 10,
                nutrients: nutrients({ calories: 88.4, fat: 10 }),
              }),
            ],
          }),
        )
        .expect(201);
      const entry = response.body as EntryDto;

      expect(entry).toMatchObject({
        name: 'Labneh plate',
        description: 'chicken and rice',
        mealType: 'lunch',
        source: 'food_photo',
        timestamp: TIMESTAMP,
        localDate: LOCAL_DATE,
        analysisId: analysis.analysisId,
        favoriteId: null,
        productId: null,
        photo: draft.photos[0]?.photo,
        totals: nutrients({ calories: 268, fat: 24.3 }),
      });
      expect(entry.photos).toEqual(draft.photos);
      expect(entry.items.map(({ name, grams }) => [name, grams])).toEqual([
        ['Labneh', 120.1],
        ['Olive oil', 10],
      ]);
      expect(entry.items.map(({ micros }) => micros)).toEqual([
        { calcium: 132, vitaminA: 120 },
        null,
      ]);
      const raw = (
        await agent.get(`/api/entries/${entry.id}/raw-ai`).expect(200)
      ).body as EntryRawAiResponse;
      const stored = await prisma.analysis.findUniqueOrThrow({
        where: { id: analysis.analysisId },
      });
      expect(raw).toEqual({
        entryId: entry.id,
        analysisId: analysis.analysisId,
        rawAiJson: stored.rawResponse,
      });
      expect(raw.rawAiJson).not.toBeNull();
      expect(await listDrafts()).toEqual([]);
      await expect(
        prisma.draftPhoto.count({ where: { draftId: draft.id } }),
      ).resolves.toBe(0);
      await expect(photoExists(draft.photos[1]?.photo.id)).resolves.toBe(true);
      const after = (
        await agent
          .get('/api/entries')
          .query({ from: LOCAL_DATE, to: LOCAL_DATE })
          .expect(200)
      ).body as EntryListResponse;
      expect(after.items.map(({ id }) => id)).toEqual([entry.id]);

      await agent
        .post(`/api/drafts/${draft.id}/log`)
        .send(logBody())
        .expect(404);
      expect(await prisma.entry.count()).toBe(1);
    });

    it('logs a described draft as a text entry without photo or analysis', async () => {
      const draft = await createDraft({ mode: 'text', description: 'soup' });

      const entry = (
        await agent
          .post(`/api/drafts/${draft.id}/log`)
          .send(logBody({ description: null, mealType: 'dinner' }))
          .expect(201)
      ).body as EntryDto;

      expect(entry).toMatchObject({
        source: 'text',
        description: null,
        mealType: 'dinner',
        photo: null,
        analysisId: null,
      });
      const raw = (
        await agent.get(`/api/entries/${entry.id}/raw-ai`).expect(200)
      ).body as EntryRawAiResponse;
      expect(raw.rawAiJson).toBeNull();
    });

    it('logs a draft that was never analysed with every photo and role', async () => {
      const draft = await createDraft({ mode: 'food_photo' }, [
        { buffer: await image(900, 1200), role: 'label' },
        { buffer: await image(1200, 900), role: 'food' },
      ]);
      const [label, food] = draft.photos.map(({ photo }) => photo);

      const entry = (
        await agent
          .post(`/api/drafts/${draft.id}/log`)
          .send(logBody())
          .expect(201)
      ).body as EntryDto;

      expect(entry.analysisId).toBeNull();
      expect(entry.photo).toEqual(food);
      expect(entry.photos).toEqual([
        { photo: label, role: 'label' },
        { photo: food, role: 'food' },
      ]);
      await expect(photoExists(label?.id)).resolves.toBe(true);
      await agent.get(label!.url).expect(200);
    });

    it('uses the source of the analysis and keeps every draft photo on the entry', async () => {
      const draft = await createDraft({ mode: 'text', description: 'burger' }, [
        { buffer: await image(800, 600), role: 'food' },
        { buffer: await image(600, 800), role: 'label' },
      ]);
      const [food, label] = draft.photos.map(({ photo }) => photo.id);
      const analysis = (
        await agent
          .post('/api/analyze')
          .field('mode', 'text')
          .field('draftId', draft.id)
          .expect(200)
      ).body as AnalyzeResponse;
      expect(analysis.mode).toBe('food_photo');
      const linked = (
        await agent
          .put(`/api/drafts/${draft.id}`)
          .send({ analysisId: analysis.analysisId })
          .expect(200)
      ).body as DraftDto;
      expect(linked).toMatchObject({
        mode: 'food_photo',
        analysisId: analysis.analysisId,
      });
      expect((await listDrafts())[0]?.mode).toBe('food_photo');
      await prisma.analysisPhoto.deleteMany({
        where: { analysisId: analysis.analysisId, photoId: label },
      });

      const entry = (
        await agent
          .post(`/api/drafts/${draft.id}/log`)
          .send(logBody())
          .expect(201)
      ).body as EntryDto;

      expect(entry.source).toBe('food_photo');
      expect(entry.photo?.id).toBe(food);
      expect(entry.photos.map(({ photo, role }) => [photo.id, role])).toEqual([
        [food, 'food'],
        [label, 'label'],
      ]);
      await expect(photoExists(food)).resolves.toBe(true);
      await expect(photoExists(label)).resolves.toBe(true);

      await agent.delete(`/api/entries/${entry.id}`).expect(204);

      await expect(photoExists(food)).resolves.toBe(true);
      await expect(photoExists(label)).resolves.toBe(false);
    });

    it('validates the entry and keeps the draft when logging fails', async () => {
      const draft = await createDraft({ mode: 'text', description: 'soup' });

      for (const body of [
        logBody({ items: [] }),
        logBody({ name: '   ' }),
        logBody({ localDate: 'yesterday' }),
        { ...logBody(), source: 'manual' },
      ]) {
        await agent.post(`/api/drafts/${draft.id}/log`).send(body).expect(400);
      }
      await agent
        .post(`/api/drafts/${randomUUID()}/log`)
        .send(logBody())
        .expect(404);
      expect(await listDrafts()).toEqual([draft]);
      expect(await prisma.entry.count()).toBe(0);
    });
  });

  describe('ownership', () => {
    it("returns 404 for another person's drafts", async () => {
      const mine = await createDraft({ mode: 'food_photo' }, [
        { buffer: await image(800, 600), role: 'food' },
      ]);
      const stranger = await createSignedInUser(app);
      const theirAnalysis = (
        await stranger.agent
          .post('/api/analyze')
          .send({ mode: 'text', description: 'apple' })
          .expect(200)
      ).body as AnalyzeResponse;

      await stranger.agent
        .put(`/api/drafts/${mine.id}`)
        .send({ name: 'mine now' })
        .expect(404);
      await stranger.agent
        .post(`/api/drafts/${mine.id}/log`)
        .send(logBody())
        .expect(404);
      await stranger.agent.delete(`/api/drafts/${mine.id}`).expect(404);
      await stranger.agent
        .post('/api/analyze')
        .field('mode', 'food_photo')
        .field('draftId', mine.id)
        .expect(404);
      await agent
        .put(`/api/drafts/${mine.id}`)
        .send({ analysisId: theirAnalysis.analysisId })
        .expect(404);
      await stranger.agent.get(mine.photos[0]!.photo.url).expect(404);

      expect(await listDrafts()).toEqual([mine]);
      expect(await listDrafts(stranger.agent)).toEqual([]);
      expect(await prisma.entry.count()).toBe(0);
    });
  });
});

describe('draft upload throttling (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ throttling: true });
    await resetDatabase(app.get(PrismaService));
  });

  afterAll(async () => {
    await resetDatabase(app.get(PrismaService));
    await app.close();
  });

  it(`allows ${DRAFT_UPLOAD_THROTTLE.long.limit} new drafts per minute per client`, async () => {
    const agent = await setupAndLogin(app);
    const create = (): request.Test =>
      agent
        .post('/api/drafts')
        .field('mode', 'text')
        .field('description', 'soup')
        .field('timestamp', TIMESTAMP)
        .field('localDate', LOCAL_DATE);

    const first = await create().expect(201);
    const second = await create().expect(201);
    const listing = await agent.get('/api/drafts').expect(200);

    const limit = String(DRAFT_UPLOAD_THROTTLE.long.limit);
    expect(first.headers['x-ratelimit-limit-long']).toBe(limit);
    expect(first.headers['x-ratelimit-remaining-long']).toBe(
      String(DRAFT_UPLOAD_THROTTLE.long.limit - 1),
    );
    expect(second.headers['x-ratelimit-remaining-long']).toBe(
      String(DRAFT_UPLOAD_THROTTLE.long.limit - 2),
    );
    expect(listing.headers['x-ratelimit-limit-long']).toBe('600');
  });
});
