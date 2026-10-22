import {
  deriveSecretKey,
  openSecret,
  sealedKeySource,
  sealSecret,
} from './secret-box.js';

const KEY = deriveSecretKey('a'.repeat(48));
const OTHER_KEY = deriveSecretKey('b'.repeat(48));
const PURPOSE = 'ai-provider.api-key';
const SECRET = 'sk-test-0000000000001a2b';

describe('secret box', () => {
  it('round-trips a secret without storing it in readable form', () => {
    const sealed = sealSecret(SECRET, KEY, 'env', PURPOSE);

    expect(sealed.startsWith('v1:env:')).toBe(true);
    expect(sealed).not.toContain(SECRET);
    expect(sealed).not.toContain(Buffer.from(SECRET).toString('base64url'));
    expect(sealedKeySource(sealed)).toBe('env');
    expect(openSecret(sealed, { env: KEY }, PURPOSE)).toBe(SECRET);
  });

  it('uses a fresh IV for every seal', () => {
    expect(sealSecret(SECRET, KEY, 'db', PURPOSE)).not.toBe(
      sealSecret(SECRET, KEY, 'db', PURPOSE),
    );
  });

  it('refuses the wrong key, the wrong purpose or a tampered value', () => {
    const sealed = sealSecret(SECRET, KEY, 'db', PURPOSE);
    const parts = sealed.split(':');
    const ciphertext = Buffer.from(parts[4] ?? '', 'base64url');
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    const tampered = [
      ...parts.slice(0, 4),
      ciphertext.toString('base64url'),
    ].join(':');

    expect(openSecret(sealed, { db: OTHER_KEY }, PURPOSE)).toBeNull();
    expect(openSecret(sealed, { db: KEY }, 'other-purpose')).toBeNull();
    expect(openSecret(sealed, { env: KEY }, PURPOSE)).toBeNull();
    expect(openSecret(tampered, { db: KEY }, PURPOSE)).toBeNull();
  });

  it('rejects values in an unknown format', () => {
    expect(sealedKeySource('plain-text')).toBeNull();
    expect(openSecret('plain-text', { env: KEY }, PURPOSE)).toBeNull();
    expect(openSecret('v2:env:a:b:c', { env: KEY }, PURPOSE)).toBeNull();
    expect(openSecret('v1:env:a:b:c:d', { env: KEY }, PURPOSE)).toBeNull();
  });
});
