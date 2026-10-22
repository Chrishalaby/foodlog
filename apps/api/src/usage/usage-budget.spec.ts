import {
  type BudgetSubject,
  effectiveBudgetUsd,
  isBudgetReached,
  UNKNOWN_BUDGET_SUBJECT,
} from './usage-budget.js';

function subject(overrides: Partial<BudgetSubject>): BudgetSubject {
  return { ...UNKNOWN_BUDGET_SUBJECT, ...overrides };
}

describe('AI budgets', () => {
  it('uses the per-person budget when one is set, for admins too', () => {
    expect(effectiveBudgetUsd(subject({ aiMonthlyBudgetUsd: 12 }), 5)).toBe(12);
    expect(
      effectiveBudgetUsd(subject({ role: 'admin', aiMonthlyBudgetUsd: 3 }), 5),
    ).toBe(3);
    expect(effectiveBudgetUsd(subject({ aiMonthlyBudgetUsd: 0 }), 5)).toBe(0);
  });

  it('falls back to unlimited for admins and the member default otherwise', () => {
    expect(effectiveBudgetUsd(subject({ role: 'admin' }), 5)).toBeNull();
    expect(effectiveBudgetUsd(subject({}), 5)).toBe(5);
    expect(effectiveBudgetUsd(subject({}), null)).toBeNull();
  });

  it('is unlimited whenever the unlimited flag is set', () => {
    expect(
      effectiveBudgetUsd(subject({ aiBudgetUnlimited: true }), 5),
    ).toBeNull();
    expect(
      effectiveBudgetUsd(
        subject({ aiBudgetUnlimited: true, aiMonthlyBudgetUsd: 3 }),
        5,
      ),
    ).toBeNull();
    expect(
      effectiveBudgetUsd(
        subject({ role: 'admin', aiBudgetUnlimited: true }),
        5,
      ),
    ).toBeNull();
  });

  it('treats an unknown person as a member on the default budget', () => {
    expect(effectiveBudgetUsd(UNKNOWN_BUDGET_SUBJECT, 5)).toBe(5);
  });

  it('reports a budget as reached once spending meets it', () => {
    expect(isBudgetReached(4.99, 5)).toBe(false);
    expect(isBudgetReached(5, 5)).toBe(true);
    expect(isBudgetReached(0, 0)).toBe(true);
    expect(isBudgetReached(1_000, null)).toBe(false);
  });
});
