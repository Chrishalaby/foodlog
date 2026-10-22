UPDATE "User" SET "aiBudgetUnlimited" = true, "aiMonthlyBudgetUsd" = NULL
WHERE "aiMonthlyBudgetUsd" >= 10000;
