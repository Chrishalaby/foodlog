import { gzipSync } from 'node:zlib';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CATALOG_PORTIONS_MAX,
  CatalogFileError,
  parseCatalogFile,
  readCatalogFile,
} from './catalog-file.js';

const PER100 = {
  calories: 143,
  protein: 12.6,
  carbs: 0.72,
  fat: 9.51,
  satFat: 3.13,
  fiber: 0,
  sugar: 0.37,
  sodium: 142,
  alcohol: 0,
};

function food(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 171287,
    source: 'sr_legacy',
    name: 'Egg, whole, raw, fresh',
    category: 'Dairy and Egg Products',
    group: 'dairy_eggs',
    per100: PER100,
    missing: [],
    microsPer100: { vitaminB12: 0.89, calcium: 56 },
    portions: [{ label: '1 large', grams: 50 }],
    ...overrides,
  };
}

describe('parseCatalogFile', () => {
  it('keeps valid foods and their values', () => {
    const file = parseCatalogFile({ version: 'v1', source: 'USDA', license: 'CC0', foods: [food()] });
    expect(file).toEqual({
      version: 'v1',
      source: 'USDA',
      license: 'CC0',
      rejected: 0,
      foods: [
        {
          id: 171287,
          source: 'sr_legacy',
          name: 'Egg, whole, raw, fresh',
          category: 'Dairy and Egg Products',
          group: 'dairy_eggs',
          per100: PER100,
          missing: [],
          microsPer100: { vitaminB12: 0.89, calcium: 56 },
          portions: [{ label: '1 large', grams: 50 }],
        },
      ],
    });
  });

  it('rejects broken foods and duplicate ids without failing the file', () => {
    const file = parseCatalogFile({
      version: 'v1',
      foods: [
        food(),
        food(),
        food({ id: 2, per100: { ...PER100, calories: -5 } }),
        food({ id: 3, per100: { ...PER100, protein: 'a lot' } }),
        food({ id: 4, source: 'branded' }),
        food({ id: 5, name: '   ' }),
        food({ id: 1.5 }),
        null,
      ],
    });
    expect(file.foods.map((entry) => entry.id)).toEqual([171287]);
    expect(file.rejected).toBe(7);
  });

  it('falls back to safe values for optional fields', () => {
    const [parsed] = parseCatalogFile({
      version: 'v1',
      foods: [
        food({
          group: 'mystery',
          category: undefined,
          missing: ['fiber', 'unicorns', 'sugar'],
          microsPer100: { vitaminC: -1, iron: 'x' },
          portions: [
            { label: '', grams: 10 },
            { label: '1 cup', grams: 0 },
            { label: '1 slice', grams: 30 },
            ...Array.from({ length: 12 }, (_, index) => ({ label: `${index + 2} slices`, grams: 30 * (index + 2) })),
          ],
        }),
      ],
    }).foods;
    expect(parsed.group).toBe('other');
    expect(parsed.category).toBe('Other');
    expect(parsed.missing).toEqual(['fiber', 'sugar']);
    expect(parsed.microsPer100).toBeNull();
    expect(parsed.portions[0]).toEqual({ label: '1 slice', grams: 30 });
    expect(parsed.portions).toHaveLength(CATALOG_PORTIONS_MAX);
  });

  it('refuses a file without a version or foods list', () => {
    expect(() => parseCatalogFile({ foods: [] })).toThrow(CatalogFileError);
    expect(() => parseCatalogFile({ version: 'v1' })).toThrow(CatalogFileError);
    expect(() => parseCatalogFile([])).toThrow(CatalogFileError);
  });
});

describe('readCatalogFile', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'foodlog-catalog-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads gzip and plain JSON files', async () => {
    const content = JSON.stringify({ version: 'v1', foods: [food()] });
    await writeFile(join(dir, 'foods.json.gz'), gzipSync(content));
    await writeFile(join(dir, 'foods.json'), content);
    expect((await readCatalogFile(join(dir, 'foods.json.gz'))).foods).toHaveLength(1);
    expect((await readCatalogFile(join(dir, 'foods.json'))).foods).toHaveLength(1);
  });

  it('explains a file that is not JSON', async () => {
    await writeFile(join(dir, 'broken.json'), '{ nope');
    await expect(readCatalogFile(join(dir, 'broken.json'))).rejects.toThrow(/not valid JSON/);
  });

  it('reads the bundled USDA database', async () => {
    const { DEFAULT_CATALOG_FILE } = await import('../config/settings.js');
    const file = await readCatalogFile(DEFAULT_CATALOG_FILE);
    expect(file.rejected).toBe(0);
    expect(file.foods.length).toBeGreaterThan(13_000);
    expect(new Set(file.foods.map((entry) => entry.id)).size).toBe(file.foods.length);
  });
});
