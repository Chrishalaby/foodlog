import {
  NUTRIENT_KEYS,
  type Nutrients,
  nutrientsFromPer100g,
  roundNutrients,
  zeroNutrients,
} from '@food/shared';
import type { Prisma, Product } from '../generated/prisma/client.js';
import {
  applySavedFoodToPast,
  savedFoodTarget,
  unlinkSavedFoodCopies,
} from './saved-food-apply.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const OTHER_USER_ID = '019a0000-0000-7000-8000-000000000002';
const FOOD_ID = '019a0000-0000-7000-8000-0000000000d1';
const OTHER_FOOD_ID = '019a0000-0000-7000-8000-0000000000d2';
const NOW = new Date('2026-09-30T10:00:00.000Z');
const PER_100 = { ...zeroNutrients(), calories: 110, carbs: 25, sodium: 900 };

type Columns = Record<keyof Nutrients, number>;

interface FakeItem extends Columns {
  id: string;
  entryId: string;
  name: string;
  grams: number;
  productId: string | null;
  micros?: Prisma.JsonValue;
}

interface FakeEntry extends Columns {
  id: string;
  userId: string;
  name: string;
  timestamp: Date;
}

interface FakeJsonRow {
  id: string;
  userId: string;
  items: Prisma.JsonValue;
}

function columns(values: Partial<Nutrients>): Columns {
  return { ...zeroNutrients(), ...values };
}

function nutrientsOf(row: Columns): Nutrients {
  const out = zeroNutrients();
  for (const key of NUTRIENT_KEYS) {
    out[key] = row[key];
  }
  return out;
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: FOOD_ID,
    userId: USER_ID,
    barcode: null,
    name: 'Heinz tomato ketchup',
    brand: null,
    aliases: ['Tomato ketchup'],
    unitName: null,
    unitGrams: null,
    basisUnit: 'g',
    ...columns(PER_100),
    microsPer100: null,
    servingSizeG: null,
    packSizeG: null,
    source: 'manual',
    imageUrl: null,
    missingNutrients: [],
    useCount: 0,
    lastUsedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

class FakeDb {
  entries: FakeEntry[] = [];
  items: FakeItem[] = [];
  favorites: (FakeJsonRow & Columns)[] = [];
  drafts: FakeJsonRow[] = [];
  productUpdates: Prisma.ProductUpdateArgs[] = [];

  private ownItems(userId: string): FakeItem[] {
    const own = new Set(
      this.entries.filter((e) => e.userId === userId).map((e) => e.id),
    );
    return this.items.filter((item) => own.has(item.entryId));
  }

  private entriesLinkedTo(userId: string, productId: string): FakeEntry[] {
    const ids = new Set(
      this.ownItems(userId)
        .filter((item) => item.productId === productId)
        .map((item) => item.entryId),
    );
    return this.entries.filter((entry) => ids.has(entry.id));
  }

  readonly tx = {
    entryItem: {
      groupBy: (args: { where: { entry: { userId: string } } }) =>
        Promise.resolve(
          [
            ...new Set(
              this.ownItems(args.where.entry.userId).map((i) => i.name),
            ),
          ].map((name) => ({ name })),
        ),
      findMany: (args: {
        where: {
          entry: { userId: string };
          OR: ({ productId: string } | { name: { in: string[] } })[];
        };
      }) =>
        Promise.resolve(
          this.ownItems(args.where.entry.userId)
            .filter((item) =>
              args.where.OR.some((condition) =>
                'productId' in condition
                  ? item.productId === condition.productId
                  : condition.name.in.includes(item.name),
              ),
            )
            .map((item) => ({ ...item })),
        ),
      updateMany: (args: {
        where: { id: { in: string[] } };
        data: Partial<FakeItem>;
      }) => {
        for (const item of this.items) {
          if (args.where.id.in.includes(item.id)) {
            Object.assign(item, args.data);
          }
        }
        return Promise.resolve({ count: args.where.id.in.length });
      },
    },
    entry: {
      findMany: (args: { where: { userId: string; id: { in: string[] } } }) =>
        Promise.resolve(
          this.entries
            .filter(
              (entry) =>
                entry.userId === args.where.userId &&
                args.where.id.in.includes(entry.id),
            )
            .map((entry) => ({
              id: entry.id,
              name: entry.name,
              items: this.items.filter((item) => item.entryId === entry.id),
            })),
        ),
      update: (args: { where: { id: string }; data: Partial<FakeEntry> }) => {
        const entry = this.entries.find((e) => e.id === args.where.id);
        if (entry) {
          Object.assign(entry, args.data);
        }
        return Promise.resolve(entry);
      },
      count: (args: {
        where: { userId: string; items: { some: { productId: string } } };
      }) =>
        Promise.resolve(
          this.entriesLinkedTo(
            args.where.userId,
            args.where.items.some.productId,
          ).length,
        ),
      aggregate: (args: {
        where: { userId: string; items: { some: { productId: string } } };
      }) => {
        const times = this.entriesLinkedTo(
          args.where.userId,
          args.where.items.some.productId,
        ).map((entry) => entry.timestamp.getTime());
        return Promise.resolve({
          _max: {
            timestamp: times.length > 0 ? new Date(Math.max(...times)) : null,
          },
        });
      },
    },
    favorite: {
      findMany: (args: { where: { userId: string } }) =>
        Promise.resolve(
          this.favorites.filter((f) => f.userId === args.where.userId),
        ),
      update: (args: {
        where: { id: string };
        data: Partial<FakeJsonRow & Columns>;
      }) => {
        const favorite = this.favorites.find((f) => f.id === args.where.id);
        if (favorite) {
          Object.assign(favorite, args.data);
        }
        return Promise.resolve(favorite);
      },
    },
    draft: {
      findMany: (args: { where: { userId: string } }) =>
        Promise.resolve(
          this.drafts.filter((d) => d.userId === args.where.userId),
        ),
      update: (args: { where: { id: string }; data: Partial<FakeJsonRow> }) => {
        const draft = this.drafts.find((d) => d.id === args.where.id);
        if (draft) {
          Object.assign(draft, args.data);
        }
        return Promise.resolve(draft);
      },
    },
    product: {
      update: (args: Prisma.ProductUpdateArgs) => {
        this.productUpdates.push(args);
        return Promise.resolve(product());
      },
    },
  };

  get client(): Prisma.TransactionClient {
    return this.tx as unknown as Prisma.TransactionClient;
  }

  addEntry(
    id: string,
    name: string,
    items: Omit<FakeItem, 'entryId' | keyof Columns>[],
    kcal: number[],
    options: { userId?: string; timestamp?: Date } = {},
  ): void {
    const rows = items.map((item, index) => ({
      ...item,
      entryId: id,
      ...columns({ calories: kcal[index] ?? 0 }),
    }));
    this.items.push(...rows);
    this.entries.push({
      id,
      userId: options.userId ?? USER_ID,
      name,
      timestamp: options.timestamp ?? NOW,
      ...columns({
        calories: rows.reduce((sum, row) => sum + row.calories, 0),
      }),
    });
  }
}

function expected(grams: number): Nutrients {
  return roundNutrients(nutrientsFromPer100g(PER_100, grams));
}

function ownerData(): FakeDb {
  const db = new FakeDb();
  db.addEntry(
    'beef',
    'Black Angus beef burger',
    [
      {
        id: 'k1',
        name: 'Heinz tomato ketchup',
        grams: 26,
        productId: null,
        micros: { potassium: 73, vitaminA: 5 },
      },
      { id: 'b1', name: 'Sofisoft potato bun', grams: 70, productId: null },
    ],
    [27, 190],
    { timestamp: new Date('2026-09-20T12:00:00.000Z') },
  );
  db.addEntry(
    'chicken',
    'Chicken burger',
    [
      { id: 'k2', name: 'Heinz tomato ketchup', grams: 26, productId: null },
      { id: 'm1', name: 'Mayonnaise, regular', grams: 12, productId: null },
    ],
    [31, 82],
    { timestamp: new Date('2026-09-21T12:00:00.000Z') },
  );
  db.addEntry(
    'ketchup',
    'Tomato ketchup',
    [{ id: 'k3', name: 'Tomato ketchup', grams: 30, productId: OTHER_FOOD_ID }],
    [33],
    { timestamp: new Date('2026-09-22T12:00:00.000Z') },
  );
  db.addEntry(
    'foreign',
    'Their burger',
    [{ id: 'x1', name: 'Tomato ketchup', grams: 40, productId: null }],
    [60],
    { userId: OTHER_USER_ID },
  );
  return db;
}

describe('savedFoodTarget', () => {
  it('matches the name, the brand name and every other name', () => {
    const target = savedFoodTarget(
      product({ name: 'Tomato ketchup', brand: 'Heinz', aliases: ['Catsup'] }),
    );
    expect(target.itemName).toBe('Heinz Tomato ketchup');
    expect([...target.keys]).toEqual([
      'tomato ketchup',
      'heinz tomato ketchup',
      'ketchup',
    ]);
  });
});

describe('applySavedFoodToPast', () => {
  it('links, renames and recomputes every matching own item and entry', async () => {
    const db = ownerData();

    const changes = await applySavedFoodToPast(db.client, USER_ID, product(), {
      matchNames: true,
    });

    expect(changes).toEqual({
      updatedItems: 3,
      updatedEntries: 3,
      updatedFavorites: 0,
    });
    for (const id of ['k1', 'k2', 'k3']) {
      const item = db.items.find((row) => row.id === id);
      expect(item).toMatchObject({
        name: 'Heinz tomato ketchup',
        productId: FOOD_ID,
      });
      expect(nutrientsOf(item as FakeItem)).toEqual(
        expected((item as FakeItem).grams),
      );
    }
    expect(db.items.find((row) => row.id === 'x1')).toMatchObject({
      name: 'Tomato ketchup',
      productId: null,
      calories: 60,
    });
    expect(db.entries.find((e) => e.id === 'beef')?.calories).toBe(
      expected(26).calories + 190,
    );
    expect(db.entries.find((e) => e.id === 'chicken')?.calories).toBe(
      expected(26).calories + 82,
    );
  });

  it('renames a single-item entry that was named after its item', async () => {
    const db = ownerData();

    await applySavedFoodToPast(db.client, USER_ID, product(), {
      matchNames: true,
    });

    expect(db.entries.map((entry) => [entry.id, entry.name])).toEqual([
      ['beef', 'Black Angus beef burger'],
      ['chicken', 'Chicken burger'],
      ['ketchup', 'Heinz tomato ketchup'],
      ['foreign', 'Their burger'],
    ]);
  });

  it('only recomputes items already linked when names are not matched', async () => {
    const db = ownerData();
    const linked = db.items.find((item) => item.id === 'k1') as FakeItem;
    linked.productId = FOOD_ID;

    const changes = await applySavedFoodToPast(db.client, USER_ID, product(), {
      matchNames: false,
    });

    expect(changes).toMatchObject({ updatedItems: 1, updatedEntries: 1 });
    expect(db.items.find((item) => item.id === 'k2')?.productId).toBeNull();
    expect(linked.calories).toBe(expected(26).calories);
  });

  it('skips items that already carry the saved name and values', async () => {
    const db = ownerData();
    for (const item of db.items.filter((row) => row.id.startsWith('k'))) {
      Object.assign(item, {
        name: 'Heinz tomato ketchup',
        productId: FOOD_ID,
        ...expected(item.grams),
      });
    }

    const changes = await applySavedFoodToPast(db.client, USER_ID, product(), {
      matchNames: true,
    });

    expect(changes).toEqual({
      updatedItems: 0,
      updatedEntries: 0,
      updatedFavorites: 0,
    });
  });

  it('updates favorites whose items match or link to the food', async () => {
    const db = ownerData();
    const item = (name: string, grams: number, productId: string | null) => ({
      name,
      grams,
      nutrients: { ...zeroNutrients(), calories: 50 },
      confidence: null,
      count: null,
      unit: null,
      unitPlural: null,
      productId,
      micros: null,
      fluidMl: null,
    });
    db.favorites.push(
      {
        id: 'fav-1',
        userId: USER_ID,
        items: [item('Tomato ketchup', 20, null), item('Fries', 150, null)],
        ...columns({ calories: 100 }),
      },
      {
        id: 'fav-2',
        userId: USER_ID,
        items: [item('Sauce', 10, FOOD_ID)],
        ...columns({ calories: 50 }),
      },
      {
        id: 'fav-3',
        userId: USER_ID,
        items: [item('Fries', 150, null)],
        ...columns({ calories: 50 }),
      },
    );

    const changes = await applySavedFoodToPast(db.client, USER_ID, product(), {
      matchNames: true,
    });

    expect(changes.updatedFavorites).toBe(2);
    const [first, second, third] = db.favorites;
    expect(first?.items).toEqual([
      {
        ...item('Heinz tomato ketchup', 20, FOOD_ID),
        nutrients: expected(20),
      },
      item('Fries', 150, null),
    ]);
    expect(first?.calories).toBe(expected(20).calories + 50);
    expect(second?.items).toMatchObject([
      { name: 'Heinz tomato ketchup', productId: FOOD_ID },
    ]);
    expect(third?.calories).toBe(50);
  });

  it('sets item micros from a saved food that has them', async () => {
    const db = ownerData();
    db.favorites.push({
      id: 'fav-1',
      userId: USER_ID,
      items: [
        {
          name: 'Tomato ketchup',
          grams: 20,
          nutrients: { ...zeroNutrients(), calories: 22 },
          micros: { potassium: 10 },
          fluidMl: null,
        },
      ],
      ...columns({ calories: 22 }),
    });
    const food = product({ microsPer100: { potassium: 281, vitaminA: 21 } });

    await applySavedFoodToPast(db.client, USER_ID, food, { matchNames: true });

    expect(
      db.items
        .filter((item) => item.id.startsWith('k'))
        .map(({ id, micros }) => [id, micros]),
    ).toEqual([
      ['k1', { potassium: 73, vitaminA: 5 }],
      ['k2', { potassium: 73, vitaminA: 5 }],
      ['k3', { potassium: 84, vitaminA: 6 }],
    ]);
    expect(db.favorites[0]?.items).toMatchObject([
      { micros: { potassium: 56, vitaminA: 4 } },
    ]);
  });

  it('keeps the own micros of items when the saved food has none', async () => {
    const db = ownerData();

    await applySavedFoodToPast(db.client, USER_ID, product(), {
      matchNames: true,
    });

    expect(db.items.find((item) => item.id === 'k1')?.micros).toEqual({
      potassium: 73,
      vitaminA: 5,
    });
    expect(db.items.find((item) => item.id === 'k2')?.micros).toBeUndefined();
  });

  it('updates items whose only difference is their micros', async () => {
    const db = ownerData();
    for (const item of db.items.filter((row) => row.id.startsWith('k'))) {
      Object.assign(item, {
        name: 'Heinz tomato ketchup',
        productId: FOOD_ID,
        ...expected(item.grams),
      });
    }
    const food = product({ microsPer100: { potassium: 281 } });

    const changes = await applySavedFoodToPast(db.client, USER_ID, food, {
      matchNames: true,
    });

    expect(changes.updatedItems).toBe(3);
    expect(db.items.find((item) => item.id === 'k3')?.micros).toEqual({
      potassium: 84,
    });
    await expect(
      applySavedFoodToPast(db.client, USER_ID, food, { matchNames: true }),
    ).resolves.toMatchObject({ updatedItems: 0 });
  });

  it('raises the usage of the food to the entries that now use it', async () => {
    const db = ownerData();

    await applySavedFoodToPast(db.client, USER_ID, product({ useCount: 1 }), {
      matchNames: true,
    });

    expect(db.productUpdates).toEqual([
      {
        where: { id: FOOD_ID },
        data: {
          useCount: 3,
          lastUsedAt: new Date('2026-09-22T12:00:00.000Z'),
        },
      },
    ]);
  });

  it('keeps a higher usage and a later use as they are', async () => {
    const db = ownerData();

    await applySavedFoodToPast(
      db.client,
      USER_ID,
      product({ useCount: 9, lastUsedAt: NOW }),
      { matchNames: true },
    );

    expect(db.productUpdates).toEqual([]);
  });
});

describe('unlinkSavedFoodCopies', () => {
  it('removes the link from favorites and drafts only where it is used', async () => {
    const db = new FakeDb();
    const linked = {
      name: 'Heinz tomato ketchup',
      grams: 20,
      nutrients: { ...zeroNutrients(), calories: 22 },
      confidence: null,
      count: null,
      unit: null,
      unitPlural: null,
      productId: FOOD_ID,
      micros: { potassium: 56 },
      fluidMl: null,
    };
    db.favorites.push(
      { id: 'fav-1', userId: USER_ID, items: [linked], ...columns({}) },
      {
        id: 'fav-2',
        userId: USER_ID,
        items: [{ ...linked, productId: OTHER_FOOD_ID }],
        ...columns({}),
      },
    );
    db.drafts.push(
      { id: 'draft-1', userId: USER_ID, items: null },
      { id: 'draft-2', userId: USER_ID, items: [linked] },
    );
    const updateFavorite = vi.spyOn(db.tx.favorite, 'update');

    await unlinkSavedFoodCopies(db.client, USER_ID, FOOD_ID);

    expect(db.favorites[0]?.items).toEqual([{ ...linked, productId: null }]);
    expect(db.favorites[1]?.items).toEqual([
      { ...linked, productId: OTHER_FOOD_ID },
    ]);
    expect(db.drafts[1]?.items).toEqual([{ ...linked, productId: null }]);
    expect(db.drafts[0]?.items).toBeNull();
    expect(updateFavorite).toHaveBeenCalledTimes(1);
  });
});
