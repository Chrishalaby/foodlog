import { decodeEntryCursor } from '../entries/entry-cursor.js';
import {
  DEFAULT_NOTES_PAGE_SIZE,
  noteCursorFilter,
  noteListOrder,
  noteListWhere,
  noteSearchFilter,
  noteSearchTokens,
  noteStatusFilter,
  toNotePage,
} from './note-query.js';

const USER_ID = '019a0000-0000-7000-8000-000000000001';
const ID_A = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b';
const ID_B = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5c';
const ID_C = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5d';

function row(id: string, iso: string) {
  return { id, createdAt: new Date(iso) };
}

function contains(token: string) {
  return { text: { contains: token, mode: 'insensitive' } };
}

describe('note search', () => {
  it('splits the query into tokens on any whitespace', () => {
    expect(noteSearchTokens('  buy\tthe \n mirror ')).toEqual([
      'buy',
      'the',
      'mirror',
    ]);
  });

  it('has no tokens for a missing or blank query', () => {
    expect(noteSearchTokens(undefined)).toEqual([]);
    expect(noteSearchTokens('   ')).toEqual([]);
  });

  it('keeps each token once', () => {
    expect(noteSearchTokens('mirror buy mirror')).toEqual(['mirror', 'buy']);
  });

  it('builds no filter for a blank query', () => {
    expect(noteSearchFilter(undefined)).toEqual({});
    expect(noteSearchFilter('  ')).toEqual({});
  });

  it('requires every token as a case-insensitive part of the text', () => {
    expect(noteSearchFilter(' Shelf  20cm ')).toEqual({
      AND: [contains('Shelf'), contains('20cm')],
    });
  });

  it('escapes like wildcards so they match literally', () => {
    expect(noteSearchFilter('50% off_now')).toEqual({
      AND: [contains('50\\%'), contains('off\\_now')],
    });
  });
});

describe('note status', () => {
  it('keeps every note by default and for all', () => {
    expect(noteStatusFilter(undefined)).toEqual({});
    expect(noteStatusFilter('all')).toEqual({});
  });

  it('keeps open or done notes', () => {
    expect(noteStatusFilter('open')).toEqual({ done: false });
    expect(noteStatusFilter('done')).toEqual({ done: true });
  });
});

describe('note list query', () => {
  it('orders by creation time then id, newest first', () => {
    expect(noteListOrder()).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('continues strictly after the cursor with id as the tie breaker', () => {
    const timestamp = new Date('2026-10-07T08:00:00.000Z');

    expect(noteCursorFilter(null)).toEqual({});
    expect(noteCursorFilter({ timestamp, id: ID_B })).toEqual({
      OR: [
        { createdAt: { lt: timestamp } },
        { createdAt: timestamp, id: { lt: ID_B } },
      ],
    });
  });

  it('always scopes the list to the owner', () => {
    expect(noteListWhere(USER_ID, {}, null)).toEqual({
      userId: USER_ID,
      AND: [{}, {}, {}],
    });
  });

  it('combines search, status and cursor', () => {
    const timestamp = new Date('2026-10-07T08:00:00.000Z');

    expect(
      noteListWhere(
        USER_ID,
        { q: 'buy mirror', status: 'open' },
        { timestamp, id: ID_A },
      ),
    ).toEqual({
      userId: USER_ID,
      AND: [
        { AND: [contains('buy'), contains('mirror')] },
        { done: false },
        {
          OR: [
            { createdAt: { lt: timestamp } },
            { createdAt: timestamp, id: { lt: ID_A } },
          ],
        },
      ],
    });
  });

  it('pages 50 notes unless told otherwise', () => {
    expect(DEFAULT_NOTES_PAGE_SIZE).toBe(50);
  });
});

describe('toNotePage', () => {
  const rows = [
    row(ID_C, '2026-10-07T10:00:00.000Z'),
    row(ID_B, '2026-10-07T09:00:00.000Z'),
    row(ID_A, '2026-10-07T09:00:00.000Z'),
  ];

  it('issues a cursor for the last returned note when more notes exist', () => {
    const page = toNotePage(rows, 2);

    expect(page.rows.map(({ id }) => id)).toEqual([ID_C, ID_B]);
    expect(decodeEntryCursor(page.nextCursor ?? '')).toEqual({
      id: ID_B,
      timestamp: new Date('2026-10-07T09:00:00.000Z'),
    });
  });

  it('returns no cursor on the last page', () => {
    expect(toNotePage(rows, 3)).toEqual({ rows, nextCursor: null });
    expect(toNotePage(rows, 5).nextCursor).toBeNull();
    expect(toNotePage([], 5)).toEqual({ rows: [], nextCursor: null });
  });
});
