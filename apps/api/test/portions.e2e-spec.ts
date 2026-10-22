import {
  type AnalysisResult,
  type AnalyzeResponse,
  type DraftDto,
  type EntryDto,
  type EntryItemInput,
  type FavoriteDto,
  type FoodSearchResponse,
  type Nutrients,
  type Portion,
  type QuickLogRequest,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const YESTERDAY = {
  timestamp: '2026-09-29T19:30:00.000Z',
  localDate: '2026-09-29',
};
const TODAY = {
  timestamp: '2026-09-30T19:30:00.000Z',
  localDate: '2026-09-30',
};
const BURGERS: Portion = { count: 2, unit: 'burger', unitPlural: 'burgers' };

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function toItemInput(item: AnalysisResult['items'][number]): EntryItemInput {
  return {
    name: item.name,
    grams: item.grams,
    nutrients: item.nutrients,
    confidence: item.confidence,
    count: item.count,
    unit: item.unit,
    unitPlural: item.unitPlural,
  };
}

function plainItem(name: string, grams: number, calories: number) {
  return { name, grams, nutrients: nutrients({ calories }) };
}

describe('portions (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
  });

  beforeEach(async () => {
    await prisma.draft.deleteMany();
    await prisma.entry.deleteMany();
    await prisma.favorite.deleteMany();
    await prisma.analysis.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function analyzeText(description: string): Promise<AnalyzeResponse> {
    const response = await agent
      .post('/api/analyze')
      .field('mode', 'text')
      .field('description', description)
      .expect(200);
    return response.body as AnalyzeResponse;
  }

  async function logAnalysis(analysis: AnalyzeResponse): Promise<EntryDto> {
    const response = await agent
      .post('/api/entries')
      .send({
        name: analysis.result.mealName,
        mealType: 'dinner',
        source: 'text',
        ...YESTERDAY,
        items: analysis.result.items.map(toItemInput),
        analysisId: analysis.analysisId,
        portion: analysis.result.portion,
      })
      .expect(201);
    return response.body as EntryDto;
  }

  async function createEntry(body: object = {}): Promise<EntryDto> {
    const response = await agent
      .post('/api/entries')
      .send({
        name: 'Black Angus burgers',
        mealType: 'dinner',
        source: 'manual',
        ...YESTERDAY,
        items: [plainItem('Black Angus burger', 600, 1500)],
        ...body,
      })
      .expect(201);
    return response.body as EntryDto;
  }

  function quickLog(
    body: Pick<QuickLogRequest, 'key' | 'servings' | 'grams' | 'portionCount'>,
  ) {
    return agent
      .post('/api/foods/log')
      .send({ ...TODAY, mealType: 'dinner', ...body });
  }

  async function getEntry(id: string): Promise<EntryDto> {
    return (await agent.get(`/api/entries/${id}`).expect(200)).body as EntryDto;
  }

  describe("the owner's burgers", () => {
    it('analyzes "2 black angus burgers" as 2 burgers with counted items', async () => {
      const analysis = await analyzeText('2 black angus burgers');

      expect(analysis.result.portion).toEqual(BURGERS);
      expect(
        analysis.result.items.map(({ name, count, unit, unitPlural }) => [
          name,
          count,
          unit,
          unitPlural,
        ]),
      ).toEqual([
        ['Beef patty 80/20, grilled', 2, 'patty', 'patties'],
        ['Burger bun', 2, 'bun', 'buns'],
        ['Cheddar cheese slice', 2, 'slice', 'slices'],
        ['Ketchup and mayo', null, null, null],
      ]);
    });

    it('saves the portion and item counts on the entry', async () => {
      const analysis = await analyzeText('2 black angus burgers');

      const entry = await logAnalysis(analysis);

      expect(entry.portion).toEqual(BURGERS);
      expect(entry.items[0]).toMatchObject({
        count: 2,
        unit: 'patty',
        unitPlural: 'patties',
      });
      expect(entry.items[3]).toMatchObject({
        count: null,
        unit: null,
        unitPlural: null,
      });
      await expect(getEntry(entry.id)).resolves.toEqual(entry);
    });

    it("re-logs 1½ of yesterday's 2 burgers as three quarters of the meal", async () => {
      const yesterday = await logAnalysis(
        await analyzeText('2 black angus burgers'),
      );

      const response = await quickLog({
        key: `meal:${yesterday.id}`,
        portionCount: 1.5,
      }).expect(201);
      const today = response.body as EntryDto;

      expect(today.portion).toEqual({ ...BURGERS, count: 1.5 });
      expect(today.name).toBe(yesterday.name);
      expect(today.localDate).toBe(TODAY.localDate);
      expect(today.totals.calories).toBeCloseTo(
        yesterday.totals.calories * 0.75,
        -1,
      );
      expect(today.totals.protein).toBeCloseTo(
        yesterday.totals.protein * 0.75,
        0,
      );
      expect(today.items.map(({ grams, count }) => [grams, count])).toEqual(
        yesterday.items.map(({ grams, count }) => [
          Math.round(grams * 0.75 * 10) / 10,
          count === null ? null : count * 0.75,
        ]),
      );
    });

    it('shows the portion in the food library', async () => {
      const yesterday = await logAnalysis(
        await analyzeText('2 black angus burgers'),
      );

      const response = await agent
        .get('/api/foods')
        .query({ q: yesterday.name })
        .expect(200);
      const meal = (response.body as FoodSearchResponse).results.find(
        (result) => result.key === `meal:${yesterday.id}`,
      );

      expect(meal?.portion).toEqual(BURGERS);
      expect(meal?.items[0]).toMatchObject({ count: 2, unit: 'patty' });
    });

    it('rejects a portion count together with servings', async () => {
      const yesterday = await logAnalysis(
        await analyzeText('2 black angus burgers'),
      );

      const response = await quickLog({
        key: `meal:${yesterday.id}`,
        portionCount: 1.5,
        servings: 1.5,
      }).expect(400);

      expect(response.body).toMatchObject({
        message: 'portionCount cannot be combined with servings or grams',
      });
      await expect(prisma.entry.count()).resolves.toBe(1);
    });

    it('scales the portion when logging servings', async () => {
      const yesterday = await logAnalysis(
        await analyzeText('2 black angus burgers'),
      );

      const today = (
        await quickLog({ key: `meal:${yesterday.id}`, servings: 0.5 }).expect(
          201,
        )
      ).body as EntryDto;

      expect(today.portion).toEqual({ ...BURGERS, count: 1 });
      expect(today.items[0]?.count).toBe(1);
    });

    it('copies the portion as it is when logging again', async () => {
      const yesterday = await logAnalysis(
        await analyzeText('2 black angus burgers'),
      );

      const copy = (
        await agent
          .post(`/api/entries/${yesterday.id}/duplicate`)
          .send(TODAY)
          .expect(201)
      ).body as EntryDto;

      expect(copy.portion).toEqual(BURGERS);
      expect(copy.items.map((item) => item.count)).toEqual(
        yesterday.items.map((item) => item.count),
      );
    });
  });

  describe('entries without a portion', () => {
    it('refuses a portion count until the portion is set with PUT', async () => {
      const old = await createEntry();
      expect(old.portion).toBeNull();

      await quickLog({ key: `meal:${old.id}`, portionCount: 1.5 }).expect(400);

      const updated = (
        await agent
          .put(`/api/entries/${old.id}`)
          .send({
            name: old.name,
            mealType: old.mealType,
            timestamp: old.timestamp,
            localDate: old.localDate,
            items: [plainItem('Black Angus burger', 600, 1500)],
            portion: BURGERS,
          })
          .expect(200)
      ).body as EntryDto;
      expect(updated.portion).toEqual(BURGERS);

      const today = (
        await quickLog({ key: `meal:${old.id}`, portionCount: 1.5 }).expect(201)
      ).body as EntryDto;
      expect(today.portion).toEqual({ ...BURGERS, count: 1.5 });
      expect(today.totals.calories).toBe(1125);
      expect(today.items[0]?.grams).toBe(450);
    });

    it('keeps the portion on updates that leave it out and clears it with null', async () => {
      const entry = await createEntry({ portion: BURGERS });
      const update = {
        name: entry.name,
        mealType: entry.mealType,
        timestamp: entry.timestamp,
        localDate: entry.localDate,
        items: [plainItem('Black Angus burger', 500, 1300)],
      };

      const kept = (
        await agent.put(`/api/entries/${entry.id}`).send(update).expect(200)
      ).body as EntryDto;
      const cleared = (
        await agent
          .put(`/api/entries/${entry.id}`)
          .send({ ...update, portion: null })
          .expect(200)
      ).body as EntryDto;

      expect(kept.portion).toEqual(BURGERS);
      expect(cleared.portion).toBeNull();
    });

    it('validates portions and item counts', async () => {
      for (const portion of [
        { count: 0, unit: 'burger', unitPlural: 'burgers' },
        { count: 101, unit: 'burger', unitPlural: 'burgers' },
        { count: 2, unit: ' ', unitPlural: 'burgers' },
        { count: 2, unit: 'burger' },
        '2 burgers',
      ]) {
        await agent
          .post('/api/entries')
          .send({
            name: 'Burgers',
            mealType: 'dinner',
            source: 'manual',
            ...TODAY,
            items: [plainItem('Burger', 300, 750)],
            portion,
          })
          .expect(400);
      }
      await agent
        .post('/api/entries')
        .send({
          name: 'Eggs',
          mealType: 'breakfast',
          source: 'manual',
          ...TODAY,
          items: [{ ...plainItem('Eggs', 100, 155), count: 2 }],
        })
        .expect(400);
      await expect(prisma.entry.count()).resolves.toBe(0);
    });
  });

  describe('foods', () => {
    it('logs a counted food by units and gives the new entry that portion', async () => {
      const entry = await createEntry({
        name: 'Breakfast',
        items: [
          {
            ...plainItem('Eggs, boiled', 100, 155),
            count: 2,
            unit: 'egg',
            unitPlural: 'eggs',
          },
          plainItem('Toast', 40, 100),
        ],
      });
      const eggs = entry.items[0];

      const response = await agent.get('/api/foods').query({ q: 'eggs' });
      const food = (response.body as FoodSearchResponse).results.find(
        (result) => result.key === `food:${eggs?.id}`,
      );
      expect(food?.portion).toEqual({
        count: 2,
        unit: 'egg',
        unitPlural: 'eggs',
      });

      const logged = (
        await quickLog({ key: `food:${eggs?.id}`, portionCount: 3 }).expect(201)
      ).body as EntryDto;
      expect(logged.portion).toEqual({
        count: 3,
        unit: 'egg',
        unitPlural: 'eggs',
      });
      expect(logged.items).toEqual([
        expect.objectContaining({ grams: 150, count: 3, unit: 'egg' }),
      ]);
      expect(logged.totals.calories).toBe(233);
    });
  });

  describe('favorites', () => {
    async function createFavorite(): Promise<FavoriteDto> {
      const response = await agent
        .post('/api/favorites')
        .send({
          name: 'Black Angus burgers',
          mealType: 'dinner',
          items: [
            {
              ...plainItem('Black Angus patties', 300, 810),
              count: 2,
              unit: 'patty',
              unitPlural: 'patties',
            },
            plainItem('Burger sauce', 30, 120),
          ],
          portion: BURGERS,
        })
        .expect(201);
      return response.body as FavoriteDto;
    }

    it('round-trips the portion and item counts', async () => {
      const favorite = await createFavorite();

      expect(favorite.portion).toEqual(BURGERS);
      expect(favorite.items[0]).toMatchObject({
        count: 2,
        unit: 'patty',
        unitPlural: 'patties',
      });
      expect(favorite.items[1]).toMatchObject({ count: null, unit: null });
      const [listed] = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(listed?.portion).toEqual(BURGERS);
      expect(listed?.items).toEqual(favorite.items);
    });

    it('logs servings and portion counts with a scaled portion and the plain name', async () => {
      const favorite = await createFavorite();

      const half = (
        await agent
          .post(`/api/favorites/${favorite.id}/log`)
          .send({ ...TODAY, mealType: 'lunch', servings: 0.5 })
          .expect(201)
      ).body as EntryDto;
      const three = (
        await quickLog({
          key: `favorite:${favorite.id}`,
          portionCount: 3,
        }).expect(201)
      ).body as EntryDto;

      expect(half.name).toBe('Black Angus burgers');
      expect(half.portion).toEqual({ ...BURGERS, count: 1 });
      expect(half.items[0]).toMatchObject({ grams: 150, count: 1 });
      expect(three.portion).toEqual({ ...BURGERS, count: 3 });
      expect(three.totals.calories).toBe(1395);
    });

    it('copies the portion from an entry and keeps or clears it on update', async () => {
      const entry = await createEntry({ portion: BURGERS });
      const favorite = (
        await agent.post(`/api/favorites/from-entry/${entry.id}`).expect(201)
      ).body as FavoriteDto;
      expect(favorite.portion).toEqual(BURGERS);

      const update = {
        name: favorite.name,
        mealType: null,
        items: favorite.items,
      };
      const kept = (
        await agent
          .put(`/api/favorites/${favorite.id}`)
          .send(update)
          .expect(200)
      ).body as FavoriteDto;
      const cleared = (
        await agent
          .put(`/api/favorites/${favorite.id}`)
          .send({ ...update, portion: null })
          .expect(200)
      ).body as FavoriteDto;

      expect(kept.portion).toEqual(BURGERS);
      expect(cleared.portion).toBeNull();
      await quickLog({
        key: `favorite:${favorite.id}`,
        portionCount: 1,
      }).expect(400);
    });
  });

  describe('drafts', () => {
    function postDraft(fields: Record<string, string>) {
      let call = agent.post('/api/drafts');
      for (const [key, value] of Object.entries({ ...TODAY, ...fields })) {
        call = call.field(key, value);
      }
      return call;
    }

    it('round-trips the portion and item counts and logs them', async () => {
      const created = (
        await postDraft({
          mode: 'text',
          description: '2 black angus burgers',
          portion: JSON.stringify(BURGERS),
          items: JSON.stringify([
            {
              ...plainItem('Black Angus patties', 300, 810),
              count: 2,
              unit: 'patty',
              unitPlural: 'patties',
            },
          ]),
        }).expect(201)
      ).body as DraftDto;
      expect(created.portion).toEqual(BURGERS);
      expect(created.items?.[0]).toMatchObject({ count: 2, unit: 'patty' });

      const updated = (
        await agent
          .put(`/api/drafts/${created.id}`)
          .send({ portion: { ...BURGERS, count: 1.5 } })
          .expect(200)
      ).body as DraftDto;
      expect(updated.portion).toEqual({ ...BURGERS, count: 1.5 });
      const [listed] = (await agent.get('/api/drafts').expect(200))
        .body as DraftDto[];
      expect(listed?.portion).toEqual({ ...BURGERS, count: 1.5 });

      const entry = (
        await agent
          .post(`/api/drafts/${created.id}/log`)
          .send({
            name: 'Black Angus burgers',
            mealType: 'dinner',
            ...TODAY,
            items: updated.items,
          })
          .expect(201)
      ).body as EntryDto;
      expect(entry.portion).toEqual({ ...BURGERS, count: 1.5 });
      expect(entry.items[0]).toMatchObject({ count: 2, unit: 'patty' });
    });

    it('logs the portion sent with the log request and clears it with null', async () => {
      const draft = (
        await postDraft({
          mode: 'text',
          description: 'burgers',
          portion: JSON.stringify(BURGERS),
        }).expect(201)
      ).body as DraftDto;
      const other = (
        await postDraft({
          mode: 'text',
          description: 'burgers',
          portion: JSON.stringify(BURGERS),
        }).expect(201)
      ).body as DraftDto;
      const log = {
        name: 'Burgers',
        mealType: 'dinner',
        ...TODAY,
        items: [plainItem('Burger', 300, 750)],
      };

      const sent = (
        await agent
          .post(`/api/drafts/${draft.id}/log`)
          .send({ ...log, portion: { ...BURGERS, count: 1 } })
          .expect(201)
      ).body as EntryDto;
      const cleared = (
        await agent
          .post(`/api/drafts/${other.id}/log`)
          .send({ ...log, portion: null })
          .expect(201)
      ).body as EntryDto;

      expect(sent.portion).toEqual({ ...BURGERS, count: 1 });
      expect(cleared.portion).toBeNull();
    });

    it('rejects an invalid portion field', async () => {
      await postDraft({
        mode: 'text',
        description: 'burgers',
        portion: '2 burgers',
      }).expect(400);
      await expect(prisma.draft.count()).resolves.toBe(0);
    });
  });

  it('exports portions with entries and favorites', async () => {
    await createEntry({ portion: BURGERS });
    await agent
      .post('/api/favorites')
      .send({
        name: 'Burgers',
        items: [plainItem('Burger', 300, 750)],
        portion: BURGERS,
      })
      .expect(201);

    const body = (await agent.get('/api/export').expect(200)).body as {
      entries: EntryDto[];
      favorites: FavoriteDto[];
    };

    expect(body.entries.map((entry) => entry.portion)).toEqual([BURGERS]);
    expect(body.favorites.map((favorite) => favorite.portion)).toEqual([
      BURGERS,
    ]);
  });
});
