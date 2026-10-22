import { API_LIMITS, addDays } from '@food/shared';
import { BadRequestException } from '@nestjs/common';
import { decodeEntryCursor, encodeEntryCursor } from './entry-cursor.js';
import {
  entryCursorFilter,
  entryListOrder,
  entryRangeFilter,
  entrySearchFilter,
  escapeLikePattern,
  parseEntryCursor,
  resolveDateRange,
  toHistoryPage,
} from './entry-query.js';

const ID_A = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b';
const ID_B = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5c';
const ID_C = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5d';

function row(id: string, iso: string) {
  return { id, timestamp: new Date(iso) };
}

describe('resolveDateRange', () => {
  it('returns null when neither bound is given', () => {
    expect(resolveDateRange(undefined, undefined)).toBeNull();
  });

  it('accepts a single day and the maximum span', () => {
    expect(resolveDateRange('2026-09-28', '2026-09-28')).toEqual({
      from: '2026-09-28',
      to: '2026-09-28',
    });
    const to = addDays('2026-01-01', API_LIMITS.rangeMaxDays - 1);
    expect(resolveDateRange('2026-01-01', to)).toEqual({
      from: '2026-01-01',
      to,
    });
  });

  it.each([
    ['only from', '2026-09-01', undefined],
    ['only to', undefined, '2026-09-01'],
    ['from after to', '2026-09-02', '2026-09-01'],
    [
      'a span over the maximum',
      '2026-01-01',
      addDays('2026-01-01', API_LIMITS.rangeMaxDays),
    ],
  ])('rejects %s', (_label, from, to) => {
    expect(() => resolveDateRange(from, to)).toThrow(BadRequestException);
  });
});

describe('parseEntryCursor', () => {
  it('returns null without a cursor and decodes issued cursors', () => {
    const cursor = {
      timestamp: new Date('2026-09-28T08:00:00.000Z'),
      id: ID_A,
    };

    expect(parseEntryCursor(undefined)).toBeNull();
    expect(parseEntryCursor(encodeEntryCursor(cursor))).toEqual(cursor);
  });

  it('rejects malformed cursors with a 400', () => {
    expect(() => parseEntryCursor('garbage!')).toThrow(BadRequestException);
  });
});

describe('entry filters', () => {
  it('orders by timestamp then id, newest first', () => {
    expect(entryListOrder()).toEqual([{ timestamp: 'desc' }, { id: 'desc' }]);
  });

  it('builds no search filter for blank queries', () => {
    expect(entrySearchFilter(undefined)).toEqual({});
    expect(entrySearchFilter('   ')).toEqual({});
  });

  it('searches name, description and item names case-insensitively', () => {
    const contains = { contains: 'oats', mode: 'insensitive' };

    expect(entrySearchFilter('  oats ')).toEqual({
      OR: [
        { name: contains },
        { description: contains },
        { items: { some: { name: contains } } },
      ],
    });
  });

  it('escapes like wildcards so they match literally', () => {
    expect(escapeLikePattern('100% whole_grain \\ oats')).toBe(
      '100\\% whole\\_grain \\\\ oats',
    );
    expect(entrySearchFilter('50%')).toMatchObject({
      OR: [{ name: { contains: '50\\%', mode: 'insensitive' } }, {}, {}],
    });
  });

  it('continues strictly after the cursor with id as the tie breaker', () => {
    const timestamp = new Date('2026-09-28T08:00:00.000Z');

    expect(entryCursorFilter(null)).toEqual({});
    expect(entryCursorFilter({ timestamp, id: ID_B })).toEqual({
      OR: [{ timestamp: { lt: timestamp } }, { timestamp, id: { lt: ID_B } }],
    });
  });

  it('filters local dates inclusively', () => {
    expect(entryRangeFilter({ from: '2026-09-01', to: '2026-09-07' })).toEqual({
      localDate: { gte: '2026-09-01', lte: '2026-09-07' },
    });
  });
});

describe('toHistoryPage', () => {
  const rows = [
    row(ID_C, '2026-09-28T10:00:00.000Z'),
    row(ID_B, '2026-09-28T09:00:00.000Z'),
    row(ID_A, '2026-09-28T09:00:00.000Z'),
  ];

  it('issues a cursor for the last returned row when more rows exist', () => {
    const page = toHistoryPage(rows, 2);

    expect(page.rows.map((r) => r.id)).toEqual([ID_C, ID_B]);
    expect(decodeEntryCursor(page.nextCursor ?? '')).toEqual({
      id: ID_B,
      timestamp: new Date('2026-09-28T09:00:00.000Z'),
    });
  });

  it('returns no cursor when the page holds every remaining row', () => {
    expect(toHistoryPage(rows, 3)).toEqual({ rows, nextCursor: null });
    expect(toHistoryPage(rows, 5).nextCursor).toBeNull();
    expect(toHistoryPage([], 5)).toEqual({ rows: [], nextCursor: null });
  });
});
