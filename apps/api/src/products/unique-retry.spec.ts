import { Prisma } from '../generated/prisma/client.js';
import { isUniqueViolation, retryOnUniqueViolation } from './unique-retry.js';

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('conflict', {
    code,
    clientVersion: Prisma.prismaVersion.client,
  });
}

describe('retryOnUniqueViolation', () => {
  it('returns the first result', async () => {
    const run = vi.fn().mockResolvedValue('saved');

    await expect(retryOnUniqueViolation(run)).resolves.toBe('saved');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries once after a concurrent insert of the same row', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(prismaError('P2002'))
      .mockResolvedValueOnce('existing');

    await expect(retryOnUniqueViolation(run)).resolves.toBe('existing');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry', async () => {
    const run = vi.fn().mockRejectedValue(prismaError('P2002'));

    await expect(retryOnUniqueViolation(run)).rejects.toSatisfy(
      isUniqueViolation,
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('rethrows other errors without retrying', async () => {
    const other = prismaError('P2025');
    const run = vi.fn().mockRejectedValue(other);

    await expect(retryOnUniqueViolation(run)).rejects.toBe(other);
    expect(run).toHaveBeenCalledTimes(1);
    expect(isUniqueViolation(new Error('P2002'))).toBe(false);
  });
});
