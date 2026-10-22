const MIN_STORABLE_TIME = Date.parse('0001-01-01T00:00:00.000Z');
const MAX_STORABLE_TIME = Date.parse('9999-12-31T23:59:59.999Z');

export function isStorableTime(millis: number): boolean {
  return millis >= MIN_STORABLE_TIME && millis <= MAX_STORABLE_TIME;
}
