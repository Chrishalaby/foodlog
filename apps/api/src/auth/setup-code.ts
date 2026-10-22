import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const SETUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SETUP_CODE_GROUPS = 3;
const SETUP_CODE_GROUP_LENGTH = 4;

function randomGroup(): string {
  return Array.from(
    { length: SETUP_CODE_GROUP_LENGTH },
    () => SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)],
  ).join('');
}

export function generateSetupCode(): string {
  return Array.from({ length: SETUP_CODE_GROUPS }, randomGroup).join('-');
}

export function normalizeSetupCode(code: string): string {
  return code.replace(/[\s-]+/g, '').toUpperCase();
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function setupCodesMatch(candidate: string, expected: string): boolean {
  const normalizedExpected = normalizeSetupCode(expected);
  if (normalizedExpected === '') {
    return false;
  }
  return timingSafeEqual(
    digest(normalizeSetupCode(candidate)),
    digest(normalizedExpected),
  );
}
