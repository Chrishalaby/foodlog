import {
  budgetUpdate,
  changesRoleOrStatus,
  demotesListedAdmin,
  isActiveAdmin,
  removesActiveAdmin,
} from './admin-rules.js';

const activeAdmin = { role: 'admin', status: 'active' } as const;
const disabledAdmin = { role: 'admin', status: 'disabled' } as const;
const member = { role: 'member', status: 'active' } as const;

describe('admin rules', () => {
  it('recognizes active admins only', () => {
    expect(isActiveAdmin(activeAdmin)).toBe(true);
    expect(isActiveAdmin(disabledAdmin)).toBe(false);
    expect(isActiveAdmin(member)).toBe(false);
  });

  it('detects real role or status changes, ignoring no-op values', () => {
    expect(changesRoleOrStatus(activeAdmin, {})).toBe(false);
    expect(
      changesRoleOrStatus(activeAdmin, { role: 'admin', status: 'active' }),
    ).toBe(false);
    expect(changesRoleOrStatus(activeAdmin, { role: 'member' })).toBe(true);
    expect(changesRoleOrStatus(member, { status: 'disabled' })).toBe(true);
  });

  it('flags demoting or disabling an active admin', () => {
    expect(removesActiveAdmin(activeAdmin, { role: 'member' })).toBe(true);
    expect(removesActiveAdmin(activeAdmin, { status: 'disabled' })).toBe(true);
    expect(removesActiveAdmin(activeAdmin, { role: 'admin' })).toBe(false);
    expect(removesActiveAdmin(disabledAdmin, { role: 'member' })).toBe(false);
    expect(removesActiveAdmin(member, { role: 'admin' })).toBe(false);
  });

  it('refuses to demote someone listed in ADMIN_EMAILS', () => {
    expect(demotesListedAdmin(activeAdmin, { role: 'member' }, true)).toBe(
      true,
    );
    expect(demotesListedAdmin(activeAdmin, { role: 'member' }, false)).toBe(
      false,
    );
    expect(demotesListedAdmin(activeAdmin, { status: 'disabled' }, true)).toBe(
      false,
    );
  });

  it('clears the unlimited flag when a custom budget is set', () => {
    expect(budgetUpdate({ aiMonthlyBudgetUsd: 12.5 })).toEqual({
      aiMonthlyBudgetUsd: 12.5,
      aiBudgetUnlimited: false,
    });
    expect(
      budgetUpdate({ aiMonthlyBudgetUsd: 0, aiBudgetUnlimited: false }),
    ).toEqual({ aiMonthlyBudgetUsd: 0, aiBudgetUnlimited: false });
  });

  it('clears the custom budget when the budget becomes unlimited', () => {
    expect(budgetUpdate({ aiBudgetUnlimited: true })).toEqual({
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: true,
    });
    expect(
      budgetUpdate({ aiMonthlyBudgetUsd: null, aiBudgetUnlimited: true }),
    ).toEqual({ aiMonthlyBudgetUsd: null, aiBudgetUnlimited: true });
  });

  it('passes other budget changes through and leaves absent fields unchanged', () => {
    expect(budgetUpdate({})).toEqual({
      aiMonthlyBudgetUsd: undefined,
      aiBudgetUnlimited: undefined,
    });
    expect(budgetUpdate({ aiMonthlyBudgetUsd: null })).toEqual({
      aiMonthlyBudgetUsd: null,
      aiBudgetUnlimited: undefined,
    });
    expect(budgetUpdate({ aiBudgetUnlimited: false })).toEqual({
      aiMonthlyBudgetUsd: undefined,
      aiBudgetUnlimited: false,
    });
  });
});
