import type { NoteListQuery, NoteStatus } from '@food/shared';
import {
  type EntryCursor,
  encodeEntryCursor,
} from '../entries/entry-cursor.js';
import { escapeLikePattern } from '../entries/entry-query.js';
import type { Prisma } from '../generated/prisma/client.js';

export const DEFAULT_NOTES_PAGE_SIZE = 50;

export interface NoteCursorRow {
  id: string;
  createdAt: Date;
}

export interface NotePage<T> {
  rows: T[];
  nextCursor: string | null;
}

const STATUS_FILTERS: Record<NoteStatus, Prisma.NoteWhereInput> = {
  all: {},
  open: { done: false },
  done: { done: true },
};

export function noteListOrder(): Prisma.NoteOrderByWithRelationInput[] {
  return [{ createdAt: 'desc' }, { id: 'desc' }];
}

export function noteSearchTokens(q: string | undefined): string[] {
  const tokens = (q ?? '').split(/\s+/).filter((token) => token !== '');
  return [...new Set(tokens)];
}

export function noteSearchFilter(q: string | undefined): Prisma.NoteWhereInput {
  const tokens = noteSearchTokens(q);
  if (tokens.length === 0) {
    return {};
  }
  return {
    AND: tokens.map((token) => ({
      text: { contains: escapeLikePattern(token), mode: 'insensitive' },
    })),
  };
}

export function noteStatusFilter(
  status: NoteStatus = 'all',
): Prisma.NoteWhereInput {
  return STATUS_FILTERS[status];
}

export function noteCursorFilter(
  cursor: EntryCursor | null,
): Prisma.NoteWhereInput {
  if (!cursor) {
    return {};
  }
  return {
    OR: [
      { createdAt: { lt: cursor.timestamp } },
      { createdAt: cursor.timestamp, id: { lt: cursor.id } },
    ],
  };
}

export function noteListWhere(
  userId: string,
  query: Pick<NoteListQuery, 'q' | 'status'>,
  cursor: EntryCursor | null,
): Prisma.NoteWhereInput {
  return {
    userId,
    AND: [
      noteSearchFilter(query.q),
      noteStatusFilter(query.status),
      noteCursorFilter(cursor),
    ],
  };
}

export function toNotePage<T extends NoteCursorRow>(
  rows: readonly T[],
  limit: number,
): NotePage<T> {
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const hasMore = rows.length > limit && last !== undefined;
  return {
    rows: page,
    nextCursor: hasMore
      ? encodeEntryCursor({ timestamp: last.createdAt, id: last.id })
      : null,
  };
}
