import type { UserRole } from '@food/shared';
import type { Prisma } from '../generated/prisma/client.js';

export const USER_BUDGET_REACHED_MESSAGE = 'Your monthly AI budget is used up';

export interface BudgetSubject {
  role: UserRole;
  aiMonthlyBudgetUsd: number | null;
  aiBudgetUnlimited: boolean;
}

export const BUDGET_SUBJECT_SELECT = {
  role: true,
  aiMonthlyBudgetUsd: true,
  aiBudgetUnlimited: true,
} as const satisfies Prisma.UserSelect;

export const UNKNOWN_BUDGET_SUBJECT: BudgetSubject = {
  role: 'member',
  aiMonthlyBudgetUsd: null,
  aiBudgetUnlimited: false,
};

export function effectiveBudgetUsd(
  user: BudgetSubject,
  memberDefaultUsd: number | null,
): number | null {
  if (user.aiBudgetUnlimited) {
    return null;
  }
  if (user.aiMonthlyBudgetUsd !== null) {
    return user.aiMonthlyBudgetUsd;
  }
  return user.role === 'admin' ? null : memberDefaultUsd;
}

export function isBudgetReached(
  spentUsd: number,
  budgetUsd: number | null,
): boolean {
  return budgetUsd !== null && spentUsd >= budgetUsd;
}
