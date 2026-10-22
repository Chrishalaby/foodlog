import type { UserRole, UserStatus } from '@food/shared';

export interface RoleAndStatus {
  role: UserRole;
  status: UserStatus;
}

export interface RoleStatusChange {
  role?: UserRole;
  status?: UserStatus;
}

export interface BudgetChange {
  aiMonthlyBudgetUsd?: number | null;
  aiBudgetUnlimited?: boolean;
}

export function budgetUpdate(change: BudgetChange): BudgetChange {
  if (typeof change.aiMonthlyBudgetUsd === 'number') {
    return {
      aiMonthlyBudgetUsd: change.aiMonthlyBudgetUsd,
      aiBudgetUnlimited: false,
    };
  }
  if (change.aiBudgetUnlimited === true) {
    return { aiMonthlyBudgetUsd: null, aiBudgetUnlimited: true };
  }
  return {
    aiMonthlyBudgetUsd: change.aiMonthlyBudgetUsd,
    aiBudgetUnlimited: change.aiBudgetUnlimited,
  };
}

export function isActiveAdmin(user: RoleAndStatus): boolean {
  return user.role === 'admin' && user.status === 'active';
}

export function applyChange(
  user: RoleAndStatus,
  change: RoleStatusChange,
): RoleAndStatus {
  return {
    role: change.role ?? user.role,
    status: change.status ?? user.status,
  };
}

export function changesRoleOrStatus(
  user: RoleAndStatus,
  change: RoleStatusChange,
): boolean {
  const next = applyChange(user, change);
  return next.role !== user.role || next.status !== user.status;
}

export function removesActiveAdmin(
  user: RoleAndStatus,
  change: RoleStatusChange,
): boolean {
  return isActiveAdmin(user) && !isActiveAdmin(applyChange(user, change));
}

export function demotesListedAdmin(
  user: RoleAndStatus,
  change: RoleStatusChange,
  listedInAdminEmails: boolean,
): boolean {
  return listedInAdminEmails && applyChange(user, change).role !== 'admin';
}
