import type { AccessRequestStatusResponse } from '@food/shared';
import type { AccessRequest } from '../generated/prisma/client.js';

export const UNKNOWN_ACCESS_STATUS: AccessRequestStatusResponse = {
  status: 'unknown',
  email: null,
  name: null,
  createdAt: null,
  decidedAt: null,
  canCreateAccount: false,
};

export type AccessRequestSnapshot = Pick<
  AccessRequest,
  'email' | 'name' | 'status' | 'createdAt' | 'decidedAt' | 'acceptedAt'
>;

export function canCreateAccount(
  request: Pick<AccessRequestSnapshot, 'status' | 'acceptedAt'>,
  hasAccount: boolean,
): boolean {
  return (
    request.status === 'approved' && request.acceptedAt === null && !hasAccount
  );
}

export function toAccessStatus(
  request: AccessRequestSnapshot,
  hasAccount: boolean,
): AccessRequestStatusResponse {
  return {
    status: request.status,
    email: request.email,
    name: request.name,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    canCreateAccount: canCreateAccount(request, hasAccount),
  };
}
