import { API_LIMITS, diffDays } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import {
  decodeEntryCursor,
  type EntryCursor,
  encodeEntryCursor,
} from './entry-cursor.js';

export const DEFAULT_HISTORY_PAGE_SIZE = 30;

export interface DateRange {
  from: string;
  to: string;
}

export interface HistoryPage<T> {
  rows: T[];
  nextCursor: string | null;
}

export function entryListOrder(): Prisma.EntryOrderByWithRelationInput[] {
  return [{ timestamp: 'desc' }, { id: 'desc' }];
}

export function resolveDateRange(
  from: string | undefined,
  to: string | undefined,
): DateRange | null {
  if (from === undefined && to === undefined) {
    return null;
  }
  if (from === undefined || to === undefined) {
    throw new BadRequestException('from and to must be provided together');
  }
  if (from > to) {
    throw new BadRequestException('from must not be after to');
  }
  if (diffDays(from, to) + 1 > API_LIMITS.rangeMaxDays) {
    throw new BadRequestException(
      `The date range must not exceed ${API_LIMITS.rangeMaxDays} days`,
    );
  }
  return { from, to };
}

export function parseEntryCursor(
  value: string | undefined,
): EntryCursor | null {
  if (value === undefined) {
    return null;
  }
  const cursor = decodeEntryCursor(value);
  if (!cursor) {
    throw new BadRequestException(
      'before must be a cursor returned by the API',
    );
  }
  return cursor;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

export function entrySearchFilter(
  q: string | undefined,
): Prisma.EntryWhereInput {
  const term = q?.trim();
  if (!term) {
    return {};
  }
  const contains = {
    contains: escapeLikePattern(term),
    mode: 'insensitive',
  } as const;
  return {
    OR: [
      { name: contains },
      { description: contains },
      { items: { some: { name: contains } } },
    ],
  };
}

export function entryCursorFilter(
  cursor: EntryCursor | null,
): Prisma.EntryWhereInput {
  if (!cursor) {
    return {};
  }
  return {
    OR: [
      { timestamp: { lt: cursor.timestamp } },
      { timestamp: cursor.timestamp, id: { lt: cursor.id } },
    ],
  };
}

export function entryRangeFilter(range: DateRange): Prisma.EntryWhereInput {
  return { localDate: { gte: range.from, lte: range.to } };
}

export function toHistoryPage<T extends EntryCursor>(
  rows: readonly T[],
  limit: number,
): HistoryPage<T> {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return {
    rows: page,
    nextCursor: hasMore
      ? encodeEntryCursor({ timestamp: last.timestamp, id: last.id })
      : null,
  };
}
