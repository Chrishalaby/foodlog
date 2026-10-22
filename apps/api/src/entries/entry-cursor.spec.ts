import {
  decodeEntryCursor,
  ENTRY_CURSOR_MAX_LENGTH,
  encodeEntryCursor,
} from './entry-cursor.js';

const ID = '019a1b2c-3d4e-7f60-8a9b-0c1d2e3f4a5b';
const TIMESTAMP = new Date('2026-09-28T12:34:56.789Z');

function encodeRaw(payload: string): string {
  return Buffer.from(payload, 'utf8').toString('base64url');
}

describe('entry cursor', () => {
  it('round-trips a timestamp and id through an opaque base64url string', () => {
    const cursor = encodeEntryCursor({ timestamp: TIMESTAMP, id: ID });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).not.toContain(ID);
    expect(decodeEntryCursor(cursor)).toEqual({ timestamp: TIMESTAMP, id: ID });
  });

  it('keeps millisecond precision', () => {
    const timestamp = new Date('2026-01-01T00:00:00.001Z');
    const decoded = decodeEntryCursor(encodeEntryCursor({ timestamp, id: ID }));

    expect(decoded?.timestamp.getTime()).toBe(timestamp.getTime());
  });

  it('supports timestamps before the unix epoch', () => {
    const timestamp = new Date('1969-12-31T23:59:59.000Z');

    expect(decodeEntryCursor(encodeEntryCursor({ timestamp, id: ID }))).toEqual(
      { timestamp, id: ID },
    );
  });

  it.each([
    ['an empty string', ''],
    ['characters outside base64url', 'abc+/='],
    ['plain text', 'not-a-cursor'],
    ['a payload without an id', encodeRaw(`${TIMESTAMP.getTime()}.`)],
    ['a payload without a timestamp', encodeRaw(`.${ID}`)],
    ['a payload with an invalid uuid', encodeRaw(`123.${'z'.repeat(36)}`)],
    [
      'a payload with a malformed uuid',
      encodeRaw('123.019a1b2c-3d4e-7f60-8a9b0-c1d2e3f4a5b'),
    ],
    [
      'a payload with an out-of-range timestamp',
      encodeRaw(`9999999999999999.${ID}`),
    ],
    [
      'a payload with a timestamp the database cannot store',
      encodeRaw(`-8640000000000000.${ID}`),
    ],
    [
      'a payload with a timestamp after year 9999',
      encodeRaw(`253402300800000.${ID}`),
    ],
    ['a json payload', encodeRaw(JSON.stringify({ t: 1, id: ID }))],
    [
      'a non-canonical encoding',
      `${encodeEntryCursor({ timestamp: TIMESTAMP, id: ID })}A`,
    ],
    ['an overly long value', 'A'.repeat(ENTRY_CURSOR_MAX_LENGTH + 4)],
  ])('rejects %s', (_label, value) => {
    expect(decodeEntryCursor(value)).toBeNull();
  });
});
