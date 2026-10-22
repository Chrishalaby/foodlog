import type {
  AdminAccessRequestDto,
  AdminInviteDto,
  AdminUserDto,
  UserRole,
  UserStatus,
} from '@food/shared';
import type { AuthTokenWithCreator } from '../auth/auth-token-queries.js';
import { inviteStatus } from '../auth/auth-token-state.js';
import type { Prisma } from '../generated/prisma/client.js';

export const ACCESS_REQUEST_INCLUDE = {
  decidedBy: { select: { email: true } },
} as const satisfies Prisma.AccessRequestInclude;

export type AccessRequestWithDecider = Prisma.AccessRequestGetPayload<{
  include: typeof ACCESS_REQUEST_INCLUDE;
}>;

export const ADMIN_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  status: true,
  createdAt: true,
  lastSeenAt: true,
  aiMonthlyBudgetUsd: true,
  aiBudgetUnlimited: true,
} as const satisfies Prisma.UserSelect;

export interface AdminUserRow {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: Date;
  lastSeenAt: Date | null;
  aiMonthlyBudgetUsd: number | null;
  aiBudgetUnlimited: boolean;
}

export interface UserAggregates {
  entryCount: number;
  aiRequestsMonth: number;
  aiCostMonthUsd: number;
  activeSessions: number;
}

export const EMPTY_AGGREGATES: UserAggregates = {
  entryCount: 0,
  aiRequestsMonth: 0,
  aiCostMonthUsd: 0,
  activeSessions: 0,
};

export function toAdminInviteDto(
  row: AuthTokenWithCreator,
  now: Date,
): AdminInviteDto {
  return {
    id: row.id,
    type: row.type,
    email: row.email,
    name: row.name,
    role: row.role,
    status: inviteStatus(row, now),
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString() ?? null,
    createdByEmail: row.createdBy?.email ?? null,
  };
}

export function toAdminAccessRequestDto(
  row: AccessRequestWithDecider,
  hasAccount: boolean,
): AdminAccessRequestDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedByEmail: row.decidedBy?.email ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    hasAccount,
  };
}

export function toAdminUserDto(
  row: AdminUserRow,
  aggregates: UserAggregates,
  effectiveBudgetUsd: number | null,
  isSelf: boolean,
): AdminUserDto {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    entryCount: aggregates.entryCount,
    aiRequestsMonth: aggregates.aiRequestsMonth,
    aiCostMonthUsd: aggregates.aiCostMonthUsd,
    aiMonthlyBudgetUsd: row.aiMonthlyBudgetUsd,
    aiBudgetUnlimited: row.aiBudgetUnlimited,
    effectiveBudgetUsd,
    activeSessions: aggregates.activeSessions,
    isSelf,
  };
}
