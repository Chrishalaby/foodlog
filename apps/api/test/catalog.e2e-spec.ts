import type {
  CatalogFoodDto,
  CatalogInfoResponse,
  CatalogSearchResponse,
} from '@food/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { CatalogLoaderService } from '../src/catalog/catalog-loader.service.js';
import { parseCatalogFile } from '../src/catalog/catalog-file.js';
import { DEFAULT_CATALOG_FILE } from '../src/config/settings.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createTestApp,
  resetDatabase,
  setupAndLogin,
  type TestAgent,
} from './helpers.js';

async function search(agent: TestAgent, query: Record<string, string | number>): Promise<CatalogSearchResponse> {
  const response = await agent.get('/api/catalog/foods').query(query).expect(200);
  return response.body as CatalogSearchResponse;
}

function names(response: CatalogSearchResponse): string[] {
  return response.results.map((food) => food.name);
}

describe('food catalog (e2e)', () => {
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let loader: CatalogLoaderService;
  let agent: TestAgent;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    loader = app.get(CatalogLoaderService);
    await resetDatabase(prisma);
    agent = await setupAndLogin(app);
  });

  afterAll(async () => {
    await resetDatabase(prisma);
    await app.close();
  });

  it('requires a signed-in user', async () => {
    await request(app.getHttpServer()).get('/api/catalog/foods?q=egg').expect(401);
    await request(app.getHttpServer()).get('/api/catalog').expect(401);
  });

  it('is empty until the database file is loaded', async () => {
    const info = (await agent.get('/api/catalog').expect(200)).body as CatalogInfoResponse;
    expect(info).toMatchObject({ version: null, foodCount: 0, groups: [] });
    expect((await search(agent, { q: 'egg' })).results).toEqual([]);
  });

  it('loads the bundled USDA file once and skips it when it is current', async () => {
    const first = await loader.loadFromFile(DEFAULT_CATALOG_FILE);
    expect(first.status).toBe('loaded');
    expect(first.foodCount).toBeGreaterThan(13_000);

    const second = await loader.loadFromFile(DEFAULT_CATALOG_FILE);
    expect(second).toEqual({ ...first, status: 'current' });
    expect(await prisma.catalogFood.count()).toBe(first.foodCount);
  });

  it('reports the dataset, its size and its groups', async () => {
    const info = (await agent.get('/api/catalog').expect(200)).body as CatalogInfoResponse;
    expect(info.version).toMatch(/^usda-fdc-/);
    expect(info.foodCount).toBeGreaterThan(13_000);
    expect(info.loadedAt).not.toBeNull();
    expect(info.license).toMatch(/CC0/);
    expect(info.groups.map((entry) => entry.group)).toEqual(
      expect.arrayContaining(['dishes', 'fruits', 'vegetables', 'drinks']),
    );
    expect(info.groups.reduce((sum, entry) => sum + entry.count, 0)).toBe(info.foodCount);
  });

  it('puts foods named by the query first', async () => {
    const hummus = await search(agent, { q: 'hummus' });
    expect(hummus.results[0].name).toMatch(/^Hummus/);
    expect(hummus.total).toBeGreaterThanOrEqual(3);

    const egg = await search(agent, { q: 'egg', limit: 5 });
    for (const name of names(egg)) {
      expect(name).toMatch(/^Eggs?\b/);
    }
  });

  it('matches every word in any order', async () => {
    const response = await search(agent, { q: 'breast chicken roasted', limit: 10 });
    expect(response.results.length).toBeGreaterThan(0);
    for (const name of names(response)) {
      expect(name.toLowerCase()).toContain('chicken');
      expect(name.toLowerCase()).toContain('breast');
    }
  });

  it('forgives typos', async () => {
    const response = await search(agent, { q: 'chiken brest', limit: 10 });
    expect(names(response).some((name) => /chicken/i.test(name) && /breast/i.test(name))).toBe(true);

    const banana = await search(agent, { q: 'bananna', limit: 5 });
    expect(names(banana).some((name) => /banana/i.test(name))).toBe(true);
  });

  it('only falls back to typo matching when no food has the words', async () => {
    const beer = await search(agent, { q: 'beer', limit: 50 });
    expect(beer.total).toBeLessThan(50);
    expect(names(beer).every((name) => /beer/i.test(name))).toBe(true);
  });

  it('prefers the plain form and whole words', async () => {
    expect((await search(agent, { q: 'egg', limit: 1 })).results[0].name).toBe('Egg, whole, raw');
    expect((await search(agent, { q: 'salmon', limit: 1 })).results[0].name).toMatch(/salmon, raw/i);
    const pita = names(await search(agent, { q: 'pita', limit: 5 }));
    expect(pita).not.toContain('Spanakopita');
  });

  it('understands common synonyms', async () => {
    const coke = await search(agent, { q: 'coke', limit: 10 });
    expect(names(coke).every((name) => /cola/i.test(name))).toBe(true);
    const prawns = await search(agent, { q: 'prawns', limit: 5 });
    expect(names(prawns).every((name) => /shrimp/i.test(name))).toBe(true);
  });

  it('filters by group and pages through results', async () => {
    const drinks = await search(agent, { q: 'apple', group: 'drinks', limit: 50 });
    expect(drinks.group).toBe('drinks');
    expect(drinks.results.length).toBeGreaterThan(0);
    expect(drinks.results.every((food) => food.group === 'drinks')).toBe(true);

    const firstPage = await search(agent, { q: 'cheese', limit: 5, offset: 0 });
    const secondPage = await search(agent, { q: 'cheese', limit: 5, offset: 5 });
    expect(firstPage.total).toBe(secondPage.total);
    expect(firstPage.total).toBeGreaterThan(10);
    const firstIds = new Set(firstPage.results.map((food) => food.id));
    expect(secondPage.results.some((food) => firstIds.has(food.id))).toBe(false);
  });

  it('browses a group alphabetically without a query', async () => {
    const fruits = await search(agent, { group: 'fruits', limit: 20 });
    expect(fruits.total).toBeGreaterThan(100);
    const list = names(fruits);
    expect(list).toEqual([...list].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
  });

  it('returns a food with its values per 100 g, vitamins and portions', async () => {
    const [first] = (await search(agent, { q: 'egg whole raw fresh', limit: 1 })).results;
    const food = (await agent.get(`/api/catalog/foods/${first.id}`).expect(200)).body as CatalogFoodDto;
    expect(food).toMatchObject({ id: first.id, name: first.name, group: 'dairy_eggs' });
    expect(food.per100.protein).toBeGreaterThan(10);
    expect(food.per100.calories).toBeGreaterThan(100);
    expect(food.microsPer100?.vitaminB12).toBeGreaterThan(0);
    expect(food.portions.length).toBeGreaterThan(0);
    expect(food.portions.every((portion) => portion.grams > 0 && portion.label.length > 0)).toBe(true);
  });

  it('rejects unknown ids and invalid queries', async () => {
    await agent.get('/api/catalog/foods/999999999').expect(404);
    await agent.get('/api/catalog/foods/abc').expect(400);
    await agent.get('/api/catalog/foods').query({ group: 'pizza' }).expect(400);
    await agent.get('/api/catalog/foods').query({ limit: 0 }).expect(400);
    await agent.get('/api/catalog/foods').query({ limit: 51 }).expect(400);
    await agent.get('/api/catalog/foods').query({ offset: -1 }).expect(400);
    await agent.get('/api/catalog/foods').query({ q: 'x'.repeat(121) }).expect(400);
  });

  it('treats a query of only punctuation as no query', async () => {
    const response = await search(agent, { q: '%%%', limit: 3 });
    expect(response.query).toBe('%%%');
    expect(response.results).toHaveLength(3);
  });

  it('replaces the foods when a new version is loaded', async () => {
    const file = parseCatalogFile({
      version: 'test-2',
      source: 'test',
      license: 'test',
      foods: [
        {
          id: 1,
          source: 'survey',
          name: 'Test manakish, zaatar',
          category: 'Yeast breads',
          group: 'grains',
          per100: { calories: 300, protein: 8, carbs: 40, fat: 12, satFat: 2, fiber: 3, sugar: 2, sodium: 500, alcohol: 0 },
          missing: [],
          microsPer100: null,
          portions: [{ label: '1 piece', grams: 120 }],
        },
        { id: 2, source: 'survey', name: 'Broken', per100: { calories: -1 } },
      ],
    });
    expect(file.rejected).toBe(1);
    const result = await loader.load(file);
    expect(result).toEqual({ status: 'loaded', version: 'test-2', foodCount: 1 });
    const response = await search(agent, { q: 'manakish' });
    expect(names(response)).toEqual(['Test manakish, zaatar']);
    expect(response.results[0].portions).toEqual([{ label: '1 piece', grams: 120 }]);
    expect(await prisma.catalogDataset.findUniqueOrThrow({ where: { id: 'usda' } })).toMatchObject({
      version: 'test-2',
      foodCount: 1,
    });
  });
});
