import { randomUUID } from 'node:crypto';
import {
  API_LIMITS,
  type AnalyzeResponse,
  type CreateEntryRequest,
  type DraftDto,
  type EntryDto,
  type EntryItemInput,
  type EntrySource,
  type FavoriteDto,
  type FoodMergeSuggestion,
  type FoodMergeSuggestionsResponse,
  type FoodSearchResponse,
  type MergeFoodsRequest,
  type MyFoodChangeResponse,
  type MyFoodDto,
  type Nutrients,
  nutrientsFromPer100g,
  roundNutrients,
  type SaveMyFoodRequest,
  sumNutrients,
  zeroNutrients,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import sharp from 'sharp';
import {
  AI_PROVIDER,
  type AiAnalyzeRequest,
  type AiAnalyzeResult,
  type AiProvider,
} from '../src/ai/providers/ai-provider.js';
import { MockProvider } from '../src/ai/providers/mock.provider.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createSignedInUser,
  createTestApp,
  getTestUser,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

const DAY_MS = 86_400_000;

class CapturingProvider implements AiProvider {
  readonly name = 'mock';
  readonly requests: AiAnalyzeRequest[] = [];
  private readonly mock = new MockProvider({ latencyMs: 0 });

  analyze(request: AiAnalyzeRequest): Promise<AiAnalyzeResult> {
    this.requests.push(request);
    return this.mock.analyze(request);
  }
}

function labelPhoto(): Promise<Buffer> {
  return sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 250, g: 250, b: 250 },
    },
  })
    .jpeg()
    .toBuffer();
}

interface OwnerItem {
  name: string;
  kcal: number;
  grams: number;
}

function nutrients(values: Partial<Nutrients> = {}): Nutrients {
  return { ...zeroNutrients(), ...values };
}

function moment(daysAgo: number): { timestamp: string; localDate: string } {
  const date = new Date(Date.now() - daysAgo * DAY_MS);
  return {
    timestamp: date.toISOString(),
    localDate: date.toISOString().slice(0, 10),
  };
}

function item(
  name: string,
  kcalPer100: number,
  grams: number,
  productId: string | null = null,
): EntryItemInput {
  return {
    name,
    grams,
    nutrients: nutrients({ calories: (kcalPer100 * grams) / 100 }),
    confidence: 'medium',
    count: null,
    unit: null,
    unitPlural: null,
    productId,
  };
}

function entryBody(
  name: string,
  items: EntryItemInput[],
  daysAgo = 1,
  source: EntrySource = 'text',
): CreateEntryRequest {
  return {
    name,
    mealType: 'lunch',
    source,
    ...moment(daysAgo),
    items,
  };
}

function savedValues(per100: Nutrients, grams: number): Nutrients {
  return roundNutrients(nutrientsFromPer100g(per100, grams));
}

const BEEF_BURGER: OwnerItem[] = [
  { name: 'Sofisoft potato bun, top hollowed', kcal: 272, grams: 55 },
  { name: 'Heinz tomato ketchup', kcal: 103, grams: 26 },
  { name: 'Heinz mayonnaise, regular', kcal: 673, grams: 12 },
  { name: 'Cabbage, raw shredded', kcal: 27, grams: 30 },
  { name: 'Added table salt', kcal: 0, grams: 1 },
  { name: 'Cucumber pickles', kcal: 10, grams: 20 },
];

const CHICKEN_BURGER: OwnerItem[] = [
  { name: 'Sofisoft potato bun, top hollowed', kcal: 272, grams: 55 },
  { name: 'Heinz tomato ketchup', kcal: 118, grams: 26 },
  { name: 'Heinz mayonnaise, regular', kcal: 680, grams: 12 },
  { name: 'Cabbage, raw shredded', kcal: 26, grams: 30 },
  { name: 'Added table salt', kcal: 0, grams: 1 },
  { name: 'Chicken breast, cooked, skinless', kcal: 165, grams: 120 },
  { name: 'Cucumber, raw, with peel', kcal: 15, grams: 40 },
];

const CHICKEN_SANDWICH: OwnerItem[] = [
  { name: 'Sofisoft potato bun', kcal: 272, grams: 70 },
  { name: 'Tomato ketchup', kcal: 110, grams: 30 },
  { name: 'Mayonnaise, regular', kcal: 685, grams: 12 },
  { name: 'Garlic mayonnaise sauce', kcal: 680, grams: 10 },
  { name: 'Cabbage, raw, shredded', kcal: 23, grams: 30 },
  { name: 'Table salt', kcal: 0, grams: 1 },
  { name: 'Chicken breast, grilled', kcal: 165, grams: 120 },
  { name: 'Cucumber, raw, with peel', kcal: 15, grams: 40 },
];

const YOGURT: OwnerItem = {
  name: 'Khoury strawberry Greek yogurt, low fat',
  kcal: 88,
  grams: 170,
};

function ownerItems(items: OwnerItem[]): EntryItemInput[] {
  return items.map(({ name, kcal, grams }) => item(name, kcal, grams));
}

describe('my foods (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let agent: TestAgent;
  let userId: string;
  const provider = new CapturingProvider();

  beforeAll(async () => {
    app = await createTestApp({
      configure: (builder) =>
        builder.overrideProvider(AI_PROVIDER).useValue(provider),
    });
    prisma = app.get(PrismaService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
    userId = (await getTestUser(app)).id;
  });

  beforeEach(async () => {
    await prisma.entry.deleteMany();
    await prisma.favorite.deleteMany();
    await prisma.draft.deleteMany();
    await prisma.product.deleteMany();
    await prisma.analysis.deleteMany();
    await prisma.user.deleteMany({ where: { id: { not: userId } } });
    await prisma.profile.deleteMany();
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  async function createEntry(
    body: CreateEntryRequest,
    as: TestAgent = agent,
  ): Promise<EntryDto> {
    return (await as.post('/api/entries').send(body).expect(201))
      .body as EntryDto;
  }

  async function getEntry(id: string): Promise<EntryDto> {
    return (await agent.get(`/api/entries/${id}`).expect(200)).body as EntryDto;
  }

  async function suggestions(): Promise<FoodMergeSuggestion[]> {
    const response = await agent.get('/api/my-foods/suggestions').expect(200);
    return (response.body as FoodMergeSuggestionsResponse).suggestions;
  }

  async function listFoods(as: TestAgent = agent, q?: string) {
    const response = await as
      .get('/api/my-foods')
      .query(q ? { q } : {})
      .expect(200);
    return response.body as MyFoodDto[];
  }

  async function saveFood(
    body: Partial<SaveMyFoodRequest> = {},
  ): Promise<MyFoodDto> {
    const response = await agent
      .post('/api/my-foods')
      .send({
        name: 'Sofisoft potato bun',
        basisUnit: 'g',
        per100: nutrients({ calories: 272, protein: 9, carbs: 49, fat: 4.5 }),
        unitName: 'bun',
        unitGrams: 70,
        ...body,
      })
      .expect(201);
    return response.body as MyFoodDto;
  }

  async function seedOwnerData(): Promise<EntryDto[]> {
    const entries = [
      await createEntry(
        entryBody('Black Angus beef burger', ownerItems(BEEF_BURGER), 3),
      ),
      await createEntry(
        entryBody('Chicken burger', ownerItems(CHICKEN_BURGER), 2),
      ),
      await createEntry(
        entryBody('Chicken sandwich', ownerItems(CHICKEN_SANDWICH), 1),
      ),
    ];
    for (const daysAgo of [3, 2, 1]) {
      entries.push(
        await createEntry(
          entryBody(
            YOGURT.name,
            ownerItems([YOGURT]),
            daysAgo,
            'nutrition_label',
          ),
        ),
      );
    }
    return entries;
  }

  describe('the owner burgers', () => {
    it('suggests, merges, links new analyses and forgets dismissed groups', async () => {
      const entries = await seedOwnerData();

      const initial = await suggestions();
      expect(initial.map(({ key }) => key)).toEqual([
        'tomato ketchup',
        'mayo',
        'sofisoft potato bun',
      ]);
      const [ketchup, mayo, bun] = initial;
      expect(ketchup).toMatchObject({
        label: 'Tomato ketchup',
        itemCount: 3,
        entryCount: 3,
      });
      expect(ketchup?.variants.map(({ name }) => name)).toEqual([
        'Heinz tomato ketchup',
        'Tomato ketchup',
      ]);
      expect(ketchup?.variants.map(({ recommended }) => recommended)).toEqual([
        true,
        false,
      ]);
      expect(ketchup?.variants[0]).toMatchObject({
        productId: null,
        timesLogged: 2,
        typicalGrams: 26,
        valueSource: 'estimate',
        basisUnit: 'g',
      });
      expect(ketchup?.kcalPer100Min).toBeGreaterThanOrEqual(103);
      expect(ketchup?.kcalPer100Max).toBeLessThanOrEqual(120);
      expect(mayo?.variants.map(({ name }) => name)).toEqual([
        'Heinz mayonnaise, regular',
        'Mayonnaise, regular',
      ]);
      expect(bun?.variants.map(({ name }) => name).sort()).toEqual([
        'Sofisoft potato bun',
        'Sofisoft potato bun, top hollowed',
      ]);
      const suggestedNames = initial.flatMap(({ variants }) =>
        variants.map(({ name }) => name),
      );
      for (const name of [
        'Garlic mayonnaise sauce',
        'Added table salt',
        'Table salt',
        'Chicken breast, grilled',
        'Chicken breast, cooked, skinless',
        'Cabbage, raw shredded',
        'Cucumber, raw, with peel',
        YOGURT.name,
      ]) {
        expect(suggestedNames).not.toContain(name);
      }

      const recommended = ketchup?.variants.find((v) => v.recommended);
      if (!ketchup || !recommended) {
        throw new Error('missing ketchup suggestion');
      }
      const merge: MergeFoodsRequest = {
        key: ketchup.key,
        names: ketchup.variants.map(({ name }) => name),
        name: recommended.name,
        basisUnit: recommended.basisUnit,
        per100: recommended.per100,
        applyToPast: true,
      };
      const merged = (
        await agent.post('/api/my-foods/merge').send(merge).expect(201)
      ).body as MyFoodChangeResponse;

      expect(merged).toMatchObject({
        food: {
          barcode: null,
          name: 'Heinz tomato ketchup',
          brand: null,
          aliases: ['Tomato ketchup'],
          source: 'manual',
          per100: recommended.per100,
          itemCount: 3,
          useCount: 3,
        },
        updatedItems: 3,
        updatedEntries: 3,
        updatedFavorites: 0,
      });
      const food = merged.food;
      for (const entry of entries.slice(0, 3)) {
        const stored = await getEntry(entry.id);
        const ketchupItems = stored.items.filter(
          ({ productId }) => productId === food.id,
        );
        expect(ketchupItems).toHaveLength(1);
        for (const linked of ketchupItems) {
          expect(linked.name).toBe('Heinz tomato ketchup');
          expect(linked.nutrients).toEqual(
            savedValues(food.per100, linked.grams),
          );
        }
        expect(stored.totals).toEqual(
          roundNutrients(sumNutrients(stored.items.map((i) => i.nutrients))),
        );
        expect(stored.items.map(({ grams }) => grams)).toEqual(
          entry.items.map(({ grams }) => grams),
        );
      }
      expect((await suggestions()).map(({ key }) => key)).toEqual([
        'mayo',
        'sofisoft potato bun',
      ]);

      const analysis = (
        await agent
          .post('/api/analyze')
          .send({ mode: 'text', description: 'burger with ketchup' })
          .expect(200)
      ).body as AnalyzeResponse;
      const linkedItem = analysis.result.items.find(
        ({ savedFood }) => savedFood?.id === food.id,
      );
      expect(linkedItem).toMatchObject({
        name: 'Heinz tomato ketchup',
        per100g: food.per100,
        savedFood: {
          id: food.id,
          name: 'Heinz tomato ketchup',
          brand: null,
          per100: food.per100,
        },
        suggestedFood: null,
      });
      expect(linkedItem?.nutrients).toEqual(
        savedValues(food.per100, linkedItem?.grams ?? 0),
      );

      const saved = await createEntry({
        name: analysis.result.mealName,
        mealType: 'dinner',
        source: 'text',
        ...moment(0),
        analysisId: analysis.analysisId,
        items: analysis.result.items.map((analysed) => ({
          name: analysed.name,
          grams: analysed.grams,
          nutrients: analysed.nutrients,
          confidence: analysed.confidence,
          count: analysed.count,
          unit: analysed.unit,
          unitPlural: analysed.unitPlural,
          productId: analysed.savedFood?.id ?? null,
        })),
      });
      expect(
        saved.items
          .filter(({ productId }) => productId !== null)
          .map(({ name, productId }) => [name, productId]),
      ).toEqual([['Heinz tomato ketchup', food.id]]);
      const [afterSave] = await listFoods();
      expect(afterSave).toMatchObject({
        id: food.id,
        useCount: 4,
        itemCount: 4,
      });
      expect((await suggestions()).map(({ key }) => key)).toEqual([
        'mayo',
        'sofisoft potato bun',
      ]);

      await agent
        .post('/api/my-foods/suggestions/dismiss')
        .send({ key: 'mayo' })
        .expect(204);
      expect((await suggestions()).map(({ key }) => key)).toEqual([
        'sofisoft potato bun',
      ]);
      await createEntry(
        entryBody('Fries', [
          item('Fries', 312, 150),
          item('Mayonnaise', 720, 15),
        ]),
      );
      expect((await suggestions()).map(({ key }) => key)).toEqual([
        'sofisoft potato bun',
      ]);
      await expect(
        prisma.profile.findUniqueOrThrow({
          where: { userId },
          select: { dismissedFoodMerges: true },
        }),
      ).resolves.toEqual({ dismissedFoodMerges: ['mayo'] });
    });

    it('applies the micros chosen in a merge to past items, favorites, edits and new analyses', async () => {
      await seedOwnerData();
      const fries = await createEntry(
        entryBody(
          'Fries with ketchup',
          [
            item('Fries', 312, 150),
            {
              ...item('Tomato ketchup', 110, 30),
              micros: { potassium: 84, vitaminA: 6 },
            },
          ],
          0,
        ),
      );
      await agent.post(`/api/favorites/from-entry/${fries.id}`).expect(201);
      const [ketchup] = await suggestions();
      if (!ketchup) {
        throw new Error('missing ketchup suggestion');
      }
      expect(
        Object.fromEntries(
          ketchup.variants.map(({ name, microsPer100 }) => [
            name,
            microsPer100,
          ]),
        ),
      ).toEqual({
        'Heinz tomato ketchup': null,
        'Tomato ketchup': { potassium: 280, vitaminA: 20 },
      });

      const merged = (
        await agent
          .post('/api/my-foods/merge')
          .send({
            key: ketchup.key,
            names: ketchup.variants.map(({ name }) => name),
            name: 'Heinz tomato ketchup',
            basisUnit: 'g',
            per100: nutrients({ calories: 110 }),
            microsPer100: { potassium: 281, vitaminA: 21 },
            applyToPast: true,
          })
          .expect(201)
      ).body as MyFoodChangeResponse;

      expect(merged).toMatchObject({
        food: { microsPer100: { potassium: 281, vitaminA: 21 } },
        updatedItems: 4,
        updatedFavorites: 1,
      });
      const linked = await prisma.entryItem.findMany({
        where: { productId: merged.food.id },
        select: { grams: true, micros: true },
        orderBy: { grams: 'asc' },
      });
      expect(linked).toEqual([
        { grams: 26, micros: { potassium: 73, vitaminA: 5 } },
        { grams: 26, micros: { potassium: 73, vitaminA: 5 } },
        { grams: 30, micros: { potassium: 84, vitaminA: 6 } },
        { grams: 30, micros: { potassium: 84, vitaminA: 6 } },
      ]);
      const [favorite] = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(favorite?.items[1]).toMatchObject({
        productId: merged.food.id,
        micros: { potassium: 84, vitaminA: 6 },
      });

      const analysis = (
        await agent
          .post('/api/analyze')
          .send({ mode: 'text', description: 'burger with ketchup' })
          .expect(200)
      ).body as AnalyzeResponse;
      const analysed = analysis.result.items.find(
        ({ savedFood }) => savedFood?.id === merged.food.id,
      );
      expect(analysed?.savedFood?.microsPer100).toEqual({
        potassium: 281,
        vitaminA: 21,
      });
      expect(analysed?.microsPer100g).toEqual({ potassium: 281, vitaminA: 21 });
      expect(analysed?.micros).toEqual({
        potassium: Math.round(2.81 * (analysed?.grams ?? 0)),
        vitaminA: Math.round(0.21 * (analysed?.grams ?? 0)),
      });

      const edited = (
        await agent
          .put(`/api/my-foods/${merged.food.id}`)
          .send({ microsPer100: { potassium: 300 }, applyToPast: true })
          .expect(200)
      ).body as MyFoodChangeResponse;
      expect(edited).toMatchObject({
        food: { microsPer100: { potassium: 300 } },
        updatedItems: 4,
      });
      const fixed = await getEntry(fries.id);
      expect(fixed.items[1]?.micros).toEqual({ potassium: 90 });
    });

    it('remembers a partial merge until a genuinely new duplicate is logged', async () => {
      await seedOwnerData();
      const keys = async () => (await suggestions()).map(({ key }) => key);
      const bun = (await suggestions()).find(
        ({ key }) => key === 'sofisoft potato bun',
      );
      if (!bun) {
        throw new Error('missing bun suggestion');
      }

      const merged = (
        await agent
          .post('/api/my-foods/merge')
          .send({
            key: bun.key,
            names: ['Sofisoft potato bun'],
            keptApart: ['Sofisoft potato bun, top hollowed'],
            name: 'Sofisoft potato bun',
            basisUnit: 'g',
            per100: nutrients({ calories: 272 }),
            applyToPast: false,
          })
          .expect(201)
      ).body as MyFoodChangeResponse;

      expect(await keys()).toEqual(['tomato ketchup', 'mayo']);
      await expect(
        prisma.profile.findUniqueOrThrow({
          where: { userId },
          select: { foodMergeDecisions: true },
        }),
      ).resolves.toEqual({
        foodMergeDecisions: [
          {
            names: ['sofisoft potato bun'],
            keptApart: ['sofisoft potato bun top hollowed'],
            productId: merged.food.id,
            at: expect.any(String) as string,
          },
        ],
      });

      for (const name of ['Burger', 'Chicken burger']) {
        await createEntry(
          entryBody(
            name,
            [item('Sofisoft potato bun, top hollowed', 220, 55)],
            0,
          ),
        );
      }
      expect(await keys()).toEqual(['tomato ketchup', 'mayo']);

      for (const name of ['Sandwich', 'Wrap']) {
        await createEntry(
          entryBody(name, [item('Sofisoft potato bun', 320, 70)], 0),
        );
      }
      const back = (await suggestions()).find(
        ({ key }) => key === 'sofisoft potato bun',
      );
      expect(
        back?.variants.map(({ name, productId, timesLogged }) => [
          name,
          productId,
          timesLogged,
        ]),
      ).toEqual([
        ['Sofisoft potato bun', merged.food.id, 0],
        ['Sofisoft potato bun', null, 2],
      ]);

      await agent
        .post('/api/my-foods/merge')
        .send({
          key: 'tomato ketchup',
          names: ['Heinz tomato ketchup', 'Tomato ketchup'],
          name: 'Heinz tomato ketchup',
          basisUnit: 'g',
          per100: nutrients({ calories: 110 }),
          applyToPast: true,
        })
        .expect(201);
      const { foodMergeDecisions } = await prisma.profile.findUniqueOrThrow({
        where: { userId },
        select: { foodMergeDecisions: true },
      });
      expect(
        (foodMergeDecisions as { names: string[] }[]).map(({ names }) => names),
      ).toEqual([
        ['sofisoft potato bun'],
        ['heinz tomato ketchup', 'tomato ketchup'],
      ]);
    });

    it('keeps an unticked Tomato ketchup apart from the saved Heinz ketchup', async () => {
      await seedOwnerData();
      const keys = async () => (await suggestions()).map(({ key }) => key);
      expect(await keys()).toEqual([
        'tomato ketchup',
        'mayo',
        'sofisoft potato bun',
      ]);

      const merged = (
        await agent
          .post('/api/my-foods/merge')
          .send({
            key: 'tomato ketchup',
            names: ['Heinz tomato ketchup'],
            keptApart: ['Tomato ketchup'],
            name: 'Heinz tomato ketchup',
            basisUnit: 'g',
            per100: nutrients({ calories: 110 }),
            applyToPast: false,
          })
          .expect(201)
      ).body as MyFoodChangeResponse;

      expect(merged.updatedItems).toBe(0);
      expect(await keys()).toEqual(['mayo', 'sofisoft potato bun']);
      const { foodMergeDecisions } = await prisma.profile.findUniqueOrThrow({
        where: { userId },
        select: { foodMergeDecisions: true },
      });
      expect(foodMergeDecisions).toEqual([
        {
          names: ['heinz tomato ketchup'],
          keptApart: ['tomato ketchup'],
          productId: merged.food.id,
          at: expect.any(String) as string,
        },
      ]);

      for (const name of ['Fries', 'Hot dog']) {
        await createEntry(
          entryBody(name, [item('Tomato ketchup', 130, 30)], 0),
        );
      }
      const afterTomato = await suggestions();
      expect(afterTomato.map(({ key }) => key)).toEqual([
        'mayo',
        'sofisoft potato bun',
      ]);
      expect(
        afterTomato.some(({ variants }) =>
          variants.some(({ productId }) => productId === merged.food.id),
        ),
      ).toBe(false);

      for (const name of ['Burger', 'Nuggets']) {
        await createEntry(entryBody(name, [item('Ketchup', 125, 30)], 0));
      }
      const afterKetchup = await suggestions();
      const ketchup = afterKetchup.find(({ key }) => key === 'ketchup');
      expect(ketchup?.variants.map(({ name }) => name).sort()).toEqual([
        'Ketchup',
        'Tomato ketchup',
      ]);
      expect(ketchup?.variants.map(({ productId }) => productId)).toEqual([
        null,
        null,
      ]);
    });

    it('suggests a new unlinked Ketchup together with the saved Heinz ketchup', async () => {
      await seedOwnerData();
      const merged = (
        await agent
          .post('/api/my-foods/merge')
          .send({
            key: 'tomato ketchup',
            names: ['Heinz tomato ketchup'],
            keptApart: ['Tomato ketchup'],
            name: 'Heinz tomato ketchup',
            basisUnit: 'g',
            per100: nutrients({ calories: 110 }),
            applyToPast: false,
          })
          .expect(201)
      ).body as MyFoodChangeResponse;

      for (const name of ['Burger', 'Nuggets']) {
        await createEntry(entryBody(name, [item('Ketchup', 125, 30)], 0));
      }

      const ketchup = (await suggestions()).find(
        ({ key }) => key === 'ketchup',
      );
      expect(
        ketchup?.variants.map(({ name, productId, timesLogged }) => [
          name,
          productId,
          timesLogged,
        ]),
      ).toEqual([
        ['Heinz tomato ketchup', merged.food.id, 0],
        ['Ketchup', null, 2],
      ]);
    });

    it('stops treating an unticked name as an alias of the saved food', async () => {
      const [, , sandwich] = await seedOwnerData();
      const heinz = await saveFood({
        name: 'Heinz tomato ketchup',
        aliases: ['Tomato ketchup', 'Catsup'],
        per100: nutrients({ calories: 110 }),
        unitName: null,
        unitGrams: null,
      });

      const merged = (
        await agent
          .post('/api/my-foods/merge')
          .send({
            key: 'tomato ketchup',
            names: ['Heinz tomato ketchup'],
            keptApart: ['Tomato ketchup'],
            name: 'Heinz tomato ketchup',
            basisUnit: 'g',
            per100: nutrients({ calories: 110 }),
            productId: heinz.id,
            applyToPast: true,
          })
          .expect(201)
      ).body as MyFoodChangeResponse;

      expect(merged.food.aliases).toEqual(['Catsup']);
      expect(merged.updatedItems).toBe(2);
      const tomato = (await getEntry(sandwich?.id ?? '')).items.find(
        ({ name }) => name === 'Tomato ketchup',
      );
      expect(tomato).toMatchObject({ productId: null, grams: 30 });
      expect(tomato?.nutrients.calories).toBe(33);
      expect(await suggestions()).not.toContainEqual(
        expect.objectContaining({ key: 'tomato ketchup' }),
      );
    });

    it('rejects kept-apart names that are not a list of names', async () => {
      await agent
        .post('/api/my-foods/merge')
        .send({
          key: 'mayo',
          names: ['Mayonnaise, regular'],
          keptApart: [''],
          name: 'Mayonnaise',
          basisUnit: 'g',
          per100: nutrients({ calories: 680 }),
          applyToPast: false,
        })
        .expect(400);
      await expect(prisma.product.count()).resolves.toBe(0);
    });

    it('folds the linked ketchup into one library row with its latest amount', async () => {
      await seedOwnerData();
      const [ketchup] = await suggestions();
      const recommended = ketchup?.variants[0];
      if (!ketchup || !recommended) {
        throw new Error('missing ketchup suggestion');
      }
      const { food } = (
        await agent
          .post('/api/my-foods/merge')
          .send({
            key: ketchup.key,
            names: ketchup.variants.map(({ name }) => name),
            name: recommended.name,
            basisUnit: 'g',
            per100: recommended.per100,
            applyToPast: true,
          })
          .expect(201)
      ).body as MyFoodChangeResponse;

      const response = (
        await agent.get('/api/foods').query({ q: 'ketchup' }).expect(200)
      ).body as FoodSearchResponse;

      expect(response.results.map(({ key }) => key)).toEqual([
        `product:${food.id}`,
      ]);
      expect(response.results[0]).toMatchObject({
        kind: 'product',
        name: 'Heinz tomato ketchup',
        grams: 30,
        items: [{ grams: 30, productId: food.id }],
      });
      const partial = (
        await agent.get('/api/foods').query({ q: 'tomato ketc' }).expect(200)
      ).body as FoodSearchResponse;
      expect(partial.results.map(({ key }) => key)).toEqual([
        `product:${food.id}`,
      ]);
    });

    it('leaves past items alone and stops suggesting the names it merged', async () => {
      await seedOwnerData();
      const [ketchup] = await suggestions();
      if (!ketchup) {
        throw new Error('missing ketchup suggestion');
      }

      const merged = (
        await agent
          .post('/api/my-foods/merge')
          .send({
            key: ketchup.key,
            names: ['Tomato ketchup'],
            name: 'Heinz tomato ketchup',
            basisUnit: 'g',
            per100: nutrients({ calories: 110 }),
            applyToPast: false,
          })
          .expect(201)
      ).body as MyFoodChangeResponse;

      expect(merged).toMatchObject({
        food: { itemCount: 0, useCount: 0 },
        updatedItems: 0,
        updatedEntries: 0,
      });
      await expect(
        prisma.entryItem.count({ where: { productId: merged.food.id } }),
      ).resolves.toBe(0);

      expect((await suggestions()).map(({ key }) => key)).toEqual([
        'mayo',
        'sofisoft potato bun',
      ]);

      for (const name of ['Fries', 'Wedges']) {
        await createEntry(
          entryBody(name, [item('Tomato ketchup', 140, 30)], 0),
        );
      }
      const again = (await suggestions()).find(
        ({ key }) => key === 'tomato ketchup',
      );
      expect(
        again?.variants.map(({ name, productId, timesLogged }) => [
          name,
          productId,
          timesLogged,
        ]),
      ).toEqual([
        ['Heinz tomato ketchup', merged.food.id, 0],
        ['Tomato ketchup', null, 2],
      ]);
    });

    it('merges into a saved food nobody logged yet instead of creating a second one', async () => {
      const saved = await saveFood({
        name: 'Ketchup',
        per100: nutrients({ calories: 112, carbs: 26 }),
        unitName: 'tbsp',
        unitGrams: 17,
      });
      await seedOwnerData();
      await createEntry(
        entryBody('Salad', [item('Tomato', 18, 80), item('Tomato', 18, 60)]),
      );
      await createEntry(entryBody('Toast', [item('Tomato', 18, 40)]));

      const [ketchup] = await suggestions();
      if (!ketchup) {
        throw new Error('missing ketchup suggestion');
      }
      expect(
        ketchup.variants.map(({ name, productId }) => [name, productId]),
      ).toEqual([
        ['Ketchup', saved.id],
        ['Heinz tomato ketchup', null],
        ['Tomato ketchup', null],
      ]);

      const merged = (
        await agent
          .post('/api/my-foods/merge')
          .send({
            key: ketchup.key,
            names: ketchup.variants.map(({ name }) => name),
            name: 'Ketchup',
            basisUnit: 'g',
            per100: saved.per100,
            productId: saved.id,
            applyToPast: true,
          })
          .expect(201)
      ).body as MyFoodChangeResponse;

      expect(merged).toMatchObject({
        food: {
          id: saved.id,
          aliases: ['Heinz tomato ketchup', 'Tomato ketchup'],
          itemCount: 3,
        },
        updatedItems: 3,
      });
      expect(await listFoods()).toHaveLength(1);
      await expect(
        prisma.entryItem.count({ where: { name: 'Tomato', productId: null } }),
      ).resolves.toBe(3);
      expect((await suggestions()).map(({ key }) => key)).toEqual([
        'mayo',
        'sofisoft potato bun',
      ]);
    });
  });

  describe('analysis', () => {
    it('lists up to 40 saved foods, most used first, for food and text analyses only', async () => {
      for (let index = 0; index < 42; index += 1) {
        await saveFood({
          name: `Saved food ${String(index).padStart(2, '0')}`,
          brand: index === 7 ? 'Heinz' : null,
          aliases: index === 7 ? ['Seven'] : [],
        });
      }
      await prisma.product.updateMany({
        where: { userId, name: 'Saved food 07' },
        data: { useCount: 5 },
      });

      await agent
        .post('/api/analyze')
        .send({ mode: 'text', description: 'soup' })
        .expect(200);
      const text = provider.requests.at(-1);
      expect(text?.prompt.savedFoods).toHaveLength(40);
      expect(text?.prompt.savedFoods?.[0]).toEqual({
        name: 'Saved food 07',
        brand: 'Heinz',
        aliases: ['Seven'],
      });
      expect(text?.prompt.savedFoods?.[1]?.name).toBe('Saved food 00');

      await agent
        .post('/api/analyze')
        .field('mode', 'nutrition_label')
        .attach('image', await labelPhoto(), {
          filename: 'label.jpg',
          contentType: 'image/jpeg',
        })
        .expect(200);
      expect(provider.requests.at(-1)?.prompt.savedFoods).toEqual([]);
    });
  });

  describe('CRUD', () => {
    it('creates, lists, searches and edits saved foods', async () => {
      const bun = await saveFood({
        brand: 'Sofisoft',
        aliases: ['Potato bun', 'potato  bun', 'Sofisoft potato bun'],
      });

      expect(bun).toMatchObject({
        barcode: null,
        name: 'Sofisoft potato bun',
        brand: 'Sofisoft',
        aliases: ['Potato bun'],
        unitName: 'bun',
        unitGrams: 70,
        source: 'manual',
        missingNutrients: [],
        useCount: 0,
        lastUsedAt: null,
        itemCount: 0,
      });
      await saveFood({ name: 'Garlic sauce', unitName: null, unitGrams: null });
      expect((await listFoods()).map(({ name }) => name)).toEqual([
        'Garlic sauce',
        'Sofisoft potato bun',
      ]);
      expect((await listFoods(agent, 'potato')).map(({ id }) => id)).toEqual([
        bun.id,
      ]);

      const edited = (
        await agent
          .put(`/api/my-foods/${bun.id}`)
          .send({
            name: 'Potato bun',
            aliases: ['Burger bun', 'Sofisoft bun'],
            unitName: '',
            unitGrams: null,
          })
          .expect(200)
      ).body as MyFoodChangeResponse;

      expect(edited).toEqual({
        food: expect.objectContaining({
          id: bun.id,
          name: 'Potato bun',
          brand: 'Sofisoft',
          aliases: ['Burger bun', 'Sofisoft bun'],
          unitName: null,
          unitGrams: null,
          per100: bun.per100,
        }),
        updatedItems: 0,
        updatedEntries: 0,
        updatedFavorites: 0,
      });
    });

    it('validates saved foods', async () => {
      const bun = await saveFood();
      const base = {
        name: 'Bun',
        basisUnit: 'g',
        per100: nutrients({ calories: 272 }),
      };

      for (const body of [
        { ...base, name: '' },
        { ...base, name: 'x'.repeat(API_LIMITS.nameMax + 1) },
        { ...base, aliases: Array.from({ length: 21 }, (_, i) => `n${i}`) },
        { ...base, aliases: ['x'.repeat(API_LIMITS.nameMax + 1)] },
        { ...base, per100: nutrients({ calories: -1 }) },
        { ...base, unitGrams: 2001 },
        { ...base, basisUnit: 'oz' },
        { ...base, barcode: '5280001234566' },
      ]) {
        await agent.post('/api/my-foods').send(body).expect(400);
        await agent.put(`/api/my-foods/${bun.id}`).send(body).expect(400);
      }
      await agent
        .post('/api/my-foods')
        .send({ name: 'Bun', basisUnit: 'g' })
        .expect(400);
      await agent
        .put(`/api/my-foods/${bun.id}`)
        .send({ applyToPast: 'yes' })
        .expect(400);
      await agent.put('/api/my-foods/nope').send({}).expect(400);
      await agent.delete('/api/my-foods/nope').expect(400);
      await agent
        .post('/api/my-foods/merge')
        .send({ key: 'bun', names: [], name: 'Bun', basisUnit: 'g' })
        .expect(400);
      await agent
        .post('/api/my-foods/suggestions/dismiss')
        .send({ key: '' })
        .expect(400);
      await agent
        .post('/api/my-foods/suggestions/dismiss')
        .send({ key: '...' })
        .expect(400);
      expect(await listFoods()).toHaveLength(1);
    });

    it('keeps saved foods private to their owner', async () => {
      const bun = await saveFood();
      const stranger = await createSignedInUser(app);

      expect(await listFoods(stranger.agent)).toEqual([]);
      await stranger.agent
        .put(`/api/my-foods/${bun.id}`)
        .send({ name: 'Mine now' })
        .expect(404);
      await stranger.agent.delete(`/api/my-foods/${bun.id}`).expect(404);
      await stranger.agent
        .post('/api/my-foods/merge')
        .send({
          key: 'bun',
          names: ['Bun'],
          name: 'Bun',
          basisUnit: 'g',
          per100: nutrients({ calories: 100 }),
          productId: bun.id,
          applyToPast: true,
        })
        .expect(404);
      await agent
        .put(`/api/my-foods/${randomUUID()}`)
        .send({ name: 'Ghost' })
        .expect(404);

      const foreign = await createEntry(
        entryBody('Their burger', [item('Bun', 272, 70, bun.id)]),
        stranger.agent,
      );

      expect(foreign.items[0]?.productId).toBeNull();
      const [stored] = await listFoods();
      expect(stored).toMatchObject({
        name: 'Sofisoft potato bun',
        useCount: 0,
        itemCount: 0,
      });
    });

    it('recomputes linked items, entries and favorites when values change', async () => {
      const bun = await saveFood();
      const entry = await createEntry(
        entryBody('Burger', [
          item('Sofisoft potato bun', 272, 70, bun.id),
          item('Fries', 312, 100),
        ]),
      );
      const favorite = (
        await agent.post(`/api/favorites/from-entry/${entry.id}`).expect(201)
      ).body as FavoriteDto;
      expect(favorite.items[0]?.productId).toBe(bun.id);
      const per100 = nutrients({
        calories: 250,
        protein: 8,
        carbs: 45,
        fat: 4,
      });

      const changed = (
        await agent
          .put(`/api/my-foods/${bun.id}`)
          .send({ per100, applyToPast: true })
          .expect(200)
      ).body as MyFoodChangeResponse;

      expect(changed).toMatchObject({
        food: { per100 },
        updatedItems: 1,
        updatedEntries: 1,
        updatedFavorites: 1,
      });
      const stored = await getEntry(entry.id);
      expect(stored.items[0]).toMatchObject({
        name: 'Sofisoft potato bun',
        productId: bun.id,
        nutrients: savedValues(per100, 70),
      });
      expect(stored.totals.calories).toBe(175 + 312);
      const [storedFavorite] = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(storedFavorite?.items[0]?.nutrients).toEqual(
        savedValues(per100, 70),
      );
      expect(storedFavorite?.totals.calories).toBe(175 + 312);

      const untouched = (
        await agent
          .put(`/api/my-foods/${bun.id}`)
          .send({ per100: nutrients({ calories: 200 }), applyToPast: false })
          .expect(200)
      ).body as MyFoodChangeResponse;
      expect(untouched).toMatchObject({ updatedItems: 0, updatedEntries: 0 });
      expect((await getEntry(entry.id)).items[0]?.nutrients.calories).toBe(175);
    });

    it('keeps past values when a saved food is deleted', async () => {
      const bun = await saveFood();
      const entry = await createEntry(
        entryBody('Burger', [item('Sofisoft potato bun', 272, 70, bun.id)]),
      );
      const favorite = (
        await agent.post(`/api/favorites/from-entry/${entry.id}`).expect(201)
      ).body as FavoriteDto;

      await agent.delete(`/api/my-foods/${bun.id}`).expect(204);

      const stored = await getEntry(entry.id);
      expect(stored.items[0]).toMatchObject({
        name: 'Sofisoft potato bun',
        grams: 70,
        productId: null,
        nutrients: entry.items[0]?.nutrients,
      });
      expect(stored.totals).toEqual(entry.totals);
      const [storedFavorite] = (await agent.get('/api/favorites').expect(200))
        .body as FavoriteDto[];
      expect(storedFavorite?.id).toBe(favorite.id);
      expect(storedFavorite?.items[0]?.productId).toBeNull();
      expect(await listFoods()).toEqual([]);
      await agent.delete(`/api/my-foods/${bun.id}`).expect(404);
    });
  });

  describe('copies', () => {
    it('keeps item links in every copy and counts each logged entry', async () => {
      const bun = await saveFood();
      const entry = await createEntry(
        entryBody('Burger', [
          item('Sofisoft potato bun', 272, 70, bun.id),
          item('Fries', 312, 100),
        ]),
      );
      const linkedOf = (logged: EntryDto) =>
        logged.items.map(({ productId }) => productId);

      const again = (
        await agent
          .post(`/api/entries/${entry.id}/duplicate`)
          .send(moment(0))
          .expect(201)
      ).body as EntryDto;
      const quick = (
        await agent
          .post('/api/foods/log')
          .send({ key: `meal:${entry.id}`, mealType: 'dinner', ...moment(0) })
          .expect(201)
      ).body as EntryDto;
      const food = (
        await agent
          .post('/api/foods/log')
          .send({
            key: `food:${entry.items[0]?.id}`,
            grams: 140,
            mealType: 'dinner',
            ...moment(0),
          })
          .expect(201)
      ).body as EntryDto;
      const favorite = (
        await agent.post(`/api/favorites/from-entry/${entry.id}`).expect(201)
      ).body as FavoriteDto;
      const fromFavorite = (
        await agent
          .post(`/api/favorites/${favorite.id}/log`)
          .send({ mealType: 'lunch', ...moment(0) })
          .expect(201)
      ).body as EntryDto;
      const product = (
        await agent
          .post(`/api/products/${bun.id}/log`)
          .send({ servings: 2, mealType: 'lunch', ...moment(0) })
          .expect(201)
      ).body as EntryDto;
      const draft = (
        await agent
          .post('/api/drafts')
          .field('mode', 'text')
          .field('description', 'burger')
          .field('timestamp', moment(0).timestamp)
          .field('localDate', moment(0).localDate)
          .expect(201)
      ).body as DraftDto;
      const withItems = (
        await agent
          .put(`/api/drafts/${draft.id}`)
          .send({
            items: entry.items.map(
              ({ id: _id, position: _position, ...input }) => input,
            ),
          })
          .expect(200)
      ).body as DraftDto;
      const fromDraft = (
        await agent
          .post(`/api/drafts/${draft.id}/log`)
          .send({
            name: 'Burger',
            mealType: 'dinner',
            ...moment(0),
            items: withItems.items,
          })
          .expect(201)
      ).body as EntryDto;

      expect(linkedOf(again)).toEqual([bun.id, null]);
      expect(linkedOf(quick)).toEqual([bun.id, null]);
      expect(food.items).toMatchObject([
        { grams: 140, productId: bun.id, nutrients: { calories: 380 } },
      ]);
      expect(favorite.items.map(({ productId }) => productId)).toEqual([
        bun.id,
        null,
      ]);
      expect(linkedOf(fromFavorite)).toEqual([bun.id, null]);
      expect(product).toMatchObject({
        productId: bun.id,
        source: 'copy',
        items: [{ grams: 140, productId: bun.id }],
      });
      expect(withItems.items?.map(({ productId }) => productId)).toEqual([
        bun.id,
        null,
      ]);
      expect(linkedOf(fromDraft)).toEqual([bun.id, null]);
      const [stored] = await listFoods();
      expect(stored).toMatchObject({ useCount: 7, itemCount: 7 });

      const exported = (await agent.get('/api/export').expect(200)).body as {
        entries: EntryDto[];
        favorites: FavoriteDto[];
      };
      const exportedEntry = exported.entries.find(({ id }) => id === entry.id);
      expect(exportedEntry?.items.map(({ productId }) => productId)).toEqual([
        bun.id,
        null,
      ]);
      expect(exported.favorites[0]?.items[0]?.productId).toBe(bun.id);
    });
  });
});
