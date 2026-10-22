import type { Prisma } from '../generated/prisma/client.js';

export type ProductLinkClient = Pick<Prisma.TransactionClient, 'product'>;

export interface ProductLinked {
  productId?: string | null;
}

export type WithProductLink<T> = T & { productId: string | null };

export function linkedProductIds(items: readonly ProductLinked[]): string[] {
  return [
    ...new Set(
      items.flatMap(({ productId }) => (productId ? [productId] : [])),
    ),
  ];
}

export async function withOwnedProductLinks<T extends ProductLinked>(
  client: ProductLinkClient,
  userId: string,
  items: readonly T[],
): Promise<WithProductLink<T>[]> {
  const ids = linkedProductIds(items);
  const owned =
    ids.length === 0
      ? new Set<string>()
      : new Set(
          (
            await client.product.findMany({
              where: { userId, id: { in: ids } },
              select: { id: true },
            })
          ).map(({ id }) => id),
        );
  return items.map((item) => ({
    ...item,
    productId:
      item.productId && owned.has(item.productId) ? item.productId : null,
  }));
}

export async function touchLinkedProducts(
  client: ProductLinkClient,
  userId: string,
  items: readonly ProductLinked[],
  usedAt: Date = new Date(),
): Promise<void> {
  const ids = linkedProductIds(items);
  if (ids.length === 0) {
    return;
  }
  await client.product.updateMany({
    where: { userId, id: { in: ids } },
    data: { useCount: { increment: 1 }, lastUsedAt: usedAt },
  });
}
