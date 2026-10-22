import type { AuthToken, Prisma } from '../generated/prisma/client.js';
import { EMAIL_LOCK_NAMESPACE } from './auth.constants.js';

type Client = Pick<Prisma.TransactionClient, 'authToken'>;
type LockClient = Pick<Prisma.TransactionClient, '$executeRaw'>;

export const AUTH_TOKEN_INCLUDE = {
  createdBy: { select: { email: true } },
} as const satisfies Prisma.AuthTokenInclude;

export type AuthTokenWithCreator = Prisma.AuthTokenGetPayload<{
  include: typeof AUTH_TOKEN_INCLUDE;
}>;

export function pendingTokens(
  where: Prisma.AuthTokenWhereInput,
): Prisma.AuthTokenWhereInput {
  return { ...where, usedAt: null, revokedAt: null };
}

export function revokePendingTokens(
  client: Client,
  where: Prisma.AuthTokenWhereInput,
  now: Date,
): Promise<Prisma.BatchPayload> {
  return client.authToken.updateMany({
    where: pendingTokens(where),
    data: { revokedAt: now },
  });
}

export async function lockEmail(
  client: LockClient,
  email: string,
): Promise<void> {
  await client.$executeRaw`SELECT pg_advisory_xact_lock(${EMAIL_LOCK_NAMESPACE}::int, hashtext(${email}))`;
}

export function sameRecipientTokens(
  token: Pick<AuthToken, 'id' | 'type' | 'email' | 'userId'>,
): Prisma.AuthTokenWhereInput {
  if (token.type === 'invite') {
    return { type: 'invite', email: token.email };
  }
  return token.userId
    ? { type: 'reset', userId: token.userId }
    : { id: token.id };
}
