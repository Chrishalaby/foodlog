import { isUUID } from 'class-validator';
import { isStorableTime } from './storable-time.js';

export interface EntryCursor {
  timestamp: Date;
  id: string;
}

export const ENTRY_CURSOR_MAX_LENGTH = 128;

const ENCODED_PATTERN = /^[A-Za-z0-9_-]+$/;
const PAYLOAD_PATTERN = /^(-?\d{1,16})\.([0-9a-f-]{36})$/;

export function encodeEntryCursor(cursor: EntryCursor): string {
  const payload = `${cursor.timestamp.getTime()}.${cursor.id}`;
  return Buffer.from(payload, 'utf8').toString('base64url');
}

export function decodeEntryCursor(value: string): EntryCursor | null {
  if (value.length > ENTRY_CURSOR_MAX_LENGTH || !ENCODED_PATTERN.test(value)) {
    return null;
  }
  const payload = Buffer.from(value, 'base64url').toString('utf8');
  const match = PAYLOAD_PATTERN.exec(payload);
  if (!match) {
    return null;
  }
  const [, millis = '', id = ''] = match;
  const timestamp = new Date(Number(millis));
  if (!isStorableTime(timestamp.getTime()) || !isUUID(id)) {
    return null;
  }
  const cursor = { timestamp, id };
  return encodeEntryCursor(cursor) === value ? cursor : null;
}
