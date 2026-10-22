import { ENTRY_INCLUDE, type EntryWithRelations } from '../common/mappers.js';
import {
  touchLinkedProducts,
  withOwnedProductLinks,
} from '../common/product-links.js';
import type { Prisma } from '../generated/prisma/client.js';
import { entryCreateData, type NewEntry } from './entry-data.js';

export type EntryWriteClient = Pick<
  Prisma.TransactionClient,
  'entry' | 'product'
>;

export type EntryCreateExtras = Pick<
  Prisma.EntryUncheckedCreateInput,
  'productId'
>;

export async function createLinkedEntry(
  client: EntryWriteClient,
  entry: NewEntry,
  extras: EntryCreateExtras = {},
): Promise<EntryWithRelations> {
  const items = await withOwnedProductLinks(client, entry.userId, entry.items);
  const created = await client.entry.create({
    data: { ...entryCreateData({ ...entry, items }), ...extras },
    include: ENTRY_INCLUDE,
  });
  await touchLinkedProducts(client, entry.userId, items);
  return created;
}
