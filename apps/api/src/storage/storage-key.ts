const STORAGE_KEY_PATTERN =
  /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const MAX_STORAGE_KEY_LENGTH = 512;

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(`Invalid storage key: ${JSON.stringify(key)}`);
    this.name = 'InvalidStorageKeyError';
  }
}

export function assertValidStorageKey(key: string): void {
  if (key.length > MAX_STORAGE_KEY_LENGTH || !STORAGE_KEY_PATTERN.test(key)) {
    throw new InvalidStorageKeyError(key);
  }
}
