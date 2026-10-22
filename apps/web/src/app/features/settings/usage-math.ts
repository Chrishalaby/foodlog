import { type UsageMode, type UsageSummaryResponse, isFiniteNumber } from '@food/shared';

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const USAGE_MODE_LABELS: Record<UsageMode, string> = {
  food_photo: 'Photo',
  nutrition_label: 'Label',
  text: 'Text',
  menu: 'Menu',
  voice: 'Voice',
  ideas: 'Meal ideas',
};

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DAY_MS = 86_400_000;

const pad = (value: number): string => String(value).padStart(2, '0');

export function utcMonthOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

function parseMonth(month: string): { year: number; monthIndex: number } | null {
  const match = MONTH_PATTERN.exec(month);
  if (!match) {
    return null;
  }
  const monthIndex = Number(match[2]) - 1;
  return monthIndex >= 0 && monthIndex < 12 ? { year: Number(match[1]), monthIndex } : null;
}

export function recentUtcMonths(now: Date, count: number): string[] {
  const months: string[] = [];
  for (let offset = 0; offset < count; offset++) {
    months.push(
      utcMonthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1))),
    );
  }
  return months;
}

export function monthLabel(month: string): string {
  const parsed = parseMonth(month);
  return parsed ? `${MONTH_NAMES[parsed.monthIndex]} ${parsed.year}` : month;
}

export function utcMonthRange(month: string): { startMs: number; endMs: number } | null {
  const parsed = parseMonth(month);
  if (!parsed) {
    return null;
  }
  return {
    startMs: Date.UTC(parsed.year, parsed.monthIndex, 1),
    endMs: Date.UTC(parsed.year, parsed.monthIndex + 1, 1),
  };
}

export function projectMonthEndUsd(
  monthToDateUsd: number,
  month: string,
  now: Date,
): number | null {
  const range = utcMonthRange(month);
  const nowMs = now.getTime();
  if (!range || nowMs < range.startMs || nowMs >= range.endMs) {
    return null;
  }
  const elapsedDays = Math.max(1, (nowMs - range.startMs) / DAY_MS);
  const totalDays = (range.endMs - range.startMs) / DAY_MS;
  const spent = isFiniteNumber(monthToDateUsd) ? Math.max(0, monthToDateUsd) : 0;
  return (spent / elapsedDays) * totalDays;
}

export type BudgetLevel = 'ok' | 'warn' | 'over';

export interface BudgetStatus {
  percent: number;
  fillPercent: number;
  level: BudgetLevel;
  remainingUsd: number;
}

export const BUDGET_WARN_RATIO = 0.8;

export function budgetStatus(spentUsd: number, budgetUsd: number | null): BudgetStatus | null {
  if (budgetUsd === null || !isFiniteNumber(budgetUsd) || budgetUsd <= 0) {
    return null;
  }
  const spent = isFiniteNumber(spentUsd) ? Math.max(0, spentUsd) : 0;
  const ratio = spent / budgetUsd;
  return {
    percent: Math.round(ratio * 100),
    fillPercent: Math.min(100, ratio * 100),
    level: ratio >= 1 ? 'over' : ratio >= BUDGET_WARN_RATIO ? 'warn' : 'ok',
    remainingUsd: Math.max(0, budgetUsd - spent),
  };
}

export function budgetNote(
  status: BudgetStatus,
  currentMonth: boolean,
  projectedOver: boolean,
): string {
  if (!currentMonth) {
    return status.level === 'over'
      ? `Budget reached (${status.percent}% used).`
      : `${status.percent}% of the budget used.`;
  }
  if (status.level === 'over') {
    return 'Budget reached. New analyses are blocked until next month.';
  }
  if (projectedOver) {
    return `${status.percent}% used. At this pace you will hit the budget before the month ends.`;
  }
  return `${status.percent}% used · ${formatUsd(status.remainingUsd)} left`;
}

export function formatUsd(value: number): string {
  const safe = isFiniteNumber(value) ? Math.max(0, value) : 0;
  if (safe === 0) {
    return '$0.00';
  }
  if (safe < 0.001) {
    return '<$0.001';
  }
  const maximumFractionDigits = safe < 1 ? 3 : 2;
  return `$${safe.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits })}`;
}

export function formatTokenCount(tokens: number): string {
  const safe = isFiniteNumber(tokens) ? Math.max(0, Math.round(tokens)) : 0;
  if (safe < 1000) {
    return String(safe);
  }
  if (safe < 1_000_000) {
    return `${(safe / 1000).toLocaleString('en-US', { maximumFractionDigits: safe < 10_000 ? 1 : 0 })}k`;
  }
  return `${(safe / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}M`;
}

export function formatDuration(durationMs: number): string {
  const safe = isFiniteNumber(durationMs) ? Math.max(0, durationMs) : 0;
  if (safe < 1000) {
    return `${Math.round(safe)} ms`;
  }
  return `${(safe / 1000).toLocaleString('en-US', { maximumFractionDigits: safe < 10_000 ? 1 : 0 })} s`;
}

export interface ModelUsageRow {
  model: string;
  label: string;
  requests: number;
  costUsd: number;
  share: number;
}

export function modelBreakdown(
  byModel: UsageSummaryResponse['byModel'],
  labels: ReadonlyMap<string, string>,
): ModelUsageRow[] {
  const totalCost = byModel.reduce((sum, row) => sum + Math.max(0, row.costUsd), 0);
  const totalRequests = byModel.reduce((sum, row) => sum + Math.max(0, row.requests), 0);
  return byModel
    .map((row) => ({
      model: row.model,
      label: labels.get(row.model) ?? row.model,
      requests: row.requests,
      costUsd: row.costUsd,
      share:
        totalCost > 0
          ? Math.max(0, row.costUsd) / totalCost
          : totalRequests > 0
            ? Math.max(0, row.requests) / totalRequests
            : 0,
    }))
    .sort(
      (a, b) => b.costUsd - a.costUsd || b.requests - a.requests || a.label.localeCompare(b.label),
    );
}
