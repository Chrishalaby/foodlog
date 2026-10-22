import type { Prisma } from '../generated/prisma/client.js';
import {
  linkedProductIds,
  touchLinkedProducts,
  withOwnedProductLinks,
} from './product-links.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const OWN_ID = '019a0000-0000-7000-8000-0000000000d1';
const FOREIGN_ID = '019a0000-0000-7000-8000-0000000000d2';
const USED_AT = new Date('2026-09-30T10:00:00.000Z');

function setup(ownedIds: string[] = [OWN_ID]) {
  const product = {
    findMany: vi.fn((args: { where: { id: { in: string[] } } }) =>
      Promise.resolve(
        args.where.id.in
          .filter((id) => ownedIds.includes(id))
          .map((id) => ({ id })),
      ),
    ),
    updateMany: vi.fn(() => Promise.resolve({ count: 1 })),
  };
  const client = { product } as unknown as Pick<
    Prisma.TransactionClient,
    'product'
  >;
  return { product, client };
}

describe('linkedProductIds', () => {
  it('lists each linked product once', () => {
    expect(
      linkedProductIds([
        { productId: OWN_ID },
        {},
        { productId: null },
        { productId: OWN_ID },
        { productId: FOREIGN_ID },
      ]),
    ).toEqual([OWN_ID, FOREIGN_ID]);
  });
});

describe('withOwnedProductLinks', () => {
  it('keeps links to own products and clears every other link', async () => {
    const { product, client } = setup();

    const items = await withOwnedProductLinks(client, USER_ID, [
      { name: 'Ketchup', productId: OWN_ID },
      { name: 'Mayo', productId: FOREIGN_ID },
      { name: 'Bun' },
    ]);

    expect(items).toEqual([
      { name: 'Ketchup', productId: OWN_ID },
      { name: 'Mayo', productId: null },
      { name: 'Bun', productId: null },
    ]);
    expect(product.findMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: [OWN_ID, FOREIGN_ID] } },
      select: { id: true },
    });
  });

  it('does not query without links', async () => {
    const { product, client } = setup();

    await expect(
      withOwnedProductLinks(client, USER_ID, [
        { name: 'Bun', productId: null },
      ]),
    ).resolves.toEqual([{ name: 'Bun', productId: null }]);
    expect(product.findMany).not.toHaveBeenCalled();
  });
});

describe('touchLinkedProducts', () => {
  it('counts one use for each distinct own product', async () => {
    const { product, client } = setup();

    await touchLinkedProducts(
      client,
      USER_ID,
      [{ productId: OWN_ID }, { productId: OWN_ID }, { productId: null }],
      USED_AT,
    );

    expect(product.updateMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, id: { in: [OWN_ID] } },
      data: { useCount: { increment: 1 }, lastUsedAt: USED_AT },
    });
  });

  it('does nothing without links', async () => {
    const { product, client } = setup();

    await touchLinkedProducts(client, USER_ID, [{}, { productId: null }]);

    expect(product.updateMany).not.toHaveBeenCalled();
  });
});
