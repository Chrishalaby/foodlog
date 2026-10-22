import { buildConfig } from '../../test/support/config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  ENCRYPTION_SECRET_KEY,
  generateSecret,
  JWT_SECRET_KEY,
  SecretsService,
} from './secrets.service.js';

function createPrismaMock(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const appSecret = {
    findUnique: vi.fn(({ where }: { where: { key: string } }) => {
      const value = store.get(where.key);
      return Promise.resolve(value === undefined ? null : { value });
    }),
    createMany: vi.fn(({ data }: { data: { key: string; value: string } }) => {
      if (!store.has(data.key)) {
        store.set(data.key, data.value);
        return Promise.resolve({ count: 1 });
      }
      return Promise.resolve({ count: 0 });
    }),
  };
  return {
    store,
    appSecret,
    prisma: { appSecret } as unknown as PrismaService,
  };
}

describe('SecretsService', () => {
  it('uses JWT_SECRET from the environment without touching the database', async () => {
    const jwtSecret = 'x'.repeat(40);
    const mock = createPrismaMock();
    const service = new SecretsService(
      mock.prisma,
      buildConfig({ JWT_SECRET: jwtSecret }),
    );

    await expect(service.jwtSecret()).resolves.toBe(jwtSecret);
    expect(mock.appSecret.findUnique).not.toHaveBeenCalled();
  });

  it('returns the stored secret when one exists', async () => {
    const mock = createPrismaMock({ [JWT_SECRET_KEY]: 'stored-secret' });
    const service = new SecretsService(mock.prisma, buildConfig());

    await expect(service.jwtSecret()).resolves.toBe('stored-secret');
    expect(mock.appSecret.createMany).not.toHaveBeenCalled();
  });

  it('creates a random secret with skipDuplicates when none exists', async () => {
    const mock = createPrismaMock();
    const service = new SecretsService(mock.prisma, buildConfig());

    const secret = await service.jwtSecret();

    expect(secret).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(mock.store.get(JWT_SECRET_KEY)).toBe(secret);
    expect(mock.appSecret.createMany).toHaveBeenCalledWith({
      data: { key: JWT_SECRET_KEY, value: expect.any(String) as string },
      skipDuplicates: true,
    });
    await expect(service.jwtSecret()).resolves.toBe(secret);
  });

  it('returns the winner of a concurrent insert', async () => {
    const mock = createPrismaMock();
    mock.appSecret.findUnique.mockResolvedValueOnce(null);
    mock.appSecret.createMany.mockImplementationOnce(() => {
      mock.store.set(JWT_SECRET_KEY, 'written-by-another-instance');
      return Promise.resolve({ count: 0 });
    });
    const service = new SecretsService(mock.prisma, buildConfig());

    await expect(service.jwtSecret()).resolves.toBe(
      'written-by-another-instance',
    );
  });

  it('encrypts with SECRETS_KEY without storing a key in the database', async () => {
    const mock = createPrismaMock();
    const service = new SecretsService(
      mock.prisma,
      buildConfig({ SECRETS_KEY: 's'.repeat(40) }),
    );

    const sealed = await service.seal('sk-secret-value', 'purpose');

    expect(sealed.startsWith('v1:env:')).toBe(true);
    expect(sealed).not.toContain('sk-secret-value');
    expect(mock.appSecret.createMany).not.toHaveBeenCalled();
    await expect(service.open(sealed, 'purpose')).resolves.toBe(
      'sk-secret-value',
    );
    await expect(service.open(sealed, 'other')).resolves.toBeNull();
  });

  it('falls back to a generated key stored in the database', async () => {
    const mock = createPrismaMock();
    const service = new SecretsService(mock.prisma, buildConfig());

    const sealed = await service.seal('sk-secret-value', 'purpose');

    expect(sealed.startsWith('v1:db:')).toBe(true);
    expect(mock.store.get(ENCRYPTION_SECRET_KEY)).toMatch(
      /^[A-Za-z0-9_-]{64}$/,
    );
    await expect(service.open(sealed, 'purpose')).resolves.toBe(
      'sk-secret-value',
    );
  });

  it('cannot open a value after SECRETS_KEY changes or the stored key is gone', async () => {
    const mock = createPrismaMock();
    const sealedWithEnv = await new SecretsService(
      mock.prisma,
      buildConfig({ SECRETS_KEY: 's'.repeat(40) }),
    ).seal('sk-secret-value', 'purpose');
    const rotated = new SecretsService(
      mock.prisma,
      buildConfig({ SECRETS_KEY: 't'.repeat(40) }),
    );
    await expect(rotated.open(sealedWithEnv, 'purpose')).resolves.toBeNull();
    await expect(
      new SecretsService(mock.prisma, buildConfig()).open(
        sealedWithEnv,
        'purpose',
      ),
    ).resolves.toBeNull();

    const sealedWithDb = await new SecretsService(
      mock.prisma,
      buildConfig(),
    ).seal('sk-secret-value', 'purpose');
    mock.store.delete(ENCRYPTION_SECRET_KEY);
    await expect(rotated.open(sealedWithDb, 'purpose')).resolves.toBeNull();
    expect(mock.store.has(ENCRYPTION_SECRET_KEY)).toBe(false);
  });

  it('generates 48 random bytes encoded as base64url', () => {
    const secret = generateSecret();
    expect(Buffer.from(secret, 'base64url')).toHaveLength(48);
    expect(generateSecret()).not.toBe(secret);
  });
});
