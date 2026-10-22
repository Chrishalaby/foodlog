import { randomBytes } from 'node:crypto';

export function uuidV7(timeMs: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(Math.max(0, Math.floor(timeMs)) % 2 ** 48, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
