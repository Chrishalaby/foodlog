import { Prisma } from '../generated/prisma/client.js';

const UNIQUE_VIOLATION = 'P2002';

export function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_VIOLATION
  );
}

export async function retryOnUniqueViolation<T>(
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    return run();
  }
}
