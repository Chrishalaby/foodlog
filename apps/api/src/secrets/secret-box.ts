import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';

export const SECRET_BOX_VERSION = 'v1';
export const SECRET_KEY_SOURCES = ['env', 'db'] as const;

export type SecretKeySource = (typeof SECRET_KEY_SOURCES)[number];

export type SecretKeyring = Partial<Record<SecretKeySource, Buffer>>;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_SALT = 'foodlog-secret-box';

export function deriveSecretKey(material: string): Buffer {
  return Buffer.from(hkdfSync('sha256', material, KEY_SALT, 'aes-256-gcm', 32));
}

export function sealSecret(
  plaintext: string,
  key: Buffer,
  source: SecretKeySource,
  purpose: string,
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(purpose, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [
    SECRET_BOX_VERSION,
    source,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

function isKeySource(value: string | undefined): value is SecretKeySource {
  return SECRET_KEY_SOURCES.includes(value as SecretKeySource);
}

export function sealedKeySource(sealed: string): SecretKeySource | null {
  const [version, source] = sealed.split(':');
  return version === SECRET_BOX_VERSION && isKeySource(source) ? source : null;
}

export function openSecret(
  sealed: string,
  keyring: SecretKeyring,
  purpose: string,
): string | null {
  const [version, source, iv, tag, ciphertext, ...rest] = sealed.split(':');
  const key = isKeySource(source) ? keyring[source] : undefined;
  if (
    version !== SECRET_BOX_VERSION ||
    rest.length > 0 ||
    !key ||
    iv === undefined ||
    tag === undefined ||
    ciphertext === undefined
  ) {
    return null;
  }
  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'base64url'),
      { authTagLength: TAG_BYTES },
    );
    decipher.setAAD(Buffer.from(purpose, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
