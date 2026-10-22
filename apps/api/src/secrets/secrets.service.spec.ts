import { buildConfig } from '../../test/support/config.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
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

  it('generates 48 random bytes encoded as base64url', () => {
    const secret = generateSecret();
    expect(Buffer.from(secret, 'base64url')).toHaveLength(48);
    expect(generateSecret()).not.toBe(secret);
  });
});
